/** Both viewers use the same exclusive-composer contract. */
export function getStoryQuestionComposerState(active) {
  const ownsViewer = active === true;
  return {
    hideReplyRail: ownsViewer,
    pausePlayback: ownsViewer,
    blockViewerGestures: ownsViewer,
  };
}
