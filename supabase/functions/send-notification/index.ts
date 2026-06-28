/**
  * Edge Function: send-notification
  *
  * Sends an Expo push notification to a target user.
  * Called from the mobile client for events without a dedicated edge function
  * (follow, comment, message, in-video gift).
  *
  * Payload:
  *   to_user_id  — UUID of the recipient
  *   title       — notification title
  *   body        — notification body text
  *   data?       — optional key/value object for client-side routing
  *
  * Auth: requires a valid user JWT (Bearer token).
  * A user cannot notify themselves (silently skipped).
  */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders }  from '../_shared/cors.ts';
import { sendPushToUser } from '../_shared/pushNotify.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const respOk   = (d: object) =>
  new Response(JSON.stringify(d), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const respFail = (msg: string, status = 400) =>
  new Response(JSON.stringify({ success: false, error: msg }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Authenticate caller ────────────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return respFail('unauthorized', 401);

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return respFail('unauthorized', 401);

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { to_user_id?: string; title?: string; body?: string; data?: Record<string, string> };
  try { body = await req.json(); }
  catch { return respFail('invalid JSON body'); }

  const { to_user_id, title, body: bodyText, data } = body;

  if (!to_user_id || !title || !bodyText)
    return respFail('to_user_id, title, and body are required');

  // Silently skip self-notifications
  if (to_user_id === user.id) return respOk({ success: true, skipped: 'self' });

  await sendPushToUser(admin, to_user_id, title, bodyText, data);
  return respOk({ success: true });
});
