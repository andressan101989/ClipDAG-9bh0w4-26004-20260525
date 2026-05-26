/**
 * modules/core/TelemetryPipeline.ts — Centralized production telemetry
 *
 * Aggregates all metrics from every subsystem into a unified pipeline:
 *   - FPS history with percentile stats (p50/p95/p99)
 *   - GPU pressure history with VRAM trend
 *   - Thermal state transitions log
 *   - Render surface history (frame budget, jank events)
 *   - RTC session analytics (quality, drops, reconnects)
 *   - Stream analytics (bitrate, stalls, viewer spikes)
 *   - Upload analytics (speed, retries, failures)
 *   - Memory timeline (heap, VRAM, allocation trend)
 *   - Navigation timing (mount time, route load)
 *   - Lifecycle traces (foreground/background cycles)
 *   - Background worker diagnostics
 *   - Frame drop correlation with thermal/GPU/memory
 *
 * Architecture:
 *   - Ring buffers (configurable depth) per metric category
 *   - Aggregation layer (min/max/avg/p95 per window)
 *   - Export to Diagnostics for in-app debug panel
 *   - Hooks for future remote crash reporting service
 *
 * Usage:
 *   TelemetryPipeline.initialize();
 *   TelemetryPipeline.recordFPS('FeedScreen', 58.2);
 *   TelemetryPipeline.recordRTCQuality(peerId, { rttMs: 45, packetLoss: 0.1 });
 *   const summary = TelemetryPipeline.getSummary();
 */

import { AppLifecycle }  from './AppLifecycle';
import { ThermalMonitor } from './ThermalMonitor';
import { EventBus }      from './EventBus';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FPSSample {
  surface:   string;
  fps:       number;
  timestamp: number;
  thermalState: string;
}

export interface GPUSample {
  vramKB:      number;
  activeSlots: number;
  pressure:    'low' | 'medium' | 'high' | 'critical';
  timestamp:   number;
}

export interface ThermalTransition {
  from:      string;
  to:        string;
  timestamp: number;
  durationMs?: number;
}

export interface RTCAnalytic {
  peerId:       string;
  rttMs:        number;
  packetLossPct: number;
  bitrateKbps:  number;
  qualityLevel: string;
  timestamp:    number;
}

export interface StreamAnalytic {
  sessionId:   string;
  bitrateKbps: number;
  viewerCount: number;
  stallCount:  number;
  timestamp:   number;
}

export interface NavTiming {
  route:        string;
  mountMs:      number;
  loadMs:       number;
  timestamp:    number;
}

export interface MemoryTrend {
  heapMB:     number;
  vramKB:     number;
  timestamp:  number;
}

export interface WorkerDiagnostic {
  worker:     string;
  running:    boolean;
  paused:     boolean;
  taskCount:  number;
  errorCount: number;
  timestamp:  number;
}

export interface FrameDropEvent {
  surface:       string;
  droppedFrames: number;
  thermalState:  string;
  memoryMB:      number;
  timestamp:     number;
}

export interface TelemetrySummary {
  period:         { from: number; to: number };
  fps:            { avg: number; p50: number; p95: number; p99: number; drops: number };
  thermal:        { transitions: number; mostSevere: string; timeInCritical: number };
  rtc:            { sessions: number; avgRtt: number; avgPacketLoss: number; reconnects: number };
  stream:         { sessions: number; avgBitrate: number; totalStalls: number };
  memory:         { avgHeapMB: number; peakHeapMB: number; trend: 'stable' | 'growing' | 'shrinking' };
  navigation:     { routeCount: number; avgMountMs: number; slowRoutes: string[] };
  stability:      { score: number; crashCount: number; recoveryRate: number };
}

// ── Ring buffer helper ─────────────────────────────────────────────────────────

function ring<T>(arr: T[], item: T, max: number): T[] {
  const n = [...arr, item];
  return n.length > max ? n.slice(-max) : n;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ── TelemetryPipeline ─────────────────────────────────────────────────────────

class TelemetryPipelineImpl {
  private _fpsSamples:        FPSSample[]        = [];
  private _gpuSamples:        GPUSample[]         = [];
  private _thermalTransitions: ThermalTransition[] = [];
  private _rtcAnalytics:      RTCAnalytic[]       = [];
  private _streamAnalytics:   StreamAnalytic[]    = [];
  private _navTimings:        NavTiming[]         = [];
  private _memoryTrend:       MemoryTrend[]       = [];
  private _workerDiagnostics: WorkerDiagnostic[]  = [];
  private _frameDropEvents:   FrameDropEvent[]    = [];

  private _crashCount          = 0;
  private _recoveryCount       = 0;
  private _rtcReconnectCount   = 0;
  private _initAt              = Date.now();
  private _lastThermalState    = 'nominal';

  private readonly BUFFER_SIZE = 200;

  // ── Init ───────────────────────────────────────────────────────────────────

  initialize(): void {
    // Wire thermal transitions
    EventBus.on('app:low_memory', () => {
      this.recordCrash('low_memory');
    });

    AppLifecycle.onForeground(() => {
      this._recordLifecycle('foreground');
    });
    AppLifecycle.onBackground(() => {
      this._recordLifecycle('background');
    });

    console.log('[TelemetryPipeline] initialized');
  }

  // ── FPS ────────────────────────────────────────────────────────────────────

  recordFPS(surface: string, fps: number): void {
    this._fpsSamples = ring(this._fpsSamples, {
      surface, fps, timestamp: Date.now(),
      thermalState: ThermalMonitor.currentState,
    }, this.BUFFER_SIZE);
  }

  recordFrameDrop(surface: string, droppedFrames: number, memoryMB: number): void {
    this._frameDropEvents = ring(this._frameDropEvents, {
      surface, droppedFrames,
      thermalState: ThermalMonitor.currentState,
      memoryMB,
      timestamp: Date.now(),
    }, this.BUFFER_SIZE);
  }

  // ── GPU ────────────────────────────────────────────────────────────────────

  recordGPUSample(vramKB: number, activeSlots: number): void {
    const budget = 96_000;
    const ratio  = vramKB / budget;
    const pressure: GPUSample['pressure'] =
      ratio > 0.9 ? 'critical' : ratio > 0.7 ? 'high' : ratio > 0.5 ? 'medium' : 'low';

    this._gpuSamples = ring(this._gpuSamples, {
      vramKB, activeSlots, pressure, timestamp: Date.now(),
    }, this.BUFFER_SIZE);
  }

  // ── Thermal ────────────────────────────────────────────────────────────────

  recordThermalTransition(from: string, to: string): void {
    this._thermalTransitions = ring(this._thermalTransitions, {
      from, to, timestamp: Date.now(),
    }, this.BUFFER_SIZE);
    this._lastThermalState = to;
  }

  // ── RTC ────────────────────────────────────────────────────────────────────

  recordRTCQuality(peerId: string, stats: {
    rttMs: number;
    packetLossPct: number;
    bitrateKbps: number;
    qualityLevel: string;
  }): void {
    this._rtcAnalytics = ring(this._rtcAnalytics, {
      peerId, ...stats, timestamp: Date.now(),
    }, this.BUFFER_SIZE);
  }

  recordRTCReconnect(): void {
    this._rtcReconnectCount++;
  }

  // ── Stream ─────────────────────────────────────────────────────────────────

  recordStreamSample(sessionId: string, data: {
    bitrateKbps: number;
    viewerCount: number;
    stallCount:  number;
  }): void {
    this._streamAnalytics = ring(this._streamAnalytics, {
      sessionId, ...data, timestamp: Date.now(),
    }, this.BUFFER_SIZE);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  recordNavTiming(route: string, mountMs: number, loadMs: number): void {
    this._navTimings = ring(this._navTimings, {
      route, mountMs, loadMs, timestamp: Date.now(),
    }, this.BUFFER_SIZE);

    if (mountMs > 800) {
      console.warn(`[TelemetryPipeline] slow route "${route}": mount ${mountMs.toFixed(0)}ms`);
    }
  }

  // ── Memory ─────────────────────────────────────────────────────────────────

  recordMemory(heapMB: number, vramKB: number): void {
    this._memoryTrend = ring(this._memoryTrend, {
      heapMB, vramKB, timestamp: Date.now(),
    }, this.BUFFER_SIZE);
  }

  // ── Workers ────────────────────────────────────────────────────────────────

  recordWorkerStatus(worker: string, running: boolean, paused: boolean, taskCount: number, errorCount: number): void {
    // Remove old entry for same worker
    this._workerDiagnostics = this._workerDiagnostics.filter(w => w.worker !== worker);
    this._workerDiagnostics.push({ worker, running, paused, taskCount, errorCount, timestamp: Date.now() });
  }

  // ── Stability ─────────────────────────────────────────────────────────────

  recordCrash(context: string): void {
    this._crashCount++;
    console.warn(`[TelemetryPipeline] crash recorded: ${context}`);
  }

  recordRecovery(): void {
    this._recoveryCount++;
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  getSummary(windowMs = 5 * 60_000): TelemetrySummary {
    const cutoff = Date.now() - windowMs;

    const fpsSamples = this._fpsSamples.filter(s => s.timestamp > cutoff).map(s => s.fps);
    const sortedFPS  = [...fpsSamples].sort((a, b) => a - b);
    const fpsDrops   = this._frameDropEvents.filter(e => e.timestamp > cutoff)
      .reduce((s, e) => s + e.droppedFrames, 0);

    const thermalWindow = this._thermalTransitions.filter(t => t.timestamp > cutoff);
    const mostSevere    = thermalWindow.reduce((prev, t) => {
      const rank = { nominal: 0, fair: 1, serious: 2, critical: 3 } as any;
      return (rank[t.to] ?? 0) > (rank[prev] ?? 0) ? t.to : prev;
    }, 'nominal');

    const rtcWindow   = this._rtcAnalytics.filter(r => r.timestamp > cutoff);
    const streamWindow = this._streamAnalytics.filter(s => s.timestamp > cutoff);

    const memWindow = this._memoryTrend.filter(m => m.timestamp > cutoff);
    const heapValues = memWindow.map(m => m.heapMB);
    const avgHeap    = heapValues.length > 0 ? heapValues.reduce((a, b) => a + b, 0) / heapValues.length : 0;
    const peakHeap   = heapValues.length > 0 ? Math.max(...heapValues) : 0;

    let memTrend: TelemetrySummary['memory']['trend'] = 'stable';
    if (heapValues.length >= 4) {
      const firstHalf = heapValues.slice(0, Math.floor(heapValues.length / 2));
      const secondHalf = heapValues.slice(Math.floor(heapValues.length / 2));
      const firstAvg  = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      if (secondAvg > firstAvg * 1.1) memTrend = 'growing';
      else if (secondAvg < firstAvg * 0.9) memTrend = 'shrinking';
    }

    const navWindow   = this._navTimings.filter(n => n.timestamp > cutoff);
    const slowRoutes  = navWindow.filter(n => n.mountMs > 600).map(n => n.route);
    const avgMountMs  = navWindow.length > 0
      ? navWindow.reduce((s, n) => s + n.mountMs, 0) / navWindow.length : 0;

    const stabilityScore = this._computeStabilityScore(sortedFPS, fpsDrops, thermalWindow.length);

    return {
      period:    { from: cutoff, to: Date.now() },
      fps: {
        avg:  sortedFPS.length > 0 ? sortedFPS.reduce((a, b) => a + b, 0) / sortedFPS.length : 0,
        p50:  percentile(sortedFPS, 50),
        p95:  percentile(sortedFPS, 95),
        p99:  percentile(sortedFPS, 99),
        drops: fpsDrops,
      },
      thermal: {
        transitions: thermalWindow.length,
        mostSevere,
        timeInCritical: 0, // future: calculate actual time
      },
      rtc: {
        sessions:      new Set(rtcWindow.map(r => r.peerId)).size,
        avgRtt:        rtcWindow.length > 0 ? rtcWindow.reduce((s, r) => s + r.rttMs, 0) / rtcWindow.length : 0,
        avgPacketLoss: rtcWindow.length > 0 ? rtcWindow.reduce((s, r) => s + r.packetLossPct, 0) / rtcWindow.length : 0,
        reconnects:    this._rtcReconnectCount,
      },
      stream: {
        sessions:     new Set(streamWindow.map(s => s.sessionId)).size,
        avgBitrate:   streamWindow.length > 0 ? streamWindow.reduce((s, r) => s + r.bitrateKbps, 0) / streamWindow.length : 0,
        totalStalls:  streamWindow.reduce((s, r) => s + r.stallCount, 0),
      },
      memory: { avgHeapMB: avgHeap, peakHeapMB: peakHeap, trend: memTrend },
      navigation: {
        routeCount: navWindow.length,
        avgMountMs,
        slowRoutes: [...new Set(slowRoutes)],
      },
      stability: {
        score:        stabilityScore,
        crashCount:   this._crashCount,
        recoveryRate: this._crashCount > 0 ? this._recoveryCount / this._crashCount : 1,
      },
    };
  }

  getRawBuffers() {
    return {
      fps:         this._fpsSamples.slice(-50),
      gpu:         this._gpuSamples.slice(-50),
      thermal:     this._thermalTransitions.slice(-30),
      rtc:         this._rtcAnalytics.slice(-50),
      stream:      this._streamAnalytics.slice(-50),
      navigation:  this._navTimings.slice(-30),
      memory:      this._memoryTrend.slice(-50),
      workers:     this._workerDiagnostics,
      frameDrops:  this._frameDropEvents.slice(-30),
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _computeStabilityScore(fps: number[], drops: number, thermalEvents: number): number {
    let score = 100;

    if (fps.length > 0) {
      const avgFps = fps.reduce((a, b) => a + b, 0) / fps.length;
      if (avgFps < 50) score -= 20;
      else if (avgFps < 55) score -= 10;
      else if (avgFps < 58) score -= 5;
    }

    if (drops > 100) score -= 20;
    else if (drops > 50) score -= 10;
    else if (drops > 20) score -= 5;

    if (thermalEvents > 5) score -= 15;
    else if (thermalEvents > 2) score -= 7;

    score -= Math.min(30, this._crashCount * 10);

    return Math.max(0, Math.min(100, score));
  }

  private _recordLifecycle(event: string): void {
    console.log(`[TelemetryPipeline] lifecycle: ${event}`);
  }
}

export const TelemetryPipeline = new TelemetryPipelineImpl();
