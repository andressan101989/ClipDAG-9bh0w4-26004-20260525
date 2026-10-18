import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

import {
  VisualProbeError,
  buildVisualMultiImageProbeRequest,
  buildVisualProbeRequest,
  runVisualStructuredRequest,
  visualStructuredResponseValue,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs'
import {
  VISUAL_PROMPT_VERSION,
  buildVisualSafetyRequest,
  validateVisualSafetyResult,
} from '../supabase/functions/content-safety-scan/visualPipeline.mjs'
import {
  VISUAL_SEMANTIC_PROMPT_VERSION,
  buildVisualSemanticRequest,
  validateVisualSemanticResult,
} from '../supabase/functions/video-semantic-index/visualSemanticPipeline.mjs'

const TOOL_NAME = 'report_visual_safety'
const safeVisualResult = Object.freeze({
  schema_version: VISUAL_PROMPT_VERSION,
  review_required: false,
  findings: [],
  summary: 'No review signal.',
})
const safeSemanticResult = Object.freeze({
  schema_version: VISUAL_SEMANTIC_PROMPT_VERSION,
  summary: 'A blue circle beside a red square.',
  topics: ['geometry'],
  objects: ['circle', 'square'],
  activities: [],
  setting: null,
})

function openAiToolEnvelope(argumentsValue, overrides = {}) {
  return {
    success: true,
    result: {
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [{
            id: 'call_visual_1',
            type: 'function',
            function: {
              name: TOOL_NAME,
              arguments: typeof argumentsValue === 'string' ? argumentsValue : JSON.stringify(argumentsValue),
            },
          }],
        },
      }],
      usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
      ...overrides,
    },
  }
}

function assertStrictToolContract(request, schema) {
  assert.equal(Object.hasOwn(request, 'response_format'), false)
  assert.equal(request.stream, false)
  assert.equal(request.parallel_tool_calls, false)
  assert.deepEqual(request.tool_choice, { type: 'function', function: { name: TOOL_NAME } })
  assert.equal(request.tools.length, 1)
  assert.equal(request.tools[0].type, 'function')
  assert.equal(request.tools[0].function.name, TOOL_NAME)
  assert.equal(request.tools[0].function.strict, true)
  assert.deepEqual(request.tools[0].function.parameters, schema)
}

test('every visual Workers AI request uses exactly one forced strict function contract', () => {
  const probe = buildVisualProbeRequest()
  const multi = buildVisualMultiImageProbeRequest()
  const safety = buildVisualSafetyRequest('data:image/jpeg;base64,/9j/', { sourceKind: 'eligible_image' })
  const semantic = buildVisualSemanticRequest('data:image/jpeg;base64,/9j/')

  assertStrictToolContract(probe, probe.tools[0].function.parameters)
  assertStrictToolContract(multi, multi.tools[0].function.parameters)
  assertStrictToolContract(safety, safety.tools[0].function.parameters)
  assertStrictToolContract(semantic, semantic.tools[0].function.parameters)
  assert.deepEqual(probe.tools[0].function.parameters.required, ['objects'])
  assert.deepEqual(safety.tools[0].function.parameters.required, ['schema_version', 'review_required', 'findings', 'summary'])
  assert.deepEqual(semantic.tools[0].function.parameters.required, ['schema_version', 'summary', 'topics', 'objects', 'activities', 'setting'])
  for (const request of [probe, multi, safety, semantic]) {
    assert.match(request.messages[0].content, /report_visual_safety/i)
    assert.doesNotMatch(request.messages[0].content, /return only (?:valid )?(?:structured )?json/i)
  }
})

test('transport rejects a request that does not carry the canonical forced tool contract before network access', async () => {
  let fetchCalls = 0
  await assert.rejects(
    () => runVisualStructuredRequest({
      token: 'server-secret',
      accountId: 'account-id',
      request: { messages: [], response_format: { type: 'json_schema' } },
      fetchImpl: async () => { fetchCalls += 1 },
    }),
    error => error.code === 'visual_workers_ai_request_contract_invalid' && error.providerCalled === false,
  )
  assert.equal(fetchCalls, 0)
})

test('strict parser accepts the documented OpenAI-compatible and traditional tool-call carriers', () => {
  const openAi = visualStructuredResponseValue(openAiToolEnvelope(safeVisualResult))
  assert.deepEqual(validateVisualSafetyResult(openAi, { sourceKind: 'eligible_image' }), safeVisualResult)

  const traditional = visualStructuredResponseValue({
    success: true,
    result: { tool_calls: [{ name: TOOL_NAME, arguments: safeSemanticResult }] },
  })
  assert.deepEqual(validateVisualSemanticResult(traditional), safeSemanticResult)
})

test('strict parser rejects legacy text, ambiguity, unauthorized tools, and malformed arguments', () => {
  const validCall = openAiToolEnvelope(safeVisualResult).result.choices[0].message.tool_calls[0]
  const cases = [
    [{ success: true, result: { response: JSON.stringify(safeVisualResult) } }, 'visual_workers_ai_tool_call_missing'],
    [{ success: true, result: { tool_calls: [validCall, validCall] } }, 'visual_workers_ai_tool_call_ambiguous'],
    [{ success: true, result: { tool_calls: [{ name: 'publish_content', arguments: safeVisualResult }] } }, 'visual_workers_ai_tool_call_unauthorized'],
    [openAiToolEnvelope('{"schema_version":'), 'visual_workers_ai_tool_arguments_invalid_json'],
    [openAiToolEnvelope(JSON.stringify([safeVisualResult])), 'visual_workers_ai_tool_arguments_invalid_type'],
    [{
      success: true,
      result: {
        tool_calls: [{ name: TOOL_NAME, arguments: safeVisualResult }],
        choices: openAiToolEnvelope(safeVisualResult).result.choices,
      },
    }, 'visual_workers_ai_tool_call_ambiguous'],
    [{
      success: true,
      result: {
        choices: [{
          index: 0,
          finish_reason: 'tool_calls',
          message: { content: 'also text', refusal: null, tool_calls: [validCall] },
        }],
      },
    }, 'visual_workers_ai_tool_call_ambiguous'],
  ]

  for (const [payload, code] of cases) {
    assert.throws(
      () => visualStructuredResponseValue(payload),
      error => error instanceof VisualProbeError && error.code === code && error.providerCalled === true,
      code,
    )
  }
})

test('refusal and truncation fail closed without cost-amplifying retries', () => {
  const refusal = openAiToolEnvelope(safeVisualResult)
  refusal.result.choices[0].finish_reason = 'content_filter'
  refusal.result.choices[0].message.refusal = 'request refused'
  assert.throws(
    () => visualStructuredResponseValue(refusal),
    error => error.code === 'visual_workers_ai_tool_call_refused' && error.retryable === false,
  )

  const truncated = openAiToolEnvelope(safeVisualResult)
  truncated.result.choices[0].finish_reason = 'length'
  assert.throws(
    () => visualStructuredResponseValue(truncated),
    error => error.code === 'visual_workers_ai_tool_call_truncated' && error.retryable === false,
  )
})

test('provider failure exposes only bounded technical telemetry', async () => {
  const payload = openAiToolEnvelope('{"schema_version":')
  const serialized = JSON.stringify(payload)
  await assert.rejects(
    () => runVisualStructuredRequest({
      token: 'secret-that-must-not-escape',
      accountId: 'account-id',
      request: buildVisualProbeRequest(),
      fetchImpl: async () => new Response(serialized, {
        status: 200,
        headers: { 'content-type': 'application/json', 'cf-ray': 'abc123-EWR' },
      }),
    }),
    error => {
      assert.equal(error.code, 'visual_workers_ai_tool_arguments_invalid_json')
      assert.deepEqual(error.providerTelemetry, {
        status_code: 200,
        request_correlation_id: 'abc123-EWR',
        carrier: 'choices_message_tool_calls',
        finish_reason: 'tool_calls',
        response_bytes: Buffer.byteLength(serialized),
        input_tokens: 80,
        output_tokens: 30,
        total_tokens: 110,
      })
      assert.doesNotMatch(JSON.stringify(error.providerTelemetry), /secret-that-must-not-escape|schema_version/u)
      return true
    },
  )
})

test('both production workers log only the bounded telemetry allowlist', () => {
  const scanner = readFileSync(new URL('../supabase/functions/content-safety-scan/index.ts', import.meta.url), 'utf8')
  const semantic = readFileSync(new URL('../supabase/functions/video-semantic-index/embeddingPipeline.mjs', import.meta.url), 'utf8')
  for (const source of [scanner, semantic]) {
    assert.match(source, /provider_correlation_id/)
    assert.match(source, /provider_carrier/)
    assert.match(source, /provider_finish_reason/)
    assert.match(source, /provider_response_bytes/)
    assert.match(source, /provider_total_tokens/)
    assert.doesNotMatch(source, /providerTelemetry\?\.(?:payload|response|message|arguments)\b/u)
  }
})
