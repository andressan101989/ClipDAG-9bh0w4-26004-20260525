export interface StoryQuestionAnswerCard {
  id: string;
  type: 'question_answer';
  x: number;
  y: number;
  scale: number;
  rotation: number;
  question: string;
  answer: string;
}

/** Private authoritative response tuple. Never include it in public cards or routes. */
export interface StoryQuestionReplySource {
  storyId: string;
  elementId: string;
  respondentId: string;
}

export interface StoryQuestionReplyPayload {
  source: StoryQuestionReplySource;
  question: string;
  answer: string;
}

export interface StoryQuestionHandoffRouteParams {
  handoffToken: string;
}

export interface StoryQuestionHandoffStore {
  issueStoryReply(input: { actorId: string } & StoryQuestionReplyPayload): StoryQuestionHandoffRouteParams | null;
  issueChatDraft(input: { actorId: string; recipientId: string; text: string }): StoryQuestionHandoffRouteParams | null;
  consumeStoryReply(token: unknown, actorId: unknown): StoryQuestionReplyPayload | null;
  consumeChatDraft(token: unknown, actorId: unknown, recipientId: unknown): { text: string } | null;
}

export function createStoryQuestionHandoffStore(options: {
  /** Use a cryptographically secure v4 UUID generator, e.g. expo-crypto randomUUID. */
  randomUUID: () => string;
  now?: () => number;
  /** Positive, finite expiry, at most five minutes; defaults to five minutes. */
  ttlMs?: number;
}): StoryQuestionHandoffStore;

/** Draft only: a blank answer is allowed until the creator writes it. */
export function buildStoryQuestionAnswerSeed(input: unknown, options: { randomUUID: () => string }): StoryQuestionAnswerCard | null;

/** Final publication requires non-empty question and answer, each at most 500 code points. */
export function parseStoryQuestionAnswerCard(input: unknown): StoryQuestionAnswerCard | null;
