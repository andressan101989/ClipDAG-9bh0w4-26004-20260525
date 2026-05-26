import { useContext } from 'react';
import { NotificationsContext } from '@/contexts/NotificationsContext';

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  // Return safe defaults when provider is not mounted (isolation mode / startup)
  if (!ctx) return { unreadCount: 0, notifications: [], markRead: async () => {}, markAllRead: async () => {} } as any;
  return ctx;
}
