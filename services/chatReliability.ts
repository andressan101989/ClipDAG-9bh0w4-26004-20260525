import type { ChatDeliveryStatus } from '@/services/chatContract';

const rank: Record<Exclude<ChatDeliveryStatus, 'failed'>, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

export function monotonicDeliveryStatus(
  current?: ChatDeliveryStatus,
  incoming?: ChatDeliveryStatus,
): ChatDeliveryStatus | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  if (incoming === 'failed') return current === 'pending' || current === 'failed' ? 'failed' : current;
  if (current === 'failed') return incoming;
  return rank[incoming] >= rank[current] ? incoming : current;
}

export function isChatReadEligible(input: {
  authenticatedUserId: string | null;
  expectedUserId: string;
  activePartnerId: string | null;
  messagePartnerId: string;
  appActive: boolean;
  generation: number;
  expectedGeneration: number;
}): boolean {
  return input.authenticatedUserId === input.expectedUserId
    && input.activePartnerId === input.messagePartnerId
    && input.appActive
    && input.generation === input.expectedGeneration;
}

export class ChatRetryCoordinator {
  private flights = new Map<string, Promise<void>>();
  run(key: string, task: () => Promise<void>): Promise<void> {
    const current = this.flights.get(key);
    if (current) return current;
    const promise = task().finally(() => { if (this.flights.get(key) === promise) this.flights.delete(key); });
    this.flights.set(key, promise);
    return promise;
  }
  clear(): void { this.flights.clear(); }
  get size(): number { return this.flights.size; }
}
