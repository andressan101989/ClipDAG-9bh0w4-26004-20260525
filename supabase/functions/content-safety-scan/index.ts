/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { evaluateTextRules } from './ruleEngine.mjs'

const BATCH_LIMIT = 25
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

function secretsEqual(actual: string, expected: string) {
  const left = new TextEncoder().encode(actual)
  const right = new TextEncoder().encode(expected)
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)
  if (!req.headers.get('Authorization')?.startsWith('Bearer ') || !req.headers.get('apikey')) {
    return json({ success: false, error: 'missing_authorization' }, 401)
  }
  const expectedSecret = Deno.env.get('CALL_DISPATCH_SECRET') ?? ''
  const suppliedSecret = req.headers.get('x-content-safety-secret') ?? ''
  if (!expectedSecret || !suppliedSecret || !secretsEqual(suppliedSecret, expectedSecret)) {
    return json({ success: false, error: 'invalid_dispatch_authorization' }, 401)
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'server_configuration_unavailable' }, 503)
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: rulesData, error: rulesError } = await admin.rpc('get_content_safety_worker_rules')
  if (rulesError || !Array.isArray(rulesData)) return json({ success: false, error: 'rule_load_failed' }, 500)
  const { data: scansData, error: scansError } = await admin.rpc('claim_content_safety_scans', { p_limit: BATCH_LIMIT })
  if (scansError || !Array.isArray(scansData)) return json({ success: false, error: 'scan_claim_failed' }, 500)
  let completed = 0
  let retried = 0
  let failed = 0
  let alerts = 0
  for (const value of scansData) {
    const scan = value && typeof value === 'object' ? value as Record<string, unknown> : null
    if (!scan || !uuid(scan.id) || typeof scan.scope !== 'string' || typeof scan.text !== 'string') {
      if (scan && uuid(scan.id)) {
        await admin.rpc('fail_content_safety_scan', { p_scan_id: scan.id, p_error_code: 'malformed_scan', p_retryable: false })
      }
      failed += 1
      continue
    }
    try {
      const matches = evaluateTextRules({ text: scan.text, scope: scan.scope }, rulesData)
      const { data, error } = await admin.rpc('complete_content_safety_scan', { p_scan_id: scan.id, p_matches: matches })
      if (error) throw new Error('complete_failed')
      const receipt = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      alerts += typeof receipt.alerts_processed === 'number' ? receipt.alerts_processed : 0
      completed += 1
    } catch {
      const { data } = await admin.rpc('fail_content_safety_scan', {
        p_scan_id: scan.id,
        p_error_code: 'worker_processing_error',
        p_retryable: true,
      })
      const receipt = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      if (receipt.status === 'queued') retried += 1
      else failed += 1
    }
  }
  return json({ success: true, claimed: scansData.length, completed, retried, failed, alerts, external_providers: 0 })
})
