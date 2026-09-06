import { useContext } from 'react';
import { MessagesContext } from '@/contexts/MessagesContext';

export function useMessages() {
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
