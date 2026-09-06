import React, { createContext, useState, useCallback, useEffect, useContext, useRef, type ReactNode } from 'react';
import * as Notifications from 'expo-notifications';
import { AuthContext } from './AuthContext';
import { AppLifecycle } from '@/modules/core/AppLifecycle';
import { PollingManager } from '@/modules/realtime/PollingManager';
import { PresenceManager } from '@/modules/realtime/PresenceManager';
import {
  acknowledgeChatDelivery, acknowledgeChatReads, acknowledgePendingChatDeliveries, createChatClientMessageId,
  fetchChatConversations, fetchChatUserProfile, fetchRecentChatMessages,
  getOrCreateDirectConversation, sendChatMessage, subscribeToChatChanges,
} from '@/services/chatService';
import { createChatTypingSession, type ChatTypingSession } from '@/services/chatTypingSession';
import { ChatRetryCoordinator, isChatReadEligible, monotonicDeliveryStatus } from '@/services/chatReliability';
import type { ChatCursor, ChatDeliveryStatus, ChatMessageReceiptRow, ChatMessageRow, ChatMessageWithReceiptRow } from '@/services/chatContract';

const MESSAGE_PAGE_SIZE = 50;

export interface Message {
  id: string; conversationId?: string; clientMessageId?: string; senderId: string; recipientId: string;
  text: string; mediaUrl?: string; mediaType: 'text' | 'image' | 'video' | 'premium_dm'; read: boolean;
  deliveryStatus?: ChatDeliveryStatus; createdAt: string;
}
export interface Conversation {
  id: string; conversationId?: string; partnerId: string; partnerUsername: string; partnerAvatar: string;
  lastMessage: string; lastMessageAt: string; unreadCount: number; otherUserId?: string;
  otherUsername?: string; otherUserAvatar?: string;
}
interface MessagesContextType {
  conversations: Conversation[]; messages: Record<string, Message[]>; unreadTotal: number; isLoading: boolean;
  hasOlderMessages: Record<string, boolean>; isLoadingOlder: Record<string, boolean>;
  presenceByUser: Record<string, 'online' | 'offline'>; typingByUser: Record<string, boolean>;
  sendMessage: (recipientId: string, text: string, mediaUrl?: string, mediaType?: string) => Promise<void>;
  retryMessage: (partnerId: string, clientMessageId: string) => Promise<void>;
  loadConversation: (partnerId: string) => Promise<void>; loadOlderMessages: (partnerId: string) => Promise<void>;
  markConversationRead: (partnerId: string) => Promise<void>; refreshConversations: () => Promise<void>;
  activateConversation: (partnerId: string) => Promise<void>; deactivateConversation: (partnerId: string) => void;
  setConversationTyping: (partnerId: string, hasText: boolean) => void;
}
export const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

function rowStatus(row: ChatMessageRow | ChatMessageWithReceiptRow): Exclude<ChatDeliveryStatus, 'pending' | 'failed'> {
  if ('delivery_status' in row && row.delivery_status) return row.delivery_status;
  return row.read ? 'read' : 'sent';
}
export function mapChatMessage(row: ChatMessageRow | ChatMessageWithReceiptRow): Message {
  const deliveryStatus = rowStatus(row);
  return {
    id: row.id, conversationId: row.conversation_id, clientMessageId: row.client_message_id,
    senderId: row.sender_id, recipientId: row.recipient_id, text: row.text || '',
    mediaUrl: row.media_url || undefined,
    mediaType: (['image', 'video', 'premium_dm'].includes(row.message_type) ? row.message_type : 'text') as Message['mediaType'],
    read: deliveryStatus === 'read', deliveryStatus, createdAt: row.created_at,
  };
}
export function mergeChatMessage(current: Message[], incoming: Message): Message[] {
  const index = current.findIndex(message => message.id === incoming.id
    || Boolean(incoming.clientMessageId && message.clientMessageId === incoming.clientMessageId));
  if (index < 0) return [...current, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const next = [...current];
  const previous = next[index];
  const deliveryStatus = monotonicDeliveryStatus(previous.deliveryStatus, incoming.deliveryStatus);
  next[index] = { ...previous, ...incoming, deliveryStatus, read: deliveryStatus === 'read' };
  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
function mergeMany(current: Message[], incoming: Message[]): Message[] {
  return incoming.reduce(mergeChatMessage, current);
}
function receiptStatus(receipt: ChatMessageReceiptRow): Exclude<ChatDeliveryStatus, 'pending' | 'failed'> {
  if (receipt.read_at || receipt.legacy_read) return 'read';
  if (receipt.delivered_at || receipt.legacy_delivered) return 'delivered';
  return 'sent';
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const authCtx = useContext(AuthContext); const user = authCtx?.user;
  const activeUserRef = useRef<string | null>(user?.id ?? null);
  const generationRef = useRef(0); const conversationIdsRef = useRef(new Map<string, string>());
  const cursorsRef = useRef(new Map<string, ChatCursor>()); const olderFlightRef = useRef(new Set<string>());
  const retryFlightRef = useRef(new ChatRetryCoordinator());
  const activePartnerRef = useRef<string | null>(null); const focusedPartnerRef = useRef<string | null>(null);
  const typingSessionRef = useRef<ChatTypingSession | null>(null);
  const typingSessionFlightRef = useRef<Promise<ChatTypingSession> | null>(null);
  const watchedPartnersRef = useRef(new Set<string>());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState<Record<string, boolean>>({});
  const [isLoadingOlder, setIsLoadingOlder] = useState<Record<string, boolean>>({});
  const [presenceByUser, setPresenceByUser] = useState<Record<string, 'online' | 'offline'>>({});
  const [typingByUser, setTypingByUser] = useState<Record<string, boolean>>({});
  const messagesRef = useRef(messages); messagesRef.current = messages;
  activeUserRef.current = user?.id ?? null;

  const fetchConversations = useCallback(async () => {
    const userId = user?.id; if (!userId) return;
    try {
      const rows = await fetchChatConversations(); if (activeUserRef.current !== userId) return;
      const partners = new Set(rows.map(row => row.other_user_id));
      const stale = [...watchedPartnersRef.current].filter(id => !partners.has(id));
      if (stale.length) PresenceManager.unwatchUsers(stale);
      PresenceManager.watchUsers([...partners]); watchedPartnersRef.current = partners;
      setConversations(rows.map(row => {
        conversationIdsRef.current.set(row.other_user_id, row.conversation_id);
        return { id: row.conversation_id, conversationId: row.conversation_id, partnerId: row.other_user_id,
          partnerUsername: row.other_username || 'Usuario', partnerAvatar: row.other_avatar_url || '',
          lastMessage: row.last_message?.text || '', lastMessageAt: row.last_message?.created_at || row.last_activity_at,
          unreadCount: Number(row.unread_count) || 0, otherUserId: row.other_user_id,
          otherUsername: row.other_username || 'Usuario', otherUserAvatar: row.other_avatar_url || '' };
      }));
    } catch (error) { console.warn('[MessagesContext] conversation refresh failed', error); }
  }, [user?.id]);
  const refreshConversations = useCallback(async () => { setIsLoading(true); await fetchConversations(); if (activeUserRef.current === user?.id) setIsLoading(false); }, [fetchConversations, user?.id]);

  const resolveConversation = useCallback(async (partnerId: string) => {
    const known = conversationIdsRef.current.get(partnerId); if (known) return known;
    const id = await getOrCreateDirectConversation(partnerId); conversationIdsRef.current.set(partnerId, id); return id;
  }, []);

  const markConversationRead = useCallback(async (partnerId: string, visibleMessages?: Message[]) => {
    const userId = user?.id; const generation = generationRef.current;
    if (!userId || !isChatReadEligible({ authenticatedUserId: activeUserRef.current, expectedUserId: userId,
      activePartnerId: activePartnerRef.current, messagePartnerId: partnerId, appActive: AppLifecycle.isActive,
      generation: generationRef.current, expectedGeneration: generation })) return;
    try {
      await resolveConversation(partnerId);
      if (activeUserRef.current !== userId || generation !== generationRef.current
        || activePartnerRef.current !== partnerId || !AppLifecycle.isActive) return;
      const loadedIds = (visibleMessages ?? messagesRef.current[partnerId] ?? [])
        .filter(message => message.recipientId === userId && message.deliveryStatus !== 'read')
        .map(message => message.id);
      await acknowledgeChatReads(loadedIds);
      if (activeUserRef.current !== userId || generation !== generationRef.current || activePartnerRef.current !== partnerId) return;
      setConversations(previous => previous.map(c => c.partnerId === partnerId
        ? { ...c, unreadCount: Math.max(0, c.unreadCount - loadedIds.length) } : c));
      setMessages(previous => ({ ...previous, [partnerId]: (previous[partnerId] || []).map(message =>
        message.recipientId === userId ? { ...message, read: true, deliveryStatus: 'read' } : message) }));
      void fetchConversations();
    } catch (error) { console.warn('[MessagesContext] mark read failed', error); }
  }, [fetchConversations, resolveConversation, user?.id]);

  const loadConversation = useCallback(async (partnerId: string) => {
    const userId = user?.id; const generation = generationRef.current; if (!userId) return;
    try {
      const conversationId = await resolveConversation(partnerId);
      const [rows, profile] = await Promise.all([fetchRecentChatMessages(conversationId), fetchChatUserProfile(partnerId)]);
      if (activeUserRef.current !== userId || generation !== generationRef.current) return;
      const ordered = rows.map(mapChatMessage).reverse();
      setMessages(previous => ({ ...previous, [partnerId]: mergeMany(previous[partnerId] || [], ordered) }));
      const oldest = rows.at(-1); if (oldest) cursorsRef.current.set(partnerId, { createdAt: oldest.created_at, id: oldest.id });
      setHasOlderMessages(previous => ({ ...previous, [partnerId]: rows.length === MESSAGE_PAGE_SIZE }));
      setConversations(previous => {
        const existing = previous.find(item => item.partnerId === partnerId);
        if (existing) return previous.map(item => item.partnerId === partnerId ? { ...item, id: conversationId, conversationId,
          partnerUsername: profile?.username || item.partnerUsername, partnerAvatar: profile?.avatar_url || item.partnerAvatar } : item);
        return [...previous, { id: conversationId, conversationId, partnerId, partnerUsername: profile?.username || 'Usuario',
          partnerAvatar: profile?.avatar_url || '', lastMessage: ordered.at(-1)?.text || '',
          lastMessageAt: ordered.at(-1)?.createdAt || new Date(0).toISOString(), unreadCount: 0,
          otherUserId: partnerId, otherUsername: profile?.username || 'Usuario', otherUserAvatar: profile?.avatar_url || '' }];
      });
      if (activePartnerRef.current === partnerId && AppLifecycle.isActive) await markConversationRead(partnerId, ordered);
    } catch (error) { console.warn('[MessagesContext] conversation load failed', error); throw error; }
  }, [markConversationRead, resolveConversation, user?.id]);

  const loadOlderMessages = useCallback(async (partnerId: string) => {
    const userId = user?.id; const generation = generationRef.current; const cursor = cursorsRef.current.get(partnerId);
    if (!userId || !cursor || olderFlightRef.current.has(partnerId)) return;
    olderFlightRef.current.add(partnerId); setIsLoadingOlder(previous => ({ ...previous, [partnerId]: true }));
    try {
      const conversationId = await resolveConversation(partnerId); const rows = await fetchRecentChatMessages(conversationId, cursor);
      if (activeUserRef.current !== userId || generation !== generationRef.current) return;
      setMessages(previous => ({ ...previous, [partnerId]: mergeMany(previous[partnerId] || [], rows.map(mapChatMessage).reverse()) }));
      const oldest = rows.at(-1); if (oldest) cursorsRef.current.set(partnerId, { createdAt: oldest.created_at, id: oldest.id });
      setHasOlderMessages(previous => ({ ...previous, [partnerId]: rows.length === MESSAGE_PAGE_SIZE }));
    } catch (error) {
      console.warn('[MessagesContext] older messages load failed', error);
    } finally {
      olderFlightRef.current.delete(partnerId);
      if (activeUserRef.current === userId) setIsLoadingOlder(previous => ({ ...previous, [partnerId]: false }));
    }
  }, [resolveConversation, user?.id]);

  const transmitMessage = useCallback(async (partnerId: string, message: Message): Promise<void> => {
    const userId = user?.id; const generation = generationRef.current;
    if (!userId || message.senderId !== userId || !message.clientMessageId) throw new Error('chat_retry_not_authorized');
    setMessages(previous => ({ ...previous, [partnerId]: (previous[partnerId] || []).map(item =>
      item.clientMessageId === message.clientMessageId ? { ...item, deliveryStatus: 'pending' } : item) }));
    try {
      const conversationId = await resolveConversation(partnerId);
      const row = await sendChatMessage({ conversationId, clientMessageId: message.clientMessageId, text: message.text,
        messageType: message.mediaType as 'text' | 'image' | 'video', mediaUrl: message.mediaUrl });
      if (activeUserRef.current !== userId || generation !== generationRef.current) return;
      setMessages(previous => ({ ...previous, [partnerId]: mergeChatMessage(previous[partnerId] || [], mapChatMessage(row)) }));
      await fetchConversations();
    } catch (error) {
      if (activeUserRef.current === userId && generation === generationRef.current) setMessages(previous => ({ ...previous,
        [partnerId]: (previous[partnerId] || []).map(item => item.clientMessageId === message.clientMessageId
          ? { ...item, deliveryStatus: 'failed' } : item) }));
      console.warn('[MessagesContext] message send failed', error); throw error;
    }
  }, [fetchConversations, resolveConversation, user?.id]);

  const sendMessage = useCallback(async (recipientId: string, text: string, mediaUrl?: string, mediaType = 'text') => {
    const userId = user?.id; const normalizedText = text.trim();
    if (!userId || !normalizedText || !['text', 'image', 'video'].includes(mediaType)) throw new Error('chat_message_invalid');
    const clientMessageId = createChatClientMessageId();
    const optimistic: Message = { id: `opt_${clientMessageId}`, clientMessageId, senderId: userId, recipientId,
      text: normalizedText, mediaUrl, mediaType: mediaType as Message['mediaType'], read: false,
      deliveryStatus: 'pending', createdAt: new Date().toISOString() };
    setMessages(previous => ({ ...previous, [recipientId]: mergeChatMessage(previous[recipientId] || [], optimistic) }));
    await transmitMessage(recipientId, optimistic);
  }, [transmitMessage, user?.id]);

  const retryMessage = useCallback(async (partnerId: string, clientMessageId: string) => {
    const key = `${user?.id || ''}:${partnerId}:${clientMessageId}`;
    const message = (messages[partnerId] || []).find(item => item.clientMessageId === clientMessageId && item.deliveryStatus === 'failed');
    if (!message) throw new Error('chat_failed_message_missing');
    return retryFlightRef.current.run(key, () => transmitMessage(partnerId, message));
  }, [messages, transmitMessage, user?.id]);

  const deactivateConversation = useCallback((partnerId: string) => {
    if (focusedPartnerRef.current === partnerId) focusedPartnerRef.current = null;
    if (activePartnerRef.current !== partnerId) return;
    activePartnerRef.current = null; setTypingByUser(previous => ({ ...previous, [partnerId]: false }));
    const session = typingSessionRef.current; typingSessionRef.current = null; typingSessionFlightRef.current = null; void session?.dispose();
  }, []);
  const activateConversation = useCallback(async (partnerId: string) => {
    const userId = user?.id; const generation = generationRef.current; if (!userId || !AppLifecycle.isActive) return;
    focusedPartnerRef.current = partnerId;
    if (activePartnerRef.current !== partnerId) {
      const previous = activePartnerRef.current; if (previous) deactivateConversation(previous);
      activePartnerRef.current = partnerId;
    }
    const conversationId = await resolveConversation(partnerId);
    if (activeUserRef.current !== userId || generation !== generationRef.current || activePartnerRef.current !== partnerId) return;
    if (!typingSessionRef.current) {
      const flight = typingSessionFlightRef.current ?? createChatTypingSession({ userId, partnerId, conversationId, generation,
        onRemoteChange: typing => { if (activeUserRef.current === userId && generation === generationRef.current
          && activePartnerRef.current === partnerId && AppLifecycle.isActive) setTypingByUser(previous => ({ ...previous, [partnerId]: typing })); } });
      typingSessionFlightRef.current = flight;
      try {
        const session = await flight;
        if (activeUserRef.current !== userId || generation !== generationRef.current || activePartnerRef.current !== partnerId) {
          await session.dispose(); return;
        }
        typingSessionRef.current = session;
      } catch (error) {
        console.warn('[MessagesContext] typing channel unavailable', error);
      } finally {
        if (typingSessionFlightRef.current === flight) typingSessionFlightRef.current = null;
      }
    }
    await markConversationRead(partnerId);
  }, [deactivateConversation, markConversationRead, resolveConversation, user?.id]);
  const setConversationTyping = useCallback((partnerId: string, hasText: boolean) => {
    if (activePartnerRef.current !== partnerId || !AppLifecycle.isActive) return;
    void typingSessionRef.current?.setTyping(hasText).catch(error => console.warn('[MessagesContext] typing signal failed', error));
  }, []);

  useEffect(() => {
    const userId = user?.id; const generation = ++generationRef.current;
    const ownedConversationIds = conversationIdsRef.current;
    setConversations([]); setMessages({}); setHasOlderMessages({}); setIsLoadingOlder({}); setPresenceByUser({}); setTypingByUser({});
    setIsLoading(Boolean(userId));
    conversationIdsRef.current.clear(); cursorsRef.current.clear(); retryFlightRef.current.clear(); olderFlightRef.current.clear();
    activePartnerRef.current = null; focusedPartnerRef.current = null;
    void typingSessionRef.current?.dispose(); typingSessionRef.current = null; typingSessionFlightRef.current = null;
    PollingManager.unregister('messages_conversations'); if (!userId) return;
    let active = true;
    const reconcileDeliveries = () => acknowledgePendingChatDeliveries().then(count => { if (count > 0) void fetchConversations(); })
      .catch(error => console.warn('[MessagesContext] delivery reconciliation failed', error));
    const reconcile = () => {
      if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
      void fetchConversations();
      const partner = activePartnerRef.current;
      if (partner) void loadConversation(partner).catch(error => console.warn('[MessagesContext] message reconciliation failed', error));
    };
    const unsubscribePresence = PresenceManager.onPresenceChange(users => {
      if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
      setPresenceByUser(Object.fromEntries(users.map(item => [item.userId, item.presence?.status === 'online' ? 'online' : 'offline'])));
    });
    const unsubscribe = subscribeToChatChanges({ userId,
      onMessage: row => {
        if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
        if (row.sender_id !== userId && row.recipient_id !== userId) return;
        const partnerId = row.sender_id === userId ? row.recipient_id : row.sender_id;
        conversationIdsRef.current.set(partnerId, row.conversation_id);
        setMessages(previous => ({ ...previous, [partnerId]: mergeChatMessage(previous[partnerId] || [], mapChatMessage(row)) }));
        if (row.recipient_id === userId) {
          void acknowledgeChatDelivery(row.id).then(() => {
            if (activePartnerRef.current === partnerId && AppLifecycle.isActive) void markConversationRead(partnerId, [mapChatMessage(row)]);
          }).catch(error => console.warn('[MessagesContext] delivery acknowledgement failed', error));
        }
        reconcile();
      },
      onReceipt: receipt => {
        if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
        const deliveryStatus = receiptStatus(receipt);
        setMessages(previous => Object.fromEntries(Object.entries(previous).map(([partnerId, rows]) => [partnerId,
          rows.map(message => message.id === receipt.message_id
            ? { ...message, deliveryStatus: monotonicDeliveryStatus(message.deliveryStatus, deliveryStatus),
              read: monotonicDeliveryStatus(message.deliveryStatus, deliveryStatus) === 'read' } : message)])));
      }, onReconcile: reconcile, onSubscribed: reconcileDeliveries,
    });
    const foregroundUnsub = AppLifecycle.onForeground(() => {
      if (!active || generation !== generationRef.current) return; void reconcileDeliveries();
      const partner = focusedPartnerRef.current; if (partner) void activateConversation(partner).then(() => loadConversation(partner));
    });
    const backgroundUnsub = AppLifecycle.onBackground(() => {
      const partner = activePartnerRef.current; activePartnerRef.current = null;
      if (partner) setTypingByUser(previous => ({ ...previous, [partner]: false }));
      const session = typingSessionRef.current; typingSessionRef.current = null; typingSessionFlightRef.current = null; void session?.dispose();
    });
    void reconcileDeliveries(); void fetchConversations().finally(() => { if (active && activeUserRef.current === userId) setIsLoading(false); });
    PollingManager.register({ key: 'messages_conversations', intervalMs: 30_000, fn: async () => {
      await fetchConversations(); const partner = activePartnerRef.current; if (partner) await loadConversation(partner);
    }, runImmediately: false, backgroundFactor: 0 });
    return () => {
      active = false; unsubscribe(); unsubscribePresence(); foregroundUnsub(); backgroundUnsub();
      PollingManager.unregister('messages_conversations'); PresenceManager.unwatchUsers([...watchedPartnersRef.current]);
      watchedPartnersRef.current.clear(); ownedConversationIds.clear(); void typingSessionRef.current?.dispose(); typingSessionRef.current = null;
    };
  }, [activateConversation, deactivateConversation, fetchConversations, loadConversation, markConversationRead, user?.id]);

  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const applicationBadgeCount = user?.id ? unreadTotal : 0;
  useEffect(() => { Notifications.setBadgeCountAsync(applicationBadgeCount).catch(() => undefined); }, [applicationBadgeCount]);
  return <MessagesContext.Provider value={{ conversations, messages, unreadTotal, isLoading, hasOlderMessages, isLoadingOlder,
    presenceByUser, typingByUser, sendMessage, retryMessage, loadConversation, loadOlderMessages, markConversationRead,
    refreshConversations, activateConversation, deactivateConversation, setConversationTyping }}>{children}</MessagesContext.Provider>;
}
