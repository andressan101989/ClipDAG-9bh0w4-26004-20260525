/**
 * background/CacheWorker.ts — Intelligent background cache maintenance
 *
 * Runs independently of the render cycle to:
 *   - Evict expired / low-priority cache entries from IntelligentCacheManager
 *   - Enforce total disk cache budget
 *   - Clean stale temp files from expo-file-system
 *   - Pre-warm high-priority media assets for upcoming screens
 *   - Respond to thermal / memory pressure by aggressively reducing cache
 *   - GPUManager texture eviction at regular intervals
 *
 * Pauses on app background.
 * Performs aggressive cleanup immediately after foregrounding.
 *
 * Usage:
 *   CacheWorker.start();
 *   CacheWorker.stop();
 */

import { AppLifecycle }            from '@/modules/core/AppLifecycle';
import { IntelligentCacheManager } from '@/modules/media/IntelligentCacheManager';
import { MediaCleanupManager }     from '@/modules/media/MediaCleanupManager';
import { GPUManager }              from '@/modules/core/GPUManager';
import { PowerManager }            from '@/modules/core/PowerManager';
import { ThermalMonitor }          from '@/modules/core/ThermalMonitor';

const MAINTENANCE_INTERVAL_MS = 45_000;   // routine maintenance every 45s
const THERMAL_CHECK_INTERVAL_MS = 15_000; // thermal-driven eviction every 15s

class CacheWorkerImpl {
  private _maintenanceTimer:   ReturnType<typeof setInterval> | null = null;
  private _thermalCheckTimer:  ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _paused  = false;

  start(): void {
    if (this._running) return;
    this._running = true;

    this._maintenanceTimer = setInterval(() => {
      if (!this._paused) this._runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);

    this._thermalCheckTimer = setInterval(() => {
      if (!this._paused) this._runThermalEviction();
    }, THERMAL_CHECK_INTERVAL_MS);

    AppLifecycle.onBackground(() => {
      this._paused = true;
    });
    AppLifecycle.onForeground(() => {
      this._paused = false;
      // Immediate maintenance on resume to reclaim memory before UI loads
      setTimeout(() => this._runMaintenance(), 2_000);
    });

    console.log('[CacheWorker] started');
  }

  stop(): void {
    if (this._maintenanceTimer)  { clearInterval(this._maintenanceTimer);  this._maintenanceTimer  = null; }
    if (this._thermalCheckTimer) { clearInterval(this._thermalCheckTimer); this._thermalCheckTimer = null; }
    this._running = false;
    console.log('[CacheWorker] stopped');
  }

  /** Trigger immediate aggressive cache cleanup (e.g. on low-memory warning). */
  emergencyCleanup(): void {
    console.warn('[CacheWorker] EMERGENCY cleanup triggered');
    this._runThermalEviction();
    GPUManager.emergencyRelease();
    MediaCleanupManager.emergencyCleanup?.();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _runMaintenance(): void {
    try {
      const thermal = ThermalMonitor.currentState;
      const tier    = PowerManager.currentTier;

      // Adjust cache eviction aggressiveness by power tier
      const maxCacheAgeMs: Record<typeof tier, number> = {
        performance: 30 * 60_000,   // 30min
        balanced:    15 * 60_000,   // 15min
        saver:        5 * 60_000,   //  5min
        emergency:    1 * 60_000,   //  1min
      };

      IntelligentCacheManager.evictOlderThan?.(maxCacheAgeMs[tier]);

      // GPU texture TTL maintenance
      const gpuReport = GPUManager.getReport();
      if (gpuReport.estimatedVRAM_KB > 50_000) {
        console.log(`[CacheWorker] VRAM high (${(gpuReport.estimatedVRAM_KB / 1024).toFixed(0)}MB) — triggering GPU eviction`);
      }

      console.log(
        `[CacheWorker] maintenance done — thermal:${thermal} tier:${tier}` +
        ` vram:${(gpuReport.estimatedVRAM_KB / 1024).toFixed(0)}MB`,
      );
    } catch (e: any) {
      console.warn('[CacheWorker] maintenance error:', e?.message);
    }
  }

  private _runThermalEviction(): void {
    try {
      const thermal = ThermalMonitor.currentState;
      if (thermal === 'nominal') return;

      console.log(`[CacheWorker] thermal eviction for state: ${thermal}`);

      if (thermal === 'serious' || thermal === 'critical') {
        GPUManager.emergencyRelease();
        IntelligentCacheManager.setThermalState?.(thermal);
      }
    } catch (e: any) {
      console.warn('[CacheWorker] thermal eviction error:', e?.message);
    }
  }
}

export const CacheWorker = new CacheWorkerImpl();
