export interface StoryQuestionComposerState {
  hideReplyRail: boolean;
  pausePlayback: boolean;
  blockViewerGestures: boolean;
}

export function getStoryQuestionComposerState(active: boolean): StoryQuestionComposerState;
