import type { AppStateStatus } from 'react-native';

type PresentationState = {
  activeConversationId: string | null;
  activeChatUserId: string | null;
  appState: AppStateStatus;
};

export type MessagePresentationIdentity = {
  conversationId?: string | null;
  senderId?: string | null;
};

const globalKey = '__onspaceMessageNotificationPresentation';
const globalStore = globalThis as typeof globalThis & Record<string, unknown>;

function state(): PresentationState {
  if (!globalStore[globalKey]) {
    globalStore[globalKey] = { activeConversationId: null, activeChatUserId: null, appState: 'active' };
  }
  const current = globalStore[globalKey] as Partial<PresentationState>;
  if (!('activeConversationId' in current)) current.activeConversationId = null;
  return current as PresentationState;
}

export function setMessageNotificationAppState(appState: AppStateStatus): void { state().appState = appState; }
export function getMessageNotificationAppState(): AppStateStatus { return state().appState; }

export function setActiveMessageConversation(conversationId: string | null, userId: string | null = null): void {
  const current = state();
  current.activeConversationId = conversationId;
  current.activeChatUserId = userId;
}

export function clearActiveMessageConversation(conversationId: string | null, userId: string | null = null): void {
  const current = state();
  const conversationMatches = Boolean(conversationId && current.activeConversationId === conversationId);
  const legacyMatches = Boolean(!conversationId && userId && current.activeChatUserId === userId);
  if (conversationMatches || legacyMatches) {
    current.activeConversationId = null;
    current.activeChatUserId = null;
  }
}

/** Compatibility for old direct-message notifications without conversation_id. */
export function setActiveMessageChat(userId: string | null): void { setActiveMessageConversation(null, userId); }
export function clearActiveMessageChat(userId: string): void { clearActiveMessageConversation(null, userId); }
export function getActiveMessageChat(): string | null { return state().activeChatUserId; }
export function getActiveMessageConversation(): string | null { return state().activeConversationId; }

export function isMessageChatCurrentlyVisible(identity: string | MessagePresentationIdentity): boolean {
  const current = state();
  if (current.appState !== 'active') return false;
  const input = typeof identity === 'string' ? { senderId: identity } : identity;
  if (input.conversationId) return current.activeConversationId === input.conversationId;
  return Boolean(input.senderId && current.activeChatUserId === input.senderId);
}
