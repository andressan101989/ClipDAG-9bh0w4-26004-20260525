import { resolveGiftAnimation, type ResolvedGiftAnimation } from './giftAnimationResolver';
import type { LiveGiftPresentationEvent } from './giftPresentationContract';

export const GIFT_PRESENTATION_QUEUE_CAPACITY = 32;
export const GIFT_COMBO_WINDOW_MS = 1_200;
const MAX_SEEN_EVENT_IDS = 256;

export type GiftPresentationEntry = Readonly<{
  event: LiveGiftPresentationEvent;
  animation: ResolvedGiftAnimation;
  comboCount: number;
}>;

export type GiftQueueEnqueueResult =
  | Readonly<{ accepted: true; entry: GiftPresentationEntry; combined: boolean; evictedEventId: string | null }>
  | Readonly<{ accepted: false; reason: 'duplicate' | 'cancelled' | 'capacity'; entry?: never }>;

function comboKey(event: LiveGiftPresentationEvent): string {
  return `${event.giftId}\u0000${event.senderUserId}\u0000${event.receiverUserId}`;
}

function compareEntries(a: GiftPresentationEntry, b: GiftPresentationEntry): number {
  const tierPriority = { micro: 0, standard: 1, featured: 2, premium: 3, epic: 4, legendary: 5 } as const;
  return tierPriority[b.animation.tier] - tierPriority[a.animation.tier]
    || b.event.priority - a.event.priority
    || a.event.createdAt - b.event.createdAt
    || a.event.eventId.localeCompare(b.event.eventId);
}

export class GiftPresentationQueue {
  readonly capacity: number;
  private pending: GiftPresentationEntry[] = [];
  private active: GiftPresentationEntry | null = null;
  private seenOrder: string[] = [];
  private seen = new Set<string>();
  private cancelled = false;

  constructor(capacity = GIFT_PRESENTATION_QUEUE_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  enqueue(event: LiveGiftPresentationEvent): GiftQueueEnqueueResult {
    if (this.cancelled) return { accepted: false, reason: 'cancelled' };
    if (this.seen.has(event.eventId) || this.seen.has(event.transactionId)) return { accepted: false, reason: 'duplicate' };
    const animation = resolveGiftAnimation(event);
    const combinableIndex = this.pending.findIndex(item =>
      comboKey(item.event) === comboKey(event)
      && event.createdAt >= item.event.createdAt
      && event.createdAt - item.event.createdAt <= GIFT_COMBO_WINDOW_MS,
    );
    if (combinableIndex >= 0) {
      const previous = this.pending[combinableIndex];
      const combined = Object.freeze({ event: previous.event, animation: previous.animation, comboCount: previous.comboCount + 1 });
      this.pending[combinableIndex] = combined;
      this.remember(event);
      return { accepted: true, entry: combined, combined: true, evictedEventId: null };
    }

    const entry = Object.freeze({ event, animation, comboCount: 1 });
    let evictedEventId: string | null = null;
    if (this.pending.length >= this.capacity) {
      const lowestIndex = this.findLowestEvictable();
      if (lowestIndex < 0) return { accepted: false, reason: 'capacity' };
      evictedEventId = this.pending[lowestIndex].event.eventId;
      this.pending.splice(lowestIndex, 1);
    }
    this.remember(event);
    this.pending.push(entry);
    this.pending.sort(compareEntries);
    return { accepted: true, entry, combined: false, evictedEventId };
  }

  next(): GiftPresentationEntry | null {
    if (this.cancelled || this.active) return this.active;
    this.active = this.pending.shift() ?? null;
    return this.active;
  }

  complete(eventId: string): GiftPresentationEntry | null {
    if (this.active?.event.eventId === eventId) this.active = null;
    return this.next();
  }

  removePending(eventId: string): GiftPresentationEntry | null {
    const index = this.pending.findIndex(item => item.event.eventId === eventId);
    if (index < 0) return null;
    const [removed] = this.pending.splice(index, 1);
    return removed;
  }

  cancel(): void {
    this.cancelled = true;
    this.active = null;
    this.pending = [];
  }

  reset(): void {
    this.cancelled = false;
    this.active = null;
    this.pending = [];
    this.seen.clear();
    this.seenOrder = [];
  }

  snapshot(): Readonly<{ active: GiftPresentationEntry | null; pending: readonly GiftPresentationEntry[]; cancelled: boolean }> {
    return Object.freeze({ active: this.active, pending: Object.freeze([...this.pending]), cancelled: this.cancelled });
  }

  private remember(event: LiveGiftPresentationEvent): void {
    for (const key of [event.eventId, event.transactionId]) {
      if (!this.seen.has(key)) {
        this.seen.add(key);
        this.seenOrder.push(key);
      }
    }
    while (this.seenOrder.length > MAX_SEEN_EVENT_IDS) {
      const oldest = this.seenOrder.shift();
      if (oldest) this.seen.delete(oldest);
    }
  }

  private findLowestEvictable(): number {
    let candidate = -1;
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (!this.pending[index].animation.exclusive) {
        candidate = index;
        break;
      }
    }
    return candidate;
  }
}
