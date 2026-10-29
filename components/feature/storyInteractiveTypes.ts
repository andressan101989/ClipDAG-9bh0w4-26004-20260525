import { parseStoryQuestionAnswerCard, type StoryQuestionAnswerCard } from '../../services/storyQuestionHandoffRuntime.mjs';
export type { StoryQuestionAnswerCard } from '../../services/storyQuestionHandoffRuntime.mjs';

export type StoryInteractiveKind = 'poll' | 'slider' | 'quiz' | 'question' | 'reaction';
export type StoryTextSize = 'small' | 'medium' | 'large';
export type StoryTextColor = '#FFFFFF' | '#111111' | '#FF2D78' | '#7C5CFF' | '#00D4FF' | '#FFD60A';
export type StoryStickerValue = '❤️' | '😂' | '😮' | '😢' | '🔥' | '👏' | '✨' | '⭐' | '💯' | '🎉' | '😍';
export interface StoryInteractiveOption { id: string; label: string }

export interface StoryElementBase {
  id: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface StoryTextElement extends StoryElementBase {
  type: 'text';
  text: string;
  color: StoryTextColor;
  align: 'left' | 'center' | 'right';
  size: StoryTextSize;
}

export interface StoryStickerElement extends StoryElementBase {
  type: 'sticker';
  value: StoryStickerValue;
}

interface StoryInteractiveDefinitionBase {
  version: 1;
  element_id: string;
  prompt: string;
}

// Public configuration only. Answers, responses and aggregates come from authorized RPCs.
export type StoryInteractiveDefinition = StoryInteractiveDefinitionBase & (
  | { type: 'poll' | 'quiz'; options: StoryInteractiveOption[] }
  | { type: 'slider' | 'reaction'; emoji: StoryStickerValue }
  | { type: 'question' }
);

export interface StoryInteractivePlacement extends StoryElementBase {
  type: 'interactive';
  element_id: string;
}

export type StoryStaticElement = StoryTextElement | StoryStickerElement | StoryQuestionAnswerCard;
export type StoryCompositionElement = StoryStaticElement | StoryInteractivePlacement;
export type StoryComposition =
  | { version: 1; elements: StoryStaticElement[] }
  | { version: 2; elements: StoryCompositionElement[] };

/** Private editor state. Never render or persist correctOptionId in public composition/config. */
export interface StoryInteractiveDraft {
  definition: StoryInteractiveDefinition;
  correctOptionId: string | null;
}

export type StoryInteractiveSubmissionDefinition =
  | (StoryInteractiveDefinitionBase & { type: 'poll'; options: StoryInteractiveOption[] })
  | (StoryInteractiveDefinitionBase & { type: 'quiz'; options: StoryInteractiveOption[]; correct_option_id?: string })
  | (StoryInteractiveDefinitionBase & { type: 'slider' | 'reaction'; emoji: StoryStickerValue })
  | (StoryInteractiveDefinitionBase & { type: 'question' });

export interface StoryEditorPublication {
  composition: StoryComposition;
  interactiveDefinitions: StoryInteractiveSubmissionDefinition[];
}

export const STORY_INTERACTIVE_MAX_OPTIONS = 6;
export const STORY_INTERACTIVE_MAX_PROMPT_LENGTH = 200;
export const STORY_INTERACTIVE_MAX_OPTION_LENGTH = 80;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPTION_ID = /^[a-z0-9_-]{1,64}$/i;
const URL = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:javascript|data):|\bwww\.)/i;
const STICKERS: readonly StoryStickerValue[] = ['❤️', '😂', '😮', '😢', '🔥', '👏', '✨', '⭐', '💯', '🎉', '😍'];
const COLORS: readonly StoryTextColor[] = ['#FFFFFF', '#111111', '#FF2D78', '#7C5CFF', '#00D4FF', '#FFD60A'];
const GEOMETRY_KEYS = ['id', 'type', 'x', 'y', 'scale', 'rotation'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function text(value: unknown, maximum: number, forbidUrls = true): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || [...normalized].length > maximum || /[<>]/.test(normalized)
    || (forbidUrls && URL.test(normalized))) return null;
  return normalized;
}

function range(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/** Invalid input rejects the whole definition; unknown keys are never silently stripped. */
export function parseStoryInteractiveDefinition(value: unknown): StoryInteractiveDefinition | null {
  if (!record(value) || value.version !== 1) return null;
  const element_id = uuid(value.element_id);
  const prompt = text(value.prompt, STORY_INTERACTIVE_MAX_PROMPT_LENGTH);
  if (!element_id || prompt === null) return null;
  const allowed = ['version', 'element_id', 'type', 'prompt'];
  const base = { version: 1 as const, element_id, prompt };
  if (value.type === 'poll' || value.type === 'quiz') {
    if (!keys(value, [...allowed, 'options']) || !Array.isArray(value.options)
      || value.options.length < 2 || value.options.length > STORY_INTERACTIVE_MAX_OPTIONS) return null;
    const options: StoryInteractiveOption[] = [];
    const ids = new Set<string>();
    for (const option of value.options) {
      if (!record(option) || !keys(option, ['id', 'label'])
        || typeof option.id !== 'string' || !OPTION_ID.test(option.id) || ids.has(option.id)) return null;
      const label = text(option.label, STORY_INTERACTIVE_MAX_OPTION_LENGTH);
      if (label === null) return null;
      ids.add(option.id);
      options.push({ id: option.id, label });
    }
    return { ...base, type: value.type, options };
  }
  if (value.type === 'slider' || value.type === 'reaction') {
    if (!keys(value, [...allowed, 'emoji']) || typeof value.emoji !== 'string'
      || !STICKERS.includes(value.emoji as StoryStickerValue)) return null;
    return { ...base, type: value.type, emoji: value.emoji as StoryStickerValue };
  }
  if (value.type === 'question' && keys(value, allowed)) return { ...base, type: 'question' };
  return null;
}

function parseElement(value: unknown, version: 1 | 2): StoryCompositionElement | null {
  if (!record(value)) return null;
  if (value.type === 'question_answer') return version === 2 ? parseStoryQuestionAnswerCard(value) : null;
  const id = uuid(value.id);
  if (!id || !range(value.x, 0, 1) || !range(value.y, 0, 1)
    || !range(value.scale, 0.5, 4) || !range(value.rotation, -180, 180)) return null;
  const base = { id, x: value.x, y: value.y, scale: value.scale, rotation: value.rotation };
  if (value.type === 'interactive' && version === 2 && keys(value, [...GEOMETRY_KEYS, 'element_id'])) {
    const element_id = uuid(value.element_id);
    return element_id ? { ...base, type: 'interactive', element_id } : null;
  }
  if (value.type === 'text' && keys(value, [...GEOMETRY_KEYS, 'text', 'color', 'align', 'size'])) {
    // Preserve v1's plain-text contract; URL-bearing object keys remain forbidden.
    const normalized = text(value.text, 200, false);
    if (normalized === null || typeof value.color !== 'string' || !COLORS.includes(value.color as StoryTextColor)
      || (value.align !== 'left' && value.align !== 'center' && value.align !== 'right')
      || (value.size !== 'small' && value.size !== 'medium' && value.size !== 'large')) return null;
    return { ...base, type: 'text', text: normalized, color: value.color as StoryTextColor,
      align: value.align, size: value.size };
  }
  if (value.type === 'sticker' && keys(value, [...GEOMETRY_KEYS, 'value'])
    && typeof value.value === 'string' && STICKERS.includes(value.value as StoryStickerValue)) {
    return { ...base, type: 'sticker', value: value.value as StoryStickerValue };
  }
  return null;
}

/** Placement is always relative to the full media frame, never device pixels or safe areas. */
export function parseStoryComposition(value: unknown): StoryComposition | null {
  if (!record(value) || !keys(value, ['version', 'elements'])
    || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.elements)
    || value.elements.length > 32) return null;
  const elements: StoryCompositionElement[] = [];
  const ids = new Set<string>();
  const references = new Set<string>();
  let texts = 0;
  let stickers = 0;
  let answers = 0;
  for (const input of value.elements) {
    const element = parseElement(input, value.version);
    if (!element || ids.has(element.id)) return null;
    ids.add(element.id);
    if (element.type === 'text' && ++texts > 10) return null;
    if (element.type === 'sticker' && ++stickers > 24) return null;
    if (element.type === 'question_answer' && ++answers > 1) return null;
    if (element.type === 'interactive') {
      if (references.has(element.element_id)) return null;
      references.add(element.element_id);
    }
    elements.push(element);
  }
  return value.version === 1
    ? { version: 1, elements: elements as StoryStaticElement[] }
    : { version: 2, elements };
}

/** Legacy text/stickers use v1; interactive placements and answer cards require v2. */
export function normalizeStoryCompositionVersion(
  composition: { version: 1 | 2; elements: StoryCompositionElement[] },
): StoryComposition {
  return composition.elements.some(element => element.type === 'interactive' || element.type === 'question_answer')
    ? { version: 2, elements: composition.elements }
    : { version: 1, elements: composition.elements as StoryStaticElement[] };
}

/**
 * Builds the sole publication envelope. Its definition IDs must exactly equal the placement set.
 * Quiz answers are emitted only into the private RPC envelope, never public config/composition.
 */
export function buildStoryInteractivePublication(
  compositionInput: { version: 1 | 2; elements: StoryCompositionElement[] },
  drafts: StoryInteractiveDraft[],
): StoryEditorPublication | null {
  const composition = parseStoryComposition(normalizeStoryCompositionVersion(compositionInput));
  if (!composition) return null;
  const compositionElements: StoryCompositionElement[] = composition.elements;
  const placements = compositionElements.filter(
    (element): element is StoryInteractivePlacement => element.type === 'interactive',
  );
  if (placements.length !== drafts.length) return null;

  const byId = new Map<string, StoryInteractiveSubmissionDefinition>();
  for (const draft of drafts) {
    const definition = parseStoryInteractiveDefinition(draft.definition);
    if (!definition || byId.has(definition.element_id)) return null;
    if (definition.type === 'quiz') {
      if (draft.correctOptionId !== null
        && !definition.options.some(option => option.id === draft.correctOptionId)) return null;
      byId.set(definition.element_id, draft.correctOptionId === null
        ? definition
        : { ...definition, correct_option_id: draft.correctOptionId });
    } else {
      if (draft.correctOptionId !== null) return null;
      byId.set(definition.element_id, definition);
    }
  }

  const interactiveDefinitions: StoryInteractiveSubmissionDefinition[] = [];
  for (const placement of placements) {
    const definition = byId.get(placement.element_id);
    if (!definition) return null;
    interactiveDefinitions.push(definition);
    byId.delete(placement.element_id);
  }
  if (byId.size !== 0) return null;
  return { composition, interactiveDefinitions };
}
