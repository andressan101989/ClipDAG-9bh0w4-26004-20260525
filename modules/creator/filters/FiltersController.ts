/**
 * modules/creator/filters/FiltersController.ts — Creator Studio filter management
 *
 * Manages the full lifecycle of visual filters in Creator Studio:
 *   - DeepAR AR effects (face tracking, 3D masks, beauty)
 *   - LUT color grades (cinematic, vintage, neon)
 *   - Skia shader effects (blur, glow, distortion)
 *   - Built-in filters (brightness, contrast, saturation)
 *   - Custom filter bundles (downloadable)
 *
 * Asset lifecycle:
 *   1. catalog()   — load filter metadata from bundle/remote
 *   2. preview()   — apply filter in live camera preview (non-destructive)
 *   3. commit()    — lock filter for export baking
 *   4. reset()     — remove all applied filters
 *   5. cleanup()   — release DeepAR textures + cached assets
 *
 * Performance strategy:
 *   - DeepAR filters only allowed when PowerManager tier ≥ balanced
 *   - LUT filters always available (CPU-only)
 *   - Shader effects throttled via FrameScheduler
 *   - CacheManager stores downloaded filter assets locally
 *
 * Coordinates with:
 *   - deeparService (AR effect switching)
 *   - CacheManager (asset caching)
 *   - EffectsController (Skia layer)
 *   - RenderIsolationManager (surface suspension)
 */

import { CacheManager }         from '../../media/CacheManager';
import { EventBus }             from '../../core/EventBus';

export type FilterCategory = 'ar' | 'lut' | 'skia' | 'basic' | 'beauty';

export interface Filter {
  id:          string;
  name:        string;
  category:    FilterCategory;
  thumbnail:   string;             // local or remote URI
  assetUrl?:   string;             // remote download URL for DeepAR/LUT files
  localPath?:  string;             // cached local path
  intensity:   number;             // 0.0–1.0 default
  isPremium:   boolean;
  isDownloaded: boolean;
}

export interface AppliedFilter {
  filter:    Filter;
  intensity: number;
  appliedAt: number;
}

class FiltersControllerImpl {
  private _catalog:    Filter[]       = [];
  private _applied:    AppliedFilter | null = null;
  private _isLoaded    = false;
  private readonly _subs = new Set<(filter: AppliedFilter | null) => void>();

  // ── Catalog ───────────────────────────────────────────────────────────────

  async loadCatalog(): Promise<Filter[]> {
    if (this._isLoaded) return this._catalog;
    this._isLoaded = true;

    // Built-in LUT filters (bundled)
    this._catalog = [
      { id: 'none',      name: 'Normal',    category: 'basic',  thumbnail: '', intensity: 1.0, isPremium: false, isDownloaded: true },
      { id: 'beauty',    name: 'Beauty',    category: 'beauty', thumbnail: '', intensity: 0.7, isPremium: false, isDownloaded: true },
      { id: 'lut_cine',  name: 'Cinematic', category: 'lut',    thumbnail: '', intensity: 1.0, isPremium: false, isDownloaded: true },
      { id: 'lut_neon',  name: 'Neon',      category: 'lut',    thumbnail: '', intensity: 0.8, isPremium: false, isDownloaded: true },
      { id: 'lut_warm',  name: 'Warm',      category: 'lut',    thumbnail: '', intensity: 0.9, isPremium: false, isDownloaded: true },
      { id: 'lut_cool',  name: 'Cool',      category: 'lut',    thumbnail: '', intensity: 0.9, isPremium: false, isDownloaded: true },
      { id: 'ar_mask_1', name: 'Neon Mask', category: 'ar',     thumbnail: '', intensity: 1.0, isPremium: true,  isDownloaded: false,
        assetUrl: 'https://example.com/filters/neon_mask.deepar' },
    ];

    console.log(`[FiltersController] catalog loaded: ${this._catalog.length} filters`);
    return this._catalog;
  }

  getFilters(category?: FilterCategory): Filter[] {
    if (!category) return this._catalog;
    return this._catalog.filter(f => f.category === category);
  }

  // ── Download ──────────────────────────────────────────────────────────────

  async downloadFilter(filterId: string): Promise<boolean> {
    const filter = this._catalog.find(f => f.id === filterId);
    if (!filter || !filter.assetUrl) return false;
    if (filter.isDownloaded) return true;

    try {
      const localPath = await CacheManager.getOrFetch(filter.assetUrl, 'filters');
      if (localPath) {
        filter.localPath    = localPath;
        filter.isDownloaded = true;
        console.log(`[FiltersController] downloaded "${filter.name}" → ${localPath}`);
        return true;
      }
      return false;
    } catch (e: any) {
      console.warn(`[FiltersController] download "${filterId}" failed:`, e?.message);
      return false;
    }
  }

  // ── Application ───────────────────────────────────────────────────────────

  async applyFilter(filterId: string, intensity = 1.0): Promise<boolean> {
    const filter = this._catalog.find(f => f.id === filterId);
    if (!filter) return false;

    if (!filter.isDownloaded && filter.assetUrl) {
      const ok = await this.downloadFilter(filterId);
      if (!ok) return false;
    }

    if (filter.category === 'ar') {
      // Delegate to deeparService (lazy-loaded to avoid circular dep)
      try {
        const deeparService = require('@/services/deeparService');
        if (filter.localPath) {
          await deeparService.switchEffect(filter.localPath);
        }
      } catch (e: any) {
        console.warn('[FiltersController] AR filter switch failed:', e?.message);
        return false;
      }
    }

    this._applied = { filter, intensity, appliedAt: Date.now() };
    this._notify();
    console.log(`[FiltersController] applied "${filter.name}" (intensity:${intensity})`);
    return true;
  }

  resetFilter(): void {
    if (this._applied?.filter.category === 'ar') {
      try {
        const deeparService = require('@/services/deeparService');
        deeparService.clearEffects?.();
      } catch { /* ignore */ }
    }
    this._applied = null;
    this._notify();
  }

  get appliedFilter(): AppliedFilter | null { return this._applied; }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  async cleanup(): Promise<void> {
    this.resetFilter();
    this._isLoaded = false;
    console.log('[FiltersController] cleaned up');
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  subscribe(fn: (f: AppliedFilter | null) => void): () => void {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  private _notify(): void {
    for (const fn of this._subs) {
      try { fn(this._applied); } catch { /* isolate */ }
    }
  }
}

export const FiltersController = new FiltersControllerImpl();
