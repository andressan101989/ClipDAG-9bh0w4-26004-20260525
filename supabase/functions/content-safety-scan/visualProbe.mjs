export const VISUAL_AI_PROVIDER = 'cloudflare_workers_ai'
export const VISUAL_MODEL = '@cf/google/gemma-4-26b-a4b-it'

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
  constructor(code, status = 502) {
    super(code)
    this.name = 'VisualProbeError'
    this.code = code
    this.status = status
  }
}

export function makeSyntheticVisualProbeImage() {
  return `data:image/png;base64,${SYNTHETIC_PROBE_PNG_BASE64}`
}

export function buildVisualProbeRequest() {
  return {
    messages: [
      {
        role: 'system',
        content: 'Inspect the supplied synthetic image. Return only structured JSON matching the response schema, with no markdown or commentary.',
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
    response_format: {
      type: 'json_schema',
      json_schema: VISUAL_PROBE_SCHEMA,
    },
    temperature: 0,
    max_tokens: 160,
  }
}

function providerError(status) {
  if (status === 401) return new VisualProbeError('visual_workers_ai_unauthorized', 401)
  if (status === 403) return new VisualProbeError('visual_workers_ai_forbidden', 403)
  if (status === 400 || status === 404) return new VisualProbeError('visual_workers_ai_model_unavailable', status)
  return new VisualProbeError('visual_workers_ai_probe_rejected', status || 502)
}

function responseValue(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new VisualProbeError('visual_workers_ai_response_malformed')
  if (payload.success === false) throw new VisualProbeError('visual_workers_ai_response_rejected')
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result) ? payload.result : payload
  const firstChoice = Array.isArray(result.choices) && result.choices[0] && typeof result.choices[0] === 'object' ? result.choices[0] : null
  const message = firstChoice?.message && typeof firstChoice.message === 'object' ? firstChoice.message : null
  const candidate = result.response ?? message?.content ?? firstChoice?.text
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate
  if (typeof candidate !== 'string' || candidate.includes('```')) throw new VisualProbeError('visual_workers_ai_structured_output_malformed')
  try {
    const parsed = JSON.parse(candidate)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not_object')
    return parsed
  } catch {
    throw new VisualProbeError('visual_workers_ai_structured_output_malformed')
  }
}

function exactKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)) && allowed.every(key => Object.hasOwn(value, key))
}

export function validateVisualProbeResponse(payload) {
  const value = responseValue(payload)
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
  if (!token || !accountId) throw new VisualProbeError('visual_workers_ai_configuration_missing', 503)
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${VISUAL_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildVisualProbeRequest()),
  }).catch(() => { throw new VisualProbeError('visual_workers_ai_network_error') })
  if (!response.ok) throw providerError(response.status)
  const payload = await response.json().catch(() => { throw new VisualProbeError('visual_workers_ai_response_malformed') })
  return validateVisualProbeResponse(payload)
}
