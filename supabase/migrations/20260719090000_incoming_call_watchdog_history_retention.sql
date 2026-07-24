begin;

-- The one-second D4D watchdog is intentionally installed inactive by
-- 20260715090000. Keep six hours of focused run history before activation so
-- retries remain observable without allowing cron.job_run_details to grow
-- without bound.
do $$
declare
  v_retention_job_id bigint;
  v_watchdog_active boolean;
begin
  select active into v_watchdog_active
    from cron.job
   where jobname = 'call-incoming-dispatch-watchdog'
     and schedule = '1 second';

  if v_watchdog_active is distinct from false then
    raise exception 'incoming watchdog prestate must be installed inactive';
  end if;

  if exists (
    select 1 from cron.job
     where jobname = 'call-incoming-dispatch-history-retention'
  ) then
    raise exception 'incoming dispatch history retention job already exists';
  end if;

  select cron.schedule(
    'call-incoming-dispatch-history-retention',
    '*/5 * * * *',
    $retention$
      delete from cron.job_run_details
       where end_time < clock_timestamp() - interval '6 hours'
         and jobid in (
           select jobid
             from cron.job
            where jobname in (
              'call-incoming-dispatch-watchdog',
              'call-incoming-dispatch-history-retention'
            )
         )
    $retention$
  ) into v_retention_job_id;

  if not exists (
    select 1 from cron.job
     where jobid = v_retention_job_id
       and jobname = 'call-incoming-dispatch-history-retention'
       and schedule = '*/5 * * * *'
       and active = true
  ) then
    raise exception 'incoming dispatch history retention job was not installed active';
  end if;
end;
$$;

commit;
