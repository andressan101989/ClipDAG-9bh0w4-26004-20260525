// Transport bounds are not scoring rules. All points and caps belong to PostgreSQL.
const BATCH_SIZE = 16;
const BATCH_DELAY_MS = 300;
export type LikeBatch = { count: number; idempotencyKey: string };
export type LikeReceipt = { accepted_count: number; awarded_points: number };
export class LikeBatchRejectedError extends Error {}

export class LiveBattleLikeBatcher {
  private queued = 0;
  private attempt: LikeBatch | null = null;
  private running = false;
  private closed = false;
  private disabled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  constructor(
    private readonly send: (batch: LikeBatch) => Promise<LikeReceipt>,
    private readonly confirmed: () => void,
    private readonly key: () => string = () => `like:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  ) {}

  add(): void {
    if (this.closed || this.disabled) return;
    this.queued += 1;
    this.schedule(BATCH_DELAY_MS);
  }

  private schedule(delay: number): void {
    if (this.closed || this.disabled || this.timer || this.running) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }

  async flush(): Promise<void> {
    if (this.closed || this.disabled) return;
    await this.flushAttempt();
  }

  private cancelTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private disable(): void {
    this.disabled = true;
    this.attempt = null;
    this.queued = 0;
    this.cancelTimer();
  }

  private async flushAttempt(final = false): Promise<void> {
    if (this.running || this.disabled || (this.closed && !final)) return;
    this.cancelTimer();
    if (!this.attempt && this.queued) {
      const count = Math.min(BATCH_SIZE, this.queued);
      this.queued -= count;
      this.attempt = { count, idempotencyKey: this.key() };
    }
    // Closing permits only this one bounded attempt, never a drain loop.
    if (final) this.queued = 0;
    if (!this.attempt) return;
    this.running = true;
    let retry = false;
    try {
      const attempt = this.attempt;
      const receipt = await this.send(attempt);
      this.attempt = null;
      this.retryDelay = 1000;
      if (receipt.accepted_count < attempt.count) this.disable();
      if (!this.closed) this.confirmed();
    } catch (error) {
      // Preserve the whole attempt on ambiguous failure, including its key.
      if (error instanceof LikeBatchRejectedError) this.disable();
      else if (!this.closed && !this.disabled) retry = true;
    } finally {
      this.running = false;
      if (this.closed || this.disabled) {
        this.attempt = null;
        this.queued = 0;
        this.cancelTimer();
      } else if (this.attempt || this.queued) {
        this.schedule(retry ? this.retryDelay : BATCH_DELAY_MS);
        if (retry) this.retryDelay = Math.min(10000, this.retryDelay * 2);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cancelTimer();
    if (this.running) {
      this.queued = 0;
      return;
    }
    // One immediate best-effort flush; no timers or retries after unmount.
    void this.flushAttempt(true);
  }
}
