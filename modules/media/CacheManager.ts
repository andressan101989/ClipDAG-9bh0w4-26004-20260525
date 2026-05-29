/**
 * modules/media/CacheManager.ts — In-memory + disk LRU media cache
 *
 * Prevents re-downloading the same media (thumbnails, AR filters, avatars)
 * on every render. Uses two tiers:
 *
 *   Tier 1 — In-memory Map (fast, lost on app restart, max 100 entries)
 *   Tier 2 — expo-file-system disk cache (persists across sessions, max 100 MB)
 *
 * Usage:
 *   import { CacheManager } from '@/modules/media/CacheManager';
 *
 *   // Get cached URI (returns null if not cached)
 *   const uri = CacheManager.get('https://cdn.example.com/filter.deepar');
 *
 *   // Set cache
 *   CacheManager.set('https://...', localFilePath);
 *
 *   // Get or fetch — downloads if not cached
 *   const localPath = await CacheManager.getOrFetch(remoteUrl, 'deepar_filters');
 *
 *   // Evict a key
 *   CacheManager.evict('https://...');
 *
 *   // Clear entire cache
 *   CacheManager.clear();
 */

let _FileSystem: any = null;
try { _FileSystem = require('expo-file-system'); } catch { /* web */ }

interface CacheEntry {
  key:       string;
  localPath: string;
  hitCount:  number;
  size?:     number; // bytes
  cachedAt:  number;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const MAX_MEMORY_ENTRIES = 100;
const MAX_DISK_BYTES     = 100 * 1024 * 1024; // 100 MB
const CACHE_DIR_NAME     = 'media_cache';

class CacheManagerImpl {
  private readonly _memory = new Map<string, CacheEntry>();
  private _diskBytes = 0;
  private _initialized = false;
  private _cacheDir = '';

  async init(): Promise<void> {
    if (this._initialized || !_FileSystem) return;
    this._initialized = true;
    this._cacheDir = (_FileSystem.cacheDirectory ?? '') + CACHE_DIR_NAME + '/';
    try {
      await _FileSystem.makeDirectoryAsync(this._cacheDir, { intermediates: true });
    } catch { /* already exists */ }
  }

  /** Return cached local path if it exists, null otherwise. */
  get(key: string): string | null {
    const entry = this._memory.get(key);
    if (entry) {
      entry.hitCount++;
      return entry.localPath;
    }
    return null;
  }

  /** Store a mapping from remote key → local path. */
  set(key: string, localPath: string, size?: number): void {
    // Evict least-recently-used if at capacity
    if (this._memory.size >= MAX_MEMORY_ENTRIES) {
      this._evictLRU();
    }
    this._memory.set(key, { key, localPath, hitCount: 0, size, cachedAt: Date.now() });
    if (size) this._diskBytes += size;
    this._enforceDiskLimit();
  }

  /** Evict a single key from memory. Disk file is NOT deleted (use clearDisk for that). */
  evict(key: string): void {
    const entry = this._memory.get(key);
    if (entry?.size) this._diskBytes = Math.max(0, this._diskBytes - entry.size);
    this._memory.delete(key);
  }

  /** Evict entries older than ttlMs (default 1 hour). Called by CleanupWorker. */
  evictExpired(ttlMs = 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [key, entry] of this._memory.entries()) {
      if (now - entry.cachedAt > ttlMs) this.evict(key);
    }
  }

  /** Clear memory cache (disk files remain). */
  clear(): void {
    this._memory.clear();
    this._diskBytes = 0;
  }

  /** Get OR download and cache a remote URL. Returns local path. */
  async getOrFetch(
    remoteUrl: string,
    subDir     = 'general',
    fileExt?:  string,
  ): Promise<string | null> {
    const cached = this.get(remoteUrl);
    if (cached) return cached;
    if (!_FileSystem) return null;

    await this.init();

    try {
      const ext      = fileExt ?? remoteUrl.split('?')[0].split('.').pop() ?? 'bin';
      const safeName = remoteUrl.replace(/[^a-zA-Z0-9]/g, '_').slice(-60);
      const dir      = this._cacheDir + subDir + '/';
      const dest     = dir + safeName + '.' + ext;

      await _FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});

      const { uri, status } = await _FileSystem.downloadAsync(remoteUrl, dest);
      if (status !== 200) return null;

      const info = await _FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
      const size: number = (info as any)?.size ?? 0;

      // Strip file:// for DeepAR compatibility (raw POSIX path)
      const rawPath = (uri as string).replace(/^file:\/\//, '');
      this.set(remoteUrl, rawPath, size);
      return rawPath;
    } catch (e: any) {
      console.warn('[CacheManager] getOrFetch error:', e?.message ?? e);
      return null;
    }
  }

  /** Delete all cached files from disk. */
  async clearDisk(): Promise<void> {
    if (!_FileSystem || !this._cacheDir) return;
    try {
      await _FileSystem.deleteAsync(this._cacheDir, { idempotent: true });
      await _FileSystem.makeDirectoryAsync(this._cacheDir, { intermediates: true });
    } catch { /* ignore */ }
    this.clear();
  }

  /** Stats for debug panel. */
  get stats() {
    return {
      memoryEntries: this._memory.size,
      diskBytes:     this._diskBytes,
      diskMB:        (this._diskBytes / (1024 * 1024)).toFixed(2),
      maxMemory:     MAX_MEMORY_ENTRIES,
      maxDiskMB:     MAX_DISK_BYTES / (1024 * 1024),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private _evictLRU(): void {
    let oldest: CacheEntry | null = null;
    for (const entry of this._memory.values()) {
      if (!oldest || entry.hitCount < oldest.hitCount ||
        (entry.hitCount === oldest.hitCount && entry.cachedAt < oldest.cachedAt)) {
        oldest = entry;
      }
    }
    if (oldest) this.evict(oldest.key);
  }

  private _enforceDiskLimit(): void {
    if (this._diskBytes <= MAX_DISK_BYTES) return;
    // Evict largest entries first
    const sorted = Array.from(this._memory.values())
      .filter(e => e.size && e.size > 0)
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    for (const entry of sorted) {
      this.evict(entry.key);
      if (this._diskBytes <= MAX_DISK_BYTES * 0.8) break;
    }
  }
}

export const CacheManager = new CacheManagerImpl();
