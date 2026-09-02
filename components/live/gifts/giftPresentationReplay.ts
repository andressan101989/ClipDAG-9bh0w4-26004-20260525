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
export const GIFT_REPLAY_MIN_UUID = '00000000-0000-0000-0000-000000000000';

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
  now?: () => number;
}>;

function compareCursor(a: GiftReplayCursor, b: GiftReplayCursor): number {
  return a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId);
}

function compareRows(a: GiftReplayRow, b: GiftReplayRow): number {
  return compareCursor(a.cursor, b.cursor);
}

function earlierCursor(a: GiftReplayCursor | null, b: GiftReplayCursor): GiftReplayCursor {
  if (!a) return b;
  const order = compareCursor(a, b);
  if (order < 0) return a;
  if (order > 0) return b;
  return a.inclusive ? a : b;
}

function cursorAdvanced(before: GiftReplayCursor, after: GiftReplayCursor): boolean {
  const order = compareCursor(after, before);
  return order > 0 || (order === 0 && before.inclusive && !after.inclusive);
}

export function createInitialGiftReplayCursor(now = Date.now()): GiftReplayCursor {
  return Object.freeze({
    createdAt: new Date(now).toISOString(),
    eventId: GIFT_REPLAY_MIN_UUID,
    inclusive: true,
  });
}

export function clampGiftReplayCursor(cursor: GiftReplayCursor, now = Date.now()): GiftReplayCursor {
  const lowerBound = new Date(now - GIFT_REPLAY_MAX_AGE_MS).toISOString();
  if (cursor.createdAt >= lowerBound) return cursor;
  return Object.freeze({
    createdAt: lowerBound,
    eventId: GIFT_REPLAY_MIN_UUID,
    inclusive: true,
  });
}

export class GiftPresentationReplayCoordinator {
  private cursor: GiftReplayCursor | null = null;
  private deferredCursor: GiftReplayCursor | null = null;
  private inFlight: Promise<void> | null = null;
  private cancelled = false;
  private generation = 0;
  private requestEpoch = 0;
  private continuationRequested = false;
  private continuationTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryResolve: (() => void) | null = null;

  constructor(private readonly options: GiftPresentationReplayOptions) {}

  request(cursor: GiftReplayCursor): void {
    if (this.cancelled) return;
    this.recordRequest(cursor);
    this.options.logger?.('backpressure', cursor.eventId.slice(0, 8));
  }

  notifyCapacityAvailable(): Promise<void> {
    return this.replay();
  }

  notifyReconnect(cursor?: GiftReplayCursor | null): Promise<void> {
    if (cursor) this.recordRequest(cursor);
    return this.replay();
  }

  replay(): Promise<void> {
    if (this.cancelled || !this.cursor) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.continuationTimer = null;
    this.continuationRequested = false;
    const generation = this.generation;
    const flight = this.run(generation).finally(() => {
      if (this.inFlight !== flight) return;
      this.inFlight = null;
      this.mergeDeferredCursor();
      if (this.continuationRequested && this.cursor && this.isCurrent(generation)) {
        this.continuationRequested = false;
        this.scheduleContinuation(generation);
      }
    });
    this.inFlight = flight;
    return flight;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.generation += 1;
    this.cursor = null;
    this.deferredCursor = null;
    this.continuationRequested = false;
    if (this.continuationTimer) clearTimeout(this.continuationTimer);
    this.continuationTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryResolve?.();
    this.retryResolve = null;
    this.options.logger?.('replay_cancelled');
  }

  snapshot(): Readonly<{ pending: boolean; inFlight: boolean; cancelled: boolean; timerActive: boolean }> {
    return Object.freeze({
      pending: this.cursor !== null || this.deferredCursor !== null,
      inFlight: this.inFlight !== null,
      cancelled: this.cancelled,
      timerActive: this.retryTimer !== null || this.continuationTimer !== null,
    });
  }

  private async run(generation: number): Promise<void> {
    this.options.logger?.('replay_start');
    for (let pageNumber = 0; pageNumber < GIFT_REPLAY_MAX_PAGES_PER_RUN; pageNumber += 1) {
      if (!this.isCurrent(generation) || !this.cursor) return;
      const requestedCursor = clampGiftReplayCursor(
        this.cursor,
        this.options.now?.() ?? Date.now(),
      );
      this.cursor = requestedCursor;
      const fetchEpoch = this.requestEpoch;
      let rows: readonly GiftReplayRow[] | null = null;
      for (let attempt = 1; attempt <= GIFT_REPLAY_MAX_NETWORK_ATTEMPTS; attempt += 1) {
        try {
          rows = await this.options.fetchPage(requestedCursor, GIFT_REPLAY_PAGE_SIZE);
          break;
        } catch {
          if (attempt === GIFT_REPLAY_MAX_NETWORK_ATTEMPTS) {
            this.continuationRequested = false;
            return;
          }
          await this.waitForRetry(generation);
        }
        if (!this.isCurrent(generation)) return;
      }
      if (!this.isCurrent(generation) || rows === null) return;

      const ordered = [...rows].sort(compareRows).slice(0, GIFT_REPLAY_PAGE_SIZE);
      if (ordered.length === 0) {
        this.mergeDeferredCursor();
        if (this.requestEpoch !== fetchEpoch) {
          this.continuationRequested = false;
          continue;
        }
        this.cursor = null;
        this.continuationRequested = false;
        this.options.logger?.('replay_complete');
        return;
      }

      for (const row of ordered) {
        if (!this.isCurrent(generation)) return;
        const outcome = this.options.enqueue(row);
        if (outcome.status === 'backpressure') {
          this.cursor = earlierCursor(this.cursor, Object.freeze({ ...row.cursor, inclusive: true }));
          this.mergeDeferredCursor();
          this.continuationRequested = false;
          return;
        }
        if (outcome.status === 'cancelled') {
          this.continuationRequested = false;
          return;
        }
        const advancedCursor = Object.freeze({ ...row.cursor, inclusive: false });
        if (cursorAdvanced(this.cursor, advancedCursor)) this.cursor = advancedCursor;
        if (outcome.status === 'accepted' || outcome.status === 'combined') {
          this.options.logger?.('replay_accepted', row.event.eventId.slice(0, 8));
        }
      }

      const advanced = cursorAdvanced(requestedCursor, this.cursor);
      this.mergeDeferredCursor();
      if (!advanced) {
        this.continuationRequested = false;
        return;
      }

      if (ordered.length < GIFT_REPLAY_PAGE_SIZE) {
        if (this.requestEpoch !== fetchEpoch) {
          this.continuationRequested = false;
          continue;
        }
        this.cursor = null;
        this.continuationRequested = false;
        this.options.logger?.('replay_complete');
        return;
      }
    }
    if (this.cursor) this.continuationRequested = true;
  }

  private recordRequest(cursor: GiftReplayCursor): void {
    this.requestEpoch += 1;
    if (this.inFlight) {
      this.deferredCursor = earlierCursor(this.deferredCursor, cursor);
      this.continuationRequested = true;
      return;
    }
    this.cursor = earlierCursor(this.cursor, cursor);
  }

  private mergeDeferredCursor(): void {
    if (!this.deferredCursor) return;
    this.cursor = earlierCursor(this.cursor, this.deferredCursor);
    this.deferredCursor = null;
  }

  private scheduleContinuation(generation: number): void {
    if (this.continuationTimer || !this.cursor || !this.isCurrent(generation)) return;
    this.continuationTimer = setTimeout(() => {
      this.continuationTimer = null;
      if (!this.cursor || !this.isCurrent(generation)) return;
      void this.replay();
    }, 0);
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
