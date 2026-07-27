/* eslint-disable import/no-unresolved */
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
 * Body:    { callId: string } | { groupRoomId: string }
 *        | { liveSessionId: string, requestedRole: 'host' | 'viewer' | 'cohost' }
 *        | { channelName: string, uid?: unknown, role?: unknown } (legacy call/group)
 * Returns: { token, appId, channel, uid }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const AGORA_APP_ID          = Deno.env.get('AGORA_APP_ID')          ?? '';
const AGORA_APP_CERTIFICATE = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')          ?? '';
const SUPABASE_ANON_KEY     =
  Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

function userIdToAgoraUid(userId: string): number {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return (hash % 2147483647) + 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

type AgoraTokenRequest = {
  callId?: unknown;
  groupRoomId?: unknown;
  liveSessionId?: unknown;
  requestedRole?: unknown;
  channelName?: unknown;
  uid?: unknown;
  role?: unknown;
};

type RequestContract =
  | { kind: 'new_call'; callId: string }
  | { kind: 'new_group'; groupRoomId: string }
  | {
      kind: 'live';
      liveSessionId: string;
      requestedRole: 'host' | 'viewer' | 'cohost';
    }
  | { kind: 'legacy_call'; channelName: string };

type AuthorizedCall = {
  caller_id: string;
  callee_id: string;
  channel_name: string;
  status: string;
  expires_at: string | null;
};

function parseRequestContract(body: AgoraTokenRequest): RequestContract | null {
  const hasCallId = Object.prototype.hasOwnProperty.call(body, 'callId');
  const hasGroupRoomId = Object.prototype.hasOwnProperty.call(body, 'groupRoomId');
  const hasLiveSessionId = Object.prototype.hasOwnProperty.call(body, 'liveSessionId');
  const hasChannelName = Object.prototype.hasOwnProperty.call(body, 'channelName');
  const suppliedResourceCount = Number(hasCallId)
    + Number(hasGroupRoomId)
    + Number(hasLiveSessionId)
    + Number(hasChannelName);

  if (suppliedResourceCount !== 1) return null;
  if (hasCallId && isNonEmptyString(body.callId)) {
    return { kind: 'new_call', callId: body.callId.trim() };
  }
  if (hasGroupRoomId && isNonEmptyString(body.groupRoomId)) {
    return { kind: 'new_group', groupRoomId: body.groupRoomId.trim() };
  }
  if (hasLiveSessionId && isNonEmptyString(body.liveSessionId)
    && (body.requestedRole === 'host'
      || body.requestedRole === 'viewer'
      || body.requestedRole === 'cohost')) {
    return {
      kind: 'live',
      liveSessionId: body.liveSessionId.trim(),
      requestedRole: body.requestedRole,
    };
  }
  if (hasChannelName && isNonEmptyString(body.channelName)) {
    return { kind: 'legacy_call', channelName: body.channelName.trim() };
  }
  return null;
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
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

  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
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
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid request payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }
    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      return new Response(JSON.stringify({ error: 'invalid request payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }
    const body = rawBody as AgoraTokenRequest;
    if (Object.prototype.hasOwnProperty.call(body, 'liveSessionId')
      && body.requestedRole !== 'host'
      && body.requestedRole !== 'viewer'
      && body.requestedRole !== 'cohost') {
      return jsonError('invalid live requested role', 400);
    }
    const contract = parseRequestContract(body);
    if (!contract) {
      return new Response(
        JSON.stringify({ error: 'exactly one authorized Agora resource is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      );
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let authorizedChannel: string | null = null;
    let isPublisher = true;
    let observedContract: RequestContract['kind'] | 'legacy_group' = contract.kind;
    let observedParticipantKind: 'host' | 'viewer' | 'cohost' | 'guest' | undefined;

    if (contract.kind === 'new_call' || contract.kind === 'legacy_call') {
      // Legacy uid and role are intentionally never read. The legacy channel
      // only resolves the authoritative call row; authorization, channel, UID
      // and publisher privileges use the same server-side policy as new_call.
      let callQuery = admin
        .from('calls')
        .select('caller_id, callee_id, channel_name, status, expires_at');
      callQuery = contract.kind === 'new_call'
        ? callQuery.eq('id', contract.callId)
        : callQuery.eq('channel_name', contract.channelName);
      const { data: call, error } = await callQuery.maybeSingle<AuthorizedCall>();
      if (error) throw new Error('authorized call lookup failed');
      if (!call) {
        if (contract.kind === 'legacy_call') {
          // Distributed group clients used channelName=roomId and joined every
          // active link room as publisher. Preserve exactly that policy after
          // an exact 1:1 miss; UID and publisher privileges remain server-side.
          const { data: legacyGroup, error: legacyGroupError } = await admin
            .from('group_call_rooms')
            .select('id, host_id, status')
            .eq('id', contract.channelName)
            .maybeSingle<{ id: string; host_id: string; status: string }>();
          if (legacyGroupError) throw new Error('legacy resource lookup failed');
          if (!legacyGroup) {
            return new Response(JSON.stringify({ error: 'call not found' }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
            });
          }
          if (legacyGroup.status !== 'active') {
            return new Response(JSON.stringify({ error: 'group room is not joinable' }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409,
            });
          }
          // host_id authoritatively distinguishes host from guest, but both
          // roles were publishers in the distributed join-by-link client.
          observedParticipantKind = legacyGroup.host_id === user.id ? 'host' : 'guest';
          authorizedChannel = legacyGroup.id;
          observedContract = 'legacy_group';
        } else {
          return new Response(JSON.stringify({ error: 'call not found' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
          });
        }
      } else {
        const isCaller = call.caller_id === user.id;
        const isCallee = call.callee_id === user.id;
        if (!isCaller && !isCallee) {
          // Do not disclose whether a legacy channel belongs to another call.
          const status = contract.kind === 'legacy_call' ? 404 : 403;
          const error = contract.kind === 'legacy_call' ? 'call not found' : 'forbidden';
          return new Response(JSON.stringify({ error }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
          });
        }
        const isExpired = call.expires_at !== null
          && new Date(call.expires_at).getTime() <= Date.now();
        const stateAllowed = !isExpired
          && (call.status === 'accepted' || (isCaller && call.status === 'ringing'));
        if (!stateAllowed) {
          return new Response(JSON.stringify({ error: 'call is not joinable' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409,
          });
        }
        if (!isNonEmptyString(call.channel_name)) throw new Error('authorized call channel missing');
        authorizedChannel = call.channel_name.trim();
      }
    } else if (contract.kind === 'new_group') {
      // Group calls intentionally allow any authenticated holder of an active
      // room link. The channel is still read from the authoritative room row.
      const { data: room, error } = await admin
        .from('group_call_rooms')
        .select('id, status')
        .eq('id', contract.groupRoomId)
        .maybeSingle<{ id: string; status: string }>();
      if (error) throw new Error('authorized group room lookup failed');
      if (!room) {
        return new Response(JSON.stringify({ error: 'group room not found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
        });
      }
      if (room.status !== 'active') {
        return new Response(JSON.stringify({ error: 'group room is not joinable' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 409,
        });
      }
      authorizedChannel = room.id;
    } else {
      const { data: liveSession, error: liveSessionError } = await admin
        .from('live_sessions')
        .select('id, host_id, status, ended_at')
        .eq('id', contract.liveSessionId)
        .maybeSingle<{ id: string; host_id: string; status: string; ended_at: string | null }>();
      if (liveSessionError) throw new Error('authorized live session lookup failed');
      if (!liveSession) return jsonError('live session not found', 404);
      if (liveSession.status !== 'live' || liveSession.ended_at !== null) {
        return jsonError('live session is not joinable', 409);
      }

      authorizedChannel = liveSession.id;
      if (contract.requestedRole === 'host') {
        if (liveSession.host_id !== user.id) {
          return jsonError('live host authorization failed', 403);
        }
        observedParticipantKind = 'host';
        isPublisher = true;
      } else if (contract.requestedRole === 'viewer') {
        observedParticipantKind = 'viewer';
        isPublisher = false;
      } else {
        const { data: participant, error: participantError } = await admin
          .from('live_participants')
          .select('role, status')
          .eq('session_id', liveSession.id)
          .eq('user_id', user.id)
          .maybeSingle<{ role: string; status: string }>();
        if (participantError) throw new Error('authorized live participant lookup failed');
        if (!participant || participant.role !== 'cohost') {
          return jsonError('cohost is not authorized', 403);
        }
        if (participant.status !== 'active') {
          return jsonError('cohost is not active', 409);
        }
        // Host approval writes role=cohost/status=active. floor_granted is
        // intentionally not a token gate: it controls speaking/mute after
        // promotion and can be revoked while the participant remains cohost.
        observedParticipantKind = 'cohost';
        isPublisher = true;
      }
    }

    if (!authorizedChannel) throw new Error('authorized channel missing');
    console.info('agora-token authorized', {
      contract: observedContract,
      participant: observedParticipantKind,
    });

    const numericUid = userIdToAgoraUid(user.id);

    const token = await buildToken({
      appId:       AGORA_APP_ID,
      appCert:     AGORA_APP_CERTIFICATE,
      channelName: authorizedChannel,
      uid:         numericUid,
      isPublisher,
      expireSec:   TOKEN_EXPIRE_SEC,
    });

    return new Response(
      JSON.stringify({ token, appId: AGORA_APP_ID, channel: authorizedChannel, uid: numericUid }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch {
    console.error('agora-token internal error', { code: 'internal_error' });
    return jsonError('internal error', 500);
  }
});
