-- Disposable-only doubles for the production pg_cron, pg_net and Vault APIs.
-- Signatures match the production project; no network request leaves localhost.
create schema cron;
create table cron.job(
  jobid bigint generated always as identity primary key,
  jobname text not null,
  schedule text not null,
  command text not null,
  database text,
  username text,
  active boolean not null default true
);
create function cron.schedule(job_name text,schedule text,command text)
returns bigint
language sql
as $$
  insert into cron.job(jobname,schedule,command,database,username)
    values($1,$2,$3,pg_catalog.current_database(),current_user)
    returning jobid
$$;

create function cron.alter_job(
  job_id bigint,
  schedule text default null,
  command text default null,
  database text default null,
  username text default null,
  active boolean default null
)
returns void
language sql
as $$
  update cron.job
     set schedule=coalesce($2,cron.job.schedule),
         command=coalesce($3,cron.job.command),
         database=coalesce($4,cron.job.database),
         username=coalesce($5,cron.job.username),
         active=coalesce($6,cron.job.active)
   where jobid=$1
$$;

create schema net;
create table net.http_requests(
  id bigint generated always as identity primary key,
  url text not null,
  body jsonb not null,
  params jsonb not null,
  headers jsonb not null,
  timeout_milliseconds integer not null
);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 1000
)
returns bigint
language sql
as $$
  insert into net.http_requests(url,body,params,headers,timeout_milliseconds)
    values($1,$2,$3,$4,$5)
    returning id
$$;

create schema vault;
create table vault.decrypted_secrets(name text primary key,decrypted_secret text not null);
insert into vault.decrypted_secrets(name,decrypted_secret) values
  ('call_dispatch_project_url','https://project.example'),
  ('call_dispatch_publishable_key','publishable-test-key'),
  ('call_dispatch_secret',pg_catalog.repeat('d',32));
