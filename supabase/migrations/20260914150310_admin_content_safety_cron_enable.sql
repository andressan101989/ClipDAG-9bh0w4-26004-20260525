begin;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname='content-safety-scan-dispatch';

  if v_job_id is null then
    select cron.schedule(
      'content-safety-scan-dispatch',
      '* * * * *',
      'select public.wake_content_safety_scanner()'
    ) into v_job_id;
  else
    perform cron.alter_job(
      v_job_id,
      schedule:='* * * * *',
      command:='select public.wake_content_safety_scanner()',
      active:=true
    );
  end if;
end;
$$;

commit;
