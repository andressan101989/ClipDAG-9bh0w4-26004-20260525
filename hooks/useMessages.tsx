import { useContext } from 'react';
import { MessagesContext } from '@/contexts/MessagesContext';

export function useMessages() {
  const ctx = useContext(MessagesContext);
  // Return safe defaults when provider is not mounted (isolation mode / startup)
  if (!ctx) return { unreadTotal: 0, conversations: [], messages: {}, sendMessage: async () => {}, markRead: async () => {}, loadMessages: async () => {} } as any;
  return ctx;
}
