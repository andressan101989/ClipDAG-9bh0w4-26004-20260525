export type LiveGiftPresentationEvent = Readonly<{
  eventId: string;
  transactionId: string;
  sessionId: string;
  giftId: string;
  label: string;
  icon: string;
  category: string;
  costCoins: number;
  animationType: string | null;
  durationMs: number;
  priority: number;
  senderUserId: string;
  senderDisplayName: string;
  senderAvatarUrl: string | null;
  receiverUserId: string;
  quantity: number;
  createdAt: number;
}>;

export type LiveGiftRealtimeRow = {
  id?: unknown;
  session_id?: unknown;
  actor_user_id?: unknown;
  event_type?: unknown;
  created_at?: unknown;
  payload?: Record<string, unknown> | null;
};

export const MIN_GIFT_DURATION_MS = 800;
export const MAX_GIFT_DURATION_MS = 15_000;
export const MAX_GIFT_EVENT_AGE_MS = 15_000;

function nonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function clampGiftDuration(value: unknown): number {
  const parsed = finitePositive(value) ?? 1_800;
  return Math.min(MAX_GIFT_DURATION_MS, Math.max(MIN_GIFT_DURATION_MS, Math.round(parsed)));
}

export function isGiftPresentationEventFresh(event: LiveGiftPresentationEvent, now = Date.now()): boolean {
  return Number.isFinite(event.createdAt)
    && now - event.createdAt <= MAX_GIFT_EVENT_AGE_MS
    && event.createdAt - now <= 5_000;
}

export function liveGiftEventFromPayload(
  row: LiveGiftRealtimeRow,
  currentSessionId: string,
): LiveGiftPresentationEvent | null {
  const payload = row?.payload ?? {};
  if (row?.event_type !== 'reaction' || payload.gift_real !== true) return null;

  const eventId = nonEmpty(row.id) || nonEmpty(payload.event_id) || nonEmpty(payload.transaction_id);
  const transactionId = nonEmpty(payload.transaction_id) || eventId;
  const sessionId = nonEmpty(payload.session_id) || nonEmpty(row.session_id) || currentSessionId;
  const giftId = nonEmpty(payload.gift_id);
  const senderUserId = nonEmpty(row.actor_user_id) || nonEmpty(payload.sender_user_id);
  const receiverUserId = nonEmpty(payload.recipient_user_id) || nonEmpty(payload.receiver_user_id);
  const costCoins = finitePositive(payload.amount_coins ?? payload.amount_bdag);
  const rawCreatedAt = payload.created_at ?? row.created_at;
  const createdAt = typeof rawCreatedAt === 'number' ? rawCreatedAt : Date.parse(nonEmpty(rawCreatedAt));

  if (!eventId || !transactionId || !sessionId || !giftId || !senderUserId || !receiverUserId || !costCoins) return null;
  if (!Number.isFinite(createdAt)) return null;

  const rawQuantity = payload.quantity === undefined || payload.quantity === null
    ? 1
    : finitePositive(payload.quantity);
  if (!rawQuantity) return null;
  return Object.freeze({
    eventId,
    transactionId,
    sessionId,
    giftId,
    label: nonEmpty(payload.gift_name) || nonEmpty(payload.label) || 'Regalo ClipDAG',
    icon: nonEmpty(payload.icon) || nonEmpty(payload.emoji) || '\uD83C\uDF81',
    category: nonEmpty(payload.category) || 'basic',
    costCoins,
    animationType: nonEmpty(payload.animation_type) || null,
    durationMs: clampGiftDuration(payload.duration_ms),
    priority: Math.max(0, Math.round(Number(payload.priority) || 0)),
    senderUserId,
    senderDisplayName: nonEmpty(payload.username) || nonEmpty(payload.sender_username) || 'Invitado',
    senderAvatarUrl: nonEmpty(payload.avatar_url) || nonEmpty(payload.sender_avatar_url) || null,
    receiverUserId,
    quantity: Math.max(1, Math.round(rawQuantity)),
    createdAt,
  });
}
