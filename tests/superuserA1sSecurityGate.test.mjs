import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260911141751_superuser_a1s_security_gate.sql", import.meta.url),
  "utf8",
);
const ledgerEdge = readFileSync(
  new URL("../supabase/functions/bdag-ledger/index.ts", import.meta.url),
  "utf8",
);
const settlementService = readFileSync(
  new URL("../services/marketplaceSettlementService.ts", import.meta.url),
  "utf8",
);
const authContext = readFileSync(
  new URL("../contexts/AuthContext.tsx", import.meta.url),
  "utf8",
);
const walletScreen = readFileSync(
  new URL("../app/(tabs)/wallet.tsx", import.meta.url),
  "utf8",
);
const walletHook = readFileSync(
  new URL("../hooks/useWallet.tsx", import.meta.url),
  "utf8",
);
const feedContext = readFileSync(
  new URL("../contexts/FeedContext.tsx", import.meta.url),
  "utf8",
);

function section(start, end) {
  const from = migration.indexOf(start);
  assert.notEqual(from, -1, `missing migration section: ${start}`);
  const to = migration.indexOf(end, from);
  assert.notEqual(to, -1, `missing migration boundary: ${end}`);
  return migration.slice(from, to);
}

function functionBody(name, next) {
  return section(`function public.${name}`, next);
}

test("public profile projection excludes every A1 sensitive field", () => {
  const projection = section(
    "create or replace view public.public_user_profiles",
    "comment on view public.public_user_profiles",
  );
  assert.match(projection, /security_invoker\s*=\s*true/i);
  for (const field of ["email", "wallet_address", "dag_balance", "is_admin", "push_token", "hide_activity", "allow_comments_from", "allow_messages_from"]) {
    assert.doesNotMatch(projection, new RegExp(`\\b${field}\\b`, "i"));
  }
  assert.match(migration, /revoke select on table public\.user_profiles from public, anon, authenticated/i);
  assert.match(migration, /grant select \([\s\S]*?\) on public\.user_profiles to anon, authenticated/i);
  assert.match(migration, /revoke insert \(email, dag_balance, is_admin\),[\s\S]*?update \(email, dag_balance, is_admin\)[\s\S]*?from authenticated/i);
});

test("self-private profile path is authenticated, minimal, and admin remains canonical", () => {
  const selfPrivate = functionBody("get_my_user_profile_private", "revoke all on function public.get_my_user_profile_private");
  assert.match(selfPrivate, /auth\.uid\(\)/);
  assert.match(selfPrivate, /set search_path to 'pg_catalog', 'public'/i);
  for (const field of ["email", "dag_balance", "is_admin", "push_token"]) {
    assert.doesNotMatch(selfPrivate, new RegExp(`'${field}'`, "i"));
  }
  assert.match(migration, /grant execute on function public\.get_my_user_profile_private\(\) to authenticated/i);
  assert.match(authContext, /\.from\('public_user_profiles'\)/);
  assert.match(authContext, /rpc\('get_my_user_profile_private'\)/);
  assert.match(authContext, /rpc\('get_my_marketplace_admin_access'\)/);
  assert.match(authContext, /\.from\('ledger_accounts'\)/);
  assert.doesNotMatch(authContext, /\.select\('\*'\)/);
  assert.doesNotMatch(authContext, /\.insert\(\{ id: userId, email,/);
  assert.doesNotMatch(walletScreen, /select\([^\n]*email|email\.ilike/i);
});

test("follow and unfollow bind the actor to auth.uid and deny anon execution", () => {
  for (const [name, next] of [
    ["follow_user", "create or replace function public.unfollow_user"],
    ["unfollow_user", "revoke all on function public.follow_user"],
  ]) {
    const body = functionBody(name, next);
    assert.match(body, /v_actor uuid := auth\.uid\(\)/);
    assert.match(body, /p_follower_id is distinct from v_actor/);
    assert.match(body, /set search_path to 'pg_catalog', 'public'/i);
  }
  assert.match(migration, /revoke all on function public\.follow_user\(uuid, uuid\)[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.follow_user\(uuid, uuid\) to authenticated/i);
});

test("counter RPCs cannot apply caller supplied deltas", () => {
  const comments = functionBody("increment_comment_likes", "create or replace function public.increment_video_counter");
  const videos = functionBody("increment_video_counter", "revoke all on function public.increment_comment_likes");
  assert.doesNotMatch(comments, /likes_count\s*\+\s*p_delta/i);
  assert.doesNotMatch(videos, /(?:likes_count|comments_count|views_count|shares_count|saves_count)\s*\+\s*p_delta/i);
  assert.match(comments, /from public\.comment_likes/);
  assert.match(videos, /from public\.likes/);
  assert.match(videos, /from public\.comments/);
  assert.match(videos, /from public\.video_saves/);
  assert.match(migration, /revoke all on function public\.increment_comment_likes\(uuid, integer\)[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on function public\.increment_video_counter\(uuid, text, integer\)[\s\S]*?from public, anon, authenticated, service_role/i);
});

test("bdag-ledger no longer exposes parallel Marketplace dispute authority", () => {
  assert.doesNotMatch(ledgerEdge, /marketplace_dispute_(?:fetch|resolve)/);
  assert.doesNotMatch(ledgerEdge, /rpc\(['"]resolve_marketplace_dispute['"]/);
  assert.doesNotMatch(ledgerEdge, /select\(['"]is_admin['"]\)/);
  assert.doesNotMatch(settlementService, /supportInvoke|fetchSupportMarketplaceDispute|resolveMarketplaceDispute/);
});

test("legacy seller wrappers are internal and canonical seller RPC stays client-facing", () => {
  for (const signature of [
    "approve_marketplace_seller\\(uuid\\)",
    "reject_marketplace_seller\\(uuid, text\\)",
    "suspend_marketplace_seller\\(uuid, text\\)",
    "restore_marketplace_seller\\(uuid\\)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated, service_role`, "i"));
  }
  assert.match(migration, /grant execute on function public\.admin_moderate_marketplace_seller\(uuid, text, text, uuid\)[\s\S]*?to authenticated, service_role/i);
});

test("ledger is append-only and financial transaction runtime writes are bounded", () => {
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*?public\.ledger_entries from anon, authenticated, service_role/i);
  assert.match(migration, /ledger_entries_immutable[\s\S]*?before update or delete/i);
  assert.match(migration, /ledger_entries_are_append_only/);
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*?public\.financial_transactions from anon, authenticated, service_role/i);
  assert.match(migration, /grant update \(status, blockchain_txid\)[\s\S]*?to service_role/i);
  assert.match(migration, /old\.operation_type = 'withdrawal'/);
  assert.match(migration, /new\.status = 'processing'/);
  assert.match(migration, /financial_transaction_delete_forbidden/);
});

test("frontend financial writes use the canonical ledger client", () => {
  assert.match(feedContext, /sendGift as sendLedgerGift/);
  assert.match(feedContext, /await sendLedgerGift\(/);
  assert.doesNotMatch(feedContext, /user_profiles[\s\S]{0,120}dag_balance|dag_balance[\s\S]{0,120}user_profiles/);
  assert.doesNotMatch(walletHook, /user_profiles[\s\S]{0,120}dag_balance|dag_balance[\s\S]{0,120}user_profiles/);
  assert.doesNotMatch(walletHook, /const addReward/);
});
