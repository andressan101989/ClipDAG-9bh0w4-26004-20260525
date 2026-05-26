import React, {
  createContext, useState, useCallback, useEffect, useRef, useContext, ReactNode,
} from 'react';
import { getSupabaseClient } from '@/template';
import { AuthContext } from './AuthContext';

export type NotificationType =
  | 'like' | 'comment' | 'follow' | 'gift' | 'message' | 'sale' | 'order_update';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  fromUserId?: string;
  fromUsername: string;
  fromAvatar: string;
  referenceId: string;
  referenceType: string;
  message: string;
  read: boolean;
  createdAt: string;
}

interface NotificationsContextType {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

export const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

function mapNotification(row: Record<string, unknown>): AppNotification {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: (row.type as NotificationType) || 'like',
    fromUserId: (row.from_user_id as string) || undefined,
    fromUsername: (row.from_username as string) || 'Usuario',
    fromAvatar: (row.from_avatar as string) || '',
    referenceId: (row.reference_id as string) || '',
    referenceType: (row.reference_type as string) || '',
    message: (row.message as string) || '',
    read: Boolean(row.read),
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseClient();
  const authCtx = useContext(AuthContext);
  const user = authCtx?.user;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) {
        setNotifications(data.map(r => mapNotification(r as Record<string, unknown>)));
      }
    } catch (_) {}
  }, [user, supabase]);

  const refreshNotifications = useCallback(async () => {
    setIsLoading(true);
    await fetchNotifications();
    setIsLoading(false);
  }, [fetchNotifications]);

  const markRead = useCallback(async (id: string) => {
    try {
      await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', user?.id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (_) {}
  }, [user, supabase]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    try {
      await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (_) {}
  }, [user, supabase]);

  const addNotification = useCallback(async (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    try {
      await supabase.from('notifications').insert({
        user_id: n.userId,
        type: n.type,
        from_user_id: n.fromUserId || null,
        from_username: n.fromUsername,
        from_avatar: n.fromAvatar,
        reference_id: n.referenceId,
        reference_type: n.referenceType,
        message: n.message,
        read: false,
      });
    } catch (_) {}
  }, [supabase]);

  // ── Deferred polling — starts only after user auth, NOT on startup ────────
  // Delayed by 3s after user mounts to avoid blocking iOS startup render.
  useEffect(() => {
    if (!user) return;
    console.log('[BOOT] NotificationsProvider — user ready, starting deferred poll');
    const initDelay = setTimeout(() => {
      fetchNotifications();
      pollRef.current = setInterval(fetchNotifications, 10000);
    }, 3000);
    return () => {
      clearTimeout(initDelay);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user?.id]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationsContext.Provider value={{
      notifications, unreadCount, isLoading,
      markAllRead, markRead, addNotification, refreshNotifications,
    }}>
      {children}
    </NotificationsContext.Provider>
  );
}
