/**
 * agora-token — Generates short-lived Agora RTC tokens server-side.
 *
 * Body: { channelName: string, uid?: number, role?: 'publisher' | 'subscriber' }
 * Returns: { token, appId, channel }
 *
 * The App Certificate never leaves this function — only the signed token is
 * returned to the client. uid=0 issues a token valid for any uid (Agora
 * "wildcard" uid), used when the client lets the engine auto-assign one.
 *
 * Uses Agora's own official `agora-token` package (AccessToken2 builder)
 * rather than a hand-rolled implementation — the token wire format is
 * exact-byte-layout-sensitive, and a subtly wrong implementation fails
 * silently (Agora just rejects the token at join time with an opaque error).
 *
 * Requires a valid Supabase session — the caller's JWT is verified against
 * Supabase Auth before a token is issued.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { RtcTokenBuilder, RtcRole } from 'https://esm.sh/agora-token@2.0.5';
import { corsHeaders } from '../_shared/cors.ts';

const AGORA_APP_ID          = Deno.env.get('AGORA_APP_ID') ?? '';
const AGORA_APP_CERTIFICATE = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const TOKEN_EXPIRE_SECONDS = 3600; // 1 hour

// ── Auth helper: verify JWT with Supabase before issuing a token ────────────
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    return new Response(
      JSON.stringify({ error: 'Agora is not configured (AGORA_APP_ID / AGORA_APP_CERTIFICATE missing)' }),
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
    const { channelName, uid, role } = await req.json();

    if (!channelName || typeof channelName !== 'string') {
      return new Response(
        JSON.stringify({ error: 'channelName is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
      );
    }

    const numericUid = Number.isFinite(uid) ? Number(uid) : 0;
    const rtcRole = role === 'subscriber' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      numericUid,
      rtcRole,
      TOKEN_EXPIRE_SECONDS,
      TOKEN_EXPIRE_SECONDS,
    );

    return new Response(
      JSON.stringify({ token, appId: AGORA_APP_ID, channel: channelName }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
