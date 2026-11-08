/** PostgreSQL owns identity, eligibility, fencing, retries and publication receipts. */
type Fence = { p_schedule_id: string; p_generation: number; p_claim_token: string };
type Claim = { schedule_id: string; generation: number; claim_token: string; claim_expires_at: string };
type CopyItem = {
  position: number; source_bucket: string; source_key: string; source_etag: string;
  target_asset_id: string; target_bucket: string; target_key: string;
  mime_type: string; size_bytes: number; finalized: boolean;
};
type ObjectFacts = { bytes: Uint8Array; etag: string | null; contentType: string | null };
export type ScheduledPublicationDependencies = {
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };
  objects: {
    get(bucket: string, key: string, options: { maxBytes: number; ifMatch?: string; signal: AbortSignal }): Promise<ObjectFacts>;
    putIfAbsent(bucket: string, key: string, bytes: Uint8Array, options: { contentType: string; signal: AbortSignal }): Promise<unknown>;
  };
  now?: () => number;
  crypto?: Pick<Crypto, 'subtle'>;
};
export type ScheduledPublicationCounters = { claimed: number; published: number; retried: number; terminal: number; stale: number };

class Failure extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly stale = false) { super(code); }
}
const stale = () => new Failure('lease_expired', true, true);
const integrity = () => new Failure('integrity_failed');
const unavailable = () => new Error('scheduled_publication_unavailable');
const dbCodes: Record<string, string> = {
  publication_schedule_draft_changed: 'draft_changed',
  publication_schedule_configuration_missing: 'configuration_missing',
  publication_schedule_source_invalid: 'source_invalid',
  publication_schedule_identity_conflict: 'integrity_failed',
  publication_schedule_provider_mismatch: 'integrity_failed',
  publication_schedule_content_mismatch: 'integrity_failed',
  publication_schedule_item_invalid: 'integrity_failed',
  publication_schedule_link_invalid: 'integrity_failed',
  publication_schedule_not_finalized: 'integrity_failed',
  publication_receipt_conflict: 'integrity_failed',
  publication_receipt_target_missing: 'integrity_failed',
  publication_draft_revision_conflict: 'draft_changed',
  publication_asset_not_ready_or_owned: 'source_invalid',
  content_blocked: 'content_blocked',
};
function classify(error: unknown, source = false): Failure {
  if (error instanceof Failure) return error;
  const e = (error ?? {}) as { message?: string; name?: string; statusCode?: number; $metadata?: { httpStatusCode?: number } };
  if (e.message === 'publication_schedule_fence_invalid') return stale();
  if (e.message && Object.hasOwn(dbCodes, e.message)) return new Failure(dbCodes[e.message]);
  if (['missing_cloudflare_account_id', 'missing_r2_access_key_id', 'missing_r2_secret_access_key'].includes(e.message ?? '')) return new Failure('configuration_missing');
  if (['r2_object_too_large', 'r2_object_empty', 'r2_object_unreadable', 'invalid_r2_object_request'].includes(e.message ?? '')) return integrity();
  const status = e.$metadata?.httpStatusCode ?? e.statusCode;
  if (status === 412 || e.name === 'PreconditionFailed') return integrity();
  if (source && (status === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound')) return new Failure('source_missing');
  if (e.name === 'AbortError' || e.name === 'TimeoutError' || status === 408) return new Failure('provider_timeout', true);
  if (e.name === 'TypeError' || e.name === 'NetworkError') return new Failure('network_error', true);
  return new Failure('provider_unavailable', true);
}
function etag(value: unknown): string {
  const normalized = typeof value === 'string' ? value.replace(/^"|"$/g, '').toLowerCase() : '';
  if (!/^[0-9a-f]{32}(-[1-9][0-9]{0,4})?$/.test(normalized)) throw integrity();
  return normalized;
}
const bounded = (value: number | undefined, fallback: number, maximum: number) =>
  Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value!))) : fallback;

export async function processScheduledPublicationBatch(
  deps: ScheduledPublicationDependencies,
  options: { limit?: number; providerTimeoutMs?: number } = {},
): Promise<ScheduledPublicationCounters> {
  const now = deps.now ?? Date.now;
  const cryptoImpl = deps.crypto ?? crypto;
  const counters = { claimed: 0, published: 0, retried: 0, terminal: 0, stale: 0 };
  const limit = bounded(options.limit, 10, 10);
  const timeout = bounded(options.providerTimeoutMs, 60_000, 60_000);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await deps.db.rpc(name, args);
    if (error) throw error;
    if (data == null) throw unavailable();
    return data;
  };
  const digest = async (bytes: Uint8Array) => Array.from(
    new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new Uint8Array(bytes))),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');
  let claims: Claim[];
  try {
    await rpc('reconcile_publication_schedules_v1', { p_limit: limit });
    claims = await rpc('claim_publication_schedules_v1', { p_limit: limit });
    if (!Array.isArray(claims) || claims.length > limit) throw unavailable();
  } catch { throw unavailable(); }

  for (const claim of claims) {
    counters.claimed++;
    const fence: Fence = { p_schedule_id: claim.schedule_id, p_generation: claim.generation, p_claim_token: claim.claim_token };
    let expires = Date.parse(claim.claim_expires_at);
    const requireLease = () => { if (!Number.isFinite(expires) || now() >= expires) throw stale(); };
    try {
      requireLease();
      const prepared = await rpc('prepare_publication_schedule_v1', fence);
      if (prepared.schedule_id !== claim.schedule_id || prepared.generation !== claim.generation || !Array.isArray(prepared.items) || !prepared.items.length) throw integrity();
      // A response cannot extend the claim's original lease.
      expires = Math.min(expires, Date.parse(prepared.claim_expires_at));
      requireLease();
      for (const [position, item] of (prepared.items as CopyItem[]).entries()) {
        if (item.position !== position || typeof item.finalized !== 'boolean') throw integrity();
        if (item.finalized) continue;
        requireLease();
        if (!Number.isInteger(item.size_bytes) || item.size_bytes < 1 || item.size_bytes > 25_000_000 ||
            !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(item.mime_type) ||
            [item.source_bucket, item.source_key, item.target_bucket, item.target_key].some(v => typeof v !== 'string' || !v)) throw integrity();
        const sourceEtag = etag(item.source_etag);
        const controller = new AbortController();
        // One deadline covers the entire copy/recovery sequence, including body consumption.
        const timer = setTimeout(() => controller.abort(), Math.min(timeout, expires - now()));
        const provider = async <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
          requireLease();
          if (controller.signal.aborted) throw new Failure('provider_timeout', true);
          let abort!: () => void;
          const cancelled = new Promise<never>((_resolve, reject) => {
            abort = () => reject(new Failure('provider_timeout', true));
            controller.signal.addEventListener('abort', abort, { once: true });
          });
          try { return await Promise.race([operation(controller.signal), cancelled]); }
          finally { controller.signal.removeEventListener('abort', abort); }
        };
        try {
          let source: ObjectFacts;
          try {
            source = await provider(signal => deps.objects.get(item.source_bucket, item.source_key, { maxBytes: item.size_bytes, ifMatch: sourceEtag, signal }));
          } catch (error) { throw classify(error, true); }
          if (source.bytes.length !== item.size_bytes || etag(source.etag) !== sourceEtag || source.contentType !== item.mime_type) throw integrity();
          const sourceHash = await digest(source.bytes);
          try {
            await provider(signal => deps.objects.putIfAbsent(item.target_bucket, item.target_key, source.bytes, { contentType: item.mime_type, signal }));
          } catch (error) {
            const failure = classify(error);
            // Both precondition conflicts and ambiguous writes require complete read-back.
            if (failure.stale || (!failure.retryable && failure.code !== 'integrity_failed')) throw failure;
          }
          const target = await provider(signal => deps.objects.get(item.target_bucket, item.target_key, { maxBytes: item.size_bytes, signal }));
          const targetHash = await digest(target.bytes);
          if (target.bytes.length !== item.size_bytes || sourceHash !== targetHash || target.contentType !== item.mime_type) throw integrity();
          const targetEtag = etag(target.etag);
          requireLease();
          const confirmed = await rpc('confirm_publication_schedule_item_v1', {
            ...fence, p_position: item.position, p_size_bytes: target.bytes.length, p_etag: targetEtag,
            p_source_sha256: sourceHash, p_target_sha256: targetHash,
          });
          if (confirmed.finalized !== true || confirmed.schedule_id !== claim.schedule_id || confirmed.generation !== claim.generation || confirmed.position !== item.position || confirmed.target_asset_id !== item.target_asset_id) throw integrity();
        } finally { clearTimeout(timer); }
      }
      requireLease();
      let publication;
      try { publication = await rpc('publish_publication_schedule_v1', fence); }
      catch (error) {
        const failure = classify(error);
        if (!failure.retryable || failure.stale) throw failure;
        // A committed receipt may replay this exact successful token even after expiry.
        publication = await rpc('publish_publication_schedule_v1', fence);
      }
      if (publication.state !== 'published' || publication.schedule_id !== claim.schedule_id || publication.generation !== claim.generation || typeof publication.post_id !== 'string') throw integrity();
      counters.published++;
    } catch (error) {
      const failure = classify(error);
      if (failure.stale || !Number.isFinite(expires) || now() >= expires) { counters.stale++; continue; }
      try {
        const failed = await rpc('fail_publication_schedule_v1', { ...fence, p_error_code: failure.code, p_retryable: failure.retryable });
        // The DB can override a transient diagnosis or exhaust the attempt budget.
        if (failed.state === 'retryable_failed' && failed.retryable === true) counters.retried++;
        else if (failed.state === 'terminal_failed' && failed.retryable === false) counters.terminal++;
        else throw unavailable();
      } catch (persistError) {
        if (classify(persistError).stale) counters.stale++;
        else throw unavailable();
      }
    }
  }
  return counters;
}
