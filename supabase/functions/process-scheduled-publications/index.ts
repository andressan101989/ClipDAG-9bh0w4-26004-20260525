import { admin } from '../_shared/mediaAuth.ts';
import { timingSafeEqual } from '../_shared/messagePush.ts';
import { getObjectBytes, putObjectIfAbsent } from '../_shared/r2.ts';
import { processScheduledPublicationBatch } from './worker.ts';

const MAX_REQUEST_BYTES = 1024;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  // Same exact internal bearer contract as video-semantic-index. Never decode JWT roles.
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!secret || !timingSafeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return json({ error: 'unauthorized' }, 401);
  }
  try {
    if (Number(req.headers.get('content-length')) > MAX_REQUEST_BYTES) return json({ error: 'request_too_large' }, 413);
    let text = '';
    const reader = req.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_REQUEST_BYTES) {
            try { await reader.cancel(); } catch { /* Preserve the sanitized overflow response. */ }
            return json({ error: 'request_too_large' }, 413);
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    if (text.trim()) {
      const body = JSON.parse(text);
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) return json({ error: 'invalid_request' }, 400);
    }
  } catch { return json({ error: 'invalid_request' }, 400); }
  try {
    const db = admin();
    const counters = await processScheduledPublicationBatch({
      db,
      objects: {
        get: (bucket, key, options) => getObjectBytes(bucket, key, options.maxBytes, options),
        putIfAbsent: putObjectIfAbsent,
      },
    }, { limit: 10 });
    return json(counters);
  } catch { return json({ error: 'scheduled_publication_unavailable' }, 503); }
});
