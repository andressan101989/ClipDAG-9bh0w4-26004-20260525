begin;

do $proof$
declare
  v_columns integer;
  v_internal_publications integer;
begin
  select count(*) into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'live_battle_public_states'
    and column_name in (
      'boost_rule_version', 'rose_target_units',
      'challenger_rose_progress_units', 'opponent_rose_progress_units',
      'challenger_rose_activations_remaining',
      'opponent_rose_activations_remaining',
      'challenger_glove_uses_remaining', 'opponent_glove_uses_remaining',
      'challenger_x2_starts_at', 'challenger_x2_expires_at',
      'opponent_x2_starts_at', 'opponent_x2_expires_at',
      'challenger_x3_starts_at', 'challenger_x3_expires_at',
      'opponent_x3_starts_at', 'opponent_x3_expires_at',
      'power_version', 'power_updated_at', 'server_clock_at'
    );
  if v_columns <> 19 then
    raise exception 'f4d_b_projection_columns_failed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'live_battle_public_states'
      and relation.relrowsecurity
  ) then
    raise exception 'f4d_b_projection_rls_failed';
  end if;

  select count(*) into v_internal_publications
  from pg_catalog.pg_publication_tables
  where pubname = 'supabase_realtime'
    and tablename in (
      'live_battle_rule_sets', 'live_battle_current_rule_set',
      'live_battle_power_states', 'live_battle_boost_events',
      'live_battle_score_events'
    );
  if v_internal_publications <> 0 then
    raise exception 'f4d_b_internal_realtime_exposure';
  end if;

  if exists (
    select 1
    from public.live_battle_public_states as projection
    where projection.boost_rule_version = 1
      and (
        projection.rose_target_units <> 0 or
        projection.challenger_rose_progress_units <> 0 or
        projection.opponent_rose_progress_units <> 0 or
        projection.challenger_glove_uses_remaining <> 0 or
        projection.opponent_glove_uses_remaining <> 0
      )
  ) then
    raise exception 'f4d_b_v1_backfill_failed';
  end if;
end
$proof$;

rollback;
