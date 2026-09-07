import { useContext } from 'react';
import { MessagesContext, type MessagesContextType } from '@/contexts/MessagesContext';

export function useMessages(): MessagesContextType {
  const ctx = useContext(MessagesContext);
  // Return safe defaults when provider is not mounted (isolation mode / startup)
  if (!ctx) return {
    unreadTotal: 0,
    conversations: [],
    messages: {},
    isLoading: false,
    hasOlderMessages: {},
    isLoadingOlder: {},
    presenceByUser: {},
    typingByUser: {},
    sendMessage: async () => {},
    sendMediaMessage: async () => {},
    openOneTimeMedia: async () => { throw new Error('messages_provider_unavailable'); },
    retryMessage: async () => {},
    markConversationRead: async () => {},
    loadConversation: async () => {},
    loadOlderMessages: async () => {},
    refreshConversations: async () => {},
    activateConversation: async () => {},
    deactivateConversation: () => {},
    setConversationTyping: () => {},
  };
  return ctx;
}
