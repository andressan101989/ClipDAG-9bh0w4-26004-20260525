/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createSemanticWorkerHandler } from './embeddingPipeline.mjs'

const handle = createSemanticWorkerHandler({
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '',
  supabaseUrl: Deno.env.get('SUPABASE_URL')?.trim() ?? '',
  cloudflareAccountId: Deno.env.get('CLOUDFLARE_ACCOUNT_ID')?.trim() ?? '',
  cloudflareApiToken: Deno.env.get('CLOUDFLARE_AI_TOKEN')?.trim() ?? '',
  createAdminClient: (url: string, key: string) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  fetchImpl: fetch,
})

Deno.serve(handle)
