begin;

-- WEB-CONTROL-CENTERS-B1-QA-C3
-- PostgreSQL implements GREATEST/LEAST as conditional expressions rather than
-- pg_catalog functions. Keep the B1 draft-list authority intact and replace
-- only the invalid schema-qualified expressions in its limit clamp.

create or replace function public.list_my_publication_drafts_v1(
  p_limit integer default 20,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null
) returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1,least(coalesce(p_limit,20),50));
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if (p_cursor_updated_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023',message='publication_draft_cursor_invalid';
  end if;
  return query
  select private.publication_draft_json_v1(draft)
  from private.publication_drafts draft
  where draft.owner_id=v_actor and draft.state='draft'
    and (p_cursor_updated_at is null or (draft.updated_at,draft.id)<(p_cursor_updated_at,p_cursor_id))
  order by draft.updated_at desc,draft.id desc
  limit v_limit;
end;
$function$;

commit;
