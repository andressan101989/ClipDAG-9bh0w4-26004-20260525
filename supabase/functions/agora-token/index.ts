/**
 * agora-token — Generates short-lived Agora RTC tokens server-side.
 *
 * Body: { channelName: string, uid?: number, role?: 'publisher' | 'subscriber' }
 * Returns: { token, appId, channel }
 *
 * The App Certificate never leaves this function — only the signed token is
 * returned to the client. uid=0 issues a token valid for any uid (Agora
 * "wildcard" uid), used when the client lets the engine auto-assign one.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { RtcTokenBuilder, RtcRole } from 'https://esm.sh/agora-token@2.0.5';
import { corsHeaders } from '../_shared/cors.ts';

const AGORA_APP_ID          = Deno.env.get('AGORA_APP_ID') ?? '';
const AGORA_APP_CERTIFICATE = Deno.env.get('AGORA_APP_CERTIFICATE') ?? '';

const TOKEN_EXPIRE_SECONDS = 3600; // 1 hour

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
