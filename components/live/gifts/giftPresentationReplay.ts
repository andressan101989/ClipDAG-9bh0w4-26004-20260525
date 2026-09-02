import type {
  GiftEnqueueOutcome,
  GiftReplayCursor,
  GiftReplayRow,
} from './giftPresentationContract';

export const GIFT_REPLAY_PAGE_SIZE = 16;
export const GIFT_REPLAY_MAX_PAGES_PER_RUN = 4;
export const GIFT_REPLAY_MAX_NETWORK_ATTEMPTS = 2;
export const GIFT_REPLAY_RETRY_DELAY_MS = 80;
export const GIFT_REPLAY_MAX_AGE_MS = 30 * 60 * 1_000;

export type GiftReplayPageSource = (
  cursor: GiftReplayCursor,
  limit: number,
) => Promise<readonly GiftReplayRow[]>;

type GiftReplayLogger = (
  marker: 'backpressure' | 'replay_start' | 'replay_accepted' | 'replay_complete' | 'replay_cancelled',
  eventCode?: string,
) => void;

type GiftPresentationReplayOptions = Readonly<{
  fetchPage: GiftReplayPageSource;
  enqueue: (row: GiftReplayRow) => GiftEnqueueOutcome;
  logger?: GiftReplayLogger;
}>;

function compareCursor(a: GiftReplayCursor, b: GiftReplayCursor): number {
  return a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId);
}

function compareRows(a: GiftReplayRow, b: GiftReplayRow): number {
  return compareCursor(a.cursor, b.cursor);
}

export class GiftPresentationReplayCoordinator {
  private cursor: GiftReplayCursor | null = null;
  private inFlight: Promise<void> | null = null;
  private cancelled = false;
  private generation = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryResolve: (() => void) | null = null;

  constructor(private readonly options: GiftPresentationReplayOptions) {}

  request(cursor: GiftReplayCursor): void {
    if (this.cancelled) return;
    if (!this.cursor || compareCursor(cursor, this.cursor) < 0) this.cursor = cursor;
    this.options.logger?.('backpressure', cursor.eventId.slice(0, 8));
  }

  notifyCapacityAvailable(): Promise<void> {
    return this.replay();
  }

  notifyReconnect(cursor?: GiftReplayCursor | null): Promise<void> {
    if (cursor) this.request(cursor);
    return this.replay();
  }

  replay(): Promise<void> {
    if (this.cancelled || !this.cursor) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    const flight = this.run(generation).finally(() => {
      if (this.inFlight === flight) this.inFlight = null;
    });
    this.inFlight = flight;
    return flight;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.generation += 1;
    this.cursor = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryResolve?.();
    this.retryResolve = null;
    this.options.logger?.('replay_cancelled');
  }

  snapshot(): Readonly<{ pending: boolean; inFlight: boolean; cancelled: boolean; timerActive: boolean }> {
    return Object.freeze({
      pending: this.cursor !== null,
      inFlight: this.inFlight !== null,
      cancelled: this.cancelled,
      timerActive: this.retryTimer !== null,
    });
  }

  private async run(generation: number): Promise<void> {
    this.options.logger?.('replay_start');
    for (let pageNumber = 0; pageNumber < GIFT_REPLAY_MAX_PAGES_PER_RUN; pageNumber += 1) {
      if (!this.isCurrent(generation) || !this.cursor) return;
      const requestedCursor = this.cursor;
      let rows: readonly GiftReplayRow[] | null = null;
      for (let attempt = 1; attempt <= GIFT_REPLAY_MAX_NETWORK_ATTEMPTS; attempt += 1) {
        try {
          rows = await this.options.fetchPage(requestedCursor, GIFT_REPLAY_PAGE_SIZE);
          break;
        } catch {
          if (attempt === GIFT_REPLAY_MAX_NETWORK_ATTEMPTS) return;
          await this.waitForRetry(generation);
        }
        if (!this.isCurrent(generation)) return;
      }
      if (!this.isCurrent(generation) || rows === null) return;

      const ordered = [...rows].sort(compareRows).slice(0, GIFT_REPLAY_PAGE_SIZE);
      if (ordered.length === 0) {
        this.cursor = null;
        this.options.logger?.('replay_complete');
        return;
      }

      for (const row of ordered) {
        if (!this.isCurrent(generation)) return;
        const outcome = this.options.enqueue(row);
        if (outcome.status === 'backpressure') {
          this.cursor = Object.freeze({ ...row.cursor, inclusive: true });
          return;
        }
        if (outcome.status === 'cancelled') return;
        this.cursor = Object.freeze({ ...row.cursor, inclusive: false });
        if (outcome.status === 'accepted' || outcome.status === 'combined') {
          this.options.logger?.('replay_accepted', row.event.eventId.slice(0, 8));
        }
      }

      if (ordered.length < GIFT_REPLAY_PAGE_SIZE) {
        this.cursor = null;
        this.options.logger?.('replay_complete');
        return;
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.cancelled && this.generation === generation;
  }

  private waitForRetry(generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return Promise.resolve();
    return new Promise(resolve => {
      this.retryResolve = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.retryResolve = null;
        resolve();
      }, GIFT_REPLAY_RETRY_DELAY_MS);
    });
  }
}
