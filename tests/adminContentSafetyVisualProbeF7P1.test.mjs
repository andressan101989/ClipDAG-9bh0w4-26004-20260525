import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  VISUAL_AI_PROVIDER,
  VISUAL_MODEL,
  VisualProbeError,
  buildVisualProbeRequest,
  makeSyntheticVisualProbeImage,
  runVisualProviderProbe,
  validateVisualProbeResponse,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs'

const root = process.cwd()
const worker = readFileSync(join(root, 'supabase', 'functions', 'content-safety-scan', 'index.ts'), 'utf8')

const validProviderPayload = {
  success: true,
  result: { response: { objects: [{ shape: 'square', color: 'red' }, { shape: 'circle', color: 'blue' }] } },
}

test('probe request uses documented vision parts, synthetic PNG, and JSON schema', () => {
  const request = buildVisualProbeRequest()
  const content = request.messages[1].content
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image_url')
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/)
  assert.equal(request.response_format.type, 'json_schema')
  assert.deepEqual(request.response_format.json_schema.required, ['objects'])
  assert.equal(request.response_format.json_schema.additionalProperties, false)
  const png = Buffer.from(makeSyntheticVisualProbeImage().split(',')[1], 'base64')
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
})

test('valid structured output must recognize the synthetic red square and blue circle', () => {
  assert.deepEqual(validateVisualProbeResponse(validProviderPayload), { visionInput: true, structuredOutput: true, schemaValid: true })
  assert.deepEqual(validateVisualProbeResponse({ success: true, result: { choices: [{ message: { content: JSON.stringify(validProviderPayload.result.response) } }] } }), { visionInput: true, structuredOutput: true, schemaValid: true })
  assert.throws(() => validateVisualProbeResponse({ result: { response: { objects: [{ shape: 'square', color: 'red' }] } } }), error => error.code === 'visual_workers_ai_image_not_recognized')
})

test('malformed, fenced, partial, and schema-invalid output fail closed', () => {
  const invalid = [
    null,
    { result: { response: '```json\n{"objects":[]}\n```' } },
    { result: { response: '{"objects":' } },
    { result: { response: { objects: 'not-an-array' } } },
    { result: { response: { objects: [{ shape: 'square', color: 'red', confidence: 1 }] } } },
    { result: { response: { objects: [], commentary: 'extra' } } },
  ]
  for (const payload of invalid) assert.throws(() => validateVisualProbeResponse(payload), VisualProbeError)
})

test('provider probe maps configuration and provider failures to safe stable codes', async () => {
  await assert.rejects(() => runVisualProviderProbe({ token: '', accountId: 'account', fetchImpl: async () => assert.fail('fetch called') }), error => error.code === 'visual_workers_ai_configuration_missing')
  for (const [status, code] of [[401, 'visual_workers_ai_unauthorized'], [403, 'visual_workers_ai_forbidden'], [404, 'visual_workers_ai_model_unavailable']]) {
    await assert.rejects(() => runVisualProviderProbe({ token: 'server-secret', accountId: 'account', fetchImpl: async () => ({ ok: false, status }) }), error => error.code === code && !error.message.includes('server-secret'))
  }
})

test('successful provider call sends the token only in its authorization header and returns safe booleans', async () => {
  const token = 'server-secret-that-must-never-return'
  let captured
  const result = await runVisualProviderProbe({
    token,
    accountId: 'account-id',
    fetchImpl: async (url, init) => {
      captured = { url, init }
      return { ok: true, status: 200, json: async () => validProviderPayload }
    },
  })
  assert.equal(captured.url, `https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/${VISUAL_MODEL}`)
  assert.equal(captured.init.headers.Authorization, `Bearer ${token}`)
  assert.deepEqual(result, { visionInput: true, structuredOutput: true, schemaValid: true })
  assert.doesNotMatch(JSON.stringify(result), /server-secret/)
  assert.equal(VISUAL_AI_PROVIDER, 'cloudflare_workers_ai')
})

test('visual probe remains behind JWT and dispatch-secret checks and performs no database work', () => {
  const jwtCheck = worker.indexOf("req.headers.get('Authorization')")
  const dispatchCheck = worker.indexOf("req.headers.get('x-content-safety-secret')")
  const visualBranch = worker.indexOf("body.action === 'visual_provider_probe'")
  const clientCreation = worker.indexOf('createClient(supabaseUrl')
  assert.ok(jwtCheck >= 0 && dispatchCheck > jwtCheck && visualBranch > dispatchCheck && clientCreation > visualBranch)
  const branch = worker.slice(visualBranch, worker.indexOf("body.action === 'provider_probe'"))
  assert.doesNotMatch(branch, /admin\.rpc|\.from\(|insert|update|delete/i)
  assert.match(worker, /body\.action === 'provider_probe'/)
  assert.match(worker, /makeProbeWav\(\)/)
})
