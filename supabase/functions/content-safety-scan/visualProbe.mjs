export const VISUAL_AI_PROVIDER = 'cloudflare_workers_ai'
export const VISUAL_MODEL = '@cf/google/gemma-4-26b-a4b-it'
export const VISUAL_TOOL_NAME = 'report_visual_safety'

const SYNTHETIC_PROBE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAYAAADS1n9/AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAG+SURBVHhe7ZJJjgNBDMP6/5/O3HkIoFqUcUsEeAngstzR8ynRPPyhZNEChNMChNMChNMChNMChNMChNMChNMChNMChNMChNMChNMChNMChNMChNMChKMX4Hl+azmK/kX5h7h9ETztm7fQn2Yyty+AJymeRn+SidwOhqfseAr9KSZxOxSeccIT6M8whduB8IST7qI/wQRuh8H4N9xBH+d2t4Ng9Juuoo9ys9tBMPpNV9FHudntEBjb4Qr6GLe6HQJjO1xBH+NWtwNgZKcq+gg3uh0AIztV0Ue40e0AGNmpij7CjW4HwMhOVfQRbnQ7AEZ2qqKPcKPbfw7julXRR7jR7QAY2amKPsKNbgfAyE5V9BFudDsARnaqoo9wo9sBMLJTFX2EG90OgJGdqugj3Oh2CIztcAV9jFvdDoGxHa6gj3Gr20Ew+k1X0Ue52e0gGP2mq+ij3Ox2GIx/wx30cW53OxCecNJd9CeYwO1QeMYJT6A/wxRuB8NTdjyF/hSTuH0BPEnxNPqTTOT2RfC0b97i4tNlAi1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOC1AOH/oi2DUahja9wAAAABJRU5ErkJggg=='

export const VISUAL_PROBE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    objects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          shape: { type: 'string' },
          color: { type: 'string' },
        },
        required: ['shape', 'color'],
        additionalProperties: false,
      },
    },
  },
  required: ['objects'],
  additionalProperties: false,
})

export class VisualProbeError extends Error {
  constructor(code, status = 502, { retryable = false, providerCalled = false, providerTelemetry = null } = {}) {
    super(code)
    this.name = 'VisualProbeError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.providerCalled = providerCalled
    this.providerTelemetry = providerTelemetry
  }
}

export function makeSyntheticVisualProbeImage() {
  return `data:image/png;base64,${SYNTHETIC_PROBE_PNG_BASE64}`
}

export function buildVisualFunctionContract(schema) {
  return {
    tools: [{
      type: 'function',
      function: {
        name: VISUAL_TOOL_NAME,
        description: 'Return the requested visual analysis as strictly validated structured data. This function has no side effects.',
        parameters: schema,
        strict: true,
      },
    }],
    tool_choice: { type: 'function', function: { name: VISUAL_TOOL_NAME } },
    parallel_tool_calls: false,
    stream: false,
  }
}

export function buildVisualProbeRequest() {
  return {
    messages: [
      {
        role: 'system',
        content: `Inspect the supplied synthetic image, then call ${VISUAL_TOOL_NAME} exactly once with arguments matching its schema. Do not answer with text.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'List exactly the two visible colored shapes. Use lowercase canonical labels: shape must be square or circle, and color must be red or blue.',
          },
          {
            type: 'image_url',
            image_url: { url: makeSyntheticVisualProbeImage() },
          },
        ],
      },
    ],
    ...buildVisualFunctionContract(VISUAL_PROBE_SCHEMA),
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0,
    max_completion_tokens: 160,
  }
}

const VISUAL_MULTI_IMAGE_PROBE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    image_count: { type: 'integer', enum: [2] },
  },
  required: ['image_count'],
  additionalProperties: false,
})

export function buildVisualMultiImageProbeRequest() {
  const image = makeSyntheticVisualProbeImage()
  return {
    messages: [
      { role: 'system', content: `Inspect every supplied synthetic image, then call ${VISUAL_TOOL_NAME} exactly once with arguments matching its schema. Do not answer with text.` },
      { role: 'user', content: [
        { type: 'text', text: 'Count the two separately supplied images. Return image_count 2.' },
        { type: 'image_url', image_url: { url: image } },
        { type: 'image_url', image_url: { url: image } },
      ] },
    ],
    ...buildVisualFunctionContract(VISUAL_MULTI_IMAGE_PROBE_SCHEMA),
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0,
    max_completion_tokens: 64,
  }
}

function providerError(status) {
  if (status === 401) return new VisualProbeError('visual_workers_ai_unauthorized', 401, { providerCalled: true })
  if (status === 403) return new VisualProbeError('visual_workers_ai_forbidden', 403, { providerCalled: true })
  if (status === 400) return new VisualProbeError('visual_workers_ai_request_rejected', status, { providerCalled: true })
  if (status === 404) return new VisualProbeError('visual_workers_ai_model_unavailable', status, { providerCalled: true })
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500
  return new VisualProbeError(retryable ? 'visual_workers_ai_temporarily_unavailable' : 'visual_workers_ai_rejected', status || 502, { retryable, providerCalled: true })
}

export function visualStructuredResponseValue(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new VisualProbeError('visual_workers_ai_response_malformed', 502, { providerCalled: true })
  if (payload.success === false) throw new VisualProbeError('visual_workers_ai_response_rejected', 502, { providerCalled: true })
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result) ? payload.result : payload
  const toolError = (code, retryable = true) => new VisualProbeError(code, 502, { retryable, providerCalled: true })
  if (result.choices !== undefined && (!Array.isArray(result.choices) || result.choices.length > 1)) {
    throw toolError('visual_workers_ai_tool_call_ambiguous')
  }
  const firstChoice = Array.isArray(result.choices) && result.choices[0] && typeof result.choices[0] === 'object' ? result.choices[0] : null
  const message = firstChoice?.message && typeof firstChoice.message === 'object' ? firstChoice.message : null
  const refusal = message?.refusal
  const finishReason = firstChoice?.finish_reason
  if ((typeof refusal === 'string' && refusal.trim()) || finishReason === 'content_filter') {
    throw toolError('visual_workers_ai_tool_call_refused', false)
  }
  if (finishReason === 'length') throw toolError('visual_workers_ai_tool_call_truncated', false)

  const topLevelCalls = result.tool_calls
  const messageCalls = message?.tool_calls
  if (topLevelCalls !== undefined && messageCalls !== undefined) throw toolError('visual_workers_ai_tool_call_ambiguous')
  const textCarriers = [result.response, message?.content, firstChoice?.text]
    .filter(value => value !== undefined && value !== null && value !== '')
  const calls = topLevelCalls ?? messageCalls
  if (calls !== undefined && textCarriers.length > 0) throw toolError('visual_workers_ai_tool_call_ambiguous')
  if (calls === undefined) throw toolError('visual_workers_ai_tool_call_missing')
  if (!Array.isArray(calls)) throw toolError('visual_workers_ai_tool_call_invalid')
  if (calls.length !== 1) throw toolError(calls.length === 0 ? 'visual_workers_ai_tool_call_missing' : 'visual_workers_ai_tool_call_ambiguous')
  if (messageCalls !== undefined && !['tool_calls', 'stop'].includes(finishReason)) throw toolError('visual_workers_ai_tool_finish_reason_invalid')

  const call = calls[0]
  let name
  let args
  if (exactKeys(call, ['id', 'type', 'function'])) {
    if (typeof call.id !== 'string' || !call.id || call.type !== 'function' ||
        !exactKeys(call.function, ['name', 'arguments']) || typeof call.function.arguments !== 'string') {
      throw toolError('visual_workers_ai_tool_call_invalid')
    }
    name = call.function.name
    try { args = JSON.parse(call.function.arguments) }
    catch { throw toolError('visual_workers_ai_tool_arguments_invalid_json') }
  } else if (exactKeys(call, ['name', 'arguments'])) {
    name = call.name
    args = call.arguments
  } else {
    throw toolError('visual_workers_ai_tool_call_invalid')
  }
  if (name !== VISUAL_TOOL_NAME) throw toolError('visual_workers_ai_tool_call_unauthorized')
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw toolError('visual_workers_ai_tool_arguments_invalid_type')
  return args
}

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)) && allowed.every(key => Object.hasOwn(value, key))
}

export function validateVisualProbeResponse(payload) {
  const value = visualStructuredResponseValue(payload)
  if (!exactKeys(value, ['objects']) || !Array.isArray(value.objects)) throw new VisualProbeError('visual_workers_ai_schema_invalid')
  const objects = value.objects.map(item => {
    if (!exactKeys(item, ['shape', 'color']) || typeof item.shape !== 'string' || typeof item.color !== 'string') {
      throw new VisualProbeError('visual_workers_ai_schema_invalid')
    }
    return { shape: item.shape.trim().toLowerCase(), color: item.color.trim().toLowerCase() }
  })
  const redSquare = objects.some(item => item.shape === 'square' && item.color === 'red')
  const blueCircle = objects.some(item => item.shape === 'circle' && item.color === 'blue')
  if (!redSquare || !blueCircle) throw new VisualProbeError('visual_workers_ai_image_not_recognized')
  return { visionInput: true, structuredOutput: true, schemaValid: true }
}

export async function runVisualProviderProbe({ token, accountId, fetchImpl = fetch }) {
  const value = await runVisualStructuredRequest({ token, accountId, request: buildVisualProbeRequest(), fetchImpl })
  return validateVisualProbeResponse({ success: true, result: { tool_calls: [{ name: VISUAL_TOOL_NAME, arguments: value }] } })
}

export async function runVisualMultiImageProviderProbe({ token, accountId, fetchImpl = fetch }) {
  const value = await runVisualStructuredRequest({ token, accountId, request: buildVisualMultiImageProbeRequest(), fetchImpl })
  if (!exactKeys(value, ['image_count']) || value.image_count !== 2) throw new VisualProbeError('visual_workers_ai_multi_image_not_recognized')
  return { visionInput: true, structuredOutput: true, schemaValid: true, multiImage: true }
}

export async function runVisualStructuredRequest({ token, accountId, request, fetchImpl = fetch }) {
  if (!token || !accountId) throw new VisualProbeError('visual_workers_ai_configuration_missing', 503)
  if (!validVisualFunctionRequest(request)) throw new VisualProbeError('visual_workers_ai_request_contract_invalid', 400)
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${VISUAL_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }).catch(() => { throw new VisualProbeError('visual_workers_ai_network_error', 502, { retryable: true, providerCalled: true }) })
  if (!response.ok) throw providerError(response.status)
  const payload = await response.json().catch(() => { throw new VisualProbeError('visual_workers_ai_response_malformed', 502, { providerCalled: true }) })
  try { return visualStructuredResponseValue(payload) }
  catch (error) {
    if (error instanceof VisualProbeError) {
      error.providerCalled = true
      error.providerTelemetry = safeProviderTelemetry(response, payload)
    }
    throw error
  }
}

function validVisualFunctionRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.hasOwn(request, 'response_format') ||
      !Array.isArray(request.messages) || request.messages.length === 0 || !Array.isArray(request.tools) || request.tools.length !== 1 ||
      request.parallel_tool_calls !== false || request.stream !== false) return false
  const tool = request.tools[0]
  const selected = request.tool_choice
  return exactKeys(tool, ['type', 'function']) && tool.type === 'function' &&
    exactKeys(tool.function, ['name', 'description', 'parameters', 'strict']) &&
    tool.function.name === VISUAL_TOOL_NAME && typeof tool.function.description === 'string' && tool.function.description.length > 0 &&
    tool.function.parameters && typeof tool.function.parameters === 'object' && !Array.isArray(tool.function.parameters) &&
    tool.function.strict === true && exactKeys(selected, ['type', 'function']) && selected.type === 'function' &&
    exactKeys(selected.function, ['name']) && selected.function.name === VISUAL_TOOL_NAME
}

function safeProviderTelemetry(response, payload) {
  const result = payload?.result && typeof payload.result === 'object' && !Array.isArray(payload.result) ? payload.result : payload
  const choice = Array.isArray(result?.choices) && result.choices[0] && typeof result.choices[0] === 'object' ? result.choices[0] : null
  const message = choice?.message && typeof choice.message === 'object' ? choice.message : null
  const usage = result?.usage && typeof result.usage === 'object' && !Array.isArray(result.usage) ? result.usage : {}
  const count = key => {
    const raw = usage[key]
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return null
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  const correlation = response?.headers?.get?.('cf-ray')
  const serialized = JSON.stringify(payload)
  const finishReason = typeof choice?.finish_reason === 'string' && ['stop', 'length', 'tool_calls', 'content_filter', 'function_call'].includes(choice.finish_reason)
    ? choice.finish_reason
    : null
  return {
    status_code: Number(response?.status) || 0,
    request_correlation_id: typeof correlation === 'string' && /^[A-Za-z0-9-]{1,128}$/u.test(correlation) ? correlation : null,
    carrier: result?.tool_calls !== undefined ? 'result_tool_calls' : message?.tool_calls !== undefined ? 'choices_message_tool_calls' : 'none',
    finish_reason: finishReason,
    response_bytes: new TextEncoder().encode(serialized).byteLength,
    input_tokens: count('prompt_tokens') ?? count('input_tokens'),
    output_tokens: count('completion_tokens') ?? count('output_tokens'),
    total_tokens: count('total_tokens'),
  }
}
