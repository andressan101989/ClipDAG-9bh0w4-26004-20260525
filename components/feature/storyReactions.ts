export const STORY_REACTIONS = [
  { key: 'heart', emoji: '❤️', label: 'Me encanta', effect: 'rise', particleCount: 8 },
  { key: 'laugh', emoji: '😂', label: 'Me divierte', effect: 'pop', particleCount: 6 },
  { key: 'wow', emoji: '😮', label: 'Me sorprende', effect: 'pulse', particleCount: 1 },
  { key: 'sad', emoji: '😢', label: 'Me entristece', effect: 'fall', particleCount: 5 },
  { key: 'fire', emoji: '🔥', label: 'Está increíble', effect: 'rise', particleCount: 8 },
  { key: 'clap', emoji: '👏', label: 'Aplausos', effect: 'alternate', particleCount: 6 },
] as const;

export type StoryReactionKey = typeof STORY_REACTIONS[number]['key'];

export function isStoryReactionKey(value: unknown): value is StoryReactionKey {
  return STORY_REACTIONS.some(reaction => reaction.key === value);
}

export function storyReactionEmoji(value: StoryReactionKey): string {
  return STORY_REACTIONS.find(reaction => reaction.key === value)?.emoji ?? '';
}

export function storyReactionDefinition(value: StoryReactionKey) {
  return STORY_REACTIONS.find(reaction => reaction.key === value) ?? STORY_REACTIONS[0];
}
