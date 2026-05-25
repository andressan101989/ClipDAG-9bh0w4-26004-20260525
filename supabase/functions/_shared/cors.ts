/**
 * supabase/functions/_shared/cors.ts
 *
 * Shared CORS headers for all Edge Functions.
 * Always include in OPTIONS preflight and ALL responses (success + error).
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-monitor-secret, x-reconcile-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
