/**
 * process_dag_reward — v3 Production
 *
 * Fixes vs v2 (found in live database audit):
 *   - '__increment_likes' RPC never existed, and was misused anyway — passed
 *     as the VALUE of an .update() call, i.e. an unresolved Promise object
 *     written to a numeric column, which would have been broken even if the
 *     RPC existed. Replaced with the real increment_video_counter RPC.
 *   - 'exec_sql' RPC (the unlike-path fallback) never existed either.
 *     Replaced with the same increment_video_counter RPC (p_delta: -1).
 *   - ledger_credit was called with parameter names that don't match its
 *     actual signature (p_txn_id, p_account_id, p_amount, p_description,
 *     p_metadata) — the call always failed silently (caught by the existing
 *     non-fatal warning), meaning creators were never actually paid for
 *     likes. Fixed to use the real signature, using the account id actually
 *     returned by ensure_ledger_account (previously discarded).
 *   - 'likes' table now exists (see supabase/migrations/20260704_*) — the
 *     like/unlike logic itself was already correct, it just had no table to
 *     operate on.
 *
 * Migrated from legacy implementation:
 *   - Deno.serve() (was: deprecated serve() from std@0.168.0)
 *   - Atomic like/unlike via DB UNIQUE constraint (race-safe)
 *   - likes_count updated via atomic RPC (no read-then-write race)
 *   - BDAG reward credited via ledger_credit RPC (not user_profiles.dag_balance)
 *   - Idempotency: enforced by the `likes` unique(video_id, user_id)
 *     constraint — a duplicate insert fails and returns early, before
 *     ledger_credit is ever reached, so no separate idempotency key is
 *     needed for the credit itself.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders }  from '../_shared/cors.ts';
import { sendPushToUser } from '../_shared/pushNotify.ts';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const DAG_REWARD_PER_LIKE = 0.01; // BDAG per like

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function ok(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, ...data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}

function fail(msg: string, code = 400): Response {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: code,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('No authorization header', 401);
    const token = authHeader.replace('Bearer ', '');

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) return fail('Unauthorized', 401);

    // ── Parse ────────────────────────────────────────────────────────────────
    let body: { video_id?: string; creator_id?: string };
    try { body = await req.json(); } catch { return fail('Invalid JSON body'); }

    const { video_id, creator_id } = body;
    if (!video_id || !creator_id) return fail('Missing video_id or creator_id');
    if (user.id === creator_id) return fail('Cannot like your own video');

    // ── Check existing like (idempotency guard) ──────────────────────────────
    const { data: existing } = await admin
      .from('likes')
      .select('id')
      .eq('user_id', user.id)
      .eq('video_id', video_id)
      .maybeSingle();

    // ── UNLIKE path ──────────────────────────────────────────────────────────
    if (existing) {
      await admin
        .from('likes')
        .delete()
        .eq('user_id', user.id)
        .eq('video_id', video_id);

      // Atomic decrement — no race condition
      const { error: decErr } = await admin.rpc('increment_video_counter', {
        p_video_id: video_id, p_field: 'likes_count', p_delta: -1,
      });
      if (decErr) {
        console.warn('[process_dag_reward] increment_video_counter (unlike) failed:', decErr.message);
      }

      console.log(`[process_dag_reward] unliked video=${video_id} user=${user.id}`);
      return ok({ action: 'unliked' });
    }

    // ── LIKE path — insert (UNIQUE constraint prevents double-like) ──────────
    const { error: likeErr } = await admin
      .from('likes')
      .insert({ user_id: user.id, video_id });

    if (likeErr) {
      // Duplicate key = race condition — treat as already liked (idempotent)
      if (likeErr.code === '23505') {
        console.log(`[process_dag_reward] duplicate like ignored video=${video_id} user=${user.id}`);
        return ok({ action: 'liked', reward: 0, already_counted: true });
      }
      console.error('[process_dag_reward] like insert error:', likeErr.message);
      return fail('Error processing like');
    }

    // ── Atomic likes_count increment ─────────────────────────────────────────
    const { error: countErr } = await admin.rpc('increment_video_counter', {
      p_video_id: video_id, p_field: 'likes_count', p_delta: 1,
    });
    if (countErr) {
      console.warn('[process_dag_reward] increment_video_counter failed:', countErr.message);
      // Non-fatal: like was recorded even if the displayed count lags.
    }

    // ── Credit BDAG reward via ledger (atomic) ───────────────────────────────
    const { data: creatorAccountId, error: ensureErr } = await admin.rpc('ensure_ledger_account', {
      p_user_id: creator_id,
    });
    if (ensureErr || !creatorAccountId) {
      console.warn('[process_dag_reward] ensure_ledger_account failed:', ensureErr?.message ?? 'no account id returned');
      // Non-fatal: reward not credited but like was recorded
      return ok({ action: 'liked', reward: 0, creator_new_balance: null });
    }

    const { data: newBalance, error: creditErr } = await admin.rpc('ledger_credit', {
      p_txn_id:      crypto.randomUUID(),
      p_account_id:  creatorAccountId,
      p_amount:      DAG_REWARD_PER_LIKE,
      p_description: `Like reward: video ${video_id}`,
      p_metadata:    { video_id, liker_id: user.id, type: 'like_reward' },
    });

    if (creditErr) {
      console.warn('[process_dag_reward] ledger_credit failed:', creditErr.message);
      // Non-fatal: like was recorded, reward deferred
    }

    console.log(`[process_dag_reward] liked video=${video_id} creator=${creator_id} reward=${DAG_REWARD_PER_LIKE} BDAG new_balance=${newBalance ?? 'unknown'}`);

    // Notify video creator about the like (fire and forget)
    const { data: likerProfile } = await admin
      .from('user_profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();
    sendPushToUser(
      admin,
      creator_id,
      'Nuevo like',
      `@${likerProfile?.username ?? 'alguien'} le dio like a tu video`,
      { type: 'like', video_id, from_user_id: user.id },
    );

    return ok({
      action:               'liked',
      reward:               creditErr ? 0 : DAG_REWARD_PER_LIKE,
      creator_new_balance:  newBalance ?? null,
    });

  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? String(e);
    console.error('[process_dag_reward] unhandled error:', msg);
    return fail('Internal server error', 500);
  }
});
