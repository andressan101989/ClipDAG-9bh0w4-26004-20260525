import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.MARKETPLACE_DATABASE_URL;
if (!connectionString) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(connectionString);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.port !== "55422"
) {
  throw new Error("B8S_PROOF_REQUIRES_DISPOSABLE_DATABASE");
}

const db = new Client({ connectionString, ssl: false });
const uid = () => randomUUID();

async function role(roleName, userId = "") {
  await db.query("reset role");
  await db.query(`set local role ${roleName}`);
  await db.query(
    "select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)",
    [
      roleName,
      userId,
      JSON.stringify({
        role: roleName,
        sub: userId,
        user_metadata: {},
      }),
    ],
  );
}

async function attempt(action) {
  const point = `b8s_${uid().replaceAll("-", "")}`;
  await db.query(`savepoint ${point}`);
  try {
    const result = await action();
    await db.query(`release savepoint ${point}`);
    return { ok: true, rowCount: result.rowCount ?? 0, rows: result.rows ?? [] };
  } catch (error) {
    await db.query(`rollback to savepoint ${point}`);
    await db.query(`release savepoint ${point}`);
    return { ok: false, code: error.code, message: error.message };
  }
}

async function insertAuthUser(id, label, metadata = {}) {
  await db.query(
    `insert into auth.users(
       id,instance_id,aud,role,email,encrypted_password,raw_user_meta_data,
       confirmed_at,created_at,updated_at)
     values($1,'00000000-0000-0000-0000-000000000000','authenticated',
       'authenticated',$2,'proof',$3,now(),now(),now())`,
    [id, `b8s-${label}-${uid().slice(0, 8)}@proof.local`, metadata],
  );
}

await db.connect();
try {
  await db.query("begin");
  const ordinary = uid();
  const other = uid();
  const protectedAdmin = uid();
  const insertAttackUser = uid();
  const anonymousTarget = uid();

  await insertAuthUser(ordinary, "ordinary", { is_admin: true, role: "admin" });
  await insertAuthUser(other, "other");
  await insertAuthUser(protectedAdmin, "admin");
  await insertAuthUser(insertAttackUser, "insert-attack");
  await insertAuthUser(anonymousTarget, "anonymous-target");
  await db.query(
    `insert into public.user_profiles(id,username,display_name,is_admin)
     values($1,$2,'Ordinary',false),($3,$4,'Other',false),($5,$6,'Admin',true),($7,$8,'Anon target',false)`,
    [
      ordinary,
      `b8sordinary${uid().replaceAll("-", "").slice(0, 8)}`,
      other,
      `b8sother${uid().replaceAll("-", "").slice(0, 8)}`,
      protectedAdmin,
      `b8sadmin${uid().replaceAll("-", "").slice(0, 8)}`,
      anonymousTarget,
      `b8sanon${uid().replaceAll("-", "").slice(0, 8)}`,
    ],
  );

  await role("anon");
  const anonymousInsert = await attempt(() =>
    db.query(
      "insert into public.user_profiles(id,username,is_admin) values($1,$2,true)",
      [uid(), `b8sanoninsert${uid().replaceAll("-", "").slice(0, 8)}`],
    ),
  );
  const anonymousUpdate = await attempt(() =>
    db.query("update public.user_profiles set is_admin=true where id=$1", [
      anonymousTarget,
    ]),
  );
  assert.equal(anonymousInsert.ok, false);
  assert.equal(anonymousUpdate.ok, false);
  const anonymousAdmin = (
    await db.query("select public.marketplace_actor_is_admin() value")
  ).rows[0].value;
  assert.equal(anonymousAdmin, false);

  await role("authenticated", insertAttackUser);
  const insertAdminAttack = await attempt(() =>
    db.query(
      "insert into public.user_profiles(id,username,is_admin) values($1,$2,true)",
      [
        insertAttackUser,
        `b8sattack${uid().replaceAll("-", "").slice(0, 8)}`,
      ],
    ),
  );
  assert.equal(insertAdminAttack.ok, false);
  assert.equal(insertAdminAttack.code, "42501");

  const normalCreate = await attempt(() =>
    db.query(
      `insert into public.user_profiles(id,email,username,dag_balance)
       values($1,$2,$3,0) returning id,is_admin,dag_balance`,
      [
        insertAttackUser,
        "normal@proof.local",
        `b8snormal${uid().replaceAll("-", "").slice(0, 8)}`,
      ],
    ),
  );
  assert.equal(normalCreate.ok, true);
  assert.equal(normalCreate.rows[0].is_admin, false);
  assert.equal(Number(normalCreate.rows[0].dag_balance), 0);

  await role("authenticated", ordinary);
  const updateAdminAttack = await attempt(() =>
    db.query("update public.user_profiles set is_admin=true where id=$1", [ordinary]),
  );
  assert.equal(updateAdminAttack.ok, false);
  assert.equal(updateAdminAttack.code, "42501");

  const crossUserAttack = await attempt(() =>
    db.query("update public.user_profiles set is_admin=true where id=$1", [other]),
  );
  assert.equal(crossUserAttack.ok, false);
  assert.equal(
    (await db.query("select is_admin from public.user_profiles where id=$1", [other]))
      .rows[0].is_admin,
    false,
  );

  const balanceAttack = await attempt(() =>
    db.query("update public.user_profiles set dag_balance=999 where id=$1", [ordinary]),
  );
  const followersAttack = await attempt(() =>
    db.query("update public.user_profiles set followers_count=999 where id=$1", [ordinary]),
  );
  assert.equal(balanceAttack.ok, false);
  assert.equal(balanceAttack.message, "user_profile_server_field_forbidden");
  assert.equal(followersAttack.ok, false);

  const safeEdit = await attempt(() =>
    db.query(
      "update public.user_profiles set display_name='Safe edit',bio='Allowed',wallet_address='0xproof' where id=$1 returning display_name,bio,wallet_address",
      [ordinary],
    ),
  );
  assert.equal(safeEdit.ok, true);
  assert.equal(safeEdit.rows[0].display_name, "Safe edit");

  await db.query(
    "select set_config('request.jwt.claims',$1,true)",
    [
      JSON.stringify({
        role: "authenticated",
        sub: ordinary,
        user_metadata: { is_admin: true, role: "admin", staff: true },
        app_metadata: { is_admin: true },
      }),
    ],
  );
  const metadataForgedAdmin = (
    await db.query("select public.marketplace_actor_is_admin() value")
  ).rows[0].value;
  assert.equal(metadataForgedAdmin, false);

  const exposedAdminSetters = Number(
    (
      await db.query(
        `select count(*) n
         from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
         where p.prokind='f' and n.nspname='public'
           and pg_get_functiondef(p.oid) ~* 'update[[:space:]]+public[.]user_profiles[^;]*is_admin'
           and (has_function_privilege('anon',p.oid,'EXECUTE')
             or has_function_privilege('authenticated',p.oid,'EXECUTE'))`,
      )
    ).rows[0].n,
  );
  assert.equal(exposedAdminSetters, 0);
  const ordinaryAdmin = (
    await db.query("select public.marketplace_actor_is_admin() value")
  ).rows[0].value;
  assert.equal(ordinaryAdmin, false);

  await role("service_role", ordinary);
  const privilegedGrant = await attempt(() =>
    db.query("update public.user_profiles set is_admin=true where id=$1 returning is_admin", [
      ordinary,
    ]),
  );
  assert.equal(privilegedGrant.ok, true);
  assert.equal(privilegedGrant.rows[0].is_admin, true);

  await role("authenticated", ordinary);
  const grantedAdmin = (
    await db.query("select public.marketplace_actor_is_admin() value")
  ).rows[0].value;
  assert.equal(grantedAdmin, true);
  const adminSelfDemotion = await attempt(() =>
    db.query("update public.user_profiles set is_admin=false where id=$1", [ordinary]),
  );
  assert.equal(adminSelfDemotion.ok, false);
  assert.equal(adminSelfDemotion.code, "42501");

  await role("service_role", ordinary);
  const privilegedRevoke = await attempt(() =>
    db.query("update public.user_profiles set is_admin=false where id=$1 returning is_admin", [
      ordinary,
    ]),
  );
  assert.equal(privilegedRevoke.ok, true);
  assert.equal(privilegedRevoke.rows[0].is_admin, false);

  await role("authenticated", protectedAdmin);
  const protectedAdminResult = (
    await db.query("select public.marketplace_actor_is_admin() value")
  ).rows[0].value;
  assert.equal(protectedAdminResult, true);

  await db.query("reset role");
  const grants = (
    await db.query(
      `select
         has_table_privilege('authenticated','public.user_profiles','INSERT') authenticated_table_insert,
         has_table_privilege('authenticated','public.user_profiles','UPDATE') authenticated_table_update,
         has_column_privilege('authenticated','public.user_profiles','is_admin','INSERT') authenticated_admin_insert,
         has_column_privilege('authenticated','public.user_profiles','is_admin','UPDATE') authenticated_admin_update,
         has_column_privilege('anon','public.user_profiles','is_admin','INSERT') anon_admin_insert,
         has_column_privilege('anon','public.user_profiles','is_admin','UPDATE') anon_admin_update`,
    )
  ).rows[0];
  assert.deepEqual(grants, {
    authenticated_table_insert: false,
    authenticated_table_update: false,
    authenticated_admin_insert: false,
    authenticated_admin_update: false,
    anon_admin_insert: false,
    anon_admin_update: false,
  });

  const schema = (
    await db.query(
      `select
         exists(select 1 from pg_trigger where tgrelid='public.user_profiles'::regclass
           and tgname='protect_user_profile_server_fields' and not tgisinternal) trigger_present,
         not has_function_privilege('anon','public.protect_user_profile_server_fields()','EXECUTE') anon_guard_denied,
         not has_function_privilege('authenticated','public.protect_user_profile_server_fields()','EXECUTE') authenticated_guard_denied,
         coalesce((select array_to_string(proconfig,',') ilike '%search_path=pg_catalog, public%'
           from pg_proc where oid='public.protect_user_profile_server_fields()'::regprocedure),false) fixed_search_path`,
    )
  ).rows[0];
  assert.deepEqual(schema, {
    trigger_present: true,
    anon_guard_denied: true,
    authenticated_guard_denied: true,
    fixed_search_path: true,
  });

  await db.query("rollback");
  const persistentFixtures = Number(
    (
      await db.query(
        "select count(*) n from auth.users where email like 'b8s-%@proof.local'",
      )
    ).rows[0].n,
  );
  assert.equal(persistentFixtures, 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        attacks: {
          anonymousDenied: true,
          anonymousAdmin,
          ordinaryInsertSelfAdminDenied: true,
          ordinaryUpdateSelfAdminDenied: true,
          adminSelfDemotionDenied: true,
          crossUserAdminMutationDenied: true,
          metadataForgeryDenied: true,
          exposedAdminSetterCount: exposedAdminSetters,
          legacyBalanceMutationDenied: true,
          socialCounterMutationDenied: true,
        },
        authority: {
          ordinaryAdmin: false,
          protectedAdmin: protectedAdminResult,
          privilegedGrant: true,
          privilegedRevoke: true,
          serviceRoleDatabaseProvisioningOnly: true,
        },
        compatibility: {
          normalProfileCreate: true,
          normalSafeProfileEdit: true,
          zeroBalanceCreateCompatibility: true,
        },
        effectiveSchema: {
          tableWideAuthenticatedInsert: false,
          tableWideAuthenticatedUpdate: false,
          authenticatedIsAdminInsert: false,
          authenticatedIsAdminUpdate: false,
          anonIsAdminInsert: false,
          anonIsAdminUpdate: false,
          policyAndTriggerDefenseInDepth: true,
          guardFixedSearchPath: true,
        },
        persistentFixtures,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error(
    JSON.stringify(
      { ok: false, code: error.code ?? null, message: error.message },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
