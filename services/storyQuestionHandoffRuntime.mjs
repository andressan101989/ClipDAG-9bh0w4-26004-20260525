const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RANDOM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TTL_MS = 5 * 60 * 1000;
// Never recycle an opaque route in one process; fail closed at the bounded session budget.
const MAX_ISSUED_TOKENS = 4_096;
const CARD_KEYS = ['id', 'type', 'x', 'y', 'scale', 'rotation', 'question', 'answer'];

function exactRecord(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key)
    && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}

function uuid(value) {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function publicText(value, allowEmpty = false) {
  // Inspect before trim, so leading/trailing controls cannot evade rejection.
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f<>]/u.test(value)) return null;
  const text = value.trim();
  return ((!text && !allowEmpty) || [...text].length > 500) ? null : text;
}

function range(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Final public projection: no source tuple or arbitrary metadata is accepted. */
export function parseStoryQuestionAnswerCard(value) {
  if (!exactRecord(value, CARD_KEYS) || value.type !== 'question_answer') return null;
  const id = uuid(value.id);
  const question = publicText(value.question);
  const answer = publicText(value.answer);
  if (!id || question === null || answer === null || !range(value.x, 0, 1) || !range(value.y, 0, 1)
    || !range(value.scale, 0.5, 4) || !range(value.rotation, -180, 180)) return null;
  return { id, type: 'question_answer', x: value.x, y: value.y, scale: value.scale,
    rotation: value.rotation, question, answer };
}

/** Editor-only seed may have a blank answer; publication must use the strict parser. */
export function buildStoryQuestionAnswerSeed(value, { randomUUID }) {
  if (!exactRecord(value, ['question', 'answer'])) return null;
  const question = publicText(value.question);
  const answer = publicText(value.answer, true);
  if (question === null || answer === null) return null;
  const id = randomUUID();
  if (typeof id !== 'string' || !RANDOM_UUID.test(id)) return null;
  return { id: id.toLowerCase(), type: 'question_answer', x: 0.5, y: 0.5, scale: 1, rotation: 0,
    question, answer };
}

function parseSource(value) {
  if (!exactRecord(value, ['storyId', 'elementId', 'respondentId'])) return null;
  const storyId = uuid(value.storyId);
  const elementId = uuid(value.elementId);
  const respondentId = uuid(value.respondentId);
  return storyId && elementId && respondentId ? { storyId, elementId, respondentId } : null;
}

/**
 * App-memory handoffs only. Supply expo-crypto's randomUUID from the shared app adapter.
 * Never persist this store or put its payloads in routes, logs, or public composition.
 */
export function createStoryQuestionHandoffStore({ randomUUID, now = Date.now, ttlMs = MAX_TTL_MS }) {
  if (typeof randomUUID !== 'function' || typeof now !== 'function'
    || !range(ttlMs, Number.MIN_VALUE, MAX_TTL_MS)) throw new Error('HANDOFF_INVALID_OPTIONS');
  const entries = new Map();
  // Retain only spent token identities, never their payloads, to reject accidental UUID reuse.
  const issuedTokens = new Set();

  function time() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) return null;
    for (const [token, entry] of entries) {
      if (timestamp >= entry.expiresAt) entries.delete(token);
    }
    return timestamp;
  }

  function issue(actorId, purpose, recipientId, payload) {
    const timestamp = time();
    if (timestamp === null || !Number.isFinite(timestamp + ttlMs)
      || issuedTokens.size >= MAX_ISSUED_TOKENS) return null;
    const token = randomUUID();
    if (typeof token !== 'string' || !RANDOM_UUID.test(token)) return null;
    const normalizedToken = token.toLowerCase();
    if (issuedTokens.has(normalizedToken)) return null;
    issuedTokens.add(normalizedToken);
    entries.set(normalizedToken, { actorId, purpose, recipientId, payload, expiresAt: timestamp + ttlMs });
    return { handoffToken: normalizedToken };
  }

  function consume(token, actorInput, purpose, recipientInput = null) {
    if (typeof token !== 'string' || !RANDOM_UUID.test(token)) return null;
    const actorId = uuid(actorInput);
    const recipientId = recipientInput === null ? null : uuid(recipientInput);
    if (!actorId || (purpose === 'chat_draft' && !recipientId) || time() === null) return null;
    const normalizedToken = token.toLowerCase();
    const entry = entries.get(normalizedToken);
    if (!entry || entry.actorId !== actorId || entry.purpose !== purpose || entry.recipientId !== recipientId) return null;
    entries.delete(normalizedToken);
    return entry.payload;
  }

  return {
    issueStoryReply(value) {
      if (!exactRecord(value, ['actorId', 'source', 'question', 'answer'])) return null;
      const actorId = uuid(value.actorId);
      const source = parseSource(value.source);
      const question = publicText(value.question);
      const answer = publicText(value.answer, true);
      return actorId && source && question !== null && answer !== null
        ? issue(actorId, 'story_reply', null, { source, question, answer }) : null;
    },
    issueChatDraft(value) {
      if (!exactRecord(value, ['actorId', 'recipientId', 'text'])) return null;
      const actorId = uuid(value.actorId);
      const recipientId = uuid(value.recipientId);
      const text = publicText(value.text);
      return actorId && recipientId && text !== null
        ? issue(actorId, 'chat_draft', recipientId, { text }) : null;
    },
    consumeStoryReply(token, actorId) {
      return consume(token, actorId, 'story_reply');
    },
    consumeChatDraft(token, actorId, recipientId) {
      return consume(token, actorId, 'chat_draft', recipientId);
    },
  };
}
