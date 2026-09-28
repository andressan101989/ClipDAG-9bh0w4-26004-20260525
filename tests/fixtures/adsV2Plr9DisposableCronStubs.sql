create schema if not exists extensions;
create schema if not exists cron;

-- Production already has pgcrypto in extensions; schema-only dumps omit the
-- extension object even though canonical Admin fingerprinting depends on it.
create extension if not exists pgcrypto with schema extensions;

create table if not exists cron.job (
  jobid bigserial primary key,
  jobname text unique not null,
  schedule text not null,
  command text not null,
  active boolean not null default true
);

create or replace function cron.schedule(p_name text, p_schedule text, p_command text)
returns bigint
language plpgsql
as $$
declare v_id bigint;
begin
  insert into cron.job(jobname, schedule, command)
  values(p_name, p_schedule, p_command)
  on conflict(jobname) do update
    set schedule = excluded.schedule, command = excluded.command, active = true
  returning jobid into v_id;
  return v_id;
end;
$$;

create or replace function cron.unschedule(p_job_id bigint)
returns boolean
language sql
as $$
  delete from cron.job where jobid = p_job_id returning true;
$$;
