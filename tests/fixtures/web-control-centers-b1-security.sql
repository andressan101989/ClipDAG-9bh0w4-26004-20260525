-- WEB-CONTROL-CENTERS-B1 disposable security assertions.
-- Loaded only into the isolated PostgreSQL proof after the real B1 migration.

do $assertions$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='publication_drafts'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'b1_publication_drafts_rls_missing'; end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='publication_receipts'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'b1_publication_receipts_rls_missing'; end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='publication_draft_commands'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then raise exception 'b1_publication_draft_commands_rls_missing'; end if;

  if has_table_privilege('anon','private.publication_drafts','SELECT')
     or has_table_privilege('authenticated','private.publication_drafts','SELECT')
     or has_table_privilege('service_role','private.publication_drafts','SELECT')
  then raise exception 'b1_publication_drafts_direct_read_exposed'; end if;

  if has_table_privilege('authenticated','private.publication_receipts','INSERT,UPDATE,DELETE')
  then raise exception 'b1_publication_receipts_direct_write_exposed'; end if;

  if has_table_privilege('authenticated','private.publication_draft_commands','SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'b1_publication_draft_commands_direct_access_exposed'; end if;

  if not has_function_privilege(
    'authenticated',
    'public.publish_my_media_post_v1(uuid,text,text,text,uuid[])',
    'EXECUTE'
  ) then raise exception 'b1_publication_rpc_not_granted'; end if;

  if has_function_privilege(
    'anon',
    'public.publish_my_media_post_v1(uuid,text,text,text,uuid[])',
    'EXECUTE'
  ) then raise exception 'b1_publication_rpc_anon_exposed'; end if;

  if not has_function_privilege(
    'authenticated',
    'public.list_my_publication_drafts_v1(integer,timestamptz,uuid)',
    'EXECUTE'
  ) then raise exception 'b1_draft_list_rpc_not_granted'; end if;

  if has_function_privilege(
    'anon',
    'public.list_my_publication_drafts_v1(integer,timestamptz,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'public.list_my_publication_drafts_v1(integer,timestamptz,uuid)',
    'EXECUTE'
  ) then raise exception 'b1_draft_list_rpc_exposed'; end if;
end
$assertions$;
