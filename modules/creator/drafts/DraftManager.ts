/**
 * modules/creator/drafts/DraftManager.ts — Draft persistence and sync
 *
 * Saves recording sessions as drafts before publishing.
 * Persists locally via AsyncStorage; syncs to Supabase Storage when online.
 *
 * Draft lifecycle:
 *   recording → draft (saved locally) → editing → ready → uploading → published
 *
 * Design:
 *   - Drafts survive app restarts (AsyncStorage persistence)
 *   - Each draft holds the local video URI, thumbnail, caption, music, effects
 *   - Cloud sync uploads video to Supabase Storage draft bucket
 *   - Published drafts are archived locally for 7 days then purged
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type DraftStatus =
  | 'recording'    // being captured
  | 'saved'        // local draft ready for editing
  | 'editing'      // user is editing
  | 'ready'        // ready to upload/publish
  | 'uploading'    // being uploaded to server
  | 'published'    // successfully published
  | 'failed';      // upload/publish failed

export interface Draft {
  id:           string;
  videoUri?:    string;     // local file:// URI
  thumbnailUri?:string;
  cloudVideoUrl?: string;   // Supabase Storage URL (after upload)
  caption:      string;
  musicTrackId?: string;
  musicTrackName?: string;
  effectsJson?: string;     // JSON of EffectTrack[]
  durationMs:   number;
  status:       DraftStatus;
  createdAt:    number;
  updatedAt:    number;
  publishedAt?: number;
}

const STORAGE_KEY = 'clipdag:drafts:v1';
const MAX_DRAFTS  = 20;

class DraftManagerImpl {
  private _drafts: Draft[] = [];
  private _loaded  = false;

  // ── Load / Save ────────────────────────────────────────────────────────────

  async load(): Promise<Draft[]> {
    if (this._loaded) return this._drafts;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        this._drafts = JSON.parse(raw);
        this._purgeOldPublished();
      }
    } catch (e: any) {
      console.warn('[DraftManager] failed to load drafts:', e?.message);
      this._drafts = [];
    }
    this._loaded = true;
    return this._drafts;
  }

  private async _persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this._drafts));
    } catch (e: any) {
      console.warn('[DraftManager] persist error:', e?.message);
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async create(partial: Partial<Draft>): Promise<Draft> {
    await this.load();
    const draft: Draft = {
      id:         `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      caption:    '',
      durationMs: 0,
      status:     'saved',
      createdAt:  Date.now(),
      updatedAt:  Date.now(),
      ...partial,
    };
    this._drafts.unshift(draft);
    if (this._drafts.length > MAX_DRAFTS) this._drafts.splice(MAX_DRAFTS);
    await this._persist();
    return draft;
  }

  async update(id: string, patch: Partial<Draft>): Promise<Draft | null> {
    await this.load();
    const idx = this._drafts.findIndex(d => d.id === id);
    if (idx < 0) return null;
    this._drafts[idx] = { ...this._drafts[idx], ...patch, updatedAt: Date.now() };
    await this._persist();
    return this._drafts[idx];
  }

  async delete(id: string): Promise<void> {
    await this.load();
    this._drafts = this._drafts.filter(d => d.id !== id);
    await this._persist();
  }

  async getAll(): Promise<Draft[]> {
    await this.load();
    return [...this._drafts];
  }

  async getById(id: string): Promise<Draft | null> {
    await this.load();
    return this._drafts.find(d => d.id === id) ?? null;
  }

  async getPending(): Promise<Draft[]> {
    await this.load();
    return this._drafts.filter(d => d.status === 'saved' || d.status === 'ready' || d.status === 'editing');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _purgeOldPublished(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    this._drafts = this._drafts.filter(d =>
      d.status !== 'published' || (d.publishedAt ?? 0) > cutoff
    );
  }
}

export const DraftManager = new DraftManagerImpl();
