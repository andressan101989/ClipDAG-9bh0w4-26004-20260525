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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 1000;
  constructor(
    private readonly send: (batch: LikeBatch) => Promise<LikeReceipt>,
    private readonly confirmed: () => void,
    private readonly key: () => string = () => `like:${Date.now()}:${Math.random().toString(36).slice(2)}`,
  ) {}

  add(): void {
    if (this.closed) return;
    this.queued += 1;
    this.schedule(BATCH_DELAY_MS);
  }

  private schedule(delay: number): void {
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }

  async flush(): Promise<void> {
    if (this.running) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.attempt && this.queued) {
      const count = Math.min(BATCH_SIZE, this.queued);
      this.queued -= count;
      this.attempt = { count, idempotencyKey: this.key() };
    }
    if (!this.attempt) return;
    this.running = true;
    let retry = false;
    try {
      await this.send(this.attempt);
      this.attempt = null;
      this.retryDelay = 1000;
      if (!this.closed) this.confirmed();
    } catch (error) {
      // Preserve the whole attempt on ambiguous failure, including its key.
      if (error instanceof LikeBatchRejectedError) this.attempt = null;
      else retry = true;
    } finally {
      this.running = false;
      if (this.attempt || this.queued) {
        this.schedule(retry ? this.retryDelay : BATCH_DELAY_MS);
        if (retry) this.retryDelay = Math.min(10000, this.retryDelay * 2);
      }
    }
  }

  close(): void {
    this.closed = true;
    // Drain already accepted taps using their original session/Battle context.
    // Late fresh batches receive zero points from the authoritative deadline check.
    void this.flush();
  }
}
