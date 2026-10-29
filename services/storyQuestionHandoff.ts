import { randomUUID } from 'expo-crypto';
import { createStoryQuestionHandoffStore } from './storyQuestionHandoffRuntime.mjs';

/** The sole application-memory adapter. Never persist or serialize its private payloads. */
export const storyQuestionHandoffs = createStoryQuestionHandoffStore({ randomUUID });
export type {
  StoryQuestionAnswerCard, StoryQuestionReplySource, StoryQuestionReplyPayload,
} from './storyQuestionHandoffRuntime.mjs';
