export const STORY_REACTIONS = [
  { key: 'heart', emoji: '❤️', label: 'Me encanta' },
  { key: 'laugh', emoji: '😂', label: 'Me divierte' },
  { key: 'wow', emoji: '😮', label: 'Me sorprende' },
  { key: 'sad', emoji: '😢', label: 'Me entristece' },
  { key: 'fire', emoji: '🔥', label: 'Está increíble' },
  { key: 'clap', emoji: '👏', label: 'Aplausos' },
] as const;

export type StoryReactionKey = typeof STORY_REACTIONS[number]['key'];

export function isStoryReactionKey(value: unknown): value is StoryReactionKey {
  return STORY_REACTIONS.some(reaction => reaction.key === value);
}

export function storyReactionEmoji(value: StoryReactionKey): string {
  return STORY_REACTIONS.find(reaction => reaction.key === value)?.emoji ?? '';
}
