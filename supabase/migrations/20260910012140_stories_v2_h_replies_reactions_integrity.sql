-- STORIES-V2-H: canonical private replies through Chat V2 and owner-private reactions.

create table if not exists public.story_reactions (
  story_id uuid not null references public.stories(id) on delete cascade,
  reactor_id uuid not null references public.user_profiles(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_reactions_pkey primary key (story_id, reactor_id),
  constraint story_reactions_reaction_check check (
    reaction = any (array['heart', 'laugh', 'wow', 'sad', 'fire', 'clap']::text[])
  )
);

create index if not exists story_reactions_story_updated_reactor_idx
  on public.story_reactions (story_id, updated_at desc, reactor_id desc);

alter table public.story_reactions enable row level security;

drop policy if exists story_reactions_read_own on public.story_reactions;
create policy story_reactions_read_own
  on public.story_reactions
  for select
  to authenticated
  using (reactor_id = (select auth.uid()));

revoke all on table public.story_reactions from public, anon, authenticated;
grant select on table public.story_reactions to authenticated;

create or replace function public.set_story_reaction(
  p_story_id uuid,
  p_reaction text
)
returns table (
  status text,
  reaction text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_expires_at timestamptz;
  v_previous text;
  v_updated_at timestamptz;
  v_removed boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;
  if p_reaction is not null and p_reaction <> all (
    array['heart', 'laugh', 'wow', 'sad', 'fire', 'clap']::text[]
  ) then
    raise exception using errcode = '22023', message = 'invalid_story_reaction';
  end if;

  select s.user_id, s.expires_at
  into v_owner, v_expires_at
  from public.stories s
  where s.id = p_story_id
  for share;

  if v_owner is null or v_expires_at <= now() then
    raise exception using errcode = '42501', message = 'story_not_available';
  end if;
  if v_owner = v_actor then
    raise exception using errcode = '42501', message = 'story_owner_cannot_react';
  end if;
  if not private.story_can_view_owner(v_owner) then
    raise exception using errcode = '42501', message = 'story_not_visible';
  end if;

  if p_reaction is null then
    delete from public.story_reactions r
    where r.story_id = p_story_id
      and r.reactor_id = v_actor
    returning r.updated_at into v_updated_at;
    v_removed := found;

    return query select
      case when v_removed then 'removed'::text else 'unchanged'::text end,
      null::text,
      v_updated_at;
    return;
  end if;

  select r.reaction
  into v_previous
  from public.story_reactions r
  where r.story_id = p_story_id
    and r.reactor_id = v_actor
  for update;

  insert into public.story_reactions as r (
    story_id, reactor_id, reaction, created_at, updated_at
  ) values (
    p_story_id, v_actor, p_reaction, now(), now()
  )
  on conflict (story_id, reactor_id) do update
  set reaction = excluded.reaction,
      updated_at = case
        when r.reaction is distinct from excluded.reaction then now()
        else r.updated_at
      end
  returning r.updated_at into v_updated_at;

  return query select
    case when v_previous = p_reaction then 'unchanged'::text else 'set'::text end,
    p_reaction,
    v_updated_at;
end;
$function$;

create or replace function public.get_story_reactions(
  p_story_id uuid,
  p_limit integer default 50,
  p_before_updated_at timestamptz default null,
  p_before_reactor_id uuid default null
)
returns table (
  reactor_id uuid,
  username text,
  avatar_url text,
  reaction text,
  reacted_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;
  if (p_before_updated_at is null) <> (p_before_reactor_id is null) then
    raise exception using errcode = '22023', message = 'invalid_reaction_cursor';
  end if;

  select s.user_id
  into v_owner
  from public.stories s
  where s.id = p_story_id;

  if v_owner is null or v_owner <> v_actor then
    raise exception using errcode = '42501', message = 'story_not_found_or_not_owned';
  end if;

  return query
  with reaction_total as (
    select count(*)::bigint as total_count
    from public.story_reactions r
    where r.story_id = p_story_id
  ), reaction_page as (
    select r.reactor_id, r.reaction, r.updated_at
    from public.story_reactions r
    where r.story_id = p_story_id
      and (
        p_before_updated_at is null
        or (r.updated_at, r.reactor_id) < (p_before_updated_at, p_before_reactor_id)
      )
    order by r.updated_at desc, r.reactor_id desc
    limit v_limit
  )
  select
    rp.reactor_id,
    coalesce(up.username, 'user')::text,
    up.avatar_url,
    rp.reaction,
    rp.updated_at,
    rt.total_count
  from reaction_page rp
  join public.user_profiles up on up.id = rp.reactor_id
  cross join reaction_total rt
  order by rp.updated_at desc, rp.reactor_id desc;
end;
$function$;

create or replace function public.reply_to_story(
  p_story_id uuid,
  p_client_message_id uuid,
  p_text text
)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_expires_at timestamptz;
  v_body text := btrim(coalesce(p_text, ''));
  v_prefix constant text := 'Respondió a tu historia';
  v_conversation public.chat_conversations;
  v_message public.messages;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_id';
  end if;
  if p_client_message_id is null then
    raise exception using errcode = '22023', message = 'invalid_client_message_id';
  end if;
  if v_body = '' then
    raise exception using errcode = '22023', message = 'empty_story_reply';
  end if;
  if char_length(v_body) > 4975 then
    raise exception using errcode = '22023', message = 'story_reply_too_long';
  end if;

  select s.user_id, s.expires_at
  into v_owner, v_expires_at
  from public.stories s
  where s.id = p_story_id
  for share;

  if v_owner is null or v_expires_at <= now() then
    raise exception using errcode = '42501', message = 'story_not_available';
  end if;
  if v_owner = v_actor then
    raise exception using errcode = '42501', message = 'story_owner_cannot_reply';
  end if;
  if not private.story_can_view_owner(v_owner) then
    raise exception using errcode = '42501', message = 'story_not_visible';
  end if;

  select * into v_conversation
  from public.chat_get_or_create_direct(v_owner);

  select * into v_message
  from public.chat_send_message(
    v_conversation.id,
    p_client_message_id,
    v_prefix || E'\n' || v_body,
    'text',
    null,
    null,
    null,
    null,
    null
  );

  return v_message;
end;
$function$;

revoke all on function public.set_story_reaction(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_story_reaction(uuid, text) to authenticated;

revoke all on function public.get_story_reactions(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_story_reactions(uuid, integer, timestamptz, uuid) to authenticated;

revoke all on function public.reply_to_story(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reply_to_story(uuid, uuid, text) to authenticated;
