import type { AppStateStatus } from 'react-native';

type PresentationState = {
  activeChatUserId: string | null;
  appState: AppStateStatus;
};

const globalKey = '__onspaceMessageNotificationPresentation';
const globalStore = globalThis as typeof globalThis & Record<string, unknown>;

function state(): PresentationState {
  if (!globalStore[globalKey]) {
    globalStore[globalKey] = {
      activeChatUserId: null,
      appState: 'active',
    };
  }
  return globalStore[globalKey] as PresentationState;
}

export function setMessageNotificationAppState(appState: AppStateStatus): void {
  state().appState = appState;
}

export function getMessageNotificationAppState(): AppStateStatus {
  return state().appState;
}

export function setActiveMessageChat(userId: string | null): void {
  state().activeChatUserId = userId;
}

export function clearActiveMessageChat(userId: string): void {
  if (state().activeChatUserId === userId) {
    state().activeChatUserId = null;
  }
}

export function getActiveMessageChat(): string | null {
  return state().activeChatUserId;
}

export function isMessageChatCurrentlyVisible(senderId: string): boolean {
  const current = state();
  return current.appState === 'active' && current.activeChatUserId === senderId;
}
