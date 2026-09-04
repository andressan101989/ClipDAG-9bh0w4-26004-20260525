/**
 * services/liveGiftsService.ts
 *
 * Client-side service for real LIVE gifts. Gifts are charged in real BDAG —
 * see supabase/migrations/20260711090000_live_gifts_use_bdag_wallet.sql.
 * send_live_gift() moves the user's actual ledger_accounts (BDAG) balance
 * via atomic_ledger_transfer(), the same real-money path used everywhere
 * else in the app (GiftSheet.tsx, useWallet.tsx, useFinancialAccount.tsx).
 * Balance never moves from the client; every debit/credit happens
 * server-side inside the RPC (SECURITY DEFINER).
 *
 * gift_catalog.cost_coins / live_gift_transactions.amount_coins keep their
 * original column names (from the now-superseded separate-wallet design)
 * but represent whole BDAG units now, not a separate coin currency.
 */
import { getSupabaseClient } from '@/template';
import type {
  LiveGiftAnimationType,
  LiveGiftCategory,
  LiveGiftDefinition,
  LiveGiftSendResult,
  LiveBattleGiftSendResult,
  SendLiveBattleGiftInput,
} from '@/types/liveGifts';

export interface GiftCatalogRow {
  id: string;
  emoji?: string | null;
  icon?: string | null;
  label: string;
  /** Cost in BDAG (whole units). */
  cost_coins: number;
  sort_order?: number | null;
  display_order?: number | null;
  category?: LiveGiftCategory | null;
  animation_type?: LiveGiftAnimationType | null;
  animation_asset?: string | null;
  duration_ms?: number | null;
  priority?: number | null;
  active?: boolean | null;
  enabled?: boolean | null;
}

export type GiftCatalogItem = LiveGiftDefinition;
export type SendLiveGiftResult = LiveGiftSendResult;

export type SendLiveGiftForContextInput = {
  sessionId: string;
  giftId: string;
  idempotencyKey: string;
  battle: {
    battleId: string;
    targetUserId: string;
  } | null;
};

const supabase = () => getSupabaseClient();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FALLBACK_METADATA: Record<string, Partial<LiveGiftDefinition>> = {
  heart:      { icon: '\u2764\uFE0F', category: 'basic',     animationType: 'floating',    durationMs: 1800, priority: 1 },
  rose:       { icon: '\uD83C\uDF39', category: 'basic',     animationType: 'floating',    durationMs: 1900, priority: 2 },
  fire:       { icon: '\uD83D\uDD25', category: 'basic',     animationType: 'floating',    durationMs: 2000, priority: 3 },
  crown:      { icon: '\uD83D\uDC51', category: 'basic',     animationType: 'center',      durationMs: 2400, priority: 8 },
  diamond:    { icon: '\uD83D\uDC8E', category: 'basic',     animationType: 'center',      durationMs: 2600, priority: 10 },
  lion:       { icon: '\uD83E\uDD81', category: 'premium',   animationType: 'center',      durationMs: 3000, priority: 20 },
  rocket:     { icon: '\uD83D\uDE80', category: 'premium',   animationType: 'entrance',    durationMs: 3200, priority: 25 },
  private_jet: { icon: '\u2708\uFE0F', category: 'premium',   animationType: 'entrance',    durationMs: 3600, priority: 32 },
  phoenix:    { icon: '\uD83D\uDD25', category: 'legendary', animationType: 'celebration', durationMs: 4000, priority: 45 },
  dragon:     { icon: '\uD83D\uDC09', category: 'legendary', animationType: 'fullscreen',  durationMs: 4500, priority: 50 },
  castle:     { icon: '\uD83C\uDFF0', category: 'legendary', animationType: 'center',      durationMs: 4600, priority: 55 },
  galaxy:     { icon: '\uD83C\uDF0C', category: 'legendary', animationType: 'fullscreen',  durationMs: 5200, priority: 60 },
};

function normalizeGift(row: GiftCatalogRow): LiveGiftDefinition {
  const fallback = FALLBACK_METADATA[row.id] ?? {};
  const icon = row.icon ?? row.emoji ?? fallback.icon ?? '\uD83C\uDF81';
  return {
    id: row.id,
    name: row.label,
    priceBdag: Number(row.cost_coins ?? 0),
    icon,
    category: row.category ?? fallback.category ?? 'basic',
    animationType: row.animation_type ?? fallback.animationType ?? 'floating',
    animationAsset: row.animation_asset ?? fallback.animationAsset ?? null,
    durationMs: Number(row.duration_ms ?? fallback.durationMs ?? 1800),
    priority: Number(row.priority ?? fallback.priority ?? row.sort_order ?? row.display_order ?? 0),
    enabled: row.enabled ?? row.active ?? true,
  };
}

/** Fetch active gift catalog, cheapest/first first. */
export async function fetchGiftCatalog(): Promise<GiftCatalogItem[]> {
  const extended = await supabase()
    .from('gift_catalog')
    .select('id, emoji, icon, label, cost_coins, sort_order, display_order, category, animation_type, animation_asset, duration_ms, priority, active, enabled')
    .eq('active', true)
    .order('display_order', { ascending: true });

  if (!extended.error) return ((extended.data as GiftCatalogRow[]) ?? []).map(normalizeGift);

  const fallback = await supabase()
    .from('gift_catalog')
    .select('id, emoji, label, cost_coins, sort_order, active')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (fallback.error) throw fallback.error;
  return ((fallback.data as GiftCatalogRow[]) ?? []).map(normalizeGift);
}

/**
 * Fetch the caller's real BDAG balance via get_bdag_wallet_balance() —
 * SECURITY DEFINER, resolves auth.uid() server-side, returns only the
 * caller's own balance. Never reads ledger_accounts directly from the
 * client (RLS-dependent direct reads are fragile to session timing).
 */
export async function fetchWalletBalance(): Promise<number> {
  const { data: sessionData, error: sessionError } = await supabase().auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session?.access_token) throw new Error('Sesion no disponible');

  const { data, error } = await supabase().rpc('get_bdag_wallet_balance');

  if (error) {
    console.warn('[LiveGifts] fetchWalletBalance failed', error);
    throw error;
  }

  const numericBalance = Number(data ?? 0);
  if (!Number.isFinite(numericBalance)) {
    console.warn('[LiveGifts] fetchWalletBalance returned a non-finite value', data);
    throw new Error('Balance BDAG invalido');
  }

  return numericBalance;
}

/** Sum of gift face values (amount_coins, in BDAG) received by the host in a live session. */
export async function fetchSessionGiftTotal(sessionId: string): Promise<number> {
  const { data, error } = await supabase()
    .from('live_gift_transactions')
    .select('amount_coins')
    .eq('session_id', sessionId);

  if (error) throw error;
  return (data ?? []).reduce((sum: number, row: any) => sum + Number(row.amount_coins ?? 0), 0);
}

/** Send a real gift. Server validates balance, session status, and idempotency. */
export async function sendLiveGift(opts: {
  sessionId: string;
  giftId: string;
  idempotencyKey: string;
}): Promise<SendLiveGiftResult> {
  const { data, error } = await supabase().rpc('send_live_gift', {
    p_session_id: opts.sessionId,
    p_gift_id: opts.giftId,
    p_idempotency_key: opts.idempotencyKey,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { success: false, error: 'sin respuesta del servidor' };

  return {
    success: true,
    transaction_id: row.transaction_id,
    gift_id: row.gift_id,
    gift_name: row.gift_name ?? row.label,
    emoji: row.emoji,
    icon: row.icon ?? row.emoji,
    amount_coins: Number(row.amount_coins ?? row.amount_bdag ?? 0),
    amount_bdag: Number(row.amount_bdag ?? row.amount_coins ?? 0),
    creator_amount_coins: row.creator_amount_coins,
    new_sender_balance: Number(row.new_sender_balance ?? 0),
    receiver_user_id: row.receiver_user_id ?? row.recipient_user_id,
    recipient_user_id: row.recipient_user_id ?? row.receiver_user_id,
    category: row.category ?? FALLBACK_METADATA[row.gift_id]?.category ?? 'basic',
    animation_type: row.animation_type ?? FALLBACK_METADATA[row.gift_id]?.animationType ?? 'floating',
    animation_asset: row.animation_asset ?? null,
    duration_ms: Number(row.duration_ms ?? FALLBACK_METADATA[row.gift_id]?.durationMs ?? 1800),
    priority: Number(row.priority ?? FALLBACK_METADATA[row.gift_id]?.priority ?? 0),
  };
}

function mapBattleGiftError(message?: string): string {
  const code = message ?? '';
  if (code.includes('live_battle_gift_auth_required')) return 'Sesion no disponible';
  if (code.includes('live_battle_not_found')) return 'Battle no disponible';
  if (
    code.includes('live_battle_gift_not_active')
    || code.includes('live_battle_gift_deadline_elapsed')
  ) return 'La Battle ya no acepta regalos';
  if (
    code.includes('live_battle_gift_target_invalid')
    || code.includes('live_battle_gift_self_forbidden')
    || code.includes('live_battle_gift_target_session_not_live')
  ) return 'Destinatario Battle no disponible';
  if (code.includes('live_battle_gift_unavailable')) return 'Regalo no disponible';
  if (code.includes('live_battle_gift_idempotency_conflict')) return 'Reintento de regalo incompatible';
  if (code.includes('insufficient balance')) return 'Saldo BDAG insuficiente';
  return 'No se pudo enviar el regalo Battle';
}

/**
 * Selects the existing server authority for the viewer's canonical context.
 * The optional Battle data contains identities only; neither price nor score
 * can be supplied or calculated by this client-side router.
 */
export function sendLiveGiftForContext(
  input: SendLiveGiftForContextInput,
): Promise<LiveGiftSendResult> {
  if (input.battle) {
    return sendLiveBattleGift({
      battleId: input.battle.battleId,
      targetUserId: input.battle.targetUserId,
      giftId: input.giftId,
      idempotencyKey: input.idempotencyKey,
    });
  }
  return sendLiveGift({
    sessionId: input.sessionId,
    giftId: input.giftId,
    idempotencyKey: input.idempotencyKey,
  });
}

/**
 * Sends one directed Battle gift through the dedicated server authority.
 * The caller supplies identities only; price, fee, session, deadline and
 * receiver validation are derived and locked by PostgreSQL.
 */
export async function sendLiveBattleGift(
  input: SendLiveBattleGiftInput,
): Promise<LiveBattleGiftSendResult> {
  if (!UUID_PATTERN.test(input.battleId) || !UUID_PATTERN.test(input.targetUserId)) {
    return { success: false, error: 'Datos de Battle invalidos' };
  }
  if (
    input.giftId.trim().length === 0
    || input.idempotencyKey.trim().length === 0
    || input.idempotencyKey.length > 200
  ) {
    return { success: false, error: 'Datos de regalo invalidos' };
  }

  const { data, error } = await supabase().rpc('send_live_battle_gift', {
    p_battle_id: input.battleId,
    p_target_user_id: input.targetUserId,
    p_gift_id: input.giftId,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) return { success: false, error: mapBattleGiftError(error.message) };

  const row = Array.isArray(data) ? data[0] : data;
  const amount = Number(row?.amount_coins);
  const balance = Number(row?.new_sender_balance);
  if (
    !row
    || !UUID_PATTERN.test(String(row.transaction_id ?? ''))
    || row.battle_id !== input.battleId
    || !UUID_PATTERN.test(String(row.target_session_id ?? ''))
    || row.receiver_user_id !== input.targetUserId
    || row.gift_id !== input.giftId
    || !Number.isFinite(amount)
    || !Number.isFinite(balance)
  ) {
    return { success: false, error: 'Respuesta de regalo Battle invalida' };
  }

  return {
    success: true,
    transaction_id: row.transaction_id,
    battle_id: row.battle_id,
    target_session_id: row.target_session_id,
    gift_id: row.gift_id,
    emoji: row.emoji,
    icon: row.emoji,
    amount_coins: amount,
    amount_bdag: amount,
    creator_amount_coins: Number(row.creator_amount_coins ?? 0),
    new_sender_balance: balance,
    receiver_user_id: row.receiver_user_id,
    recipient_user_id: row.receiver_user_id,
    category: FALLBACK_METADATA[row.gift_id]?.category ?? 'basic',
    animation_type: FALLBACK_METADATA[row.gift_id]?.animationType ?? 'floating',
    animation_asset: null,
    duration_ms: FALLBACK_METADATA[row.gift_id]?.durationMs ?? 1800,
    priority: FALLBACK_METADATA[row.gift_id]?.priority ?? 0,
  };
}
