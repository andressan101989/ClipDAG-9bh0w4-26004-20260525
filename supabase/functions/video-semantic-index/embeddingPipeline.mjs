import { processVisualSemanticJob } from './visualSemanticPipeline.mjs'

export const SEMANTIC_PROVIDER = 'cloudflare_workers_ai'
export const SEMANTIC_MODEL = '@cf/baai/bge-m3'
export const EMBEDDING_DIMENSIONS = 1024
export const DEFAULT_BATCH_SIZE = 8
export const MAX_BATCH_SIZE = 25
export const MAX_INPUT_CHARACTERS = 18000
export const DEFAULT_VISUAL_BATCH_SIZE = 2
export const MAX_VISUAL_BATCH_SIZE = 5
const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

export function secretsEqual(actual, expected) {
  const left = new TextEncoder().encode(String(actual ?? ''))
  const right = new TextEncoder().encode(String(expected ?? ''))
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function bearer(request) {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function isFingerprint(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

export function validateEmbeddingResponse(payload, expectedCount) {
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_BATCH_SIZE) {
    throw new Error('invalid_embedding_response')
  }
  let serialized
  try { serialized = JSON.stringify(payload) } catch { throw new Error('invalid_embedding_response') }
  if (!serialized || serialized.length > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error('invalid_embedding_response')
  }

  const root = asObject(payload)
  const result = asObject(root.result)
  const embeddings = Array.isArray(result.data)
    ? result.data
    : Array.isArray(root.data) ? root.data : null
  if (!embeddings || embeddings.length !== expectedCount) {
    throw new Error('invalid_embedding_response')
  }

  if (result.shape !== undefined) {
    if (!Array.isArray(result.shape) || result.shape.length !== 2 ||
        result.shape[0] !== expectedCount || result.shape[1] !== EMBEDDING_DIMENSIONS) {
      throw new Error('invalid_embedding_response')
    }
  }

  for (const embedding of embeddings) {
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error('invalid_embedding_response')
    }
    for (const component of embedding) {
      if (typeof component !== 'number' || !Number.isFinite(component)) {
        throw new Error('invalid_embedding_response')
      }
    }
  }
  return embeddings
}

function validJob(value) {
  const job = asObject(value)
  return isUuid(job.video_id) &&
    isFingerprint(job.semantic_input_fingerprint) &&
    typeof job.input_text === 'string' &&
    job.input_text.length > 0 &&
    job.input_text.length <= MAX_INPUT_CHARACTERS &&
    job.provider === SEMANTIC_PROVIDER &&
    job.model === SEMANTIC_MODEL &&
    job.embedding_dimensions === EMBEDDING_DIMENSIONS &&
    Number.isInteger(job.attempt_count) &&
    job.attempt_count >= 1 && job.attempt_count <= 5
}

function validTaxonomyJob(value) {
  const job = asObject(value)
  return isUuid(job.interest_id) &&
    isFingerprint(job.embedding_fingerprint) &&
    typeof job.input_text === 'string' &&
    job.input_text.length > 0 &&
    job.input_text.length <= MAX_INPUT_CHARACTERS &&
    job.provider === SEMANTIC_PROVIDER &&
    job.model === SEMANTIC_MODEL &&
    job.embedding_dimensions === EMBEDDING_DIMENSIONS &&
    Number.isInteger(job.attempt_count) &&
    job.attempt_count >= 1 && job.attempt_count <= 5
}

async function failJob(client, job, errorCode, retryable, providerCalled) {
  return client.rpc('fail_video_semantic_profile_v1', {
    p_video_id: job.video_id,
    p_semantic_input_fingerprint: job.semantic_input_fingerprint,
    p_error_code: errorCode,
    p_retryable: retryable,
    p_provider_called: providerCalled,
  })
}

async function failJobs(client, jobs, errorCode, retryable, providerCalled) {
  let failed = 0
  for (const job of jobs) {
    await failJob(client, job, errorCode, retryable, providerCalled)
    failed += 1
  }
  return failed
}

async function failTaxonomyJob(client, job, errorCode, retryable, providerCalled) {
  return client.rpc('fail_personalization_taxonomy_embedding_job_v1', {
    p_interest_id: job.interest_id,
    p_embedding_fingerprint: job.embedding_fingerprint,
    p_error_code: errorCode,
    p_retryable: retryable,
    p_provider_called: providerCalled,
  })
}

async function failTaxonomyJobs(client, jobs, errorCode, retryable, providerCalled) {
  let failed = 0
  for (const job of jobs) {
    await failTaxonomyJob(client, job, errorCode, retryable, providerCalled)
    failed += 1
  }
  return failed
}

function safeVisualErrorCode(error) {
  const value = typeof error?.code === 'string' ? error.code : 'visual_semantic_worker_error'
  const normalized = value.toLowerCase().replace(/[^a-z0-9_:-]+/gu, '_').slice(0, 100)
  return normalized.length >= 2 ? normalized : 'visual_semantic_worker_error'
}

async function failVisualJob(client, job, errorCode, retryable, providerCallCount) {
  return client.rpc('fail_video_semantic_visual_v1', {
    p_video_id: job.video_id,
    p_visual_source_fingerprint: job.visual_source_fingerprint,
    p_error_code: errorCode,
    p_retryable: retryable,
    p_provider_call_count: providerCallCount,
  })
}

export function createSemanticWorkerHandler({
  serviceRoleKey,
  supabaseUrl,
  cloudflareAccountId,
  cloudflareApiToken,
  createAdminClient,
  fetchImpl = fetch,
  getObjectBytes,
  isR2Transient,
  streamCustomerCode,
  processVisualJob = processVisualSemanticJob,
}) {
  return async function handle(request) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
    if (!serviceRoleKey || !secretsEqual(bearer(request), serviceRoleKey)) {
      return json({ error: 'unauthorized' }, 401)
    }

    let body
    try { body = asObject(await request.json()) } catch { return json({ error: 'invalid_json' }, 400) }
    const mode = body.mode
    if (mode === 'status') {
      if (!supabaseUrl || !cloudflareAccountId || !cloudflareApiToken) {
        return json({ error: 'semantic_worker_configuration_missing' }, 503)
      }
      return json({
        status: 'ready',
        provider: SEMANTIC_PROVIDER,
        model: SEMANTIC_MODEL,
        embedding_dimensions: EMBEDDING_DIMENSIONS,
        default_batch_size: DEFAULT_BATCH_SIZE,
        max_batch_size: MAX_BATCH_SIZE,
      })
    }
    if (mode === 'process_visual') {
      const limit = body.limit === undefined ? DEFAULT_VISUAL_BATCH_SIZE : Number(body.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_VISUAL_BATCH_SIZE) {
        return json({ error: 'invalid_visual_batch_limit' }, 400)
      }
      if (!supabaseUrl || !cloudflareAccountId || !cloudflareApiToken ||
          typeof createAdminClient !== 'function' || typeof processVisualJob !== 'function') {
        return json({ error: 'semantic_worker_configuration_missing' }, 503)
      }

      const client = createAdminClient(supabaseUrl, serviceRoleKey)
      const claim = await client.rpc('claim_video_semantic_visual_v1', { p_limit: limit })
      if (claim.error) return json({ error: 'visual_semantic_claim_failed' }, 502)
      const jobs = Array.isArray(claim.data) ? claim.data : []
      if (jobs.length > limit || jobs.length > MAX_VISUAL_BATCH_SIZE) {
        return json({ error: 'visual_semantic_claim_contract_invalid' }, 502)
      }

      let completed = 0
      let failed = 0
      let stale = 0
      for (const job of jobs) {
        try {
          const result = await processVisualJob(job, {
            token: cloudflareApiToken,
            accountId: cloudflareAccountId,
            fetchImpl,
            getObjectBytes,
            isR2Transient,
            streamCustomerCode,
          })
          const completion = await client.rpc('complete_video_semantic_visual_v1', {
            p_video_id: job.video_id,
            p_visual_source_fingerprint: job.visual_source_fingerprint,
            p_visual_semantic_text: result.visualSemanticText,
            p_frame_timestamps_ms: result.frameTimestampsMs,
            p_provider_call_count: result.providerCallCount,
          })
          if (completion.error) {
            await failVisualJob(
              client,
              job,
              'visual_completion_rpc_error',
              true,
              Number.isInteger(result.providerCallCount) ? result.providerCallCount : 0,
            )
            failed += 1
          } else if (completion.data?.status === 'stale') {
            stale += 1
          } else {
            completed += 1
          }
        } catch (error) {
          const providerCallCount = Number.isInteger(error?.providerCallCount)
            ? error.providerCallCount
            : error?.providerCalled ? 1 : 0
          await failVisualJob(
            client,
            job,
            safeVisualErrorCode(error),
            Boolean(error?.retryable),
            providerCallCount,
          )
          failed += 1
        }
      }
      return json({ status: 'visual_processed', claimed: jobs.length, completed, failed, stale })
    }
    if (mode === 'process_taxonomy') {
      const limit = body.limit === undefined ? DEFAULT_BATCH_SIZE : Number(body.limit)
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
        return json({ error: 'invalid_taxonomy_batch_limit' }, 400)
      }
      if (!supabaseUrl || !cloudflareAccountId || !cloudflareApiToken ||
          typeof createAdminClient !== 'function') {
        return json({ error: 'semantic_worker_configuration_missing' }, 503)
      }

      const client = createAdminClient(supabaseUrl, serviceRoleKey)
      const claim = await client.rpc('claim_personalization_taxonomy_embedding_jobs_v1', {
        p_limit: limit,
      })
      if (claim.error) return json({ error: 'taxonomy_semantic_claim_failed' }, 502)
      const jobs = Array.isArray(claim.data) ? claim.data : []
      if (jobs.length === 0) {
        return json({ status: 'taxonomy_processed', claimed: 0, completed: 0, failed: 0, stale: 0 })
      }
      if (jobs.length > limit || jobs.length > MAX_BATCH_SIZE) {
        return json({ error: 'taxonomy_semantic_claim_contract_invalid' }, 502)
      }

      const validJobs = []
      let failed = 0
      for (const job of jobs) {
        if (validTaxonomyJob(job)) validJobs.push(job)
        else {
          await failTaxonomyJob(client, job, 'invalid_claim_payload', false, false)
          failed += 1
        }
      }
      if (validJobs.length === 0) {
        return json({ status: 'taxonomy_processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
      }

      let response
      try {
        response = await fetchImpl(
          `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/${SEMANTIC_MODEL}`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${cloudflareApiToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ text: validJobs.map(job => job.input_text) }),
          },
        )
      } catch {
        failed += await failTaxonomyJobs(client, validJobs, 'provider_network_error', true, true)
        return json({ status: 'taxonomy_processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
      }

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 425 ||
          response.status === 429 || response.status >= 500
        failed += await failTaxonomyJobs(
          client,
          validJobs,
          `provider_http_${response.status}`,
          retryable,
          true,
        )
        return json({ status: 'taxonomy_processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
      }

      let embeddings
      try {
        embeddings = validateEmbeddingResponse(await response.json(), validJobs.length)
      } catch {
        failed += await failTaxonomyJobs(client, validJobs, 'invalid_embedding_response', false, true)
        return json({ status: 'taxonomy_processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
      }

      let completed = 0
      let stale = 0
      for (let index = 0; index < validJobs.length; index += 1) {
        const job = validJobs[index]
        const completion = await client.rpc('complete_personalization_taxonomy_embedding_job_v1', {
          p_interest_id: job.interest_id,
          p_embedding_fingerprint: job.embedding_fingerprint,
          p_embedding: embeddings[index],
        })
        if (completion.error) {
          await failTaxonomyJob(client, job, 'completion_rpc_error', true, true)
          failed += 1
        } else if (completion.data?.status === 'stale') {
          stale += 1
        } else {
          completed += 1
        }
      }
      return json({ status: 'taxonomy_processed', claimed: jobs.length, completed, failed, stale })
    }
    if (mode !== 'process') return json({ error: 'invalid_mode' }, 400)

    const limit = body.limit === undefined ? DEFAULT_BATCH_SIZE : Number(body.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
      return json({ error: 'invalid_batch_limit' }, 400)
    }
    if (!supabaseUrl || !cloudflareAccountId || !cloudflareApiToken ||
        typeof createAdminClient !== 'function') {
      return json({ error: 'semantic_worker_configuration_missing' }, 503)
    }

    const client = createAdminClient(supabaseUrl, serviceRoleKey)
    const claim = await client.rpc('claim_video_semantic_profiles_v1', { p_limit: limit })
    if (claim.error) return json({ error: 'semantic_claim_failed' }, 502)
    const jobs = Array.isArray(claim.data) ? claim.data : []
    if (jobs.length === 0) {
      return json({ status: 'processed', claimed: 0, completed: 0, failed: 0, stale: 0 })
    }
    if (jobs.length > limit || jobs.length > MAX_BATCH_SIZE) {
      return json({ error: 'semantic_claim_contract_invalid' }, 502)
    }

    const validJobs = []
    let failed = 0
    for (const job of jobs) {
      if (validJob(job)) validJobs.push(job)
      else {
        await failJob(client, job, 'invalid_claim_payload', false, false)
        failed += 1
      }
    }
    if (validJobs.length === 0) {
      return json({ status: 'processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
    }

    let response
    try {
      response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/${SEMANTIC_MODEL}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${cloudflareApiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ text: validJobs.map(job => job.input_text) }),
        },
      )
    } catch {
      failed += await failJobs(client, validJobs, 'provider_network_error', true, true)
      return json({ status: 'processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
    }

    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 425 ||
        response.status === 429 || response.status >= 500
      failed += await failJobs(
        client,
        validJobs,
        `provider_http_${response.status}`,
        retryable,
        true,
      )
      return json({ status: 'processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
    }

    let embeddings
    try {
      const providerPayload = await response.json()
      embeddings = validateEmbeddingResponse(providerPayload, validJobs.length)
    } catch {
      failed += await failJobs(client, validJobs, 'invalid_embedding_response', false, true)
      return json({ status: 'processed', claimed: jobs.length, completed: 0, failed, stale: 0 })
    }

    let completed = 0
    let stale = 0
    for (let index = 0; index < validJobs.length; index += 1) {
      const job = validJobs[index]
      const completion = await client.rpc('complete_video_semantic_profile_v1', {
        p_video_id: job.video_id,
        p_semantic_input_fingerprint: job.semantic_input_fingerprint,
        p_embedding: embeddings[index],
      })
      if (completion.error) {
        await failJob(client, job, 'completion_rpc_error', true, true)
        failed += 1
      } else if (completion.data?.status === 'stale') {
        stale += 1
      } else {
        completed += 1
      }
    }
    return json({ status: 'processed', claimed: jobs.length, completed, failed, stale })
  }
}
