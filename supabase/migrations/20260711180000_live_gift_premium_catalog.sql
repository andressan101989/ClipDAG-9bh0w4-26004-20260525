-- ============================================================================
-- LIVE gift premium catalog metadata + backend-authored animation events.
--
-- Keeps the existing financial path intact:
--   gift_catalog -> send_live_gift() -> atomic_ledger_transfer()
--   -> ledger_accounts / financial_transactions / live_gift_transactions
--   -> trigger-authored live_control_events payload.
-- ============================================================================

begin;

alter table public.gift_catalog
  add column if not exists icon text,
  add column if not exists category text not null default 'basic',
  add column if not exists animation_type text not null default 'floating',
  add column if not exists animation_asset text,
  add column if not exists duration_ms integer not null default 1800,
  add column if not exists priority integer not null default 0,
  add column if not exists enabled boolean not null default true,
  add column if not exists display_order integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gift_catalog_category_check'
      and conrelid = 'public.gift_catalog'::regclass
  ) then
    alter table public.gift_catalog
      add constraint gift_catalog_category_check
      check (category in ('basic', 'premium', 'legendary'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gift_catalog_animation_type_check'
      and conrelid = 'public.gift_catalog'::regclass
  ) then
    alter table public.gift_catalog
      add constraint gift_catalog_animation_type_check
      check (animation_type in ('floating', 'center', 'fullscreen', 'entrance', 'celebration'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gift_catalog_duration_ms_check'
      and conrelid = 'public.gift_catalog'::regclass
  ) then
    alter table public.gift_catalog
      add constraint gift_catalog_duration_ms_check
      check (duration_ms between 500 and 15000);
  end if;
end $$;

update public.gift_catalog
set
  icon = coalesce(icon, emoji),
  category = 'basic',
  animation_type = case when id in ('crown', 'diamond') then 'center' else 'floating' end,
  duration_ms = case
    when id = 'diamond' then 2600
    when id = 'crown' then 2400
    when id = 'fire' then 2000
    when id = 'rose' then 1900
    else 1800
  end,
  priority = case
    when id = 'diamond' then 10
    when id = 'crown' then 8
    when id = 'fire' then 3
    when id = 'rose' then 2
    else 1
  end,
  enabled = active,
  display_order = coalesce(display_order, sort_order)
where id in ('heart', 'rose', 'fire', 'crown', 'diamond');

insert into public.gift_catalog (
  id, emoji, icon, label, cost_coins, sort_order, display_order,
  category, animation_type, duration_ms, priority, active, enabled
) values
  ('lion',       chr(129409),                chr(129409),                'Leon',           250,  20, 20, 'premium',   'center',      3000, 20, true, true),
  ('rocket',     chr(128640),                chr(128640),                'Cohete',         300,  25, 25, 'premium',   'entrance',    3200, 25, true, true),
  ('sports_car', chr(127950) || chr(65039),  chr(127950) || chr(65039),  'Auto deportivo', 450,  30, 30, 'premium',   'entrance',    3400, 30, true, true),
  ('phoenix',    chr(128293),                chr(128293),                'Fenix',          600,  45, 45, 'legendary', 'celebration', 4000, 45, true, true),
  ('dragon',     chr(128009),                chr(128009),                'Dragon',         750,  50, 50, 'legendary', 'fullscreen',  4500, 50, true, true),
  ('castle',     chr(127984),                chr(127984),                'Castillo',       900,  55, 55, 'legendary', 'center',      4600, 55, true, true),
  ('galaxy',     chr(127756),                chr(127756),                'Galaxia',       1200,  60, 60, 'legendary', 'fullscreen',  5200, 60, true, true)
on conflict (id) do update set
  emoji = excluded.emoji,
  icon = excluded.icon,
  label = excluded.label,
  cost_coins = excluded.cost_coins,
  sort_order = excluded.sort_order,
  display_order = excluded.display_order,
  category = excluded.category,
  animation_type = excluded.animation_type,
  duration_ms = excluded.duration_ms,
  priority = excluded.priority,
  active = excluded.active,
  enabled = excluded.enabled;

create index if not exists gift_catalog_enabled_display_idx
  on public.gift_catalog (enabled, active, display_order);

create unique index if not exists live_control_events_gift_transaction_uidx
  on public.live_control_events ((payload ->> 'transaction_id'))
  where event_type = 'reaction'
    and payload ->> 'gift_real' = 'true'
    and payload ? 'transaction_id';

create or replace function public.emit_live_gift_control_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gift public.gift_catalog%rowtype;
  v_sender_username text;
  v_sender_avatar_url text;
begin
  select * into v_gift
  from public.gift_catalog gc
  where gc.id = new.gift_id;

  select up.username, up.avatar_url
    into v_sender_username, v_sender_avatar_url
  from public.user_profiles up
  where up.id = new.sender_user_id;

  insert into public.live_control_events (
    session_id,
    target_user_id,
    actor_user_id,
    event_type,
    payload
  ) values (
    new.session_id,
    new.sender_user_id,
    new.sender_user_id,
    'reaction',
    jsonb_build_object(
      'gift_real', true,
      'gift_visual', true,
      'transaction_id', new.id,
      'session_id', new.session_id,
      'sender_user_id', new.sender_user_id,
      'sender_username', coalesce(v_sender_username, 'Invitado'),
      'username', coalesce(v_sender_username, 'Invitado'),
      'sender_avatar_url', v_sender_avatar_url,
      'avatar_url', v_sender_avatar_url,
      'recipient_user_id', new.receiver_user_id,
      'gift_id', new.gift_id,
      'gift_name', coalesce(v_gift.label, new.gift_id),
      'emoji', coalesce(v_gift.icon, v_gift.emoji, new.emoji),
      'icon', coalesce(v_gift.icon, v_gift.emoji, new.emoji),
      'amount_bdag', new.amount_coins,
      'amount_coins', new.amount_coins,
      'category', coalesce(v_gift.category, 'basic'),
      'animation_type', coalesce(v_gift.animation_type, 'floating'),
      'animation_asset', v_gift.animation_asset,
      'duration_ms', coalesce(v_gift.duration_ms, 1800),
      'priority', coalesce(v_gift.priority, 0),
      'created_at', new.created_at
    )
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists live_gift_transactions_emit_control_event on public.live_gift_transactions;
create trigger live_gift_transactions_emit_control_event
  after insert on public.live_gift_transactions
  for each row
  execute function public.emit_live_gift_control_event();

commit;
