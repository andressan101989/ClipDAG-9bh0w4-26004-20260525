/**
 * agora-token — Generates short-lived Agora RTC AccessToken2 server-side.
 *
 * Body: { channelName: string, uid?: number, role?: 'publisher' | 'subscriber' }
 * Returns: { token, appId, channel }
 *
 * Uses Deno's native SubtleCrypto (HMAC-SHA256) — does NOT rely on
 * agora-token npm package, which uses Node.js crypto.createHmac (unavailable
 * in the Deno Edge Functions runtime → "[unenv] crypto.createHmac not implemented").
 *
 * Implements Agora AccessToken2 wire format:
 *  Base64( version[3] + appId[32] + expire_timestamp[4_BE] + services_payload )
 *  where services_payload = compressed( RtcService privileges map )
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const AGORA_APP_ID          = Deno.env.get('AGORA_APP_ID') ?? '';
const AGORA_APP_CERTIFICATE = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const TOKEN_EXPIRE_SEC = 3600;    // token lifetime  (1 h)
const PRIV_EXPIRE_SEC  = 3600;    // privilege lifetime inside token

// ── Privilege values (Agora AccessToken2 spec) ────────────────────────────
const PRIVILEGE_JOIN_CHANNEL         = 1;
const PRIVILEGE_PUBLISH_AUDIO_STREAM = 2;
const PRIVILEGE_PUBLISH_VIDEO_STREAM = 3;
const PRIVILEGE_PUBLISH_DATA_STREAM  = 4;

// ── Auth helper ────────────────────────────────────────────────────────────
async function getUserFromToken(authHeader: string | null): Promise<{ id: string } | null> {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json() as { id?: string };
    return data.id ? { id: data.id } : null;
  } catch {
    return null;
  }
}

// ── Encoding helpers ────────────────────────────────────────────────────────
function encodeUint16LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}
function encodeUint32LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
}
function encodeUint32BE(v: number): Uint8Array {
  return new Uint8Array([(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
}
function encodeString(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  return concat(encodeUint16LE(enc.length), enc);
}
function encodeBytesWithLen(b: Uint8Array): Uint8Array {
  return concat(encodeUint16LE(b.length), b);
}
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out   = new Uint8Array(total);
  let offset  = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}
function toBase64(b: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result  = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    const rem = b.length - i;
    result += chars[(n >> 18) & 63];
    result += chars[(n >> 12) & 63];
    result += rem > 1 ? chars[(n >> 6) & 63] : '=';
    result += rem > 2 ? chars[n & 63]        : '=';
  }
  return result;
}

// ── HMAC-SHA256 via WebCrypto ──────────────────────────────────────────────
async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(sig);
}

// ── zlib compress (DeflateRaw) — required by AccessToken2 format ───────────
async function zlibCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs     = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  writer.write(data);
  writer.close();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concat(...chunks);
}

// ── AccessToken2 builder ────────────────────────────────────────────────────
async function buildAgoraToken(params: {
  appId:       string;
  appCert:     string;
  channelName: string;
  uid:         number;
  isPublisher: boolean;
  tokenExpire: number;   // seconds from now
  privExpire:  number;   // seconds from now
}): Promise<string> {
  const now          = Math.floor(Date.now() / 1000);
  const tokenExpireTs = now + params.tokenExpire;
  const privExpireTs  = now + params.privExpire;

  // ── Build privileges map ─────────────────────────────────────────────────
  // Map: Map<uint16, uint32> — privilege_id → expire_ts
  const privileges: [number, number][] = [
    [PRIVILEGE_JOIN_CHANNEL, privExpireTs],
  ];
  if (params.isPublisher) {
    privileges.push(
      [PRIVILEGE_PUBLISH_AUDIO_STREAM, privExpireTs],
      [PRIVILEGE_PUBLISH_VIDEO_STREAM, privExpireTs],
      [PRIVILEGE_PUBLISH_DATA_STREAM,  privExpireTs],
    );
  }

  // Encode privileges map: uint16(count) + N×(uint16 key + uint32 val)
  const privParts: Uint8Array[] = [encodeUint16LE(privileges.length)];
  for (const [k, v] of privileges) {
    privParts.push(encodeUint16LE(k), encodeUint32LE(v));
  }
  const privilegesBytes = concat(...privParts);

  // ── Build RTC service payload ────────────────────────────────────────────
  // ServiceType=1 (RTC), channel (string), uid as string, privileges
  const serviceType   = encodeUint16LE(1);
  const channelBytes  = encodeString(params.channelName);
  const uidBytes      = encodeString(params.uid === 0 ? '' : String(params.uid));
  const serviceBody   = concat(serviceType, channelBytes, uidBytes, privilegesBytes);

  // Services section: uint16(1 service) + uint16(serviceType) + bytes(serviceBody)
  const servicesSection = concat(
    encodeUint16LE(1),
    serviceType,
    encodeBytesWithLen(serviceBody),
  );

  // ── Build message to sign ────────────────────────────────────────────────
  // message = appId(32 bytes) + issueTs(uint32LE) + expireTs(uint32LE) + salt(uint32LE) + services
  const salt    = Math.floor(Math.random() * 0xFFFFFFFF);
  const issueTs = now;
  const msgBody = concat(
    new TextEncoder().encode(params.appId),
    encodeUint32LE(issueTs),
    encodeUint32LE(tokenExpireTs),
    encodeUint32LE(salt),
    servicesSection,
  );

  // Compress message body
  const compressedMsg = await zlibCompress(msgBody);

  // ── HMAC-SHA256 signature ────────────────────────────────────────────────
  // key = HMAC(appCert, appId + issueTs + salt + expireTs)
  const signingContent = concat(
    new TextEncoder().encode(params.appId),
    encodeUint32LE(issueTs),
    encodeUint32LE(salt),
    encodeUint32LE(tokenExpireTs),
  );
  const appCertBytes = new TextEncoder().encode(params.appCert);
  const sigKey       = await hmacSha256(appCertBytes, signingContent);
  const signature    = await hmacSha256(sigKey, compressedMsg);

  // ── Final token ──────────────────────────────────────────────────────────
  // version(3) + appId(32) + expireTs_BE(4) + compressed(sig+msg)
  const versionBytes  = new TextEncoder().encode('007');
  const expireBeBytes = encodeUint32BE(tokenExpireTs);

  // Pack: signature length (uint16LE) + signature + compressed message
  const payload = concat(
    encodeBytesWithLen(signature),
    compressedMsg,
  );

  const token = concat(versionBytes, new TextEncoder().encode(params.appId), expireBeBytes, payload);
  return toBase64(token);
}

// ── Edge Function handler ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    return new Response(
      JSON.stringify({ error: 'Agora not configured — AGORA_APP_ID or AGORA_APP_CERTIFICATE missing' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }

  const user = await getUserFromToken(req.headers.get('Authorization'));
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 },
    );
  }

  try {
    const { channelName, uid, role } = await req.json() as {
      channelName?: string;
      uid?:         number;
      role?:        string;
    };

    if (!channelName || typeof channelName !== 'string') {
      return new Response(
        JSON.stringify({ error: 'channelName is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      );
    }

    const numericUid  = Number.isFinite(uid) ? Number(uid) : 0;
    const isPublisher = role !== 'subscriber';

    const token = await buildAgoraToken({
      appId:       AGORA_APP_ID,
      appCert:     AGORA_APP_CERTIFICATE,
      channelName,
      uid:         numericUid,
      isPublisher,
      tokenExpire: TOKEN_EXPIRE_SEC,
      privExpire:  PRIV_EXPIRE_SEC,
    });

    return new Response(
      JSON.stringify({ token, appId: AGORA_APP_ID, channel: channelName }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err) {
    console.error('agora-token error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
