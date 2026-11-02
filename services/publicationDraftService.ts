import { getSupabaseClient } from '@/template';
import {
  getMediaUrl,
  uploadMediaFromBlob,
  uploadMediaFromSource,
  type CanonicalUploadSource,
  type MediaAssetDescriptor,
} from '@/services/mediaService';

export type PublicationDraftKind = 'photo' | 'carousel';
export type PublicationDraftState = 'draft' | 'published' | 'deleted';
export type PublicationDraftComposition = Record<string, unknown>;

export interface PublicationDraft {
  id: string;
  clientRequestId: string;
  kind: PublicationDraftKind;
  caption: string;
  music: string;
  composition: PublicationDraftComposition;
  state: PublicationDraftState;
  revision: number;
  assetIds: string[];
  publishedPostId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  deletedAt: string | null;
}

export interface PublicationDraftPage {
  items: PublicationDraft[];
  nextCursor: { updatedAt: string; id: string } | null;
}

export interface PublicationDraftContent {
  kind: PublicationDraftKind;
  caption: string;
  music?: string;
  composition?: PublicationDraftComposition;
}

const supabase = getSupabaseClient();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COMPOSITION_BYTES = 65_536;
const preparedDraftPublications = new Map<string, {
  draftId: string;
  revision: number;
  publicAssetIds: string[];
}>();

function requireUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`invalid_${field}`);
  return value;
}

function normalizeComposition(value: PublicationDraftComposition | undefined): PublicationDraftComposition {
  const composition = value ?? {};
  if (!composition || Array.isArray(composition) || typeof composition !== 'object') {
    throw new Error('invalid_draft_composition');
  }
  const encoded = JSON.stringify(composition);
  if (new TextEncoder().encode(encoded).byteLength > MAX_COMPOSITION_BYTES) {
    throw new Error('draft_composition_too_large');
  }
  if (/(?:file|content|ph|blob|data):|https?:\/\/|bucket_name|object_key|signed_url|public_url/i.test(encoded)) {
    throw new Error('draft_composition_contains_media_location');
  }
  return composition;
}

function requireAssetSet(kind: PublicationDraftKind, assetIds: string[]): string[] {
  const expected = kind === 'photo'
    ? assetIds.length === 1
    : assetIds.length >= 2 && assetIds.length <= 10;
  if (!expected || new Set(assetIds).size !== assetIds.length) {
    throw new Error('invalid_draft_asset_set');
  }
  return assetIds.map((id) => requireUuid(id, 'asset_id'));
}

function parseDraft(value: unknown): PublicationDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_draft_response');
  const row = value as Record<string, unknown>;
  const kind = row.kind;
  const state = row.state;
  if (kind !== 'photo' && kind !== 'carousel') throw new Error('invalid_draft_kind');
  if (state !== 'draft' && state !== 'published' && state !== 'deleted') throw new Error('invalid_draft_state');
  const assetIds = Array.isArray(row.asset_ids) ? row.asset_ids : [];
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('invalid_draft_revision');
  return {
    id: requireUuid(String(row.id ?? ''), 'draft_id'),
    clientRequestId: requireUuid(String(row.client_request_id ?? ''), 'client_request_id'),
    kind,
    caption: String(row.caption ?? ''),
    music: String(row.music ?? 'Sin musica'),
    composition: normalizeComposition((row.composition ?? {}) as PublicationDraftComposition),
    state,
    revision,
    assetIds: assetIds.map((id) => requireUuid(String(id), 'asset_id')),
    publishedPostId: row.published_post_id == null ? null : requireUuid(String(row.published_post_id), 'post_id'),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    publishedAt: row.published_at == null ? null : String(row.published_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  };
}

async function rpcDraft(name: string, args: Record<string, unknown>): Promise<PublicationDraft> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return parseDraft(data);
}

export async function uploadPublicationDraftSources(
  kind: PublicationDraftKind,
  sources: CanonicalUploadSource[],
  signal?: AbortSignal,
  onProgress?:(assets:readonly MediaAssetDescriptor[])=>Promise<void>|void,
): Promise<MediaAssetDescriptor[]> {
  if ((kind === 'photo' && sources.length !== 1) || (kind === 'carousel' && (sources.length < 2 || sources.length > 10))) {
    throw new Error('invalid_draft_source_set');
  }
  const uploaded: MediaAssetDescriptor[] = [];
  for (const source of sources) {
    uploaded.push(await uploadPublicationDraftSource(kind,source,signal));
    await onProgress?.([...uploaded]);
  }
  return uploaded;
}

/** Internal canonical primitive used to resume a partially uploaded carousel. */
export async function uploadPublicationDraftSource(
  kind:PublicationDraftKind,
  source:CanonicalUploadSource,
  signal?:AbortSignal,
):Promise<MediaAssetDescriptor> {
  return uploadMediaFromSource({
    source,purpose:kind==='photo'?'post_image':'carousel_image',
    visibility:'private',signal,
  });
}

export async function createPublicationDraft(input: PublicationDraftContent & {
  clientRequestId: string;
  assetIds: string[];
}): Promise<PublicationDraft> {
  const assetIds = requireAssetSet(input.kind, input.assetIds);
  return rpcDraft('create_my_publication_draft_v1', {
    p_client_request_id: requireUuid(input.clientRequestId, 'client_request_id'),
    p_kind: input.kind,
    p_caption: input.caption,
    p_music: input.music ?? 'Sin musica',
    p_composition: normalizeComposition(input.composition),
    p_asset_ids: assetIds,
  });
}

export async function getPublicationDraft(draftId: string): Promise<PublicationDraft> {
  return rpcDraft('get_my_publication_draft_v1', { p_draft_id: requireUuid(draftId, 'draft_id') });
}

export async function listPublicationDrafts(input: {
  limit?: number;
  cursor?: { updatedAt: string; id: string } | null;
} = {}): Promise<PublicationDraftPage> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const { data, error } = await supabase.rpc('list_my_publication_drafts_v1', {
    p_limit: limit,
    p_cursor_updated_at: input.cursor?.updatedAt ?? null,
    p_cursor_id: input.cursor ? requireUuid(input.cursor.id, 'cursor_id') : null,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('invalid_draft_list_response');
  const items = data.map(parseDraft);
  const last = items.at(-1);
  return {
    items,
    nextCursor: items.length === limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
  };
}

export async function updatePublicationDraft(input: PublicationDraftContent & {
  draftId: string;
  expectedRevision: number;
  clientMutationId: string;
  assetIds: string[];
}): Promise<PublicationDraft> {
  return rpcDraft('update_my_publication_draft_v1', {
    p_draft_id: requireUuid(input.draftId, 'draft_id'),
    p_expected_revision: input.expectedRevision,
    p_client_mutation_id: requireUuid(input.clientMutationId, 'client_mutation_id'),
    p_kind: input.kind,
    p_caption: input.caption,
    p_music: input.music ?? 'Sin musica',
    p_composition: normalizeComposition(input.composition),
    p_asset_ids: requireAssetSet(input.kind, input.assetIds),
  });
}

export async function deletePublicationDraft(input: {
  draftId: string;
  expectedRevision: number;
  clientMutationId: string;
}): Promise<PublicationDraft> {
  return rpcDraft('delete_my_publication_draft_v1', {
    p_draft_id: requireUuid(input.draftId, 'draft_id'),
    p_expected_revision: input.expectedRevision,
    p_client_mutation_id: requireUuid(input.clientMutationId, 'client_mutation_id'),
  });
}

async function materializePrivateDraftAsset(input: {
  assetId: string;
  kind: PublicationDraftKind;
  signal?: AbortSignal;
}): Promise<MediaAssetDescriptor> {
  const signedSource = await getMediaUrl(requireUuid(input.assetId, 'asset_id'));
  const response = await fetch(signedSource, { method: 'GET', signal: input.signal });
  if (!response.ok) throw new Error(`draft_source_fetch_${response.status}`);
  const blob = await response.blob();
  const mimeType = (response.headers.get('content-type') || blob.type || 'image/jpeg').split(';')[0].trim();
  if (!mimeType.startsWith('image/')) throw new Error('draft_source_mime_invalid');
  return uploadMediaFromBlob({
    blob,
    mimeType,
    fileName: `draft-${input.assetId}.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
    purpose: input.kind === 'photo' ? 'post_image' : 'carousel_image',
    visibility: 'public',
    signal: input.signal,
  });
}

export async function publishPublicationDraft(input: {
  draft: PublicationDraft;
  clientCommandId: string;
  signal?: AbortSignal;
}): Promise<string> {
  const commandId = requireUuid(input.clientCommandId, 'client_command_id');
  if (input.draft.state === 'published' && input.draft.publishedPostId) {
    preparedDraftPublications.delete(commandId);
    return input.draft.publishedPostId;
  }
  if (input.draft.state !== 'draft') throw new Error('draft_not_publishable');
  const existing = preparedDraftPublications.get(commandId);
  if (existing && (existing.draftId !== input.draft.id || existing.revision !== input.draft.revision)) {
    throw new Error('draft_publish_command_conflict');
  }
  const publicAssetIds = [...(existing?.publicAssetIds ?? [])];
  if (publicAssetIds.length > input.draft.assetIds.length) {
    throw new Error('draft_publish_command_conflict');
  }
  for (let index = publicAssetIds.length; index < input.draft.assetIds.length; index += 1) {
    const materialized = await materializePrivateDraftAsset({
      assetId: input.draft.assetIds[index], kind: input.draft.kind, signal: input.signal,
    });
    publicAssetIds.push(materialized.assetId);
    // Persist each completed index in the prepared command before attempting
    // the next upload. A retry never rematerializes indices 0..N-1.
    preparedDraftPublications.set(commandId, {
      draftId: input.draft.id,
      revision: input.draft.revision,
      publicAssetIds:[...publicAssetIds],
    });
  }
  const { data, error } = await supabase.rpc('publish_my_publication_draft_v1', {
    p_draft_id: input.draft.id,
    p_expected_revision: input.draft.revision,
    p_client_command_id: commandId,
    p_public_asset_ids: publicAssetIds,
  });
  if (error) throw error;
  const postId = requireUuid(String(data ?? ''), 'post_id');
  preparedDraftPublications.delete(commandId);
  return postId;
}
