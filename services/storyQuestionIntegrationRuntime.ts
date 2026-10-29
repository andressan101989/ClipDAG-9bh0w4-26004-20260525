import {
  buildStoryQuestionAnswerSeed, parseStoryQuestionAnswerCard,
  type StoryQuestionAnswerCard, type StoryQuestionHandoffStore, type StoryQuestionReplyPayload,
} from './storyQuestionHandoffRuntime.mjs';
import type { StoryComposition, StoryCompositionElement } from '../components/feature/storyInteractiveTypes';

/** Session identity belongs to the editor, so re-renders and failed publication keep the same draft. */
export class StoryQuestionEditorSession {
  private source: unknown = null;
  private seed: StoryQuestionAnswerCard | null = null;
  clientStoryId: string | null = null;
  constructor(private readonly randomUUID: () => string) {}

  initialize(visible: boolean, source: unknown, seed: StoryQuestionAnswerCard | null) {
    if (!visible || !source) { this.source = null; this.seed = null; return null; }
    if (this.source === source) return null;
    this.source = source;
    this.seed = seed ? { ...seed } : null;
    this.clientStoryId = this.randomUUID();
    const composition: StoryComposition = this.seed
      ? { version: 2, elements: [{ ...this.seed }] }
      : { version: 1, elements: [] };
    return { composition, clientStoryId: this.clientStoryId, selectedId: this.seed?.id ?? null };
  }

  updateCard(current: StoryQuestionAnswerCard, next: StoryQuestionAnswerCard): StoryQuestionAnswerCard {
    return { id: current.id, type: 'question_answer', question: this.seed?.question ?? current.question,
      answer: next.answer, x: next.x, y: next.y, scale: next.scale, rotation: next.rotation };
  }

  validate(composition: { elements: StoryCompositionElement[] }): boolean {
    if (!this.seed) return true;
    const cards = composition.elements.filter(element => element.type === 'question_answer');
    return cards.length === 1 && cards[0].id === this.seed.id
      && cards[0].question === this.seed.question && parseStoryQuestionAnswerCard(cards[0]) !== null;
  }
}

export interface StoryQuestionMediaTicket { generation: number; actorId: string | null }
export type StoryQuestionFeedReply = StoryQuestionReplyPayload & { seed: StoryQuestionAnswerCard };

/** Feed owns this local private session; asynchronous media completions must present its ticket. */
export class StoryQuestionFeedSession {
  private actorId: string | null = null;
  private generation = 0;
  private readonly seen = new Set<string>();
  reply: StoryQuestionFeedReply | null = null;
  constructor(private readonly store: StoryQuestionHandoffStore, private readonly randomUUID: () => string) {}

  setActor(actorId: string | null) {
    if (this.actorId === actorId) return;
    this.clear();
    this.actorId = actorId;
  }
  clear() { this.reply = null; this.generation += 1; }
  beginMedia(): StoryQuestionMediaTicket {
    this.generation += 1;
    return { generation: this.generation, actorId: this.actorId };
  }
  isCurrent(ticket: StoryQuestionMediaTicket) {
    return ticket.generation === this.generation && ticket.actorId !== null && ticket.actorId === this.actorId;
  }
  receive(token: unknown, actorId: string | null, focused: boolean, occupied: boolean) {
    if (!actorId || !focused) return { status: 'waiting' as const };
    if (actorId !== this.actorId || typeof token !== 'string') return { status: 'invalid' as const };
    if (this.seen.has(token)) return { status: 'duplicate' as const };
    if (occupied || this.reply) return { status: 'occupied' as const };
    this.seen.add(token);
    const payload = this.store.consumeStoryReply(token, actorId);
    if (!payload) return { status: 'invalid' as const };
    const seed = buildStoryQuestionAnswerSeed({ question: payload.question, answer: payload.answer }, { randomUUID: this.randomUUID });
    if (!seed) return { status: 'invalid' as const };
    this.reply = { ...payload, seed };
    return { status: 'ready' as const, ticket: this.beginMedia() };
  }
}

/** Draft-only consumption: no send, typing, conversation, media or network capability exists here. */
export class StoryQuestionChatDraftSession {
  private actorId: string | null = null;
  private recipientId: string | null = null;
  private readonly seen = new Set<string>();
  pendingText: string | null = null;
  constructor(private readonly store: StoryQuestionHandoffStore) {}
  setIdentity(actorId: string | null, recipientId: string | null) {
    if (this.actorId !== actorId || this.recipientId !== recipientId) this.pendingText = null;
    this.actorId = actorId;
    this.recipientId = recipientId;
  }
  receive(token: unknown, actorId: string | null, recipientId: string | null, text: string, voiceBusy: boolean) {
    if (!actorId || !recipientId) return { status: 'waiting' as const };
    if (actorId !== this.actorId || recipientId !== this.recipientId || typeof token !== 'string') return { status: 'invalid' as const };
    if (this.seen.has(token)) return { status: 'duplicate' as const };
    // Keep an earlier pending reply until explicit insertion; do not consume/discard a later token.
    if (this.pendingText !== null) return { status: 'occupied' as const };
    this.seen.add(token);
    const payload = this.store.consumeChatDraft(token, actorId, recipientId);
    if (!payload) return { status: 'invalid' as const };
    if (text.length > 0 || voiceBusy) {
      this.pendingText = payload.text;
      return { status: 'pending' as const };
    }
    return { status: 'ready' as const, text: payload.text };
  }
  insert(text: string, voiceBusy: boolean) {
    if (this.pendingText === null || voiceBusy) return null;
    const next = text ? `${text}\n${this.pendingText}` : this.pendingText;
    if (next.length > 1000) return null;
    this.pendingText = null;
    return { text: next };
  }
}
