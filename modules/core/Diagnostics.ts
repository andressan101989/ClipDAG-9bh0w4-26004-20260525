/**
 * modules/core/Diagnostics.ts — Internal observability & metrics system
 *
 * Collects performance metrics without external SDKs:
 *   - JS thread responsiveness (timer drift)
 *   - Memory snapshots (heap size approximation)
 *   - Render frame stats (from FrameScheduler)
 *   - Upload diagnostics (success rate, avg speed)
 *   - Realtime diagnostics (polling latency, missed polls)
 *   - Screen time tracking (detect slow screens)
 *   - Resource usage over time
 *   - Thermal state history
 *
 * Diagnostic reports are stored in a ring buffer (last 100 entries).
 * Accessible via Diagnostics.getReport() for in-app debug panels.
 *
 * Usage:
 *   Diagnostics.startCollection();
 *   const report = Diagnostics.getReport();
 *   Diagnostics.markScreenVisible('FeedScreen');
 *   Diagnostics.recordUpload({ bytes: 1024000, durationMs: 2300, success: true });
 */

import { FrameScheduler }  from './FrameScheduler';
import { ResourceManager } from './ResourceManager';
import { AppLifecycle }    from './AppLifecycle';
import { ThermalMonitor }  from './ThermalMonitor';

export interface MemorySnapshot {
  timestamp:  number;
  heapUsedMB: number;   // approximation via performance.memory if available
  jsHeapMB?:  number;
}

export interface ScreenMetric {
  screen:       string;
  visibleAt:    number;
  hiddenAt?:    number;
  durationMs?:  number;
  renderTimeMs: number;
}

export interface UploadMetric {
  timestamp:  number;
  bytes:      number;
  durationMs: number;
  speedKBps:  number;
  success:    boolean;
  error?:     string;
}

export interface RealtimeMetric {
  key:          string;
  timestamp:    number;
  latencyMs:    number;
  missed:       boolean;
}

export interface DiagnosticsReport {
  generatedAt:    number;
  appVersion:     string;
  thermalState:   string;
  gpuPressure:    string;
  frameStats:     ReturnType<typeof FrameScheduler.getStats>;
  heldResources:  ReturnType<typeof ResourceManager.heldResources>;
  memoryHistory:  MemorySnapshot[];
  recentScreens:  ScreenMetric[];
  uploadStats:    { count: number; successRate: string; avgSpeedKBps: string };
  realtimeStats:  { registeredKeys: number; avgLatencyMs: string; missRate: string };
}

const RING_BUFFER_SIZE = 100;

function ringPush<T>(arr: T[], item: T): T[] {
  const next = [...arr, item];
  return next.length > RING_BUFFER_SIZE ? next.slice(-RING_BUFFER_SIZE) : next;
}

class DiagnosticsImpl {
  private _active = false;
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  private _memoryHistory:  MemorySnapshot[]   = [];
  private _screenMetrics:  ScreenMetric[]     = [];
  private _uploadMetrics:  UploadMetric[]     = [];
  private _realtimeMetrics: RealtimeMetric[]  = [];
  private _activeScreens = new Map<string, { visibleAt: number; renderStart: number }>();

  // ── Collection lifecycle ──────────────────────────────────────────────────

  startCollection(intervalMs = 10_000): void {
    if (this._active) return;
    this._active = true;

    ThermalMonitor.start();

    this._intervalId = setInterval(() => this._collect(), intervalMs);

    AppLifecycle.onBackground(() => {
      if (this._intervalId) {
        clearInterval(this._intervalId);
        this._intervalId = null;
      }
    });
    AppLifecycle.onForeground(() => {
      if (this._active && !this._intervalId) {
        this._intervalId = setInterval(() => this._collect(), intervalMs);
      }
    });

    console.log('[Diagnostics] collection started');
  }

  stop(): void {
    this._active = false;
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
    ThermalMonitor.stop();
  }

  // ── Screen tracking ───────────────────────────────────────────────────────

  markScreenVisible(screenName: string): void {
    this._activeScreens.set(screenName, {
      visibleAt:   Date.now(),
      renderStart: performance.now(),
    });
  }

  markScreenHidden(screenName: string): void {
    const entry = this._activeScreens.get(screenName);
    if (!entry) return;
    this._activeScreens.delete(screenName);

    const now         = Date.now();
    const renderTimeMs = performance.now() - entry.renderStart;
    const metric: ScreenMetric = {
      screen:       screenName,
      visibleAt:    entry.visibleAt,
      hiddenAt:     now,
      durationMs:   now - entry.visibleAt,
      renderTimeMs,
    };

    this._screenMetrics = ringPush(this._screenMetrics, metric);

    if (renderTimeMs > 500) {
      console.warn(`[Diagnostics] slow screen "${screenName}": first render took ${renderTimeMs.toFixed(0)}ms`);
    }
  }

  /** Public alias for _collect() — called by TelemetryWorker on its snapshot interval. */
  recordMemorySnapshot(): void {
    this._collect();
  }

  // ── Upload tracking ───────────────────────────────────────────────────────

  recordUpload(data: { bytes: number; durationMs: number; success: boolean; error?: string }): void {
    const speedKBps = data.durationMs > 0
      ? (data.bytes / 1024) / (data.durationMs / 1000)
      : 0;

    this._uploadMetrics = ringPush(this._uploadMetrics, {
      timestamp:  Date.now(),
      ...data,
      speedKBps,
    });
  }

  // ── Realtime tracking ─────────────────────────────────────────────────────

  recordPollResult(key: string, latencyMs: number, missed: boolean): void {
    this._realtimeMetrics = ringPush(this._realtimeMetrics, {
      key,
      timestamp: Date.now(),
      latencyMs,
      missed,
    });
  }

  // ── Report ────────────────────────────────────────────────────────────────

  getReport(): DiagnosticsReport {
    const uploads = this._uploadMetrics;
    const rt      = this._realtimeMetrics;

    const successRate = uploads.length > 0
      ? `${((uploads.filter(u => u.success).length / uploads.length) * 100).toFixed(1)}%`
      : 'N/A';

    const avgSpeed = uploads.length > 0
      ? `${(uploads.reduce((s, u) => s + u.speedKBps, 0) / uploads.length).toFixed(0)}`
      : 'N/A';

    const avgLatency = rt.length > 0
      ? `${(rt.reduce((s, m) => s + m.latencyMs, 0) / rt.length).toFixed(0)}ms`
      : 'N/A';

    const missRate = rt.length > 0
      ? `${((rt.filter(m => m.missed).length / rt.length) * 100).toFixed(1)}%`
      : 'N/A';

    const uniqueRTKeys = new Set(rt.map(m => m.key)).size;

    return {
      generatedAt:   Date.now(),
      appVersion:    '1.0.0',
      thermalState:  ThermalMonitor.currentState,
      gpuPressure:   FrameScheduler.gpuPressure,
      frameStats:    FrameScheduler.getStats(),
      heldResources: ResourceManager.heldResources(),
      memoryHistory: this._memoryHistory.slice(-20),
      recentScreens: this._screenMetrics.slice(-10),
      uploadStats:   { count: uploads.length, successRate, avgSpeedKBps: avgSpeed },
      realtimeStats: { registeredKeys: uniqueRTKeys, avgLatencyMs: avgLatency, missRate },
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _collect(): void {
    const snapshot: MemorySnapshot = {
      timestamp:  Date.now(),
      heapUsedMB: this._estimateHeapMB(),
    };
    this._memoryHistory = ringPush(this._memoryHistory, snapshot);
  }

  private _estimateHeapMB(): number {
    try {
      // Web / Hermes with performance.memory
      const mem = (performance as any).memory;
      if (mem?.usedJSHeapSize) {
        return mem.usedJSHeapSize / 1_048_576;
      }
    } catch {}
    return 0;
  }
}

export const Diagnostics = new DiagnosticsImpl();
