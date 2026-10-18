import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  VISUAL_AI_PROVIDER,
  VISUAL_MODEL,
  VISUAL_TOOL_NAME,
  VisualProbeError,
  buildVisualMultiImageProbeRequest,
  buildVisualProbeRequest,
  makeSyntheticVisualProbeImage,
  runVisualMultiImageProviderProbe,
  runVisualProviderProbe,
  validateVisualProbeResponse,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs'

const root = process.cwd()
const worker = readFileSync(join(root, 'supabase', 'functions', 'content-safety-scan', 'index.ts'), 'utf8')

const validProviderPayload = {
  success: true,
  result: { tool_calls: [{ name: VISUAL_TOOL_NAME, arguments: { objects: [{ shape: 'square', color: 'red' }, { shape: 'circle', color: 'blue' }] } }] },
}

test('probe request uses documented vision parts, synthetic PNG, and strict function calling', () => {
  const request = buildVisualProbeRequest()
  const content = request.messages[1].content
  assert.equal(content[0].type, 'text')
  assert.equal(content[1].type, 'image_url')
  assert.match(content[1].image_url.url, /^data:image\/png;base64,/)
  assert.equal(request.tools[0].function.name, VISUAL_TOOL_NAME)
  assert.equal(request.tools[0].function.strict, true)
  assert.equal(request.parallel_tool_calls, false)
  assert.equal(request.chat_template_kwargs.enable_thinking, false)
  assert.deepEqual(request.tools[0].function.parameters.required, ['objects'])
  assert.equal(request.tools[0].function.parameters.additionalProperties, false)
  const png = Buffer.from(makeSyntheticVisualProbeImage().split(',')[1], 'base64')
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
})

test('valid structured output must recognize the synthetic red square and blue circle', () => {
  assert.deepEqual(validateVisualProbeResponse(validProviderPayload), { visionInput: true, structuredOutput: true, schemaValid: true })
  assert.deepEqual(validateVisualProbeResponse({ success: true, result: { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: VISUAL_TOOL_NAME, arguments: JSON.stringify(validProviderPayload.result.tool_calls[0].arguments) } }] } }] } }), { visionInput: true, structuredOutput: true, schemaValid: true })
  assert.throws(() => validateVisualProbeResponse({ result: { tool_calls: [{ name: VISUAL_TOOL_NAME, arguments: { objects: [{ shape: 'square', color: 'red' }] } }] } }), error => error.code === 'visual_workers_ai_image_not_recognized')
})

test('multi-image probe sends two separate image parts and requires schema-valid recognition', async () => {
  const request = buildVisualMultiImageProbeRequest()
  assert.equal(request.messages[1].content.filter(part => part.type === 'image_url').length, 2)
  assert.equal(request.tools[0].function.name, VISUAL_TOOL_NAME)
  const result = await runVisualMultiImageProviderProbe({
    token: 'server-secret',
    accountId: 'account-id',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { tool_calls: [{ name: VISUAL_TOOL_NAME, arguments: { image_count: 2 } }] } }) }),
  })
  assert.deepEqual(result, { visionInput: true, structuredOutput: true, schemaValid: true, multiImage: true })
  await assert.rejects(() => runVisualMultiImageProviderProbe({
    token: 'server-secret',
    accountId: 'account-id',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { tool_calls: [{ name: VISUAL_TOOL_NAME, arguments: { image_count: 1 } }] } }) }),
  }), error => error.code === 'visual_workers_ai_multi_image_not_recognized')
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
  for (const [status, code] of [[400, 'visual_workers_ai_request_rejected'], [401, 'visual_workers_ai_unauthorized'], [403, 'visual_workers_ai_forbidden'], [404, 'visual_workers_ai_model_unavailable']]) {
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
  const serviceProbeCheck = worker.indexOf('serviceProbeAuthorized')
  assert.ok(jwtCheck >= 0 && dispatchCheck > jwtCheck && serviceProbeCheck > dispatchCheck && visualBranch > serviceProbeCheck && clientCreation > visualBranch)
  assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(worker, /jwtRole\(bearer\) === 'service_role'/)
  const branch = worker.slice(visualBranch, worker.indexOf("body.action === 'provider_probe'"))
  assert.doesNotMatch(branch, /admin\.rpc|\.from\(|insert|update|delete/i)
  assert.match(worker, /body\.action === 'provider_probe'/)
  assert.match(worker, /makeProbeWav\(\)/)
})
