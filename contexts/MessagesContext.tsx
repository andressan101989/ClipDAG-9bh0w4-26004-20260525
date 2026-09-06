import React, {
  createContext, useState, useCallback, useEffect, useContext, useRef, type ReactNode,
} from 'react';
import * as Notifications from 'expo-notifications';
import { AuthContext } from './AuthContext';
import { PollingManager } from '@/modules/realtime/PollingManager';
import {
  acknowledgeChatDelivery,
  createChatClientMessageId,
  fetchChatConversations,
  fetchChatUserProfile,
  fetchRecentChatMessages,
  getOrCreateDirectConversation,
  markChatConversationRead,
  sendChatMessage,
  subscribeToChatChanges,
} from '@/services/chatService';
import type {
  ChatDeliveryStatus, ChatMessageReceiptRow, ChatMessageRow,
} from '@/services/chatContract';

export interface Message {
  id: string;
  conversationId?: string;
  clientMessageId?: string;
  senderId: string;
  recipientId: string;
  text: string;
  mediaUrl?: string;
  mediaType: 'text' | 'image' | 'video' | 'premium_dm';
  read: boolean;
  deliveryStatus?: ChatDeliveryStatus;
  createdAt: string;
}

export interface Conversation {
  id: string;
  conversationId?: string;
  partnerId: string;
  partnerUsername: string;
  partnerAvatar: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  otherUserId?: string;
  otherUsername?: string;
  otherUserAvatar?: string;
}

interface MessagesContextType {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  unreadTotal: number;
  isLoading: boolean;
  sendMessage: (recipientId: string, text: string, mediaUrl?: string, mediaType?: string) => Promise<void>;
  loadConversation: (partnerId: string) => Promise<void>;
  markConversationRead: (partnerId: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
}

export const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

function mapMessage(row: ChatMessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    clientMessageId: row.client_message_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    text: row.text || '',
    mediaUrl: row.media_url || undefined,
    mediaType: (['image', 'video', 'premium_dm'].includes(row.message_type) ? row.message_type : 'text') as Message['mediaType'],
    read: Boolean(row.read),
    deliveryStatus: row.read ? 'read' : 'sent',
    createdAt: row.created_at,
  };
}

function mergeMessage(current: Message[], incoming: Message): Message[] {
  const duplicateIndex = current.findIndex(message => message.id === incoming.id
    || (incoming.clientMessageId && message.clientMessageId === incoming.clientMessageId));
  if (duplicateIndex < 0) {
    return [...current, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  const next = [...current];
  next[duplicateIndex] = incoming;
  return next;
}

function receiptStatus(receipt: ChatMessageReceiptRow): ChatDeliveryStatus {
  if (receipt.read_at || receipt.legacy_read) return 'read';
  if (receipt.delivered_at || receipt.legacy_delivered) return 'delivered';
  return 'sent';
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const authCtx = useContext(AuthContext);
  const user = authCtx?.user;
  const activeUserRef = useRef<string | null>(user?.id ?? null);
  const conversationIdsRef = useRef(new Map<string, string>());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [isLoading, setIsLoading] = useState(false);

  activeUserRef.current = user?.id ?? null;

  const fetchConversations = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;
    try {
      const rows = await fetchChatConversations();
      if (activeUserRef.current !== userId) return;
      setConversations(rows.map(row => {
        conversationIdsRef.current.set(row.other_user_id, row.conversation_id);
        return {
          id: row.conversation_id,
          conversationId: row.conversation_id,
          partnerId: row.other_user_id,
          partnerUsername: row.other_username || 'Usuario',
          partnerAvatar: row.other_avatar_url || '',
          lastMessage: row.last_message?.text || '',
          lastMessageAt: row.last_message?.created_at || row.last_activity_at,
          unreadCount: Number(row.unread_count) || 0,
          otherUserId: row.other_user_id,
          otherUsername: row.other_username || 'Usuario',
          otherUserAvatar: row.other_avatar_url || '',
        };
      }));
    } catch (error) {
      console.warn('[MessagesContext] conversation refresh failed', error);
    }
  }, [user?.id]);

  const refreshConversations = useCallback(async () => {
    setIsLoading(true);
    await fetchConversations();
    if (activeUserRef.current === user?.id) setIsLoading(false);
  }, [fetchConversations, user?.id]);

  const loadConversation = useCallback(async (partnerId: string) => {
    const userId = user?.id;
    if (!userId) return;
    try {
      const conversationId = conversationIdsRef.current.get(partnerId)
        ?? await getOrCreateDirectConversation(partnerId);
      conversationIdsRef.current.set(partnerId, conversationId);
      const [rows, profile] = await Promise.all([
        fetchRecentChatMessages(conversationId),
        fetchChatUserProfile(partnerId),
      ]);
      if (activeUserRef.current !== userId) return;
      const ordered = rows.map(mapMessage).reverse();
      setMessages(previous => ({ ...previous, [partnerId]: ordered }));
      const incoming = rows.filter(row => row.recipient_id === userId && !row.read);
      void Promise.all(incoming.map(row => acknowledgeChatDelivery(row.id))).catch(error => {
        console.warn('[MessagesContext] delivery acknowledgement failed', error);
      });
      setConversations(previous => {
        const existing = previous.find(item => item.partnerId === partnerId);
        if (existing) {
          return previous.map(item => item.partnerId === partnerId ? {
            ...item, id: conversationId, conversationId,
            partnerUsername: profile?.username || item.partnerUsername,
            partnerAvatar: profile?.avatar_url || item.partnerAvatar,
          } : item);
        }
        return [...previous, {
          id: conversationId,
          conversationId,
          partnerId,
          partnerUsername: profile?.username || 'Usuario',
          partnerAvatar: profile?.avatar_url || '',
          lastMessage: ordered.at(-1)?.text || '',
          lastMessageAt: ordered.at(-1)?.createdAt || new Date(0).toISOString(),
          unreadCount: incoming.length,
          otherUserId: partnerId,
          otherUsername: profile?.username || 'Usuario',
          otherUserAvatar: profile?.avatar_url || '',
        }];
      });
    } catch (error) {
      console.warn('[MessagesContext] conversation load failed', error);
    }
  }, [user?.id]);

  const sendMessage = useCallback(async (
    recipientId: string, text: string, mediaUrl?: string, mediaType: string = 'text',
  ) => {
    const userId = user?.id;
    const normalizedText = text.trim();
    if (!userId || !normalizedText || !['text', 'image', 'video'].includes(mediaType)) return;
    const clientMessageId = createChatClientMessageId();
    const optimistic: Message = {
      id: `opt_${clientMessageId}`, clientMessageId, senderId: userId, recipientId,
      text: normalizedText, mediaUrl, mediaType: mediaType as Message['mediaType'], read: false,
      deliveryStatus: 'pending', createdAt: new Date().toISOString(),
    };
    setMessages(previous => ({
      ...previous, [recipientId]: mergeMessage(previous[recipientId] || [], optimistic),
    }));

    try {
      const conversationId = conversationIdsRef.current.get(recipientId)
        ?? await getOrCreateDirectConversation(recipientId);
      conversationIdsRef.current.set(recipientId, conversationId);
      const row = await sendChatMessage({
        conversationId, clientMessageId, text: normalizedText,
        messageType: mediaType as 'text' | 'image' | 'video', mediaUrl,
      });
      if (activeUserRef.current !== userId) return;
      setMessages(previous => ({
        ...previous,
        [recipientId]: mergeMessage(previous[recipientId] || [], mapMessage(row)),
      }));
      await fetchConversations();
    } catch (error) {
      if (activeUserRef.current === userId) {
        setMessages(previous => ({
          ...previous,
          [recipientId]: (previous[recipientId] || []).map(message =>
            message.clientMessageId === clientMessageId
              ? { ...message, deliveryStatus: 'failed' }
              : message),
        }));
      }
      console.warn('[MessagesContext] message send failed', error);
    }
  }, [fetchConversations, user?.id]);

  const markConversationRead = useCallback(async (partnerId: string) => {
    const userId = user?.id;
    if (!userId) return;
    try {
      const conversationId = conversationIdsRef.current.get(partnerId)
        ?? await getOrCreateDirectConversation(partnerId);
      conversationIdsRef.current.set(partnerId, conversationId);
      await markChatConversationRead(conversationId);
      if (activeUserRef.current !== userId) return;
      setConversations(previous => previous.map(conversation =>
        conversation.partnerId === partnerId ? { ...conversation, unreadCount: 0 } : conversation));
      setMessages(previous => ({
        ...previous,
        [partnerId]: (previous[partnerId] || []).map(message =>
          message.recipientId === userId ? { ...message, read: true, deliveryStatus: 'read' } : message),
      }));
    } catch (error) {
      console.warn('[MessagesContext] mark read failed', error);
    }
  }, [user?.id]);

  useEffect(() => {
    const userId = user?.id;
    const ownedConversationIds = conversationIdsRef.current;
    setConversations([]);
    setMessages({});
    setIsLoading(Boolean(userId));
    conversationIdsRef.current.clear();
    PollingManager.unregister('messages_conversations');
    if (!userId) return;

    let active = true;
    const reconcile = () => { if (active && activeUserRef.current === userId) void fetchConversations(); };
    const unsubscribe = subscribeToChatChanges({
      userId,
      onMessage: row => {
        if (!active || activeUserRef.current !== userId) return;
        if (row.sender_id !== userId && row.recipient_id !== userId) return;
        const partnerId = row.sender_id === userId ? row.recipient_id : row.sender_id;
        conversationIdsRef.current.set(partnerId, row.conversation_id);
        setMessages(previous => ({
          ...previous,
          [partnerId]: mergeMessage(previous[partnerId] || [], mapMessage(row)),
        }));
        if (row.recipient_id === userId) void acknowledgeChatDelivery(row.id).catch(() => undefined);
        reconcile();
      },
      onReceipt: receipt => {
        const deliveryStatus = receiptStatus(receipt);
        setMessages(previous => Object.fromEntries(Object.entries(previous).map(([partnerId, rows]) => [
          partnerId,
          rows.map(message => message.id === receipt.message_id
            ? { ...message, read: deliveryStatus === 'read', deliveryStatus }
            : message),
        ])));
      },
      onReconcile: reconcile,
    });
    void fetchConversations().finally(() => {
      if (active && activeUserRef.current === userId) setIsLoading(false);
    });
    PollingManager.register({
      key: 'messages_conversations', intervalMs: 30_000,
      fn: fetchConversations, runImmediately: false, backgroundFactor: 0,
    });
    return () => {
      active = false;
      unsubscribe();
      PollingManager.unregister('messages_conversations');
      ownedConversationIds.clear();
    };
  }, [fetchConversations, user?.id]);

  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const applicationBadgeCount = user?.id ? unreadTotal : 0;
  useEffect(() => {
    Notifications.setBadgeCountAsync(applicationBadgeCount).catch(() => undefined);
  }, [applicationBadgeCount]);

  return (
    <MessagesContext.Provider value={{
      conversations, messages, unreadTotal, isLoading,
      sendMessage, loadConversation, markConversationRead, refreshConversations,
    }}>
      {children}
    </MessagesContext.Provider>
  );
}
