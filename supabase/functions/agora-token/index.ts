/**
 * agora-token — Generates Agora RTC AccessToken (v1, "006" prefix) server-side.
 *
 * Implements the exact byte format from the official Agora Java/Go SDK:
 *   github.com/AgoraIO/Tools/DynamicKey/AgoraDynamicKey
 *
 * Token format: "006" + appId(32) + base64( content )
 * Content:      sig_len(2LE) + sig(32) + crc_channel(4LE) + crc_uid(4LE) + msg_len(2LE) + msg
 * Message:      salt(4LE) + ts(4LE) + privilege_count(2LE) + [priv_id(2LE) + expire(4LE)]...
 * Signature:    HMAC-SHA256( key=appCertificate, data=appId + channelName + uidStr + msg )
 *
 * Uses only Deno built-ins (SubtleCrypto, TextEncoder) — no npm deps.
 *
 * Body:    { channelName: string, uid?: number, role?: "publisher" | "subscriber" }
 * Returns: { token, appId, channel }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const AGORA_APP_ID          = Deno.env.get('AGORA_APP_ID')          ?? '';
const AGORA_APP_CERTIFICATE = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')          ?? '';
const SUPABASE_ANON_KEY     =
  Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Privilege IDs (AccessToken v1 spec)
const PRIV_JOIN_CHANNEL    = 1;
const PRIV_PUB_AUDIO       = 2;
const PRIV_PUB_VIDEO       = 3;
const PRIV_PUB_DATA        = 4;

const TOKEN_EXPIRE_SEC     = 3600; // token + privilege lifetime (1 h)

// ── Auth ─────────────────────────────────────────────────────────────────────
async function getUserFromToken(authHeader: string | null): Promise<{ id: string } | null> {
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const jwt = authHeader.replace('Bearer ', '');
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json() as { id?: string };
    return data.id ? { id: data.id } : null;
  } catch {
    return null;
  }
}

// ── Binary helpers ────────────────────────────────────────────────────────────
function u16LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}
function u32LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// Standard Base64 (NOT URL-safe — Agora uses standard alphabet)
function base64Encode(b: Uint8Array): string {
  // Deno: btoa operates on binary strings
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
}

// ── CRC-32 (ISO 3309 / IEEE 802.3 polynomial 0xEDB88320) ────────────────────
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFF_FFFF;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFF_FFFF) >>> 0; // unsigned
}

// ── HMAC-SHA256 ───────────────────────────────────────────────────────────────
async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

// ── AccessToken v1 builder ────────────────────────────────────────────────────
// Mirrors the Java SDK exactly:
//   https://github.com/AgoraIO/Tools/blob/master/DynamicKey/AgoraDynamicKey/java/...
//   AccessToken.java  PrivilegeMessage.marshal → salt(4LE) + ts(4LE) + intMap
//   AccessToken.java  generateSignature  → appId + channelName + uid + msgRaw
//   AccessToken.java  PackContent.marshal → bytes(sig) + crcChannel(4LE) + crcUid(4LE) + bytes(msgRaw)
//   AccessToken.java  build              → "006" + appId + base64(content)
async function buildToken(params: {
  appId:       string;
  appCert:     string;
  channelName: string;
  uid:         number;
  isPublisher: boolean;
  expireSec:   number;
}): Promise<string> {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const ts   = now + params.expireSec;                   // privilege expire timestamp
  const salt = (Math.random() * 0xFFFF_FFFF) >>> 0;     // random uint32

  // ── Build privilege map: [priv_id, expire_ts] pairs ─────────────────────
  const privileges: [number, number][] = [
    [PRIV_JOIN_CHANNEL, ts],
  ];
  if (params.isPublisher) {
    privileges.push(
      [PRIV_PUB_AUDIO, ts],
      [PRIV_PUB_VIDEO, ts],
      [PRIV_PUB_DATA,  ts],
    );
  }

  // ── Pack PrivilegeMessage: salt(4LE) + ts(4LE) + count(2LE) + [id(2LE)+expire(4LE)]... ─
  const msgParts: Uint8Array[] = [
    u32LE(salt),
    u32LE(ts),
    u16LE(privileges.length),
    ...privileges.flatMap(([k, v]) => [u16LE(k), u32LE(v)]),
  ];
  const msgRaw = concat(...msgParts);

  // ── UID string: "0" → "" as per Agora spec ───────────────────────────────
  const uidStr = params.uid === 0 ? '' : String(params.uid);

  // ── Signature: HMAC-SHA256( cert, appId + channelName + uid + msgRaw ) ───
  // Raw byte concatenation — NO length prefixes (confirmed from Java source)
  const sigData = concat(
    enc.encode(params.appId),
    enc.encode(params.channelName),
    enc.encode(uidStr),
    msgRaw,
  );
  const sig = await hmacSha256(enc.encode(params.appCert), sigData);

  // ── CRC32 of channelName and uidStr ──────────────────────────────────────
  const crcChannel = crc32(enc.encode(params.channelName));
  const crcUid     = crc32(enc.encode(uidStr));

  // ── Pack content: bytes(sig) + crcChannel(4LE) + crcUid(4LE) + bytes(msgRaw) ─
  // "bytes(x)" = u16LE(len) + x  (Agora ByteBuf.put(byte[]) convention)
  const content = concat(
    u16LE(sig.length),  sig,
    u32LE(crcChannel),
    u32LE(crcUid),
    u16LE(msgRaw.length), msgRaw,
  );

  // ── Final token: "006" + appId + base64(content) ─────────────────────────
  return '006' + params.appId + base64Encode(content);
}

// ── Edge Function handler ─────────────────────────────────────────────────────
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

    if (!channelName || typeof channelName !== 'string' || channelName.trim() === '') {
      return new Response(
        JSON.stringify({ error: 'channelName is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      );
    }

    const numericUid  = Number.isFinite(uid) && uid! > 0 ? Math.trunc(uid!) : 0;
    const isPublisher = role !== 'subscriber';

    const token = await buildToken({
      appId:       AGORA_APP_ID,
      appCert:     AGORA_APP_CERTIFICATE,
      channelName: channelName.trim(),
      uid:         numericUid,
      isPublisher,
      expireSec:   TOKEN_EXPIRE_SEC,
    });

    console.log(`Token generated — channel="${channelName}" uid=${numericUid} publisher=${isPublisher} prefix=${token.slice(0, 35)}...`);

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
