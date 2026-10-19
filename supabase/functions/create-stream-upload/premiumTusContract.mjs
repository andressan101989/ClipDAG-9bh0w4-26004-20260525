const CLOUDFLARE_TUS_HOSTS = new Set([
  'upload.cloudflarestream.com',
  'upload.videodelivery.net',
]);

export function canonicalCloudflareTusLocation(value, uid) {
  try {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(uid)) return null;
    const url = new URL(value);
    const expectedPath = `/tus/${uid}`;
    if (url.protocol !== 'https:'
      || !CLOUDFLARE_TUS_HOSTS.has(url.hostname)
      || url.port
      || url.username
      || url.password
      || url.hash
      || url.pathname !== expectedPath
      || (url.search !== '' && url.search !== '?tusv2=true')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function classifyCloudflareTusFailure(status) {
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return {
      code: 'stream_provider_temporarily_unavailable',
      httpStatus: 503,
      transient: true,
    };
  }
  if (status === 401 || status === 403) {
    return {
      code: 'stream_provider_credentials_rejected',
      httpStatus: 502,
      transient: false,
    };
  }
  if (status === 413) {
    return {
      code: 'stream_provider_size_rejected',
      httpStatus: 400,
      transient: false,
    };
  }
  return {
    code: 'stream_provider_rejected',
    httpStatus: 502,
    transient: false,
  };
}

const PROVISION_RETRY_DELAYS_MS = Object.freeze([5_000, 10_000, 20_000]);

export function cloudflareTusProvisionRetryDelayMs(status, retryAfter, failedAttempt) {
  if (status !== 429 || !Number.isInteger(failedAttempt) || failedAttempt < 1 || failedAttempt > 3) {
    return null;
  }
  if (retryAfter !== null && retryAfter !== undefined && String(retryAfter).trim() !== '') {
    const seconds = Number(String(retryAfter).trim());
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 20) return null;
    return seconds * 1_000;
  }
  return PROVISION_RETRY_DELAYS_MS[failedAttempt - 1] ?? null;
}
