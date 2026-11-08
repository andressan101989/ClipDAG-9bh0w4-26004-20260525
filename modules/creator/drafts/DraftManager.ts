/**
 * modules/creator/drafts/DraftManager.ts — Draft persistence and sync
 *
 * Local recovery cache plus facade over the canonical cloud draft authority.
 *
 * Draft lifecycle:
 *   recording → draft (saved locally) → editing → ready → uploading → published
 *
 * Design:
 *   - Drafts survive app restarts (AsyncStorage persistence)
 *   - Each draft holds the local video URI, thumbnail, caption, music, effects
 *   - Cloud drafts reserve private R2 media_assets through the canonical RPCs
 *   - This AsyncStorage cache is recovery-only and never authoritative
 *   - Published drafts are archived locally for 7 days then purged
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createPublicationDraft,
  deletePublicationDraft,
  getPublicationDraft,
  listPublicationDrafts,
  publishPublicationDraft,
  updatePublicationDraft,
  uploadPublicationDraftSource,
  type PublicationDraft,
  type PublicationDraftComposition,
  type PublicationDraftKind,
  type PublicationDraftPage,
} from '@/services/publicationDraftService';
import type { CanonicalUploadSource } from '@/services/mediaService';

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
  cloudVideoUrl?: string;   // legacy recovery field; never authoritative
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
const PREPARED_CLOUD_DRAFTS_KEY = 'clipdag:prepared-cloud-drafts:v1';
const MAX_DRAFTS  = 20;

interface PreparedCloudDraftCommand {
  clientRequestId:string;
  kind:PublicationDraftKind;
  caption:string;
  music:string;
  compositionJson:string;
  sourceFingerprints:string[];
  assetIds:string[];
}

class DraftManagerImpl {
  private _drafts: Draft[] = [];
  private _loaded  = false;
  private _preparedCloudDrafts = new Map<string,PreparedCloudDraftCommand>();
  private _preparedCloudDraftsLoaded = false;

  // ── Load / Save ────────────────────────────────────────────────────────────

  async load(): Promise<Draft[]> {
    if (this._loaded) return this._drafts;
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      this._drafts = JSON.parse(raw);
      this._purgeOldPublished();
    }
    this._loaded = true;
    return this._drafts;
  }

  private async _persist(): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this._drafts));
  }

  private async _loadPreparedCloudDrafts():Promise<void> {
    if(this._preparedCloudDraftsLoaded) return;
    const raw=await AsyncStorage.getItem(PREPARED_CLOUD_DRAFTS_KEY);
    if(raw) {
      const rows=JSON.parse(raw) as PreparedCloudDraftCommand[];
      if(!Array.isArray(rows)) throw new Error('invalid_prepared_cloud_drafts');
      this._preparedCloudDrafts=new Map(rows.map(row=>[row.clientRequestId,row]));
    }
    this._preparedCloudDraftsLoaded=true;
  }

  private async _persistPreparedCloudDrafts():Promise<void> {
    await AsyncStorage.setItem(
      PREPARED_CLOUD_DRAFTS_KEY,
      JSON.stringify([...this._preparedCloudDrafts.values()]),
    );
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  async createLocalRecovery(partial: Partial<Draft>): Promise<Draft> {
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

  async updateLocalRecovery(id: string, patch: Partial<Draft>): Promise<Draft | null> {
    await this.load();
    const idx = this._drafts.findIndex(d => d.id === id);
    if (idx < 0) return null;
    this._drafts[idx] = { ...this._drafts[idx], ...patch, updatedAt: Date.now() };
    await this._persist();
    return this._drafts[idx];
  }

  async deleteLocalRecovery(id: string): Promise<void> {
    await this.load();
    this._drafts = this._drafts.filter(d => d.id !== id);
    await this._persist();
  }

  async getAllLocalRecovery(): Promise<Draft[]> {
    await this.load();
    return [...this._drafts];
  }

  async getLocalRecoveryById(id: string): Promise<Draft | null> {
    await this.load();
    return this._drafts.find(d => d.id === id) ?? null;
  }

  async getPendingLocalRecovery(): Promise<Draft[]> {
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

  // ── Canonical cloud authority ────────────────────────────────────────────

  async savePublicationDraft(input: {
    clientRequestId: string;
    kind: PublicationDraftKind;
    caption: string;
    music?: string;
    composition?: PublicationDraftComposition;
    sources: CanonicalUploadSource[];
  }): Promise<PublicationDraft> {
    await this._loadPreparedCloudDrafts();
    const sourceFingerprints=input.sources.map(source=>JSON.stringify({
      kind:source.kind,mimeType:source.mimeType,fileName:source.fileName,sizeBytes:source.sizeBytes??null,
    }));
    let prepared=this._preparedCloudDrafts.get(input.clientRequestId);
    if(!prepared) {
      prepared={
        clientRequestId:input.clientRequestId,kind:input.kind,caption:input.caption,
        music:input.music??'Sin musica',compositionJson:JSON.stringify(input.composition??{}),
        sourceFingerprints,assetIds:[],
      };
      this._preparedCloudDrafts.set(input.clientRequestId,prepared);
      await this._persistPreparedCloudDrafts();
    } else if(prepared.kind!==input.kind
      ||prepared.sourceFingerprints.length!==sourceFingerprints.length
      ||prepared.sourceFingerprints.some((value,index)=>value!==sourceFingerprints[index])) {
      throw new Error('draft_create_command_conflict');
    }
    const frozenComposition=JSON.parse(prepared.compositionJson) as PublicationDraftComposition;
    for(let index=prepared.assetIds.length;index<input.sources.length;index+=1) {
      const asset=await uploadPublicationDraftSource(prepared.kind,input.sources[index]);
      prepared.assetIds.push(asset.assetId);
      this._preparedCloudDrafts.set(prepared.clientRequestId,prepared);
      await this._persistPreparedCloudDrafts();
    }
    try {
      const draft=await createPublicationDraft({
        clientRequestId:prepared.clientRequestId,kind:prepared.kind,
        caption:prepared.caption,music:prepared.music,composition:frozenComposition,
        assetIds:[...prepared.assetIds],
      });
      this._preparedCloudDrafts.delete(prepared.clientRequestId);
      await this._persistPreparedCloudDrafts();
      return draft;
    } catch(error) {
      // A lost create response is reconciled through the canonical list RPC.
      let cursor: {updatedAt:string;id:string}|null=null;
      for(let page=0;page<20;page+=1) {
        const result=await listPublicationDrafts({limit:50,cursor});
        const found=result.items.find(item=>item.clientRequestId===prepared!.clientRequestId);
        if(found) {
          this._preparedCloudDrafts.delete(prepared.clientRequestId);
          await this._persistPreparedCloudDrafts();
          return found;
        }
        cursor=result.nextCursor;
        if(!cursor) break;
      }
      throw error;
    }
  }

  async restorePublicationDraft(id: string): Promise<PublicationDraft> {
    return getPublicationDraft(id);
  }

  async listPublicationDrafts(input: {
    limit?: number;
    cursor?: PublicationDraftPage['nextCursor'];
  } = {}): Promise<PublicationDraftPage> {
    return listPublicationDrafts(input);
  }

  async updatePublicationDraft(input: {
    id: string;
    expectedRevision: number;
    clientMutationId: string;
    kind: PublicationDraftKind;
    caption: string;
    music?: string;
    composition?: PublicationDraftComposition;
    assetIds: string[];
  }): Promise<PublicationDraft> {
    return updatePublicationDraft({
      draftId: input.id,
      expectedRevision: input.expectedRevision,
      clientMutationId: input.clientMutationId,
      kind: input.kind,
      caption: input.caption,
      music: input.music,
      composition: input.composition,
      assetIds: input.assetIds,
    });
  }

  async deletePublicationDraft(input: {
    id: string;
    expectedRevision: number;
    clientMutationId: string;
  }): Promise<PublicationDraft> {
    return deletePublicationDraft({
      draftId: input.id,
      expectedRevision: input.expectedRevision,
      clientMutationId: input.clientMutationId,
    });
  }

  async publishPublicationDraft(input: {
    draft: PublicationDraft;
    clientCommandId: string;
    signal?: AbortSignal;
  }): Promise<string> {
    return publishPublicationDraft({
      draft: input.draft,
      clientCommandId: input.clientCommandId,
      signal: input.signal,
    });
  }
}

export const DraftManager = new DraftManagerImpl();
