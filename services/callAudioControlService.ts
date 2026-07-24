type ActiveCallAudioController = {
  callId: string;
  setMuted: (muted: boolean) => boolean;
};

let activeController: ActiveCallAudioController | null = null;
const desiredMuteByCallId = new Map<string, boolean>();

export function registerActiveCallAudioController(controller: ActiveCallAudioController): () => void {
  activeController = controller;
  return () => {
    if (activeController === controller) {
      activeController = null;
      desiredMuteByCallId.delete(controller.callId);
    }
  };
}

export function setActiveAgoraCallMuted(callId: string, muted: boolean): boolean {
  desiredMuteByCallId.set(callId, muted);
  if (!activeController || activeController.callId !== callId) return false;
  return activeController.setMuted(muted);
}

export function applyPendingAgoraCallMute(callId: string): boolean {
  const desiredMute = desiredMuteByCallId.get(callId);
  if (desiredMute === undefined || !activeController || activeController.callId !== callId) return false;
  return activeController.setMuted(desiredMute);
}
