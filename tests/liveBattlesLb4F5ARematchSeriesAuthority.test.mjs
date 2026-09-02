import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const migrationName =
  "20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql";
const c3MigrationName =
  "20260901201459_live_battles_lb4_f5_a_c3_active_series_leave.sql";
const c3c1MigrationName =
  "20260901211549_live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql";
const c3c1c1MigrationName =
  "20260901231742_live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql";
const migrationPath = `supabase/migrations/${migrationName}`;
const parentSha = "63a1b5fa1bd59c9ed63a7535ff0e58763b163729";
const c2Sha = "3e4b3920b6a54136026cf7264c43c2ef97b76cb4";
const sql = readFileSync(migrationPath, "utf8");
const concurrencyProof = readFileSync(
  "scripts/prove-live-battle-rematch-concurrency.mjs",
  "utf8",
);

const has = (pattern, message) => assert.match(sql, pattern, message);

test("F5-A and its C3/C3-C1/C3-C1-C1 corrections are the exact ordered migrations after F4D-C", () => {
  const lb4 = readdirSync("supabase/migrations")
    .filter((name) => name.includes("live_battles_lb4_"))
    .sort();
  const f4dc = lb4.indexOf(
    "20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql",
  );
  assert.deepEqual(lb4.slice(f4dc + 1), [
    migrationName, c3MigrationName, c3c1MigrationName, c3c1c1MigrationName,
  ]);
});

test("all previously deployed migrations remain byte-unmodified", () => {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", `${parentSha}..${c2Sha}`, "--", "supabase/migrations"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/).filter(Boolean), [migrationPath]);
});

test("series schema encodes single and best-of-five limits", () => {
  has(/create table public\.live_battle_series/i);
  has(/format in \('single', 'best_of_5'\)/i);
  has(/format = 'single' and max_rounds = 1 and wins_required = 1/i);
  has(/format = 'best_of_5' and max_rounds = 5 and wins_required = 3/i);
});

test("series counters and terminal timestamps are constrained", () => {
  has(/challenger_wins \+ opponent_wins \+ ties = rounds_completed/i);
  has(/rounds_completed <= max_rounds/i);
  has(/status in \('completed', 'cancelled'\) and completed_at is not null/i);
  has(/status in \('active', 'awaiting_rematch', 'rematch_pending'\) and completed_at is null/i);
});

test("only one open series can exist for an unordered host pair", () => {
  has(/create unique index live_battle_series_open_pair_uidx[\s\S]*least\(challenger_user_id, opponent_user_id\)[\s\S]*greatest\(challenger_user_id, opponent_user_id\)[\s\S]*where status in \('active', 'awaiting_rematch', 'rematch_pending'\)/i);
});

test("rematch requests enforce idempotency and one pending request per round", () => {
  has(/unique \(requested_by_user_id, idempotency_key\)/i);
  has(/create unique index live_battle_rematch_requests_pending_round_uidx[\s\S]*\(series_id, after_battle_id\)[\s\S]*where status = 'pending'/i);
});

test("new foreign-key access paths have full indexes", () => {
  for (const name of [
    "live_battle_series_challenger_user_idx",
    "live_battle_series_opponent_user_idx",
    "live_battle_series_challenger_session_idx",
    "live_battle_series_opponent_session_idx",
    "live_battle_series_champion_idx",
    "live_battle_rematch_requests_series_created_idx",
    "live_battle_rematch_requests_series_battle_created_idx",
    "live_battle_rematch_requests_after_battle_idx",
  ]) has(new RegExp(`create index ${name}`, "i"));
});

test("cross-table request validation binds participants and Battle series", () => {
  has(/live_battle_rematch_battle_series_mismatch/);
  has(/live_battle_rematch_requester_not_participant/);
  has(/live_battle_rematch_responder_not_counterpart/);
});

test("internal tables have RLS and no direct grants", () => {
  has(/alter table public\.live_battle_series enable row level security/i);
  has(/alter table public\.live_battle_rematch_requests enable row level security/i);
  has(/revoke all on table public\.live_battle_series,[\s\S]*from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(sql, /create policy/i);
});

test("internal tables are explicitly excluded from publication", () => {
  has(/pg_catalog\.pg_publication_tables[\s\S]*live_battle_series[\s\S]*live_battle_rematch_requests/i);
  assert.doesNotMatch(sql, /alter publication[\s\S]*(live_battle_series|live_battle_rematch_requests)/i);
  assert.doesNotMatch(sql, /\brealtime\./i);
});

test("historical Battles are backfilled without touching financial tables", () => {
  has(/insert into public\.live_battle_series[\s\S]*from public\.live_battles as battle[\s\S]*join public\.live_battle_score_states as score/i);
  has(/update public\.live_battles as battle[\s\S]*series_id = battle\.id[\s\S]*round_number = 1/i);
  assert.doesNotMatch(sql, /\b(update|insert into|delete from)\s+public\.(live_gift_transactions|financial_transactions|ledger_accounts|wallets)\b/i);
});

test("Battle series linkage is mandatory, unique, and capped at round five", () => {
  has(/alter column series_id set not null/i);
  has(/alter column round_number set not null/i);
  has(/unique \(series_id, round_number\)/i);
  has(/round_number between 1 and 5/i);
  has(/live_battles_series_round_desc_idx/i);
});

test("initial invite keeps its public signature and creates best-of-five round one", () => {
  has(/create or replace function public\.create_live_battle_invite\(\s*p_opponent_user_id uuid,\s*p_challenger_session_id uuid,\s*p_opponent_session_id uuid\s*\)/i);
  has(/'best_of_5', 5, 3, 'active'/i);
  has(/v_rule_set_id, v_series\.id, 1/i);
});

test("initial invite preserves canonical locks, liveness, idempotency, and errors", () => {
  has(/live_battle_lock_users/);
  has(/live_battle_lock_sessions/);
  has(/live_battle_session_pair_is_live/);
  has(/return private\.live_battle_to_json\(v_existing\)/);
  has(/live_battle_pair_busy/);
});

test("series aggregation trusts only Battles and score states", () => {
  const body = sql.match(/create or replace function private\.rebuild_live_battle_series_locked[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  assert.match(body, /from public\.live_battles as battle/i);
  assert.match(body, /join public\.live_battle_score_states as score/i);
  assert.doesNotMatch(body, /p_(challenger|opponent)_(score|wins)/i);
});

test("series aggregation handles challenger, opponent, ties, cancellation, 3 wins, and round 5", () => {
  has(/score\.outcome = 'challenger'/i);
  has(/score\.outcome = 'opponent'/i);
  has(/score\.outcome = 'tie'/i);
  has(/score\.outcome = 'cancelled'/i);
  has(/v_challenger_wins >= v_series\.wins_required/i);
  has(/v_rounds_completed >= v_series\.max_rounds/i);
});

test("material score finalization triggers idempotent series rebuild", () => {
  has(/after insert or update on public\.live_battle_score_states/i);
  has(/old\.outcome is distinct from new\.outcome/i);
  has(/rebuild_live_battle_series_locked/i);
});

test("request RPC validates actor, latest completed round, live hosts and 30-second window", () => {
  has(/create or replace function public\.request_live_battle_rematch/i);
  has(/live_battle_rematch_round_not_completed/);
  has(/live_battle_rematch_round_not_latest/);
  has(/live_battle_rematch_sessions_not_live/);
  has(/live_battle_rematch_window_expired/);
  has(/interval '30 seconds'/i);
});

test("request RPC serializes concurrent callers and returns existing requests", () => {
  has(/where request\.series_id = v_series\.id[\s\S]*request\.after_battle_id = v_battle\.id[\s\S]*request\.status = 'pending'[\s\S]*for update/i);
  has(/when unique_violation then/i);
  has(/return private\.live_battle_rematch_to_json\(v_request\)/i);
});

test("response RPC accepts only exact decisions from the counterpart", () => {
  has(/p_decision not in \('accept', 'reject'\)/i);
  has(/v_actor <> v_counterpart/i);
  has(/live_battle_rematch_responder_not_counterpart/);
});

test("accept creates one direct-countdown next round with three auditable events", () => {
  has(/battle\.round_number = v_previous\.round_number \+ 1/i);
  has(/'countdown', v_now \+ interval '30 seconds', v_now,[\s\S]*v_now, v_now \+ interval '3 seconds'/i);
  has(/'rematch_round_created', 1/i);
  has(/'rematch_bilateral_accepted', 2/i);
  has(/'rematch_countdown_started', 3/i);
});

test("double accept returns the already-created next round", () => {
  has(/v_request\.status = 'accepted' and p_decision = 'accept'[\s\S]*battle\.round_number = v_previous\.round_number \+ 1/i);
  has(/if exists \([\s\S]*battle\.round_number = v_previous\.round_number \+ 1/i);
});

test("fresh rounds receive current rules and rely on existing score/power initialization", () => {
  has(/live_battle_current_rule_set/i);
  has(/battle_rule_set_id,[\s\S]*series_id, round_number/i);
  assert.doesNotMatch(sql, /insert into public\.(live_battle_score_events|live_battle_boost_events|live_gift_transactions)/i);
});

test("reject and leave complete with accumulated authoritative result", () => {
  has(/status = 'rejected'/i);
  has(/create or replace function public\.leave_live_battle_series/i);
  has(/live_battle_series_not_between_rounds/);
  has(/private\.live_battle_series_champion/i);
});

test("expiry is bounded, idempotent, and uses SKIP LOCKED", () => {
  has(/create or replace function private\.reconcile_due_live_battle_series/i);
  has(/p_limit integer default 100/i);
  has(/for update skip locked/i);
  has(/request\.status = 'pending'/i);
  has(/status = 'expired'/i);
});

test("public projection carries all sanitized series and rematch fields", () => {
  for (const field of [
    "series_id", "series_format", "round_number", "series_max_rounds",
    "series_wins_required", "challenger_series_wins", "opponent_series_wins",
    "series_ties", "series_rounds_completed", "series_status",
    "series_champion_user_id", "series_version", "rematch_request_id",
    "rematch_request_after_battle_id", "rematch_request_status",
    "rematch_requested_by_user_id", "rematch_request_expires_at",
    "rematch_window_expires_at",
  ]) has(new RegExp(`'${field}'`, "i"));
});

test("public rematch request is scoped to the projected Battle with separate deadlines", () => {
  const body = sql.match(/create or replace function private\.sync_live_battle_series_projection_locked[\s\S]*?\n\$\$;/i)?.[0] ?? "";
  assert.match(body, /candidate\.series_id = p_series_id/i);
  assert.match(body, /candidate\.after_battle_id = battle\.id/i);
  assert.match(body, /order by candidate\.created_at desc, candidate\.id desc/i);
  assert.match(body, /rematch_request_expires_at = request\.expires_at/i);
  assert.match(body, /rematch_window_expires_at = v_series\.rematch_window_expires_at/i);
  assert.doesNotMatch(body, /rematch_(request_)?expires_at\s*=\s*coalesce\s*\(/i);
});

test("projection updates both session orientations atomically in the existing table", () => {
  has(/update public\.live_battle_public_states as projection/i);
  has(/where battle\.id = projection\.battle_id[\s\S]*battle\.series_id = p_series_id/i);
  has(/projection_version = projection\.projection_version \+ 1/i);
  assert.doesNotMatch(sql, /create table public\.live_battle_.*projection/i);
});

test("snapshot preserves canonical local side and contains no financial fields", () => {
  has(/'local_battle_side', public_state\.local_battle_side/i);
  assert.doesNotMatch(sql, /'[^']*(price|coins|wallet|ledger|revenue|earnings)[^']*'/i);
});

test("RPCs use empty search paths and schema-qualified references", () => {
  for (const name of [
    "request_live_battle_rematch", "respond_live_battle_rematch",
    "leave_live_battle_series", "create_live_battle_invite",
  ]) {
    const body = sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$\\$;`, "i"))?.[0] ?? "";
    assert.match(body, /set search_path = ''/i, name);
    assert.match(body, /auth\.uid\(\)/i, name);
  }
});

test("new RPC execution is granted only to authenticated", () => {
  for (const signature of [
    "request_live_battle_rematch\\(uuid, uuid\\)",
    "respond_live_battle_rematch\\(uuid, text\\)",
    "leave_live_battle_series\\(uuid\\)",
  ]) {
    has(new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated, service_role`, "i"));
    has(new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*?to authenticated`, "i"));
  }
});

test("F5-A changes no Agora, Media Relay, Creator Recovery, Edge Function, manifest, or realtime schema", () => {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", `${parentSha}..HEAD`, "--"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  const changedPaths = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  const protectedExactPaths = new Set([
    "hooks/useAgoraEngine.native.ts",
    "hooks/useAgoraEngine.ts",
    "hooks/live/useLiveBattleRelayRuntime.native.ts",
    "hooks/live/useLiveBattleRelayRuntime.ts",
    "services/agoraService.native.ts",
    "services/agoraService.ts",
    "services/LiveBattleRelayService.native.ts",
    "services/LiveBattleRelayService.ts",
    "services/LiveBattleRuntimeController.ts",
    "modules/creator/sessions/CreatorRecoveryManager.ts",
    "hooks/useCreatorSession.ts",
    "package.json",
    "package-lock.json",
  ]);
  const protectedChanges = changedPaths.filter((path) =>
    path.startsWith("supabase/functions/") || protectedExactPaths.has(path));
  assert.deepEqual(protectedChanges, []);
  assert.doesNotMatch(sql, /supabase\/functions|package(?:-lock)?\.json/i);
  assert.doesNotMatch(
    sql,
    /create\s+or\s+replace\s+function\s+private\.live_agora_uid\s*\(/i,
  );
  assert.doesNotMatch(sql, /\b(create|alter|drop)\s+(table|function|schema)\s+realtime\./i);
});

test("migration is transactionally closed", () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
});

test("concurrency proof uses separate local PostgreSQL connections", () => {
  assert.match(concurrencyProof, /const first = new Client/);
  assert.match(concurrencyProof, /const second = new Client/);
  assert.match(concurrencyProof, /Promise\.all\(\[\s*first\.query[\s\S]*second\.query/);
  assert.match(concurrencyProof, /concurrent requests duplicated/);
  assert.match(concurrencyProof, /concurrent accept duplicated round two/);
  assert.match(concurrencyProof, /requires_local_database/);
});
