import { parseStoryQuestionAnswerCard, type StoryQuestionReplySource } from './storyQuestionHandoffRuntime.mjs';
import type { StoryComposition, StoryInteractiveSubmissionDefinition } from '../components/feature/storyInteractiveTypes';

interface QuestionAnswerRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface StoryQuestionAnswerInput {
  source: StoryQuestionReplySource;
  mediaAssetId: string;
  composition: StoryComposition;
  clientStoryId: string;
  interactiveDefinitions?: StoryInteractiveSubmissionDefinition[];
}
export interface PreparedStoryQuestionAnswer { question: string; respondentId: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)
    && Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function sourceArgs(source: StoryQuestionReplySource) {
  if (!exactRecord(source, ['storyId', 'elementId', 'respondentId'])
    || !uuid(source.storyId) || !uuid(source.elementId) || !uuid(source.respondentId)) throw new Error('STORY_QA_INVALID_SOURCE');
  return { p_source_story_id: source.storyId, p_source_element_id: source.elementId, p_respondent_id: source.respondentId };
}
async function request(client: QuestionAnswerRpcClient, name: string, args: Record<string, unknown>) {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error();
    return data;
  } catch { throw new Error('STORY_QA_REQUEST_FAILED'); }
}

export async function prepareStoryQuestionAnswerWithClient(
  client: QuestionAnswerRpcClient, source: StoryQuestionReplySource,
): Promise<PreparedStoryQuestionAnswer> {
  const data = await request(client, 'prepare_story_question_answer', sourceArgs(source));
  if (!exactRecord(data, ['question', 'respondent_id']) || !uuid(data.respondent_id)
    || data.respondent_id.toLowerCase() !== source.respondentId.toLowerCase()) throw new Error('STORY_QA_INVALID_RESPONSE');
  // Delegate public text validation to the same parser used by editor/public composition.
  const card = parseStoryQuestionAnswerCard({ id: data.respondent_id, type: 'question_answer', x: .5, y: .5,
    scale: 1, rotation: 0, question: data.question, answer: 'validation' });
  if (!card || card.question !== data.question) throw new Error('STORY_QA_INVALID_RESPONSE');
  return { question: card.question, respondentId: data.respondent_id.toLowerCase() };
}

export async function createStoryQuestionAnswerWithClient(
  client: QuestionAnswerRpcClient, input: StoryQuestionAnswerInput,
): Promise<string> {
  const data = await request(client, 'create_story_question_answer_with_media', {
    ...sourceArgs(input.source), p_asset_id: input.mediaAssetId, p_composition: input.composition,
    p_client_story_id: input.clientStoryId, p_interactive_definitions: input.interactiveDefinitions ?? [],
  });
  if (!uuid(data)) throw new Error('STORY_QA_INVALID_RESPONSE');
  return data.toLowerCase();
}
