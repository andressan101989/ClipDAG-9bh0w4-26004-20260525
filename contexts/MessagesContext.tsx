import React, {
  createContext, useState, useCallback, useEffect, useContext, useRef, ReactNode,
} from 'react';
import { getSupabaseClient } from '@/template';
import { AuthContext } from './AuthContext';
import { PollingManager } from '@/modules/realtime/PollingManager';

export interface Message {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  mediaUrl?: string;
  mediaType: 'text' | 'image' | 'video';
  read: boolean;
  createdAt: string;
}

export interface Conversation {
  partnerId: string;
  partnerUsername: string;
  partnerAvatar: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface MessagesContextType {
  conversations: Conversation[];
  messages: Record<string, Message[]>;    // keyed by partnerId
  unreadTotal: number;
  isLoading: boolean;
  sendMessage: (recipientId: string, text: string, mediaUrl?: string, mediaType?: string) => Promise<void>;
  loadConversation: (partnerId: string) => Promise<void>;
  markConversationRead: (partnerId: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
}

export const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

// ── Helpers ──────────────────────────────────────────────────────────────────
function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    senderId: row.sender_id as string,
    recipientId: row.recipient_id as string,
    text: (row.text as string) || '',
    mediaUrl: (row.media_url as string) || undefined,
    mediaType: ((row.media_type as string) || 'text') as Message['mediaType'],
    read: Boolean(row.read),
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  // Guard getSupabaseClient() in a ref — same pattern as FeedContext/AuthContext.
  // Calling it directly in the provider body throws when the backend is unavailable,
  // which crashes the entire React tree ("TypeError: undefined is not a function").
  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  const supabaseOk  = useRef(true);
  if (!supabaseRef.current) {
    try { supabaseRef.current = getSupabaseClient(); }
    catch (e) { console.warn('[MessagesContext] getSupabaseClient failed:', e); supabaseOk.current = false; }
  }
  const supabase = supabaseRef.current!;
  const authCtx = useContext(AuthContext);
  const user = authCtx?.user;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  // Polling key unique per user to prevent cross-user leaks on re-login

  // ── Fetch conversations (latest message per partner) ─────────────────────
  const fetchConversations = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id, sender_id, recipient_id, text, media_type, read, created_at,
          sender:user_profiles!messages_sender_id_fkey(username, avatar_url),
          recipient:user_profiles!messages_recipient_id_fkey(username, avatar_url)
        `)
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error || !data) return;

      // Group by conversation partner
      const convMap = new Map<string, Conversation>();
      for (const row of data) {
        const r = row as Record<string, unknown>;
        const senderId = r.sender_id as string;
        const recipientId = r.recipient_id as string;
        const partnerId = senderId === user.id ? recipientId : senderId;

        if (convMap.has(partnerId)) continue; // already have latest

        const senderProfile = r.sender as Record<string, string> | null;
        const recipientProfile = r.recipient as Record<string, string> | null;
        const partnerProfile = senderId === user.id ? recipientProfile : senderProfile;

        const isUnread = !Boolean(r.read) && recipientId === user.id;

        convMap.set(partnerId, {
          partnerId,
          partnerUsername: partnerProfile?.username || 'Usuario',
          partnerAvatar: partnerProfile?.avatar_url || '',
          lastMessage: (r.text as string) || '',
          lastMessageAt: (r.created_at as string) || '',
          unreadCount: isUnread ? 1 : 0,
        });
      }

      // Count unread per partner properly
      const unreadCounts = new Map<string, number>();
      for (const row of data) {
        const r = row as Record<string, unknown>;
        if ((r.recipient_id as string) === user.id && !Boolean(r.read)) {
          const pid = r.sender_id as string;
          unreadCounts.set(pid, (unreadCounts.get(pid) || 0) + 1);
        }
      }

      const convList = Array.from(convMap.values()).map(c => ({
        ...c,
        unreadCount: unreadCounts.get(c.partnerId) || 0,
      }));

      convList.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      setConversations(convList);
    } catch (_) {}
  }, [user, supabase]);

  const refreshConversations = useCallback(async () => {
    setIsLoading(true);
    await fetchConversations();
    setIsLoading(false);
  }, [fetchConversations]);

  // ── Load messages with a specific user ──────────────────────────────────
  const loadConversation = useCallback(async (partnerId: string) => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${user.id},recipient_id.eq.${partnerId}),and(sender_id.eq.${partnerId},recipient_id.eq.${user.id})`
        )
        .order('created_at', { ascending: true })
        .limit(100);

      if (!error && data) {
        setMessages(prev => ({
          ...prev,
          [partnerId]: data.map(r => mapMessage(r as Record<string, unknown>)),
        }));
      }
    } catch (_) {}
  }, [user, supabase]);

  // ── Send a message ───────────────────────────────────────────────────────
  const sendMessage = useCallback(async (
    recipientId: string,
    text: string,
    mediaUrl?: string,
    mediaType: string = 'text'
  ) => {
    if (!user || !text.trim()) return;
    const optimistic: Message = {
      id: `opt_${Date.now()}`,
      senderId: user.id,
      recipientId,
      text: text.trim(),
      mediaUrl,
      mediaType: mediaType as Message['mediaType'],
      read: false,
      createdAt: new Date().toISOString(),
    };
    // Optimistic insert
    setMessages(prev => ({
      ...prev,
      [recipientId]: [...(prev[recipientId] || []), optimistic],
    }));
    // Update conversation preview
    setConversations(prev => {
      const idx = prev.findIndex(c => c.partnerId === recipientId);
      const updated = { lastMessage: text.trim(), lastMessageAt: optimistic.createdAt };
      if (idx >= 0) {
        const conv = [...prev];
        conv[idx] = { ...conv[idx], ...updated };
        return conv;
      }
      return prev;
    });

    try {
      const { data, error } = await supabase.from('messages').insert({
        sender_id: user.id,
        recipient_id: recipientId,
        text: text.trim(),
        media_url: mediaUrl || '',
        media_type: mediaType,
        read: false,
      }).select().single();

      if (!error && data) {
        // Replace optimistic with real
        setMessages(prev => ({
          ...prev,
          [recipientId]: (prev[recipientId] || []).map(m =>
            m.id === optimistic.id ? mapMessage(data as Record<string, unknown>) : m
          ),
        }));
      }
    } catch (_) {}
  }, [user, supabase]);

  // ── Mark conversation as read ─────────────────────────────────────────────
  const markConversationRead = useCallback(async (partnerId: string) => {
    if (!user) return;
    try {
      await supabase
        .from('messages')
        .update({ read: true })
        .eq('recipient_id', user.id)
        .eq('sender_id', partnerId)
        .eq('read', false);

      setConversations(prev =>
        prev.map(c => c.partnerId === partnerId ? { ...c, unreadCount: 0 } : c)
      );
      setMessages(prev => ({
        ...prev,
        [partnerId]: (prev[partnerId] || []).map(m =>
          m.recipientId === user.id ? { ...m, read: true } : m
        ),
      }));
    } catch (_) {}
  }, [user, supabase]);

  // ── Deferred polling — starts only after user auth, NOT on startup ────────
  // Uses PollingManager instead of raw setInterval:
  //   • Centralized scheduling (one master timer, not N independent intervals)
  //   • Auto-pauses when app backgrounds (battery friendly)
  //   • Auto-resumes on foreground with immediate run
  useEffect(() => {
    if (!user) {
      PollingManager.unregister('messages_conversations');
      return;
    }
    console.log('[BOOT] MessagesProvider — user ready, starting deferred poll');
    const initDelay = setTimeout(() => {
      PollingManager.register({
        key:             'messages_conversations',
        intervalMs:      4_000,
        fn:              fetchConversations,
        runImmediately:  true,
        backgroundFactor: 0, // pause when app is in background
      });
    }, 2000);
    return () => {
      clearTimeout(initDelay);
      PollingManager.unregister('messages_conversations');
    };
  }, [user?.id]);

  const unreadTotal = conversations.reduce((s, c) => s + c.unreadCount, 0);

  return (
    <MessagesContext.Provider value={{
      conversations, messages, unreadTotal, isLoading,
      sendMessage, loadConversation, markConversationRead, refreshConversations,
    }}>
      {children}
    </MessagesContext.Provider>
  );
}
