import { parseStoryInteractiveDefinition, type StoryInteractiveDefinition } from '@/components/feature/storyInteractiveTypes';
import { getSupabaseClient } from '@/template';

export type StoryAnalyticsEventType = 'impression' | 'completion' | 'forward' | 'back' | 'exit' | 'replay';
export type StoryQuestionModerationAction = 'hide' | 'block' | 'inspect';
export type StoryQuestionModerationState = 'pending' | 'hidden' | 'blocked';
export type StoryInteractivePayload =
  | { option_id: string }
  | { value: number }
  | { text: string }
  | { emoji: string };

export interface StoryInteractiveAggregate {
  total: number;
  options?: Record<string, number>;
  average?: number | null;
}

export interface StoryInteractiveOwnResponse {
  payload: StoryInteractivePayload;
  moderationState: 'not_applicable' | StoryQuestionModerationState;
}

export interface StoryInteractiveElementState {
  elementId: string;
  definition: StoryInteractiveDefinition;
  revision: number;
  response: StoryInteractiveOwnResponse | null;
  aggregate: StoryInteractiveAggregate | null;
  correctOptionId: string | null;
}

export interface StoryInteractiveState {
  storyId: string;
  elements: StoryInteractiveElementState[];
}

export interface StoryInteractiveResultsCursor {
  createdAt: string;
  respondentId: string;
}

export interface StoryInteractiveResultResponse {
  respondentId: string;
  payload: { text: string };
  moderationState: StoryQuestionModerationState;
  createdAt: string;
}

export interface StoryInteractiveResultsPage {
  aggregate: StoryInteractiveAggregate;
  responses: StoryInteractiveResultResponse[];
  analytics: Record<string, number>;
  hasMore: boolean;
  nextCursor: StoryInteractiveResultsCursor | null;
}

export type StoryInteractiveResultCursor = StoryInteractiveResultsCursor;
export type StoryQuestionResponseRecord = StoryInteractiveResultResponse;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODERATION_STATES = new Set(['not_applicable', 'pending', 'hidden', 'blocked']);
const QUESTION_STATES = new Set<StoryQuestionModerationState>(['pending', 'hidden', 'blocked']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function invalidResponse(): never {
  throw new Error('STORY_INTERACTIVE_INVALID_RESPONSE');
}

function requestFailure(): never {
  throw new Error('STORY_INTERACTIVE_REQUEST_FAILED');
}

function parsePayload(value: unknown): StoryInteractivePayload | null {
  if (!record(value)) return null;
  if (exactKeys(value, ['option_id']) && typeof value.option_id === 'string') {
    return { option_id: value.option_id };
  }
  if (exactKeys(value, ['value']) && typeof value.value === 'number'
    && Number.isFinite(value.value) && value.value >= 0 && value.value <= 1) {
    return { value: value.value };
  }
  if (exactKeys(value, ['text']) && typeof value.text === 'string'
    && value.text.length >= 1 && value.text.length <= 500) {
    return { text: value.text };
  }
  if (exactKeys(value, ['emoji']) && typeof value.emoji === 'string' && value.emoji.length <= 16) {
    return { emoji: value.emoji };
  }
  return null;
}

function parseAggregate(value: unknown, definition?: StoryInteractiveDefinition): StoryInteractiveAggregate | null {
  if (!record(value) || !nonNegativeInteger(value.total)) return null;
  if (definition?.type === 'poll' || definition?.type === 'quiz') {
    if (!exactKeys(value, ['total', 'options']) || !record(value.options)) return null;
    const options: Record<string, number> = {};
    for (const [key, count] of Object.entries(value.options)) {
      if (!definition.options.some(option => option.id === key) || !nonNegativeInteger(count)) return null;
      options[key] = count;
    }
    return { total: value.total, options };
  }
  if (definition?.type === 'slider') {
    if (!exactKeys(value, ['total', 'average'])
      || (value.average !== null && (typeof value.average !== 'number'
        || !Number.isFinite(value.average) || value.average < 0 || value.average > 1))) return null;
    return { total: value.total, average: value.average as number | null };
  }
  if (!definition && exactKeys(value, ['total', 'options']) && record(value.options)) {
    const options: Record<string, number> = {};
    for (const [key, count] of Object.entries(value.options)) {
      if (!key || !nonNegativeInteger(count)) return null;
      options[key] = count;
    }
    return { total: value.total, options };
  }
  if (!definition && exactKeys(value, ['total', 'average'])
    && (value.average === null || (typeof value.average === 'number'
      && Number.isFinite(value.average) && value.average >= 0 && value.average <= 1))) {
    return { total: value.total, average: value.average as number | null };
  }
  return exactKeys(value, ['total']) ? { total: value.total } : null;
}

function parseElementState(value: unknown): StoryInteractiveElementState | null {
  if (!record(value) || !exactKeys(value, [
    'element_id', 'definition', 'revision', 'response', 'aggregate', 'correct_option_id',
  ]) || !uuid(value.element_id) || !nonNegativeInteger(value.revision)) return null;
  const definition = parseStoryInteractiveDefinition(value.definition);
  if (!definition || definition.element_id !== value.element_id) return null;

  let response: StoryInteractiveOwnResponse | null = null;
  if (value.response !== undefined) {
    if (!record(value.response) || !exactKeys(value.response, ['payload', 'moderation_state'])
      || typeof value.response.moderation_state !== 'string'
      || !MODERATION_STATES.has(value.response.moderation_state)) return null;
    const payload = parsePayload(value.response.payload);
    if (!payload) return null;
    response = {
      payload,
      moderationState: value.response.moderation_state as StoryInteractiveOwnResponse['moderationState'],
    };
  }

  const aggregate = value.aggregate === undefined ? null : parseAggregate(value.aggregate, definition);
  if (value.aggregate !== undefined && !aggregate) return null;
  let correctOptionId: string | null = null;
  if (value.correct_option_id !== undefined) {
    if (definition.type !== 'quiz' || typeof value.correct_option_id !== 'string'
      || !definition.options.some(option => option.id === value.correct_option_id)) return null;
    correctOptionId = value.correct_option_id;
  }
  return { elementId: value.element_id, definition, revision: value.revision, response, aggregate, correctOptionId };
}

export function parseStoryInteractiveState(value: unknown): StoryInteractiveState {
  if (!record(value) || !exactKeys(value, ['story_id', 'elements'])
    || !uuid(value.story_id) || !Array.isArray(value.elements) || value.elements.length > 32) invalidResponse();
  const elements = value.elements.map(parseElementState);
  if (elements.some(element => element === null)) invalidResponse();
  const ids = new Set(elements.map(element => element!.elementId));
  if (ids.size !== elements.length) invalidResponse();
  return { storyId: value.story_id, elements: elements as StoryInteractiveElementState[] };
}

function parseResultsPage(value: unknown): StoryInteractiveResultsPage {
  if (!record(value) || !exactKeys(value, ['aggregate', 'responses', 'analytics', 'has_more', 'next_cursor'])
    || !Array.isArray(value.responses) || !record(value.analytics) || typeof value.has_more !== 'boolean') invalidResponse();
  const aggregate = parseAggregate(value.aggregate);
  if (!aggregate) invalidResponse();
  const responses: StoryInteractiveResultResponse[] = [];
  for (const item of value.responses) {
    if (!record(item) || !exactKeys(item, ['respondent_id', 'payload', 'moderation_state', 'created_at'])
      || !uuid(item.respondent_id) || !record(item.payload) || !exactKeys(item.payload, ['text'])
      || typeof item.payload.text !== 'string' || item.payload.text.length < 1 || item.payload.text.length > 500
      || typeof item.moderation_state !== 'string' || !QUESTION_STATES.has(item.moderation_state as StoryQuestionModerationState)
      || typeof item.created_at !== 'string' || !Number.isFinite(Date.parse(item.created_at))) invalidResponse();
    responses.push({ respondentId: item.respondent_id, payload: { text: item.payload.text },
      moderationState: item.moderation_state as StoryQuestionModerationState, createdAt: item.created_at });
  }
  const analytics: Record<string, number> = {};
  for (const [key, count] of Object.entries(value.analytics)) {
    if (!/^(impression|completion|forward|back|exit|replay)$/.test(key) || !nonNegativeInteger(count)) invalidResponse();
    analytics[key] = count;
  }
  let nextCursor: StoryInteractiveResultsCursor | null = null;
  if (value.next_cursor !== null) {
    if (!record(value.next_cursor) || !exactKeys(value.next_cursor, ['created_at', 'respondent_id'])
      || typeof value.next_cursor.created_at !== 'string' || !Number.isFinite(Date.parse(value.next_cursor.created_at))
      || !uuid(value.next_cursor.respondent_id)) invalidResponse();
    nextCursor = { createdAt: value.next_cursor.created_at, respondentId: value.next_cursor.respondent_id };
  }
  if (value.has_more !== (nextCursor !== null)) invalidResponse();
  return { aggregate, responses, analytics, hasMore: value.has_more, nextCursor };
}

export async function getStoryInteractiveState(storyId: string): Promise<StoryInteractiveState> {
  const { data, error } = await getSupabaseClient().rpc('get_story_interactive_state', { p_story_id: storyId });
  if (error) requestFailure();
  return parseStoryInteractiveState(data);
}

export const loadStoryInteractiveState = getStoryInteractiveState;

export async function respondToStoryElement(input: {
  storyId: string;
  elementId: string;
  idempotencyKey: string;
  payload: StoryInteractivePayload;
}): Promise<{ storyId: string; elementId: string; revision: number }> {
  const { data, error } = await getSupabaseClient().rpc('respond_to_story_element', {
    p_story_id: input.storyId,
    p_element_id: input.elementId,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload,
  });
  if (error) requestFailure();
  if (!record(data) || !exactKeys(data, ['story_id', 'element_id', 'status', 'revision'])
    || data.story_id !== input.storyId || data.element_id !== input.elementId
    || data.status !== 'recorded' || !nonNegativeInteger(data.revision)) invalidResponse();
  return { storyId: data.story_id, elementId: data.element_id, revision: data.revision };
}

export async function getStoryInteractiveResults(input: {
  storyId: string;
  elementId: string;
  limit?: number;
  cursor?: StoryInteractiveResultsCursor | null;
}): Promise<StoryInteractiveResultsPage> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const { data, error } = await getSupabaseClient().rpc('get_story_interactive_results', {
    p_story_id: input.storyId,
    p_element_id: input.elementId,
    p_limit: limit,
    p_before_created_at: input.cursor?.createdAt ?? null,
    p_before_respondent_id: input.cursor?.respondentId ?? null,
  });
  if (error) requestFailure();
  return parseResultsPage(data);
}

export const loadStoryInteractiveResults = getStoryInteractiveResults;

export async function moderateStoryQuestion(input: {
  storyId: string;
  elementId: string;
  respondentId: string;
  action: StoryQuestionModerationAction;
}): Promise<StoryQuestionModerationState | 'inspected'> {
  const { data, error } = await getSupabaseClient().rpc('moderate_story_question', {
    p_story_id: input.storyId,
    p_element_id: input.elementId,
    p_respondent_id: input.respondentId,
    p_action: input.action,
  });
  if (error) requestFailure();
  if (!record(data) || typeof data.status !== 'string') invalidResponse();
  if (data.status === 'pending' && input.action === 'inspect') return 'inspected';
  if (!QUESTION_STATES.has(data.status as StoryQuestionModerationState)) invalidResponse();
  return data.status as StoryQuestionModerationState;
}

export async function recordStoryEvent(
  storyId: string,
  eventType: StoryAnalyticsEventType,
  eventId: string,
): Promise<void> {
  const { data, error } = await getSupabaseClient().rpc('record_story_event', {
    p_story_id: storyId,
    p_event_type: eventType,
    p_event_id: eventId,
  });
  if (error) requestFailure();
  if (!record(data) || !exactKeys(data, ['status', 'event_id'])
    || (data.status !== 'recorded' && data.status !== 'owner_ignored')
    || data.event_id !== eventId) invalidResponse();
}
