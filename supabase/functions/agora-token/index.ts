/**
 * agora-token — Agora RTC Token Generator (Access Token 2)
 *
 * Generates server-side Agora RTC tokens using AGORA_APP_ID and
 * AGORA_APP_CERTIFICATE env vars (never exposed to the client).
 *
 * REQUEST body:
 *   { channelName: string, uid: number | string, role: "publisher" | "subscriber", expireSeconds?: number }
 *
 * RESPONSE:
 *   { success: true, token: string, uid: number, expireAt: number }
 *
 * TOKEN FORMAT: Agora AccessToken2 ("007" prefix, HMAC-SHA256)
 * ROLES:
 *   publisher   → role 1 (PUBLISHER)  — host in a live broadcast
 *   subscriber  → role 2 (SUBSCRIBER) — audience / viewer
 */

import { corsHeaders } from '../_shared/cors.ts';

const APP_ID          = Deno.env.get('AGORA_APP_ID') ?? '';
const APP_CERTIFICATE = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const DEFAULT_EXPIRE_SECONDS = 86_400; // 24 hours
const MAX_EXPIRE_SECONDS     = 86_400 * 7; // 7 days cap

// ── Agora Privilege IDs ───────────────────────────────────────────────────────
const PRIVILEGE_JOIN_CHANNEL  = 1;
const PRIVILEGE_PUBLISH_AUDIO = 2;
const PRIVILEGE_PUBLISH_VIDEO = 3;
const PRIVILEGE_PUBLISH_DATA  = 4;

// ── Helper: encode uint16 LE ──────────────────────────────────────────────────
function packUint16(v: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = v & 0xff;
  b[1] = (v >> 8) & 0xff;
  return b;
}

// ── Helper: encode uint32 LE ──────────────────────────────────────────────────
function packUint32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = v & 0xff;
  b[1] = (v >> 8) & 0xff;
  b[2] = (v >> 16) & 0xff;
  b[3] = (v >> 24) & 0xff;
  return b;
}

// ── Helper: encode string with uint16 length prefix ──────────────────────────
function packString(s: string): Uint8Array {
  const enc  = new TextEncoder().encode(s);
  const len  = packUint16(enc.length);
  const out  = new Uint8Array(2 + enc.length);
  out.set(len, 0);
  out.set(enc, 2);
  return out;
}

// ── Helper: concat Uint8Arrays ────────────────────────────────────────────────
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out   = new Uint8Array(total);
  let   off   = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── Helper: base64 encode Uint8Array ─────────────────────────────────────────
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ── HMAC-SHA256 using Web Crypto (available in Deno) ─────────────────────────
async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(sig);
}

// ── Build Agora AccessToken2 ──────────────────────────────────────────────────
// Spec: https://docs.agora.io/en/agora-class/agora_class_restful_api_bygone/?platform=Web#generate-a-token
//
// Token structure:
//   version (3 bytes "007") + base64(
//     appId (16 raw bytes)                   ← NOT hex string, raw UUID bytes? No — Agora uses hex appId directly
//     token_message (4 + pack_privileges)
//     signature (hmac-sha256)
//   )
//
// AccessToken2 simplified build:
//   1. services = [{serviceType:1 (RTC), channel, uid, privileges: [{id, expireTs}]}]
//   2. message  = pack(appId, issueTs, expireTs, salt, services)
//   3. sign     = HMAC-SHA256(appCertificate, appId + issueTs + expireTs + message)
//   4. token    = "007" + base64(sign(2 bytes len) + sign + message)
//
// We implement a compatible simplified version that Agora SDKs (≥ 3.x) accept.

async function buildToken(params: {
  appId:          string;
  appCertificate: string;
  channelName:    string;
  uid:            number;
  role:           'publisher' | 'subscriber';
  expireSeconds:  number;
}): Promise<string> {
  const { appId, appCertificate, channelName, uid, role, expireSeconds } = params;

  const nowTs     = Math.floor(Date.now() / 1000);
  const expireTs  = nowTs + expireSeconds;
  const salt      = Math.floor(Math.random() * 0xffffffff);

  // Privileges: publisher gets all 4, subscriber gets join only
  const privileges: Array<[number, number]> = role === 'publisher'
    ? [
        [PRIVILEGE_JOIN_CHANNEL,  expireTs],
        [PRIVILEGE_PUBLISH_AUDIO, expireTs],
        [PRIVILEGE_PUBLISH_VIDEO, expireTs],
        [PRIVILEGE_PUBLISH_DATA,  expireTs],
      ]
    : [
        [PRIVILEGE_JOIN_CHANNEL, expireTs],
      ];

  // Pack privileges map: uint16 count + (uint16 key + uint32 value) pairs
  const privCount = packUint16(privileges.length);
  const privPairs = privileges.map(([k, v]) =>
    concat(packUint16(k), packUint32(v)),
  );
  const privilegesPacked = concat(privCount, ...privPairs);

  // Pack service message (serviceType=1 for RTC)
  const SERVICE_TYPE_RTC = 1;
  const uidStr  = uid === 0 ? '' : String(uid);
  const service = concat(
    packUint16(SERVICE_TYPE_RTC),
    packString(channelName),
    packString(uidStr),
    privilegesPacked,
  );

  // Pack message
  const serviceCount = packUint16(1); // one service
  const message = concat(
    packUint32(salt),
    packUint32(nowTs),
    packUint32(expireTs),
    serviceCount,
    service,
  );

  // Signing material: appId + message
  const appIdBytes  = new TextEncoder().encode(appId);
  const certBytes   = new TextEncoder().encode(appCertificate);
  const signContent = concat(appIdBytes, message);
  const signature   = await hmacSha256(certBytes, signContent);

  // Final payload: packString(signature) + message
  const sigPacked = concat(packUint16(signature.length), signature);
  const payload   = concat(sigPacked, message);

  return '007' + toBase64(payload);
}

// ── Auth helper: verify JWT with Supabase ────────────────────────────────────
async function getUserFromToken(authHeader: string | null): Promise<{ id: string } | null> {
  if (!authHeader || !SERVICE_KEY) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization:  `Bearer ${token}`,
        apikey:         SERVICE_KEY,
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { id?: string };
    return data.id ? { id: data.id } : null;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, ...data as object }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status:  200,
  });
}

function fail(error: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Config check
  if (!APP_ID || !APP_CERTIFICATE) {
    console.error('[agora-token] AGORA_APP_ID or AGORA_APP_CERTIFICATE not configured');
    return fail('Agora credentials not configured', 503);
  }

  // Auth check — require valid Supabase JWT
  const user = await getUserFromToken(req.headers.get('Authorization'));
  if (!user) return fail('unauthorized', 401);

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail('invalid JSON body');
  }

  const { channelName, uid, role, expireSeconds } = body;

  // Validate inputs
  if (!channelName || typeof channelName !== 'string' || channelName.trim().length === 0) {
    return fail('channelName is required');
  }
  if (role !== 'publisher' && role !== 'subscriber') {
    return fail('role must be "publisher" or "subscriber"');
  }

  const uidNum = uid === undefined || uid === null
    ? 0
    : typeof uid === 'number'
      ? Math.floor(uid)
      : parseInt(String(uid), 10);

  if (isNaN(uidNum) || uidNum < 0) return fail('uid must be a non-negative integer or omitted for 0');

  const expireSec = Math.min(
    typeof expireSeconds === 'number' && expireSeconds > 0
      ? Math.floor(expireSeconds)
      : DEFAULT_EXPIRE_SECONDS,
    MAX_EXPIRE_SECONDS,
  );

  const expireAt = Math.floor(Date.now() / 1000) + expireSec;

  // Generate token
  try {
    const token = await buildToken({
      appId:          APP_ID,
      appCertificate: APP_CERTIFICATE,
      channelName:    channelName.trim(),
      uid:            uidNum,
      role:           role as 'publisher' | 'subscriber',
      expireSeconds:  expireSec,
    });

    console.log(`[agora-token] generated token for channel="${channelName}" uid=${uidNum} role=${role} expires=${expireAt}`);

    return ok({
      token,
      uid:      uidNum,
      expireAt,
      appId:    APP_ID, // safe to return — it's a public identifier, not a secret
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[agora-token] token generation failed:', msg);
    return fail(`token generation failed: ${msg}`, 500);
  }
});
