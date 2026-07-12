begin;

alter table public.gift_catalog
  add column if not exists category text not null default 'basic',
  add column if not exists animation_type text not null default 'floating',
  add column if not exists animation_asset text,
  add column if not exists duration_ms integer not null default 1800,
  add column if not exists priority integer not null default 0,
  add column if not exists enabled boolean not null default true,
  add column if not exists display_order integer;

insert into public.gift_catalog (
  id,
  emoji,
  icon,
  label,
  cost_coins,
  sort_order,
  display_order,
  category,
  animation_type,
  animation_asset,
  duration_ms,
  priority,
  active,
  enabled
) values (
  'private_jet',
  chr(9992) || chr(65039),
  chr(9992) || chr(65039),
  'Jet Privado',
  450,
  30,
  30,
  'premium',
  'entrance',
  null,
  3600,
  32,
  true,
  true
)
on conflict (id) do update set
  emoji = excluded.emoji,
  icon = excluded.icon,
  label = excluded.label,
  cost_coins = excluded.cost_coins,
  sort_order = excluded.sort_order,
  display_order = excluded.display_order,
  category = excluded.category,
  animation_type = excluded.animation_type,
  animation_asset = excluded.animation_asset,
  duration_ms = excluded.duration_ms,
  priority = excluded.priority,
  active = true,
  enabled = true;

update public.gift_catalog
set active = false,
    enabled = false,
    display_order = coalesce(display_order, sort_order, 30)
where id = 'sports_car';

commit;
