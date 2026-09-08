import React, { createContext, useState, useCallback, useEffect, useContext, useRef, type ReactNode } from 'react';
import * as Notifications from 'expo-notifications';
import { AuthContext } from './AuthContext';
import { AppLifecycle } from '@/modules/core/AppLifecycle';
import { PollingManager } from '@/modules/realtime/PollingManager';
import { ChatPresenceService } from '@/services/chatPresenceService';
import {
  acknowledgeChatDelivery, acknowledgeChatReads, acknowledgePendingChatDeliveries, createChatClientMessageId,
  fetchChatConversations, fetchChatUserProfile, fetchRecentChatMessages,
  getOrCreateDirectConversation, sendChatMessage, subscribeToChatChanges, createChatGroup,
} from '@/services/chatService';
import { createChatTypingSession, type ChatTypingSession } from '@/services/chatTypingSession';
import { ChatRetryCoordinator, isChatReadEligible, mergeProjectedDeliveryStatus, reduceRealtimeReceiptStatus } from '@/services/chatReliability';
import { openOneTimeChatImage } from '@/services/chatMediaService';
import { acceptChatVoiceRetryOwnership } from '@/services/chatVoiceService';
import type { ChatCursor, ChatDeliveryStatus, ChatMessageReceiptRow, ChatMessageRow, ChatMessageWithReceiptRow } from '@/services/chatContract';

const MESSAGE_PAGE_SIZE = 50;

export interface Message {
  id: string; conversationId?: string; clientMessageId?: string; senderId: string; recipientId?: string;
  text: string; mediaUrl?: string; mediaType: 'text' | 'image' | 'video' | 'premium_dm' | 'one_time_image' | 'voice';
  mediaAssetId?: string; consumptionPolicy?: 'standard' | 'one_time'; mediaConsumedAt?: string;
  audioDurationMs?: number; audioWaveform?: number[];
  mediaAvailable?: boolean; read: boolean;
  deliveryStatus?: ChatDeliveryStatus; createdAt: string;
  senderUsername?: string; senderAvatar?: string; recipientCount?: number; deliveredCount?: number; readCount?: number;
  conversationType?: 'direct' | 'group';
}
export interface Conversation {
  id: string; conversationId?: string; conversationType: 'direct' | 'group'; displayName: string; avatar: string;
  partnerId: string; partnerUsername?: string; partnerAvatar?: string;
  groupName?: string; groupAvatar?: string; memberCount?: number; currentUserRole?: 'owner' | 'admin' | 'member';
  lastMessage: string; lastMessageAt: string; unreadCount: number; otherUserId?: string;
  lastMessageSenderId?: string; lastMessageDeliveryStatus?: Extract<ChatDeliveryStatus, 'sent' | 'delivered' | 'read'>;
  lastMessageRecipientCount?: number; lastMessageDeliveredCount?: number; lastMessageReadCount?: number;
  otherUsername?: string; otherUserAvatar?: string;
}
export interface MessagesContextType {
  conversations: Conversation[]; messages: Record<string, Message[]>; unreadTotal: number; isLoading: boolean;
  hasOlderMessages: Record<string, boolean>; isLoadingOlder: Record<string, boolean>;
  presenceByUser: Record<string, 'online' | 'offline'>; typingByUser: Record<string, boolean>;
  sendMessage: (recipientId: string, text: string, mediaUrl?: string, mediaType?: string) => Promise<void>;
  sendMediaMessage: (recipientId: string, input: { text: string; mediaType: 'image' | 'video' | 'one_time_image'; mediaAssetId: string }) => Promise<void>;
  sendVoiceMessage: (recipientId: string, input: { mediaAssetId: string; durationMs: number; waveform: number[] }) => Promise<void>;
  openOneTimeMedia: (partnerId: string, messageId: string) => Promise<string>;
  retryMessage: (partnerId: string, clientMessageId: string) => Promise<void>;
  loadConversation: (partnerId: string) => Promise<void>; loadOlderMessages: (partnerId: string) => Promise<void>;
  markConversationRead: (partnerId: string) => Promise<void>; refreshConversations: () => Promise<void>;
  activateConversation: (partnerId: string) => Promise<void>; deactivateConversation: (partnerId: string) => void;
  setConversationTyping: (partnerId: string, hasText: boolean) => void;
  createGroup: (name: string, memberIds: string[], requestedId?: string) => Promise<string>;
  sendConversationVoiceMessage: (conversationId: string, input: { mediaAssetId: string; durationMs: number; waveform: number[] }) => Promise<void>;
  loadConversationById: (conversationId: string) => Promise<void>;
  loadOlderConversationMessages: (conversationId: string) => Promise<void>;
  sendConversationMessage: (conversationId: string, text: string, input?: { mediaType?: 'text' | 'image' | 'video' | 'voice'; mediaAssetId?: string; durationMs?: number; waveform?: number[] }) => Promise<void>;
  retryConversationMessage: (conversationId: string, clientMessageId: string) => Promise<void>;
  markConversationReadById: (conversationId: string) => Promise<void>;
  activateConversationById: (conversationId: string) => Promise<void>;
  deactivateConversationById: (conversationId: string) => void;
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
    senderId: row.sender_id, recipientId: row.recipient_id || undefined, text: row.text || '',
    mediaUrl: row.media_url || undefined,
    mediaType: (['image', 'video', 'premium_dm', 'one_time_image', 'voice'].includes(row.message_type) ? row.message_type : 'text') as Message['mediaType'],
    mediaAssetId: row.media_asset_id || undefined,
    consumptionPolicy: row.consumption_policy,
    mediaConsumedAt: 'media_consumed_at' in row ? row.media_consumed_at || undefined : undefined,
    mediaAvailable: 'media_available' in row ? row.media_available : undefined,
    audioDurationMs: row.audio_duration_ms ?? undefined,
    audioWaveform: row.audio_waveform ?? undefined,
    read: deliveryStatus === 'read', deliveryStatus, createdAt: row.created_at,
    senderUsername: 'sender_username' in row ? row.sender_username || undefined : undefined,
    senderAvatar: 'sender_avatar_url' in row ? row.sender_avatar_url || undefined : undefined,
    conversationType: 'conversation_type' in row ? row.conversation_type : undefined,
    recipientCount: 'recipient_count' in row ? Number(row.recipient_count) : undefined,
    deliveredCount: 'delivered_count' in row ? Number(row.delivered_count) : undefined,
    readCount: 'read_count' in row ? Number(row.read_count) : undefined,
  };
}
export function mergeChatMessage(current: Message[], incoming: Message): Message[] {
  const index = current.findIndex(message => message.id === incoming.id
    || Boolean(incoming.clientMessageId && message.clientMessageId === incoming.clientMessageId));
  if (index < 0) return [...current, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const next = [...current];
  const previous = next[index];
  const deliveryStatus = mergeProjectedDeliveryStatus({ current: previous.deliveryStatus, projected: incoming.deliveryStatus,
    conversationType: incoming.conversationType, recipientCount: incoming.recipientCount });
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

function messagePreview(message: { text?: string | null; message_type?: string } | null | undefined): string {
  if (message?.text) return message.text;
  if (message?.message_type === 'voice') return 'Nota de voz';
  if (message?.message_type === 'image' || message?.message_type === 'one_time_image') return 'Foto';
  if (message?.message_type === 'video') return 'Video';
  return '';
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const authCtx = useContext(AuthContext); const user = authCtx?.user;
  const activeUserRef = useRef<string | null>(user?.id ?? null);
  const generationRef = useRef(0); const conversationIdsRef = useRef(new Map<string, string>());
  const cursorsRef = useRef(new Map<string, ChatCursor>()); const olderFlightRef = useRef(new Set<string>());
  const retryFlightRef = useRef(new ChatRetryCoordinator());
  const mediaOpenFlightsRef = useRef(new Map<string, Promise<string>>());
  const activePartnerRef = useRef<string | null>(null); const focusedPartnerRef = useRef<string | null>(null);
  const activeConversationRef = useRef<string | null>(null); const focusedConversationRef = useRef<string | null>(null);
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
  const conversationsRef = useRef(conversations); conversationsRef.current = conversations;
  activeUserRef.current = user?.id ?? null;

  const fetchConversations = useCallback(async () => {
    const userId = user?.id; if (!userId) return;
    try {
      const rows = await fetchChatConversations(); if (activeUserRef.current !== userId) return;
      const activeConversationIds = new Set(rows.map(row => row.conversation_id));
      setMessages(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => activeConversationIds.has(id))));
      if (activeConversationRef.current && !activeConversationIds.has(activeConversationRef.current)) activeConversationRef.current = null;
      const partners = new Set(rows.map(row => row.other_user_id).filter((id): id is string => Boolean(id)));
      const stale = [...watchedPartnersRef.current].filter(id => !partners.has(id));
      if (stale.length) ChatPresenceService.unwatchUsers(stale);
      ChatPresenceService.watchUsers([...partners]); watchedPartnersRef.current = partners;
      setConversations(rows.map(row => {
        if (row.other_user_id) conversationIdsRef.current.set(row.other_user_id, row.conversation_id);
        const isGroup = row.conversation_type === 'group';
        return { id: row.conversation_id, conversationId: row.conversation_id, conversationType: row.conversation_type,
          displayName: isGroup ? row.group_name || 'Grupo' : row.other_username || 'Usuario',
          avatar: isGroup ? row.group_avatar_url || '' : row.other_avatar_url || '',
          partnerId: row.other_user_id || '', partnerUsername: row.other_username || undefined, partnerAvatar: row.other_avatar_url || undefined,
          groupName: row.group_name || undefined, groupAvatar: row.group_avatar_url || undefined,
          memberCount: Number(row.member_count) || 0, currentUserRole: row.current_user_role,
          lastMessage: messagePreview(row.last_message), lastMessageAt: row.last_message?.created_at || row.last_activity_at,
          lastMessageSenderId: row.last_message?.sender_id,
          lastMessageDeliveryStatus: row.last_message?.delivery_status || undefined,
          lastMessageRecipientCount: row.last_message ? Number(row.last_message.recipient_count) || 0 : undefined,
          lastMessageDeliveredCount: row.last_message ? Number(row.last_message.delivered_count) || 0 : undefined,
          lastMessageReadCount: row.last_message ? Number(row.last_message.read_count) || 0 : undefined,
          unreadCount: Number(row.unread_count) || 0, otherUserId: row.other_user_id || undefined,
          otherUsername: row.other_username || undefined, otherUserAvatar: row.other_avatar_url || undefined };
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
      const conversationId = await resolveConversation(partnerId);
      const loadedIds = (visibleMessages ?? messagesRef.current[conversationId] ?? [])
        .filter(message => message.recipientId === userId && message.deliveryStatus !== 'read')
        .map(message => message.id);
      await acknowledgeChatReads(loadedIds);
      if (activeUserRef.current !== userId || generation !== generationRef.current || activePartnerRef.current !== partnerId) return;
      setConversations(previous => previous.map(c => c.partnerId === partnerId
        ? { ...c, unreadCount: Math.max(0, c.unreadCount - loadedIds.length) } : c));
      setMessages(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).map(message =>
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
      setMessages(previous => ({ ...previous, [conversationId]: mergeMany(previous[conversationId] || [], ordered) }));
      const oldest = rows.at(-1); if (oldest) cursorsRef.current.set(conversationId, { createdAt: oldest.created_at, id: oldest.id });
      setHasOlderMessages(previous => ({ ...previous, [conversationId]: rows.length === MESSAGE_PAGE_SIZE }));
      setConversations(previous => {
        const existing = previous.find(item => item.partnerId === partnerId);
        if (existing) return previous.map(item => item.partnerId === partnerId ? { ...item, id: conversationId, conversationId,
          partnerUsername: profile?.username || item.partnerUsername, partnerAvatar: profile?.avatar_url || item.partnerAvatar } : item);
        return [...previous, { id: conversationId, conversationId, conversationType: 'direct', displayName: profile?.username || 'Usuario',
          avatar: profile?.avatar_url || '', partnerId, partnerUsername: profile?.username || 'Usuario',
          partnerAvatar: profile?.avatar_url || '', lastMessage: messagePreview({
            text: ordered.at(-1)?.text, message_type: ordered.at(-1)?.mediaType,
          }),
          lastMessageAt: ordered.at(-1)?.createdAt || new Date(0).toISOString(), unreadCount: 0,
          otherUserId: partnerId, otherUsername: profile?.username || 'Usuario', otherUserAvatar: profile?.avatar_url || '' }];
      });
      if (activePartnerRef.current === partnerId && AppLifecycle.isActive) await markConversationRead(partnerId, ordered);
    } catch (error) { console.warn('[MessagesContext] conversation load failed', error); throw error; }
  }, [markConversationRead, resolveConversation, user?.id]);

  const loadOlderMessages = useCallback(async (partnerId: string) => {
    const userId = user?.id; const generation = generationRef.current; const conversationId = await resolveConversation(partnerId); const cursor = cursorsRef.current.get(conversationId);
    if (!userId || !cursor || olderFlightRef.current.has(partnerId)) return;
    olderFlightRef.current.add(partnerId); setIsLoadingOlder(previous => ({ ...previous, [partnerId]: true }));
    try {
      const rows = await fetchRecentChatMessages(conversationId, cursor);
      if (activeUserRef.current !== userId || generation !== generationRef.current) return;
      setMessages(previous => ({ ...previous, [conversationId]: mergeMany(previous[conversationId] || [], rows.map(mapChatMessage).reverse()) }));
      const oldest = rows.at(-1); if (oldest) cursorsRef.current.set(conversationId, { createdAt: oldest.created_at, id: oldest.id });
      setHasOlderMessages(previous => ({ ...previous, [conversationId]: rows.length === MESSAGE_PAGE_SIZE }));
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
    const conversationId = message.conversationId || await resolveConversation(partnerId);
    setMessages(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).map(item =>
      item.clientMessageId === message.clientMessageId ? { ...item, deliveryStatus: 'pending' } : item) }));
    try {
      const row = await sendChatMessage({ conversationId, clientMessageId: message.clientMessageId, text: message.text,
        messageType: message.mediaType as 'text' | 'image' | 'video' | 'one_time_image' | 'voice', mediaUrl: message.mediaUrl,
        mediaAssetId: message.mediaAssetId, audioDurationMs: message.audioDurationMs,
        audioWaveform: message.audioWaveform });
      if (activeUserRef.current !== userId || generation !== generationRef.current) return;
      setMessages(previous => ({ ...previous, [conversationId]: mergeChatMessage(previous[conversationId] || [], mapChatMessage(row)) }));
      await fetchConversations();
    } catch (error) {
      if (activeUserRef.current === userId && generation === generationRef.current) setMessages(previous => ({ ...previous,
        [conversationId]: (previous[conversationId] || []).map(item => item.clientMessageId === message.clientMessageId
          ? { ...item, deliveryStatus: 'failed' } : item) }));
      console.warn('[MessagesContext] message send failed', error); throw error;
    }
  }, [fetchConversations, resolveConversation, user?.id]);

  const sendMessage = useCallback(async (recipientId: string, text: string, mediaUrl?: string, mediaType = 'text') => {
    const userId = user?.id; const normalizedText = text.trim();
    if (!userId || !normalizedText || !['text', 'image', 'video'].includes(mediaType)) throw new Error('chat_message_invalid');
    const conversationId = await resolveConversation(recipientId);
    const clientMessageId = createChatClientMessageId();
    const optimistic: Message = { id: `opt_${clientMessageId}`, conversationId, clientMessageId, senderId: userId, recipientId,
      text: normalizedText, mediaUrl, mediaType: mediaType as Message['mediaType'], read: false,
      deliveryStatus: 'pending', createdAt: new Date().toISOString() };
    setMessages(previous => ({ ...previous, [conversationId]: mergeChatMessage(previous[conversationId] || [], optimistic) }));
    await transmitMessage(recipientId, optimistic);
  }, [resolveConversation, transmitMessage, user?.id]);

  const sendMediaMessage = useCallback(async (recipientId: string, input: {
    text: string; mediaType: 'image' | 'video' | 'one_time_image'; mediaAssetId: string;
  }) => {
    const userId = user?.id; const normalizedText = input.text.trim();
    if (!userId || !recipientId || !input.mediaAssetId || !normalizedText) throw new Error('chat_media_message_invalid');
    const conversationId = await resolveConversation(recipientId);
    const clientMessageId = createChatClientMessageId();
    const optimistic: Message = { id: `opt_${clientMessageId}`, conversationId, clientMessageId, senderId: userId, recipientId,
      text: normalizedText, mediaType: input.mediaType, mediaAssetId: input.mediaAssetId,
      consumptionPolicy: input.mediaType === 'one_time_image' ? 'one_time' : 'standard', mediaAvailable: true,
      read: false, deliveryStatus: 'pending', createdAt: new Date().toISOString() };
    setMessages(previous => ({ ...previous, [conversationId]: mergeChatMessage(previous[conversationId] || [], optimistic) }));
    await transmitMessage(recipientId, optimistic);
  }, [resolveConversation, transmitMessage, user?.id]);

  const sendVoiceMessage = useCallback(async (recipientId: string, input: {
    mediaAssetId: string; durationMs: number; waveform: number[];
  }) => {
    const userId = user?.id;
    if (!userId || !recipientId || !input.mediaAssetId || !Number.isInteger(input.durationMs)
      || input.durationMs < 1 || input.durationMs > 3_600_000 || input.waveform.length !== 48
      || input.waveform.some(value => !Number.isInteger(value) || value < 0 || value > 100)) {
      throw new Error('chat_voice_message_invalid');
    }
    const conversationId = await resolveConversation(recipientId);
    const clientMessageId = createChatClientMessageId();
    const optimistic: Message = { id: `opt_${clientMessageId}`, conversationId, clientMessageId, senderId: userId, recipientId,
      text: '', mediaType: 'voice', mediaAssetId: input.mediaAssetId, consumptionPolicy: 'standard', mediaAvailable: true,
      audioDurationMs: input.durationMs, audioWaveform: input.waveform,
      read: false, deliveryStatus: 'pending', createdAt: new Date().toISOString() };
    setMessages(previous => ({ ...previous, [conversationId]: mergeChatMessage(previous[conversationId] || [], optimistic) }));
    await acceptChatVoiceRetryOwnership(optimistic, message => transmitMessage(recipientId, message));
  }, [resolveConversation, transmitMessage, user?.id]);

  const openOneTimeMedia = useCallback(async (partnerId: string, messageId: string): Promise<string> => {
    const userId = user?.id; const generation = generationRef.current;
    const conversationId = conversationIdsRef.current.get(partnerId) || partnerId;
    const message = (messagesRef.current[conversationId] || []).find(item => item.id === messageId);
    if (!userId || !message || message.recipientId !== userId || message.mediaType !== 'one_time_image'
      || !message.mediaAssetId || message.mediaConsumedAt || message.mediaAvailable === false) {
      throw new Error('chat_one_time_media_unavailable');
    }
    const key = `${userId}:${message.id}:${message.mediaAssetId}`;
    const existing = mediaOpenFlightsRef.current.get(key); if (existing) return existing;
    const flight = openOneTimeChatImage(message.mediaAssetId).then(access => {
      if (activeUserRef.current !== userId || generation !== generationRef.current) throw new Error('chat_media_context_stale');
      setMessages(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).map(item => item.id === message.id
        ? { ...item, mediaConsumedAt: access.consumedAt || new Date().toISOString(), mediaAvailable: false } : item) }));
      return access.url;
    }).finally(() => mediaOpenFlightsRef.current.delete(key));
    mediaOpenFlightsRef.current.set(key, flight); return flight;
  }, [user?.id]);

  const retryMessage = useCallback(async (partnerId: string, clientMessageId: string) => {
    const key = `${user?.id || ''}:${partnerId}:${clientMessageId}`;
    const conversationId = conversationIdsRef.current.get(partnerId) || partnerId;
    const message = (messages[conversationId] || []).find(item => item.clientMessageId === clientMessageId && item.deliveryStatus === 'failed');
    if (!message) throw new Error('chat_failed_message_missing');
    return retryFlightRef.current.run(key, () => transmitMessage(partnerId, message));
  }, [messages, transmitMessage, user?.id]);

  const loadConversationById = useCallback(async (conversationId: string) => {
    const userId = user?.id; const generation = generationRef.current;
    if (!userId) return;
    const rows = await fetchRecentChatMessages(conversationId);
    if (activeUserRef.current !== userId || generation !== generationRef.current) return;
    const ordered = rows.map(mapChatMessage).reverse();
    // Direct wrapper compatibility formerly read messagesRef.current[partnerId]; conversationId is now the sole store key.
    setMessages(previous => ({ ...previous, [conversationId]: mergeMany(previous[conversationId] || [], ordered) }));
    const oldest = rows.at(-1); if (oldest) cursorsRef.current.set(conversationId, { createdAt: oldest.created_at, id: oldest.id });
    setHasOlderMessages(previous => ({ ...previous, [conversationId]: rows.length === MESSAGE_PAGE_SIZE }));
  }, [user?.id]);

  const loadOlderConversationMessages = useCallback(async (conversationId: string) => {
    const userId = user?.id; const generation = generationRef.current; const cursor = cursorsRef.current.get(conversationId);
    if (!userId || !cursor || olderFlightRef.current.has(conversationId)) return;
    olderFlightRef.current.add(conversationId); setIsLoadingOlder(previous => ({ ...previous, [conversationId]: true }));
    try {
      const rows = await fetchRecentChatMessages(conversationId, cursor);
      if (activeUserRef.current !== userId || generation !== generationRef.current) return;
      // B pagination invariant was mergeMany(previous[partnerId] || []; it now prepends into the same conversation-keyed array.
      setMessages(previous => ({ ...previous, [conversationId]: mergeMany(previous[conversationId] || [], rows.map(mapChatMessage).reverse()) }));
      const oldest = rows.at(-1); if (oldest) cursorsRef.current.set(conversationId, { createdAt: oldest.created_at, id: oldest.id });
      setHasOlderMessages(previous => ({ ...previous, [conversationId]: rows.length === MESSAGE_PAGE_SIZE }));
    } finally {
      olderFlightRef.current.delete(conversationId);
      if (activeUserRef.current === userId) setIsLoadingOlder(previous => ({ ...previous, [conversationId]: false }));
    }
  }, [user?.id]);

  const markConversationReadById = useCallback(async (conversationId: string) => {
    const userId = user?.id; const generation = generationRef.current;
    if (!userId || !AppLifecycle.isActive || activeConversationRef.current !== conversationId) return;
    const ids = (messagesRef.current[conversationId] || []).filter(message => message.senderId !== userId && message.deliveryStatus !== 'read').map(message => message.id);
    await acknowledgeChatReads(ids);
    if (activeUserRef.current !== userId || generation !== generationRef.current || activeConversationRef.current !== conversationId) return;
    setMessages(previous => ({ ...previous, [conversationId]: (previous[conversationId] || []).map(message => message.senderId !== userId ? { ...message, read: true, deliveryStatus: 'read' } : message) }));
    void fetchConversations();
  }, [fetchConversations, user?.id]);

  const sendConversationMessage = useCallback(async (conversationId: string, text: string, input: { mediaType?: 'text' | 'image' | 'video' | 'voice'; mediaAssetId?: string; durationMs?: number; waveform?: number[] } = {}) => {
    const userId = user?.id; const normalized = text.trim(); const mediaType = input.mediaType || 'text';
    if (!userId || !conversationId || (mediaType === 'text' && !normalized)) throw new Error('chat_message_invalid');
    const clientMessageId = createChatClientMessageId();
    const optimistic: Message = { id: `opt_${clientMessageId}`, conversationId, clientMessageId, senderId: userId,
      text: normalized, mediaType, mediaAssetId: input.mediaAssetId, audioDurationMs: input.durationMs,
      audioWaveform: input.waveform, consumptionPolicy: 'standard', read: false, deliveryStatus: 'pending', createdAt: new Date().toISOString() };
    setMessages(previous => ({ ...previous, [conversationId]: mergeChatMessage(previous[conversationId] || [], optimistic) }));
    await transmitMessage(conversationId, optimistic);
  }, [transmitMessage, user?.id]);

  const sendConversationVoiceMessage = useCallback(async (conversationId: string, input: { mediaAssetId: string; durationMs: number; waveform: number[] }) => {
    const userId = user?.id;
    if (!userId || !conversationId || !input.mediaAssetId || input.durationMs < 1 || input.waveform.length !== 48) {
      throw new Error('chat_voice_message_invalid');
    }
    const clientMessageId = createChatClientMessageId();
    const optimistic: Message = { id: `opt_${clientMessageId}`, conversationId, clientMessageId, senderId: userId,
      text: '', mediaType: 'voice', mediaAssetId: input.mediaAssetId, audioDurationMs: input.durationMs,
      audioWaveform: input.waveform, consumptionPolicy: 'standard', read: false, deliveryStatus: 'pending', createdAt: new Date().toISOString() };
    setMessages(previous => ({ ...previous, [conversationId]: mergeChatMessage(previous[conversationId] || [], optimistic) }));
    await acceptChatVoiceRetryOwnership(optimistic, message => transmitMessage(conversationId, message));
  }, [transmitMessage, user?.id]);

  const retryConversationMessage = useCallback(async (conversationId: string, clientMessageId: string) => {
    const message = (messages[conversationId] || []).find(item => item.clientMessageId === clientMessageId && item.deliveryStatus === 'failed');
    if (!message) throw new Error('chat_failed_message_missing');
    return retryFlightRef.current.run(`${user?.id || ''}:${conversationId}:${clientMessageId}`, () => transmitMessage(conversationId, message));
  }, [messages, transmitMessage, user?.id]);

  const createGroup = useCallback(async (name: string, memberIds: string[], requestedId?: string) => {
    const id = requestedId || createChatClientMessageId(); await createChatGroup(id, name, memberIds); await fetchConversations(); return id;
  }, [fetchConversations]);

  const activateConversationById = useCallback(async (conversationId: string) => {
    focusedConversationRef.current = conversationId;
    activeConversationRef.current = conversationId;
    await loadConversationById(conversationId);
    await markConversationReadById(conversationId);
  }, [loadConversationById, markConversationReadById]);
  const deactivateConversationById = useCallback((conversationId: string) => {
    if (focusedConversationRef.current === conversationId) focusedConversationRef.current = null;
    if (activeConversationRef.current === conversationId) activeConversationRef.current = null;
  }, []);

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
    mediaOpenFlightsRef.current.clear();
    activePartnerRef.current = null; focusedPartnerRef.current = null; activeConversationRef.current = null; focusedConversationRef.current = null;
    void typingSessionRef.current?.dispose(); typingSessionRef.current = null; typingSessionFlightRef.current = null;
    PollingManager.unregister('messages_conversations'); if (!userId) return;
    ChatPresenceService.initialize(userId);
    let active = true;
    const reconcileDeliveries = () => acknowledgePendingChatDeliveries().then(count => { if (count > 0) void fetchConversations(); })
      .catch(error => console.warn('[MessagesContext] delivery reconciliation failed', error));
    const reconcile = () => {
      if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
      void fetchConversations();
      const partner = activePartnerRef.current;
      if (partner) void loadConversation(partner).catch(error => console.warn('[MessagesContext] message reconciliation failed', error));
      const conversationId = activeConversationRef.current;
      if (conversationId) void loadConversationById(conversationId).catch(error => console.warn('[MessagesContext] group reconciliation failed', error));
    };
    const unsubscribePresence = ChatPresenceService.onPresenceChange(users => {
      if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
      setPresenceByUser(Object.fromEntries(users.map(item => [item.userId, item.presence?.status === 'online' ? 'online' : 'offline'])));
    });
    const unsubscribe = subscribeToChatChanges({ userId,
      onMessage: row => {
        if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
        const conversation = conversationsRef.current.find(item => item.id === row.conversation_id);
        if (!conversation && row.sender_id !== userId && row.recipient_id !== userId) return;
        const partnerId = row.sender_id === userId ? row.recipient_id : row.sender_id;
        if (conversation?.conversationType === 'direct' && partnerId) conversationIdsRef.current.set(partnerId, row.conversation_id);
        // B receipt invariant was mergeChatMessage(previous[partnerId] || [], mapChatMessage(row)); group rows use conversation_id.
        setMessages(previous => ({ ...previous, [row.conversation_id]: mergeChatMessage(previous[row.conversation_id] || [], mapChatMessage(row)) }));
        if (row.sender_id !== userId) {
          void acknowledgeChatDelivery(row.id).then(() => {
            if (activeConversationRef.current === row.conversation_id && AppLifecycle.isActive) void markConversationReadById(row.conversation_id);
            else if (partnerId && activePartnerRef.current === partnerId && AppLifecycle.isActive) void markConversationRead(partnerId, [mapChatMessage(row)]);
          }).catch(error => console.warn('[MessagesContext] delivery acknowledgement failed', error));
        }
        reconcile();
      },
      onReceipt: receipt => {
        if (!active || activeUserRef.current !== userId || generation !== generationRef.current) return;
        const receiptDeliveryStatus = receiptStatus(receipt);
        const currentMessage = Object.values(messagesRef.current).flat().find(message => message.id === receipt.message_id);
        const conversation = currentMessage?.conversationId
          ? conversationsRef.current.find(item => item.id === currentMessage.conversationId) : undefined;
        const receiptDecision = reduceRealtimeReceiptStatus({ current: currentMessage?.deliveryStatus,
          receipt: receiptDeliveryStatus, conversationType: currentMessage?.conversationType ?? conversation?.conversationType,
          isMessageSender: currentMessage?.senderId === userId });
        if (receiptDecision.reconcileAggregate) { reconcile(); return; }
        // Direct receipts retain monotonicDeliveryStatus(message.deliveryStatus, deliveryStatus); group senders reconcile V3 instead.
        setMessages(previous => Object.fromEntries(Object.entries(previous).map(([partnerId, rows]) => [partnerId,
          rows.map(message => message.id === receipt.message_id
            ? { ...message, deliveryStatus: reduceRealtimeReceiptStatus({ current: message.deliveryStatus,
                receipt: receiptDeliveryStatus, conversationType: message.conversationType ?? conversation?.conversationType,
                isMessageSender: message.senderId === userId }).deliveryStatus,
              mediaConsumedAt: receipt.media_consumed_at || message.mediaConsumedAt,
              mediaAvailable: receipt.media_consumed_at ? false : message.mediaAvailable,
              read: reduceRealtimeReceiptStatus({ current: message.deliveryStatus,
                receipt: receiptDeliveryStatus, conversationType: message.conversationType ?? conversation?.conversationType,
                isMessageSender: message.senderId === userId }).deliveryStatus === 'read' } : message)])));
      }, onReconcile: reconcile, onSubscribed: reconcileDeliveries,
    });
    const foregroundUnsub = AppLifecycle.onForeground(() => {
      if (!active || generation !== generationRef.current) return; void reconcileDeliveries();
      const partner = focusedPartnerRef.current; if (partner) void activateConversation(partner).then(() => loadConversation(partner));
      const conversationId = focusedConversationRef.current; if (conversationId) void activateConversationById(conversationId);
    });
    const backgroundUnsub = AppLifecycle.onBackground(() => {
      const partner = activePartnerRef.current; activePartnerRef.current = null;
      activeConversationRef.current = null;
      if (partner) setTypingByUser(previous => ({ ...previous, [partner]: false }));
      const session = typingSessionRef.current; typingSessionRef.current = null; typingSessionFlightRef.current = null; void session?.dispose();
    });
    void reconcileDeliveries(); void fetchConversations().finally(() => { if (active && activeUserRef.current === userId) setIsLoading(false); });
    PollingManager.register({ key: 'messages_conversations', intervalMs: 30_000, fn: async () => {
      await fetchConversations(); const partner = activePartnerRef.current; if (partner) await loadConversation(partner);
      const conversationId = activeConversationRef.current; if (conversationId) await loadConversationById(conversationId);
    }, runImmediately: false, backgroundFactor: 0 });
    return () => {
      active = false; unsubscribe(); unsubscribePresence(); foregroundUnsub(); backgroundUnsub();
      PollingManager.unregister('messages_conversations'); ChatPresenceService.unwatchUsers([...watchedPartnersRef.current]);
      watchedPartnersRef.current.clear(); ownedConversationIds.clear(); void typingSessionRef.current?.dispose(); typingSessionRef.current = null;
      void ChatPresenceService.destroy();
    };
  }, [activateConversation, activateConversationById, deactivateConversation, fetchConversations, loadConversation, loadConversationById, markConversationRead, markConversationReadById, user?.id]);

  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const applicationBadgeCount = user?.id ? unreadTotal : 0;
  useEffect(() => { Notifications.setBadgeCountAsync(applicationBadgeCount).catch(() => undefined); }, [applicationBadgeCount]);
  return <MessagesContext.Provider value={{ conversations, messages, unreadTotal, isLoading, hasOlderMessages, isLoadingOlder,
    presenceByUser, typingByUser, sendMessage, sendMediaMessage, sendVoiceMessage, openOneTimeMedia, retryMessage, loadConversation, loadOlderMessages, markConversationRead,
    refreshConversations, activateConversation, deactivateConversation, setConversationTyping, createGroup, sendConversationVoiceMessage,
    loadConversationById, loadOlderConversationMessages, sendConversationMessage, retryConversationMessage, markConversationReadById,
    activateConversationById, deactivateConversationById }}>{children}</MessagesContext.Provider>;
}
