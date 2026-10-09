const MAX_GRANT_LIFETIME_MS = 315_000;
const MAX_HINTS = 128;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRANT_CODES = new Set(['denied', 'missing', 'network', 'unavailable', 'invalid']);
const contentKindHints = new Map();
const RENEWAL_LEAD_MS = 15_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const RENEWABLE_STATUSES = new Set(['ready', 'playing', 'paused']);
const ALLOWED_ENTITLEMENT_SOURCES = new Set(['owner', 'purchase', 'subscription']);
const PREMIUM_R2_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9.-]{1,61})?[a-z0-9]\.)?[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i;

function hintKey(userId, contentId) {
  return `${userId}:${contentId}`;
}

export function rememberCreatorPremiumContentKind(userId, contentId, kind) {
  if (!userId || !contentId || (kind !== 'image' && kind !== 'video')) return;
  const key = hintKey(userId, contentId);
  contentKindHints.delete(key);
  contentKindHints.set(key, kind);
  while (contentKindHints.size > MAX_HINTS) {
    contentKindHints.delete(contentKindHints.keys().next().value);
  }
}

export function getCreatorPremiumContentKindHint(userId, contentId) {
  return contentKindHints.get(hintKey(userId, contentId)) ?? null;
}

export function clearCreatorPremiumContentKindHints(userId) {
  if (!userId) {
    contentKindHints.clear();
    return;
  }
  const prefix = `${userId}:`;
  for (const key of contentKindHints.keys()) {
    if (key.startsWith(prefix)) contentKindHints.delete(key);
  }
}

export function createCreatorPremiumRenewalScheduler({
  now = Date.now,
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout,
  onRenew,
  onExpire = () => {},
}) {
  let timer = null;
  let renewedGrantExpiry = null;
  let renewedEntitlementExpiry = null;

  function cancel() {
    if (timer === null) return;
    cancelTimeout(timer);
    timer = null;
  }

  function schedule(input) {
    cancel();
    if (!input?.focused || !RENEWABLE_STATUSES.has(input.status)) return;

    const currentTime = now();
    const grantExpiry = input.grantExpiresAt ? Date.parse(input.grantExpiresAt) : Number.NaN;
    const entitlementExpiry = input.entitlementExpiresAt
      ? Date.parse(input.entitlementExpiresAt)
      : Number.NaN;
    const authorities = [
      { kind: 'grant', expiry: grantExpiry, renewed: renewedGrantExpiry },
      { kind: 'entitlement', expiry: entitlementExpiry, renewed: renewedEntitlementExpiry },
    ].filter(authority => Number.isFinite(authority.expiry));
    if (authorities.length === 0) return;

    const hardExpiry = Math.min(...authorities.map(authority => authority.expiry));
    const renewal = authorities
      .filter(authority => authority.expiry > currentTime && authority.renewed !== authority.expiry)
      .map(authority => ({ ...authority, at: authority.expiry - RENEWAL_LEAD_MS }))
      .sort((left, right) => left.at - right.at)[0] ?? null;
    const renewFirst = renewal !== null && renewal.at < hardExpiry;
    const target = renewFirst ? renewal.at : hardExpiry;
    const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, target - currentTime));
    timer = scheduleTimeout(() => {
      timer = null;
      if (!renewFirst) {
        onExpire();
        return;
      }
      if (renewal.kind === 'grant') renewedGrantExpiry = renewal.expiry;
      else renewedEntitlementExpiry = renewal.expiry;
      onRenew();
    }, delay);
  }

  return { schedule, cancel };
}

export class CreatorPremiumGrantError extends Error {
  constructor(code, safeReason = `creator_premium_grant_${code}`) {
    super(safeReason);
    this.name = 'CreatorPremiumGrantError';
    this.code = GRANT_CODES.has(code) ? code : 'invalid';
    this.safeReason = safeReason;
  }
}

export function classifyCreatorPremiumGrantError(error) {
  if (error instanceof CreatorPremiumGrantError) return error;
  const candidate = error && typeof error === 'object' ? error : {};
  const explicit = candidate.grantCode ?? candidate.code;
  if (GRANT_CODES.has(explicit)) {
    return new CreatorPremiumGrantError(explicit);
  }
  const status = Number(candidate.status ?? candidate.context?.status);
  if (status === 401 || status === 403) return new CreatorPremiumGrantError('denied');
  if (status === 404) return new CreatorPremiumGrantError('missing');
  if (status >= 500) return new CreatorPremiumGrantError('unavailable');
  const name = String(candidate.name ?? '').toLowerCase();
  const message = String(candidate.message ?? '').toLowerCase();
  if (name.includes('fetch') || /network|fetch failed|offline|timeout/.test(message)) {
    return new CreatorPremiumGrantError('network');
  }
  if (/unauthor|forbidden|denied|revok|restrict|blocked|entitlement/.test(message)) {
    return new CreatorPremiumGrantError('denied');
  }
  if (/not.?found|missing|no.?media/.test(message)) {
    return new CreatorPremiumGrantError('missing');
  }
  return new CreatorPremiumGrantError('invalid');
}

function parseExpiry(value, now) {
  const expiresAt = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + MAX_GRANT_LIFETIME_MS) {
    throw new CreatorPremiumGrantError('invalid', 'invalid_premium_grant_expiry');
  }
  return expiresAt;
}

function httpsUrl(value) {
  if (typeof value !== 'string') throw new CreatorPremiumGrantError('invalid');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new CreatorPremiumGrantError('invalid');
    return parsed;
  } catch (error) {
    if (error instanceof CreatorPremiumGrantError) throw error;
    throw new CreatorPremiumGrantError('invalid');
  }
}

function protectedR2Url(value) {
  const parsed = httpsUrl(value);
  if (!PREMIUM_R2_HOST_PATTERN.test(parsed.hostname)
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.pathname === '/') {
    throw new CreatorPremiumGrantError('invalid');
  }
  return parsed;
}

function protectedStreamUrl(value, suffix) {
  const parsed = httpsUrl(value);
  if (!parsed.hostname.startsWith('customer-')
    || !parsed.hostname.endsWith('.cloudflarestream.com')
    || !parsed.pathname.endsWith(suffix)) {
    throw new CreatorPremiumGrantError('invalid');
  }
  const token = parsed.pathname.slice(1, -suffix.length);
  if (!token || token.includes('/')) throw new CreatorPremiumGrantError('invalid');
  return { parsed, token };
}

function validateImageGrant(grant, contentId, now) {
  if (!grant || grant.contentId !== contentId) throw new CreatorPremiumGrantError('invalid');
  const url = protectedR2Url(grant.url);
  parseExpiry(grant.expiresAt, now);
  return {
    kind: 'image',
    contentId,
    url: url.toString(),
    expiresAt: String(grant.expiresAt),
  };
}

function validateVideoGrant(grant, contentId, now) {
  if (!grant || grant.contentId !== contentId) throw new CreatorPremiumGrantError('invalid');
  const hls = protectedStreamUrl(grant.hlsUrl, '/manifest/video.m3u8');
  const dash = protectedStreamUrl(grant.dashUrl, '/manifest/video.mpd');
  const thumbnail = protectedStreamUrl(grant.thumbnailUrl, '/thumbnails/thumbnail.jpg');
  if (hls.parsed.origin !== dash.parsed.origin
    || hls.parsed.origin !== thumbnail.parsed.origin
    || hls.token !== dash.token
    || hls.token !== thumbnail.token) {
    throw new CreatorPremiumGrantError('invalid');
  }
  parseExpiry(grant.expiresAt, now);
  return {
    kind: 'video',
    contentId,
    hlsUrl: hls.parsed.toString(),
    dashUrl: dash.parsed.toString(),
    thumbnailUrl: thumbnail.parsed.toString(),
    expiresAt: String(grant.expiresAt),
  };
}

function entitlementState(entitlement, now) {
  const expiresAt = entitlement?.expires_at ? Date.parse(entitlement.expires_at) : null;
  if (entitlement?.allowed === true) {
    if (!ALLOWED_ENTITLEMENT_SOURCES.has(entitlement?.source)) {
      return { allowed: false, status: 'error', reason: 'invalid_entitlement' };
    }
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
      return { allowed: false, status: 'expired', reason: 'entitlement_expired' };
    }
    return { allowed: true };
  }
  const reason = String(entitlement?.reason ?? 'not_entitled');
  if (/expired/.test(reason)) return { allowed: false, status: 'expired', reason };
  if (/refund|revers|revok|access_lost/.test(reason)) {
    return { allowed: false, status: 'revoked', reason: 'access_revoked' };
  }
  if (/age|restricted|blocked|unavailable|suspend|quarantin|removed|moderation/.test(reason)) {
    return { allowed: false, status: 'restricted', reason: 'access_restricted' };
  }
  return { allowed: false, status: 'locked', reason: 'not_entitled' };
}

function statusForGrantError(error) {
  if (error.code === 'denied') return { status: 'revoked', reason: 'access_revoked' };
  if (error.code === 'network') return { status: 'offline', reason: 'network_unavailable' };
  if (error.code === 'missing') return { status: 'error', reason: 'media_unavailable' };
  return { status: 'error', reason: 'protected_media_unavailable' };
}

function snapshotCopy(snapshot) {
  return {
    ...snapshot,
    grant: snapshot.grant ? { ...snapshot.grant } : null,
  };
}

export function createCreatorPremiumViewerController(dependencies, onSnapshot = () => {}) {
  const now = dependencies.now ?? Date.now;
  let generation = 0;
  let disposed = false;
  let context = null;
  let snapshot = {
    status: 'idle',
    reason: null,
    userId: null,
    contentId: null,
    generation,
    entitlementSource: 'none',
    entitlementExpiresAt: null,
    mediaKind: null,
    grant: null,
  };

  function publish(next) {
    snapshot = { ...snapshot, ...next, generation };
    onSnapshot(snapshotCopy(snapshot));
  }

  function current(run, expected) {
    return !disposed
      && run === generation
      && context?.userId === expected.userId
      && context?.contentId === expected.contentId;
  }

  async function attempt(kind, contentId) {
    try {
      const raw = kind === 'image'
        ? await dependencies.getImageGrant(contentId)
        : await dependencies.getVideoGrant(contentId);
      return {
        ok: true,
        kind,
        grant: kind === 'image'
          ? validateImageGrant(raw, contentId, now())
          : validateVideoGrant(raw, contentId, now()),
      };
    } catch (error) {
      return { ok: false, kind, error: classifyCreatorPremiumGrantError(error) };
    }
  }

  async function resolveGrant(userId, contentId) {
    const hint = getCreatorPremiumContentKindHint(userId, contentId);
    if (hint) {
      const hinted = await attempt(hint, contentId);
      if (hinted.ok) return hinted;
      if (hinted.error.code !== 'missing') throw hinted.error;
      const alternateKind = hint === 'image' ? 'video' : 'image';
      const alternate = await attempt(alternateKind, contentId);
      if (!alternate.ok) throw alternate.error;
      rememberCreatorPremiumContentKind(userId, contentId, alternateKind);
      return alternate;
    }

    const image = await attempt('image', contentId);
    if (!image.ok && image.error.code !== 'missing') throw image.error;
    const video = await attempt('video', contentId);
    if (!video.ok && video.error.code !== 'missing') throw video.error;
    if (image.ok && video.ok) {
      throw new CreatorPremiumGrantError('invalid', 'ambiguous_media');
    }
    const resolved = image.ok ? image : video.ok ? video : null;
    if (!resolved) throw new CreatorPremiumGrantError('missing', 'media_unavailable');
    rememberCreatorPremiumContentKind(userId, contentId, resolved.kind);
    return resolved;
  }

  async function open(input) {
    if (disposed) return;
    generation += 1;
    const run = generation;
    const expected = { userId: input?.userId, contentId: input?.contentId };
    context = expected;
    publish({
      status: 'loading',
      reason: null,
      userId: expected.userId ?? null,
      contentId: expected.contentId ?? null,
      entitlementSource: 'none',
      entitlementExpiresAt: null,
      mediaKind: null,
      grant: null,
    });
    if (!UUID_PATTERN.test(expected.userId ?? '') || !UUID_PATTERN.test(expected.contentId ?? '')) {
      publish({ status: 'error', reason: 'invalid_request' });
      return;
    }

    try {
      const beforeUser = await dependencies.getCurrentUserId();
      if (!current(run, expected)) return;
      if (beforeUser !== expected.userId) {
        publish({ status: 'locked', reason: 'identity_changed', grant: null, mediaKind: null });
        return;
      }

      const entitlement = await dependencies.getEntitlement(expected.contentId);
      if (!current(run, expected)) return;
      const decision = entitlementState(entitlement, now());
      if (!decision.allowed) {
        publish({
          status: decision.status,
          reason: decision.reason,
          entitlementSource: entitlement?.source ?? 'none',
          entitlementExpiresAt: entitlement?.expires_at ?? null,
          grant: null,
          mediaKind: null,
        });
        return;
      }

      const resolved = await resolveGrant(expected.userId, expected.contentId);
      if (!current(run, expected)) return;
      const afterUser = await dependencies.getCurrentUserId();
      if (!current(run, expected)) return;
      if (afterUser !== expected.userId) {
        publish({ status: 'locked', reason: 'identity_changed', grant: null, mediaKind: null });
        return;
      }
      const finalNow = now();
      const finalDecision = entitlementState(entitlement, finalNow);
      if (!finalDecision.allowed) {
        publish({
          status: finalDecision.status,
          reason: finalDecision.reason,
          entitlementSource: entitlement?.source ?? 'none',
          entitlementExpiresAt: entitlement?.expires_at ?? null,
          grant: null,
          mediaKind: null,
        });
        return;
      }
      const finalGrantExpiry = Date.parse(resolved.grant.expiresAt);
      if (!Number.isFinite(finalGrantExpiry) || finalGrantExpiry <= finalNow) {
        publish({
          status: 'expired',
          reason: 'grant_expired',
          entitlementSource: entitlement.source,
          entitlementExpiresAt: entitlement.expires_at ?? null,
          grant: null,
          mediaKind: null,
        });
        return;
      }
      publish({
        status: 'ready',
        reason: null,
        entitlementSource: entitlement.source,
        entitlementExpiresAt: entitlement.expires_at ?? null,
        mediaKind: resolved.kind,
        grant: resolved.grant,
      });
    } catch (error) {
      if (!current(run, expected)) return;
      const classified = classifyCreatorPremiumGrantError(error);
      const next = statusForGrantError(classified);
      const safeReason = classified.safeReason === 'ambiguous_media'
        ? 'ambiguous_media'
        : classified.safeReason === 'media_unavailable'
          ? 'media_unavailable'
          : next.reason;
      publish({ ...next, reason: safeReason, grant: null, mediaKind: null });
    }
  }

  function invalidate(reason) {
    if (disposed) return;
    generation += 1;
    const nextStatus = reason === 'logout' || reason === 'identity_change'
      ? 'locked'
      : reason === 'close'
        ? 'idle'
        : reason === 'expired'
          ? 'expired'
        : reason === 'security'
          ? 'error'
          : 'loading';
    const oldUserId = context?.userId;
    if (reason === 'logout' && oldUserId) clearCreatorPremiumContentKindHints(oldUserId);
    if (reason === 'logout' || reason === 'close' || reason === 'identity_change') context = null;
    publish({
      status: nextStatus,
      reason,
      userId: context?.userId ?? null,
      contentId: context?.contentId ?? null,
      entitlementSource: 'none',
      entitlementExpiresAt: null,
      mediaKind: null,
      grant: null,
    });
  }

  async function revalidate(reason) {
    if (!context || disposed) return;
    await open({ ...context, reason });
  }

  function dispose() {
    if (disposed) return;
    generation += 1;
    disposed = true;
    context = null;
    snapshot = {
      status: 'idle',
      reason: 'disposed',
      userId: null,
      contentId: null,
      generation,
      entitlementSource: 'none',
      entitlementExpiresAt: null,
      mediaKind: null,
      grant: null,
    };
    onSnapshot(snapshotCopy(snapshot));
  }

  return {
    open,
    revalidate,
    invalidate,
    getSnapshot: () => snapshotCopy(snapshot),
    dispose,
  };
}
