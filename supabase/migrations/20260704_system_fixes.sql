-- ============================================================================
-- supabase/migrations/20260704_system_fixes.sql
--
-- Documents fixes applied directly to aewwdlvbwpczqyvkwvvj via Supabase MCP
-- that weren't yet captured in a migration file. Reflects exactly what was
-- run live (verified against the actual project schema), not a fresh
-- reinterpretation — see inline notes where this deviates from an earlier
-- verbal description of the same fix.
--
-- SAFE TO RE-RUN: every statement is guarded (CREATE OR REPLACE / DROP
-- POLICY IF EXISTS before CREATE POLICY / CREATE TABLE IF NOT EXISTS /
-- ON CONFLICT DO NOTHING).
-- ============================================================================

-- ── Follow/unfollow idempotency fix ─────────────────────────────────────────
-- Previously, follow_user/unfollow_user always incremented/decremented the
-- counters unconditionally, even when the underlying insert/delete was a
-- no-op (e.g. double-tapping follow, or the row already not existing).
-- GET DIAGNOSTICS ... ROW_COUNT gates the counter update on whether a row
-- actually changed. Verified live against real data before this file was
-- written: a duplicate follow_user call does not double-increment, and
-- unfollow_user correctly reverts with no residual drift.
CREATE OR REPLACE FUNCTION public.follow_user(p_follower_id uuid, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_inserted int;
begin
  if p_follower_id = p_target_id then raise exception 'self_follow_not_allowed'; end if;
  insert into public.follows (follower_id, following_id)
  values (p_follower_id, p_target_id)
  on conflict (follower_id, following_id) do nothing;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  if v_inserted > 0 then
    update public.user_profiles set following_count = following_count + 1 where id = p_follower_id;
    update public.user_profiles set followers_count = followers_count + 1 where id = p_target_id;
  end if;
end; $$;

CREATE OR REPLACE FUNCTION public.unfollow_user(p_follower_id uuid, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_deleted int;
begin
  delete from public.follows where follower_id = p_follower_id and following_id = p_target_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  if v_deleted > 0 then
    update public.user_profiles set following_count = greatest(0, following_count - 1) where id = p_follower_id;
    update public.user_profiles set followers_count = greatest(0, followers_count - 1) where id = p_target_id;
  end if;
end; $$;

-- ── Video counter RPC ────────────────────────────────────────────────────────
-- Atomic increment/decrement for videos.{likes,comments,views,shares,saves}_count,
-- replacing client-side read-then-write patterns in contexts/FeedContext.tsx
-- and components/feature/CommentSheet.tsx that raced under concurrent users.
CREATE OR REPLACE FUNCTION public.increment_video_counter(
  p_video_id uuid, p_field text, p_delta integer DEFAULT 1
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE videos
  SET likes_count = CASE WHEN p_field = 'likes_count' THEN GREATEST(0, likes_count + p_delta) ELSE likes_count END,
      comments_count = CASE WHEN p_field = 'comments_count' THEN GREATEST(0, comments_count + p_delta) ELSE comments_count END,
      views_count = CASE WHEN p_field = 'views_count' THEN GREATEST(0, views_count + p_delta) ELSE views_count END,
      shares_count = CASE WHEN p_field = 'shares_count' THEN GREATEST(0, shares_count + p_delta) ELSE shares_count END,
      saves_count = CASE WHEN p_field = 'saves_count' THEN GREATEST(0, saves_count + p_delta) ELSE saves_count END
  WHERE id = p_video_id;
$$;

-- ── Admin reports policy ─────────────────────────────────────────────────────
-- NOTE: "CREATE POLICY IF NOT EXISTS" is not valid PostgreSQL syntax —
-- CREATE POLICY has no IF NOT EXISTS clause. Using this repo's established
-- DROP-then-CREATE idiom instead (see migration_to_supabase.sql).
DROP POLICY IF EXISTS "Admins can manage all reports" ON public.reports;
CREATE POLICY "Admins can manage all reports"
  ON public.reports FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true));

-- ── Blockchain settlements table ─────────────────────────────────────────────
-- Schema matches actual usage in supabase/functions/{bdag-deposit,bdag-monitor,
-- bdag-withdraw}/index.ts, which .upsert(...) with these exact columns using
-- { onConflict: 'tx_hash' } — hence the unique constraint on tx_hash below.
CREATE TABLE IF NOT EXISTS public.blockchain_settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_type  text NOT NULL,
  reference_id     uuid,
  chain_id         text NOT NULL,
  tx_hash          text NOT NULL,
  from_address     text,
  to_address       text,
  amount_wei       text,
  block_number     bigint,
  status           text,
  rpc_verified     boolean NOT NULL DEFAULT false,
  verified_at      timestamptz,
  raw_receipt      jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  unique (tx_hash)
);
ALTER TABLE blockchain_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role only" ON blockchain_settlements;
CREATE POLICY "Service role only" ON blockchain_settlements FOR ALL TO service_role USING (true);

-- ── System ledger accounts (escrow, platform, treasury) ─────────────────────
-- Fixes "account NULL not found or frozen" on withdrawals — request_withdrawal_
-- from_ledger and atomic_ledger_transfer both look up these system accounts by
-- account_type, and no seed rows existed for them on this project.
INSERT INTO ledger_accounts (account_type, currency, balance, frozen)
VALUES ('escrow', 'BDAG', 0, false), ('platform', 'BDAG', 0, false), ('treasury', 'BDAG', 0, false)
ON CONFLICT DO NOTHING;
