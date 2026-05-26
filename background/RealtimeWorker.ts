/**
 * background/RealtimeWorker.ts — Background realtime health & recovery coordinator
 *
 * Runs independently of React to:
 *   - Monitor ConnectionManager health at regular intervals
 *   - Trigger SessionRecovery.recoverAll() on reconnect
 *   - Maintain PresenceManager heartbeat
 *   - Flush SyncEngine pending mutations
 *   - Coordinate PollingManager wake-up on foreground
 *   - Track realtime latency for Diagnostics
 *
 * Pauses on background (reduces to heartbeat-only mode).
 * Full resume on foreground.
 *
 * Usage:
 *   RealtimeWorker.start(userId);
 *   RealtimeWorker.stop();
 */

import { AppLifecycle }     from '@/modules/core/AppLifecycle';
import { ConnectionManager } from '@/modules/realtime/ConnectionManager';
import { PresenceManager }  from '@/modules/realtime/PresenceManager';
import { SessionRecovery }  from '@/modules/realtime/SessionRecovery';
import { PollingManager }   from '@/modules/realtime/PollingManager';

const HEALTH_CHECK_INTERVAL_MS  = 15_000;   // connection health every 15s
const HEARTBEAT_INTERVAL_MS     = 30_000;   // presence heartbeat every 30s
const BACKGROUND_INTERVAL_MS    = 60_000;   // reduced poll in background

class RealtimeWorkerImpl {
  private _healthTimer:    ReturnType<typeof setInterval> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _userId = '';
  private _running = false;
  private _inBackground = false;

  start(userId: string): void {
    if (this._running) return;
    this._running = true;
    this._userId = userId;

    this._healthTimer = setInterval(() => {
      this._checkHealth();
    }, this._inBackground ? BACKGROUND_INTERVAL_MS : HEALTH_CHECK_INTERVAL_MS);

    this._heartbeatTimer = setInterval(() => {
      if (userId) PresenceManager.heartbeat(userId).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    // React to app state
    AppLifecycle.onBackground(() => {
      this._inBackground = true;
      // Slow down health checks
      this._restartHealthTimer(BACKGROUND_INTERVAL_MS);
    });

    AppLifecycle.onForeground(() => {
      this._inBackground = false;
      // Speed up health checks + immediate check
      this._restartHealthTimer(HEALTH_CHECK_INTERVAL_MS);
      this._onForegroundResume();
    });

    console.log('[RealtimeWorker] started for user:', userId);
  }

  stop(): void {
    if (this._healthTimer)    { clearInterval(this._healthTimer);    this._healthTimer    = null; }
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    this._running = false;
    console.log('[RealtimeWorker] stopped');
  }

  updateUserId(userId: string): void {
    this._userId = userId;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _checkHealth(): void {
    try {
      const state = ConnectionManager.state;
      if (state === 'disconnected' || state === 'error') {
        console.log('[RealtimeWorker] unhealthy connection detected — triggering recovery');
        SessionRecovery.recoverAll?.().catch(() => {});
      }
    } catch (e: any) {
      console.warn('[RealtimeWorker] health check error:', e?.message);
    }
  }

  private async _onForegroundResume(): Promise<void> {
    console.log('[RealtimeWorker] foreground — running recovery checks');
    try {
      await SessionRecovery.recoverAll?.();
      PollingManager.wakeAll?.();
    } catch (e: any) {
      console.warn('[RealtimeWorker] foreground resume error:', e?.message);
    }
  }

  private _restartHealthTimer(intervalMs: number): void {
    if (this._healthTimer) clearInterval(this._healthTimer);
    this._healthTimer = setInterval(() => this._checkHealth(), intervalMs);
  }
}

export const RealtimeWorker = new RealtimeWorkerImpl();
