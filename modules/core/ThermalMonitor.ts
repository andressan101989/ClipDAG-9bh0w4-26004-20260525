/**
 * modules/core/ThermalMonitor.ts — Device thermal state tracking
 *
 * Monitors device temperature and coordinates adaptive degradation:
 *   - Polls for thermal heuristics (frame time, battery temp approximation)
 *   - Reports to FrameScheduler for FPS capping
 *   - Reports to MemoryPressureMonitor for quality degradation
 *   - Prevents thermal throttling on mid-range devices during livestreaming
 *
 * iOS thermal states (from ProcessInfo.thermalState):
 *   nominal  → everything OK
 *   fair     → slight heat, reduce background work
 *   serious  → hot, throttle rendering
 *   critical → very hot, emergency reduce everything
 *
 * Detection strategy (without native bridge):
 *   - Track render frame times via FrameScheduler stats
 *   - Track JS thread responsiveness via periodic timer drift
 *   - Escalate state when indicators exceed thresholds
 *
 * Usage:
 *   ThermalMonitor.start();
 *   ThermalMonitor.stop();
 *   const state = ThermalMonitor.currentState;
 */

import { FrameScheduler }        from './FrameScheduler';
import { MemoryPressureMonitor } from './MemoryPressureMonitor';
import { AppLifecycle }          from './AppLifecycle';

export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

const POLL_INTERVAL_MS        = 5_000;
const TIMER_DRIFT_FAIR_MS     = 20;    // >20ms drift → fair
const TIMER_DRIFT_SERIOUS_MS  = 50;    // >50ms drift → serious
const TIMER_DRIFT_CRITICAL_MS = 100;   // >100ms drift → critical

class ThermalMonitorImpl {
  private _state:     ThermalState = 'nominal';
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _lastTimerFire = 0;
  private _driftSamples: number[] = [];
  private readonly _MAX_SAMPLES = 10;

  get currentState(): ThermalState { return this._state; }

  start(): void {
    if (this._intervalId) return;

    this._lastTimerFire = performance.now();
    this._intervalId = setInterval(() => this._sample(), POLL_INTERVAL_MS);

    AppLifecycle.onBackground(() => this.stop());
    AppLifecycle.onForeground(() => {
      if (!this._intervalId) this.start();
    });

    console.log('[ThermalMonitor] started');
  }

  stop(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._driftSamples = [];
    this._state = 'nominal';
  }

  /** Receive native thermal state (if native bridge available). */
  reportNativeState(state: ThermalState): void {
    this._applyState(state, 'native');
  }

  private _sample(): void {
    const now   = performance.now();
    const drift = now - this._lastTimerFire - POLL_INTERVAL_MS;
    this._lastTimerFire = now;

    this._driftSamples.push(Math.abs(drift));
    if (this._driftSamples.length > this._MAX_SAMPLES) {
      this._driftSamples.shift();
    }

    const avgDrift = this._driftSamples.reduce((a, b) => a + b, 0) / this._driftSamples.length;

    let newState: ThermalState = 'nominal';
    if (avgDrift > TIMER_DRIFT_CRITICAL_MS)  newState = 'critical';
    else if (avgDrift > TIMER_DRIFT_SERIOUS_MS)  newState = 'serious';
    else if (avgDrift > TIMER_DRIFT_FAIR_MS) newState = 'fair';

    // Also check FrameScheduler for sustained jank
    const frameStats = FrameScheduler.getStats();
    const hasHighDropRate = frameStats.some(s => {
      const dropPct = parseFloat(s.dropRate);
      return dropPct > 30;
    });
    if (hasHighDropRate && newState === 'nominal') newState = 'fair';

    this._applyState(newState, `drift:${avgDrift.toFixed(0)}ms`);
  }

  private _applyState(state: ThermalState, reason: string): void {
    if (this._state === state) return;

    const prev = this._state;
    this._state = state;
    console.log(`[ThermalMonitor] ${prev} → ${state} (${reason})`);

    FrameScheduler.reportThermalState(state);

    if (state === 'serious' || state === 'critical') {
      MemoryPressureMonitor.reportPressure(state === 'critical' ? 'critical' : 'moderate');
    } else if (state === 'nominal') {
      MemoryPressureMonitor.reset();
    }
  }
}

export const ThermalMonitor = new ThermalMonitorImpl();
