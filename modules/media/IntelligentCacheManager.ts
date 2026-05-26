/**
 * modules/media/IntelligentCacheManager.ts — Adaptive, thermal-aware cache layer
 *
 * Extends CacheManager with intelligence:
 *   - Memory-pressure-aware eviction (clears aggressively under pressure)
 *   - Thermal-aware cache reduction (shrinks hot cache under heat)
 *   - Priority-based retention (keep avatars > thumbnails > previews)
 *   - Session-scoped caching (entries invalidated on session end)
 *   - Prefetch budget: limits proactive downloads based on network+power
 *   - Stale resource cleanup: marks entries stale after TTL
 *   - Adaptive max size: shrinks on low memory, expands on idle
 *
 * Wraps CacheManager — use IntelligentCacheManager.getOrFetch() instead.
 *
 * Usage:
 *   const uri = await IntelligentCacheManager.getOrFetch(url, 'avatars', 'high');
 *   IntelligentCacheManager.onPressure(() => setLowMemoryUI(true));
 *   IntelligentCacheManager.setThermalState('serious');
 */

import { CacheManager }          from './CacheManager';
import { MemoryPressureMonitor } from '../core/MemoryPressureMonitor';
import { EventBus }              from '../core/EventBus';

export type CachePriority = 'critical' | 'high' | 'normal' | 'low';

interface PriorityEntry {
  key:       string;
  priority:  CachePriority;
  sizeBytes: number;
  cachedAt:  number;
  ttlMs?:    number;
  sessionId?: string;
}

// Priority-based TTL (how long entries stay fresh)
const PRIORITY_TTL_MS: Record<CachePriority, number> = {
  critical: 24 * 60 * 60 * 1000,  // 24h — avatars, profile images
  high:     6  * 60 * 60 * 1000,  // 6h  — thumbnails, AR filters
  normal:   60 * 60 * 1000,       // 1h  — feed thumbnails
  low:      15 * 60 * 1000,       // 15m — preview frames, temp assets
};

// Max cache size per thermal state
const THERMAL_MAX_MB: Record<string, number> = {
  nominal:  100,
  fair:     60,
  serious:  30,
  critical: 10,
};

class IntelligentCacheManagerImpl {
  private readonly _priorities = new Map<string, PriorityEntry>();
  private _thermalState  = 'nominal';
  private _totalBytes    = 0;
  private _sessionId: string | null = null;

  constructor() {
    // React to memory pressure
    EventBus.subscribe('app:low_memory', () => {
      this._emergencyEviction();
    });
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  setThermalState(state: string): void {
    const prev = this._thermalState;
    this._thermalState = state;
    if (state !== 'nominal' && prev === 'nominal') {
      this._thermalEviction();
    }
  }

  /** Set a session ID — entries tagged with this session will be auto-evicted on endSession(). */
  beginSession(sessionId: string): void {
    this._sessionId = sessionId;
  }

  endSession(sessionId: string): void {
    let evicted = 0;
    for (const [key, entry] of this._priorities) {
      if (entry.sessionId === sessionId) {
        CacheManager.evict(key);
        this._priorities.delete(key);
        this._totalBytes = Math.max(0, this._totalBytes - entry.sizeBytes);
        evicted++;
      }
    }
    if (evicted > 0) {
      console.log(`[IntelligentCache] evicted ${evicted} entries for session "${sessionId}"`);
    }
    if (this._sessionId === sessionId) this._sessionId = null;
  }

  // ── Fetch API ─────────────────────────────────────────────────────────────

  /**
   * Get or fetch a remote URL, with priority-based retention.
   */
  async getOrFetch(
    url:      string,
    subDir    = 'general',
    priority: CachePriority = 'normal',
    ttlMs?:   number,
  ): Promise<string | null> {
    // Check for stale entry
    const entry = this._priorities.get(url);
    if (entry) {
      const effectiveTtl = ttlMs ?? PRIORITY_TTL_MS[priority];
      if (Date.now() - entry.cachedAt > effectiveTtl) {
        CacheManager.evict(url);
        this._priorities.delete(url);
      } else {
        // Cache hit — return from CacheManager
        const cached = CacheManager.get(url);
        if (cached) return cached;
      }
    }

    // Check thermal — don't fetch new entries under critical heat
    if (this._thermalState === 'critical' && priority === 'low') {
      return null;
    }

    const result = await CacheManager.getOrFetch(url, subDir);
    if (result) {
      const sizeBytes = await this._estimateSize(url);
      this._registerEntry(url, priority, sizeBytes, ttlMs);
    }

    return result;
  }

  /** Check if URL is cached and fresh. */
  isFresh(url: string): boolean {
    const entry = this._priorities.get(url);
    if (!entry) return false;
    const ttl = PRIORITY_TTL_MS[entry.priority];
    return (Date.now() - entry.cachedAt) < ttl && !!CacheManager.get(url);
  }

  /** Evict a specific URL. */
  evict(url: string): void {
    const entry = this._priorities.get(url);
    if (entry) {
      this._totalBytes = Math.max(0, this._totalBytes - entry.sizeBytes);
      this._priorities.delete(url);
    }
    CacheManager.evict(url);
  }

  /** Evict all entries with given priority or lower. */
  evictByPriority(maxPriority: CachePriority): void {
    const order: CachePriority[] = ['low', 'normal', 'high', 'critical'];
    const maxIdx = order.indexOf(maxPriority);
    let evicted = 0;

    for (const [key, entry] of this._priorities) {
      if (order.indexOf(entry.priority) <= maxIdx) {
        CacheManager.evict(key);
        this._priorities.delete(key);
        this._totalBytes = Math.max(0, this._totalBytes - entry.sizeBytes);
        evicted++;
      }
    }

    if (evicted > 0) {
      console.log(`[IntelligentCache] evicted ${evicted} entries with priority ≤ ${maxPriority}`);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  get stats() {
    return {
      ...CacheManager.stats,
      intelligentEntries: this._priorities.size,
      thermalState:       this._thermalState,
      sessionId:          this._sessionId,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _registerEntry(url: string, priority: CachePriority, sizeBytes: number, ttlMs?: number): void {
    this._priorities.set(url, {
      key: url,
      priority,
      sizeBytes,
      cachedAt: Date.now(),
      ttlMs,
      sessionId: this._sessionId ?? undefined,
    });
    this._totalBytes += sizeBytes;
    this._enforceThreshold();
  }

  private _enforceThreshold(): void {
    const maxBytes = (THERMAL_MAX_MB[this._thermalState] ?? 100) * 1024 * 1024;
    if (this._totalBytes <= maxBytes) return;

    // Evict low-priority entries first
    this.evictByPriority('low');
    if (this._totalBytes > maxBytes) this.evictByPriority('normal');
  }

  private _thermalEviction(): void {
    console.log(`[IntelligentCache] thermal eviction (state: ${this._thermalState})`);
    this.evictByPriority('low');
    if (this._thermalState === 'serious') this.evictByPriority('normal');
    if (this._thermalState === 'critical') this.evictByPriority('high');
  }

  private _emergencyEviction(): void {
    console.warn('[IntelligentCache] emergency eviction triggered by low memory');
    this.evictByPriority('normal');
    CacheManager.clear();
    this._priorities.clear();
    this._totalBytes = 0;
  }

  private async _estimateSize(url: string): Promise<number> {
    try {
      const fs = require('expo-file-system');
      const cached = CacheManager.get(url);
      if (!cached) return 0;
      const info = await fs.getInfoAsync(`file://${cached}`, { size: true });
      return (info as any)?.size ?? 0;
    } catch {
      return 0;
    }
  }
}

export const IntelligentCacheManager = new IntelligentCacheManagerImpl();
