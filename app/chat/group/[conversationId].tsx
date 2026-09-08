import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  StyleSheet, Text, TextInput, View, type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { MessageDeliveryIndicator } from '@/components/chat/MessageDeliveryIndicator';
import { MessageReceiptSheet } from '@/components/chat/MessageReceiptSheet';
import { PrivateChatImage } from '@/components/chat/PrivateChatImage';
import { PrivateChatVideo } from '@/components/chat/PrivateChatVideo';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import { VoiceRecorderBar } from '@/components/chat/VoiceRecorderBar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { Message } from '@/contexts/MessagesContext';
import { useAuth } from '@/hooks/useAuth';
import { useMessages } from '@/hooks/useMessages';
import { generateUUID } from '@/services/agoraService';
import { sendCallNotification } from '@/services/callNotificationService';
import { getActiveGroupCall, startGroupCall, type CallType, type GroupCallSession } from '@/services/callSessionService';
import { uploadPrivateChatImage, uploadPrivateChatVideo } from '@/services/chatMediaService';
import { ChatVoiceDraftSender } from '@/services/chatVoiceService';
import { clearActiveMessageConversation, setActiveMessageConversation } from '@/services/messageNotificationPresentation';
import { timeAgo } from '@/services/mockData';
import { getSupabaseClient } from '@/template';

const INPUT_MIN_HEIGHT = 42;
const INPUT_MAX_HEIGHT = 112;

export default function GroupChatScreen() {
  const { conversationId = '' } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const ctx = useMessages();
  const {
    activateConversationById, conversations, deactivateConversationById, hasOlderMessages,
    isLoadingOlder, loadOlderConversationMessages, messages: messagesByConversation,
    retryConversationMessage, sendConversationMessage, sendConversationVoiceMessage,
  } = ctx;
  const conversation = conversations.find(item => item.id === conversationId);
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [activeVoice, setActiveVoice] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<GroupCallSession | null>(null);
  const callStartRef = useRef(false);
  const voiceDraftSenderRef = useRef(new ChatVoiceDraftSender());

  useFocusEffect(useCallback(() => {
    if (!conversationId) return undefined;
    setActiveMessageConversation(conversationId);
    void activateConversationById(conversationId);
    return () => {
      clearActiveMessageConversation(conversationId);
      deactivateConversationById(conversationId);
    };
  }, [activateConversationById, conversationId, deactivateConversationById]));

  useEffect(() => () => {
    setActiveVoice(null);
    voiceDraftSenderRef.current.clear();
  }, [conversationId, user?.id]);

  useEffect(() => {
    if (!conversationId) return undefined;
    let stale = false;
    let cleanupFlight: Promise<unknown> | null = null;
    const supabase = getSupabaseClient();
    const refresh = () => void getActiveGroupCall(conversationId).then(call => {
      if (!stale) setActiveCall(call);
    }).catch(() => { if (!stale) setActiveCall(null); });
    refresh();
    // realtime-js 2.106.1 reuses channels by topic. A mount-scoped topic avoids
    // reusing a joined channel while removeChannel completes during dev remounts.
    const channel = supabase.channel(`chat-group-call-entry:${conversationId}:${generateUUID()}`);
    channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'calls', filter: `conversation_id=eq.${conversationId}`,
    }, refresh);
    channel.subscribe();
    return () => {
      stale = true;
      cleanupFlight ??= supabase.removeChannel(channel).catch(() => undefined);
      void cleanupFlight;
    };
  }, [conversationId]);

  const openGroupCall = useCallback((call: GroupCallSession) => router.push({
    pathname: '/group-call/[roomId]',
    params: { roomId: call.callId, conversationId, callType: call.callType, creatorId: call.callerId },
  } as any), [conversationId, router]);

  const startCall = useCallback(async (callType: CallType) => {
    if (callStartRef.current || !conversationId) return;
    callStartRef.current = true;
    try {
      const existing = await getActiveGroupCall(conversationId);
      const call = existing ?? await startGroupCall({ conversationId, callType, idempotencyKey: generateUUID() });
      setActiveCall(call);
      if (!existing) void sendCallNotification(call.callId, 'incoming_call').catch(() => undefined);
      openGroupCall(call);
    } catch (error) {
      Alert.alert('Llamada no iniciada', error instanceof Error ? error.message : 'No se pudo iniciar.');
    } finally {
      callStartRef.current = false;
    }
  }, [conversationId, openGroupCall]);

  const handleInputContentSizeChange = useCallback((
    event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
  ) => {
    const nextHeight = Math.min(
      INPUT_MAX_HEIGHT,
      Math.max(INPUT_MIN_HEIGHT, event.nativeEvent.contentSize.height),
    );
    setInputHeight(currentHeight => (
      Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight
    ));
  }, []);

  const send = useCallback(async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true); setText(''); setInputHeight(INPUT_MIN_HEIGHT);
    try {
      await sendConversationMessage(conversationId, value);
    } catch (error) {
      setText(value);
      Alert.alert('Mensaje no enviado', error instanceof Error ? error.message : 'No se pudo enviar.');
    } finally {
      setSending(false);
    }
  }, [conversationId, sendConversationMessage, sending, text]);

  const pickMedia = useCallback(async () => {
    if (uploading) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7 });
      if (result.canceled) return;
      setUploading(true);
      const asset = result.assets[0];
      const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video/') === true
        || /\.(mp4|mov)$/i.test(asset.fileName || asset.uri);
      if (isVideo) {
        const mimeType = asset.mimeType || (/\.mov$/i.test(asset.fileName || asset.uri) ? 'video/quicktime' : 'video/mp4');
        const mediaAssetId = await uploadPrivateChatVideo({
          uri: asset.uri, mimeType, fileName: asset.fileName || undefined, sizeBytes: asset.fileSize,
        });
        await sendConversationMessage(conversationId, 'Video', { mediaType: 'video', mediaAssetId });
      } else {
        const mediaAssetId = await uploadPrivateChatImage({
          uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg', fileName: asset.fileName || undefined, sizeBytes: asset.fileSize,
        });
        await sendConversationMessage(conversationId, 'Foto', { mediaType: 'image', mediaAssetId });
      }
    } catch (error) {
      Alert.alert('Archivo no enviado', error instanceof Error ? error.message : 'No se pudo enviar.');
    } finally {
      setUploading(false);
    }
  }, [conversationId, sendConversationMessage, uploading]);

  const messages = useMemo(() => messagesByConversation[conversationId] || [], [conversationId, messagesByConversation]);
  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const mine = item.senderId === user?.id;
    const retry = item.deliveryStatus === 'failed' && item.clientMessageId
      ? () => void retryConversationMessage(conversationId, item.clientMessageId!) : undefined;
    return <View style={[styles.messageRow, mine && styles.messageRowMine]}>
      {!mine ? <Avatar uri={item.senderAvatar} username={item.senderUsername} size={28} /> : null}
      <Pressable onLongPress={() => mine && !item.id.startsWith('opt_') && setReceiptId(item.id)}
        style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {!mine ? <Text style={styles.sender}>@{item.senderUsername || 'usuario'}</Text> : null}
        {item.mediaType === 'voice' && item.mediaAssetId ? <VoiceMessageBubble
          messageId={item.id} assetId={item.mediaAssetId} durationMs={item.audioDurationMs || 1}
          waveform={item.audioWaveform || Array(48).fill(0)} isMine={mine}
          activeMessageId={activeVoice} onActivate={setActiveVoice}
        /> : item.mediaType === 'image' ? <PrivateChatImage assetId={item.mediaAssetId} legacyUrl={item.mediaUrl} />
          : item.mediaType === 'video' ? <PrivateChatVideo assetId={item.mediaAssetId} />
          : <Text style={styles.body}>{item.text}</Text>}
        <View style={styles.meta}>
          <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
          {mine ? <MessageDeliveryIndicator status={item.deliveryStatus} onRetry={retry} /> : null}
        </View>
      </Pressable>
    </View>;
  }, [activeVoice, conversationId, retryConversationMessage, user?.id]);

  return <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
    <View style={styles.header}>
      <Pressable accessibilityLabel="Volver" onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
        <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.textPrimary} />
      </Pressable>
      <Pressable style={styles.headerIdentity} onPress={() => router.push(`/chat/group/${conversationId}/info` as any)}>
        <Avatar uri={conversation?.avatar} username={conversation?.displayName || 'Grupo'} size={38} />
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.title}>{conversation?.displayName || 'Grupo'}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>{activeCall ? 'Llamada en curso' : `${conversation?.memberCount || 0} miembros`}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityLabel="Llamada de audio grupal" onPress={() => void startCall('audio')} style={styles.iconButton}>
        <MaterialCommunityIcons name="phone-outline" size={22} color={Colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityLabel="Videollamada grupal" onPress={() => void startCall('video')} style={styles.iconButton}>
        <MaterialCommunityIcons name="video-outline" size={23} color={Colors.textPrimary} />
      </Pressable>
      <Pressable accessibilityLabel="Información del grupo" onPress={() => router.push(`/chat/group/${conversationId}/info` as any)} style={styles.iconButton}>
        <MaterialCommunityIcons name="information-outline" size={22} color={Colors.textPrimary} />
      </Pressable>
    </View>

    {activeCall ? <Pressable style={styles.callBanner} onPress={() => openGroupCall(activeCall)}>
      <MaterialCommunityIcons name={activeCall.callType === 'audio' ? 'phone' : 'video'} size={18} color="#fff" />
      <View style={{ flex: 1 }}><Text style={styles.callBannerTitle}>Llamada grupal en curso</Text>
        <Text style={styles.callBannerSubtitle}>Toca para volver a unirte</Text></View>
      <MaterialCommunityIcons name="chevron-right" size={22} color="#fff" />
    </Pressable> : null}

    {messages.length ? <FlatList
      data={messages} keyExtractor={item => item.id} renderItem={renderMessage}
      contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false} maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      ListHeaderComponent={isLoadingOlder[conversationId]
        ? <ActivityIndicator size="small" color={Colors.primary} /> : <View style={styles.listTop} />}
      onScroll={event => {
        if (event.nativeEvent.contentOffset.y <= 24 && hasOlderMessages[conversationId]) {
          void loadOlderConversationMessages(conversationId);
        }
      }} scrollEventThrottle={100}
    /> : <View style={styles.empty}>
      <Avatar uri={conversation?.avatar} username={conversation?.displayName || 'Grupo'} size={68} showBorder />
      <Text style={styles.emptyTitle}>{conversation?.displayName || 'Grupo'}</Text>
      <Text style={styles.emptyText}>Envía el primer mensaje al grupo</Text>
    </View>}

    <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
      {!voiceRecording ? <Pressable accessibilityLabel="Enviar foto o video" onPress={() => void pickMedia()}
        disabled={uploading || sending} style={styles.composerAction}>
        {uploading ? <ActivityIndicator size="small" color={Colors.primary} />
          : <MaterialCommunityIcons name="image-outline" size={23} color={Colors.textSecondary} />}
      </Pressable> : null}
      {!voiceRecording ? <TextInput style={[styles.input, { height: inputHeight }]} value={text} onChangeText={setText}
        placeholder="Mensaje" placeholderTextColor={Colors.textSubtle} multiline maxLength={1000}
        scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
        onContentSizeChange={handleInputContentSizeChange}
      /> : null}
      <View style={[styles.composerTrailing, voiceRecording ? styles.composerTrailingRecording : styles.composerTrailingIdle]}>
        {text.trim() && !voiceRecording ? <Pressable accessibilityLabel="Enviar mensaje" onPress={() => void send()}
          disabled={sending} style={styles.sendButton}>
          {sending ? <ActivityIndicator size="small" color="#fff" />
            : <MaterialCommunityIcons name="send" size={18} color="#fff" />}
        </Pressable> : <VoiceRecorderBar identityKey={`${user?.id || ''}:${conversationId}`}
          disabled={!user?.id || uploading || sending} onRecordingChange={setVoiceRecording}
          onError={message => Alert.alert('Nota de voz', message)}
          onSend={draft => voiceDraftSenderRef.current.handoff(
            draft, input => sendConversationVoiceMessage(conversationId, input),
          ).then(() => undefined)}
        />}
      </View>
    </View>
    <MessageReceiptSheet messageId={receiptId} visible={Boolean(receiptId)} onClose={() => setReceiptId(null)} />
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  iconButton: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: Colors.textPrimary, fontWeight: FontWeight.semibold, fontSize: FontSize.md },
  subtitle: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },
  callBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md,
    paddingVertical: 10, backgroundColor: Colors.primary },
  callBannerTitle: { color: '#fff', fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  callBannerSubtitle: { color: '#FFFFFFBB', fontSize: FontSize.xs },
  list: { flexGrow: 1, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 6 },
  listTop: { height: 4 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginVertical: 2 },
  messageRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', minWidth: 78, paddingHorizontal: 11, paddingVertical: 8, borderRadius: Radius.lg },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.primaryDim2, borderBottomRightRadius: Radius.xs },
  theirs: { alignSelf: 'flex-start', backgroundColor: Colors.surfaceElevated, borderBottomLeftRadius: Radius.xs },
  sender: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, marginBottom: 3 },
  body: { color: Colors.textPrimary, fontSize: FontSize.md, lineHeight: 20 },
  meta: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  time: { color: Colors.textSubtle, fontSize: 9 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  emptyTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, marginTop: Spacing.md },
  emptyText: { color: Colors.textSubtle, fontSize: FontSize.sm, marginTop: Spacing.xs },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.borderSubtle, backgroundColor: Colors.surface },
  composerAction: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: INPUT_MIN_HEIGHT, maxHeight: INPUT_MAX_HEIGHT, color: Colors.textPrimary,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, paddingHorizontal: 15, paddingVertical: 10,
    fontSize: FontSize.md, textAlignVertical: 'top' },
  composerTrailing: { minHeight: 46, alignItems: 'center', justifyContent: 'flex-end' },
  composerTrailingIdle: { width: 46 },
  composerTrailingRecording: { flex: 1 },
  sendButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
});
