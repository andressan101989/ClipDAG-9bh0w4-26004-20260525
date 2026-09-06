import { getSupabaseClient } from '@/template';
import type { LikeBatch, LikeReceipt } from './liveBattleLikeBatcher';
import { LikeBatchRejectedError } from './liveBattleLikeBatcher';

export async function sendLiveBattleLikes(sessionId: string, battleId: string, actorId: string, batch: LikeBatch): Promise<LikeReceipt> {
  const client = getSupabaseClient();
  const { data: auth, error: authError } = await client.auth.getSession();
  if (authError) throw new Error('live_battle_like_retry');
  if (auth.session?.user.id !== actorId) throw new LikeBatchRejectedError('live_battle_like_actor_changed');
  const { data, error } = await client.rpc('send_live_battle_likes', {
    p_session_id: sessionId, p_battle_id: battleId,
    p_count: batch.count, p_idempotency_key: batch.idempotencyKey,
  });
  if (error) {
    if (['live_auth_required', 'live_participant_required', 'live_battle_not_found', 'live_battle_like_input_invalid',
      'live_battle_like_session_invalid', 'live_battle_like_idempotency_conflict'].includes(error.message)) {
      throw new LikeBatchRejectedError('live_battle_like_rejected');
    }
    throw new Error('live_battle_like_retry');
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Number.isSafeInteger(row.accepted_count) || row.accepted_count < 0 || row.accepted_count > batch.count
    || !Number.isSafeInteger(Number(row.awarded_points)) || Number(row.awarded_points) < 0) {
    throw new Error('live_battle_like_retry');
  }
  return { accepted_count: row.accepted_count, awarded_points: Number(row.awarded_points) };
}
