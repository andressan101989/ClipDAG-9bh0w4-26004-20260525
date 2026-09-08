import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet,
  KeyboardAvoidingView, Keyboard, Platform, ActivityIndicator, Modal, Alert,
  NativeSyntheticEvent,
} from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ScreenCapture from 'expo-screen-capture';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { getSupabaseClient, useAlert } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';
import { detectMimeType } from '@/contexts/FeedContext';
import { uploadPrivateChatImage, uploadPrivateChatVideo } from '@/services/chatMediaService';
import { PrivateChatImage } from '@/components/chat/PrivateChatImage';
import { PrivateChatVideo } from '@/components/chat/PrivateChatVideo';
import { ChatVoiceDraftSender, type ChatVoiceDraft } from '@/services/chatVoiceService';
import { VoiceRecorderBar } from '@/components/chat/VoiceRecorderBar';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import { MessageDeliveryIndicator } from '@/components/chat/MessageDeliveryIndicator';
import type { Message } from '@/contexts/MessagesContext';
import {
  clearActiveMessageConversation,
  setActiveMessageConversation,
} from '@/services/messageNotificationPresentation';

const PREMIUM_COLOR  = '#FF9D00';
const PREMIUM_COLOR2 = '#FF5A00';
const INPUT_MIN_HEIGHT = 44;
const INPUT_MAX_HEIGHT = 120;
const ONE_TIME_CAPTURE_KEY = 'chat-one-time-media';

function OneTimeMediaViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  ScreenCapture.usePreventScreenCapture(ONE_TIME_CAPTURE_KEY);
  useEffect(() => {
    if (!url) return undefined;
    void ScreenCapture.enableAppSwitcherProtectionAsync(1).catch(() => undefined);
    return () => { void ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => undefined); };
  }, [url]);
  return <Modal visible={Boolean(url)} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.oneTimeViewer}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cerrar foto" onPress={onClose} style={styles.oneTimeClose}>
        <MaterialCommunityIcons name="close" size={28} color="#fff" />
      </Pressable>
      {url ? <Image source={{ uri: url }} style={styles.oneTimeImage} contentFit="contain" cachePolicy="none" /> : null}
    </View>
  </Modal>;
}

// ── Premium DM Sheet ──────────────────────────────────────────────────────────
interface PremiumDMSheetProps {
  visible: boolean;
  recipientUsername: string;
  dmConfig: { enabled: boolean; price_bdag: number; welcome_message: string } | null;
  balance: number;
  isFreeFromSub: boolean;
  freeLeft: number;
  onClose: () => void;
  onSend: (text: string, amount: number) => Promise<void>;
}

function PremiumDMSheet({
  visible, recipientUsername, dmConfig, balance, isFreeFromSub, freeLeft,
  onClose, onSend,
}: PremiumDMSheetProps) {
  const [msg, setMsg]     = useState('');
  const [sending, setSending] = useState(false);
  const insets = useSafeAreaInsets();

  const price    = dmConfig?.price_bdag ?? 50;
  const canAfford = isFreeFromSub || balance >= price;

  const handleSend = async () => {
    if (!msg.trim()) return;
    setSending(true);
    await onSend(msg.trim(), price);
    setSending(false);
    setMsg('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide"
      presentationStyle="overFullScreen" onRequestClose={onClose}>
      <Pressable style={sh.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[sh.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={sh.handle} />

          {/* Header */}
          <View style={sh.headerRow}>
            <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={sh.headerIcon}>
              <MaterialIcons name="mark-email-read" size={18} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={sh.headerTitle}>DM Premium a @{recipientUsername}</Text>
              <Text style={sh.headerSub}>
                {isFreeFromSub
                  ? `Gratis con suscripción · ${freeLeft} DMs restantes este mes`
                  : `Precio: ${price} BDAG retenidos`}
              </Text>
            </View>
          </View>

          {/* How it works */}
          <View style={sh.howBox}>
            {[
              { icon: 'lock-clock',    text: 'BDAG retenido hasta que el creador responda' },
              { icon: 'priority-high', text: 'Aparece en el tope de la bandeja del creador' },
              { icon: 'replay',        text: 'Reembolso automático si no responde en 72h' },
            ].map(item => (
              <View key={item.text} style={sh.howRow}>
                <MaterialIcons name={item.icon as any} size={13} color={PREMIUM_COLOR} />
                <Text style={sh.howText}>{item.text}</Text>
              </View>
            ))}
          </View>

          {/* Creator welcome message */}
          {dmConfig?.welcome_message ? (
            <View style={sh.welcomeBox}>
              <MaterialIcons name="format-quote" size={14} color={PREMIUM_COLOR} />
              <Text style={sh.welcomeText}>{dmConfig.welcome_message}</Text>
            </View>
          ) : null}

          <TextInput
            style={sh.input}
            value={msg}
            onChangeText={setMsg}
            placeholder="Escribe tu mensaje prioritario..."
            placeholderTextColor={Colors.textSubtle}
            multiline
            maxLength={500}
            autoFocus
          />
          <Text style={sh.charCount}>{msg.length}/500</Text>

          {/* Balance */}
          {isFreeFromSub ? (
            <View style={sh.balRow}>
              <MaterialIcons name="star" size={13} color={Colors.accent} />
              <Text style={[sh.balLabel, { color: Colors.accent }]}>
                Incluido en tu suscripción ({freeLeft} gratis restantes)
              </Text>
            </View>
          ) : (
            <View style={sh.balRow}>
              <Text style={sh.balLabel}>Saldo:</Text>
              <Text style={[sh.balVal, { color: canAfford ? Colors.accent : Colors.error }]}>
                {balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} BDAG
              </Text>
              {!canAfford && <Text style={sh.insuf}>· Saldo insuficiente</Text>}
            </View>
          )}

          <Pressable
            style={[sh.sendBtn, (!msg.trim() || !canAfford || sending) && { opacity: 0.4 }]}
            onPress={handleSend}
            disabled={!msg.trim() || !canAfford || sending}
          >
            <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={sh.sendBtnGrad}>
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialIcons name="send" size={18} color="#fff" />}
              <Text style={sh.sendBtnText}>
                {sending
                  ? 'Enviando...'
                  : isFreeFromSub
                    ? 'Enviar gratis (con suscripción)'
                    : `Enviar · ${price} BDAG`}
              </Text>
            </LinearGradient>
          </Pressable>
          <Pressable style={sh.cancelBtn} onPress={onClose}>
            <Text style={sh.cancelText}>Cancelar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const sh = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet:        { backgroundColor: '#0F0F1E', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: Spacing.lg, gap: Spacing.md, borderTopWidth: 1, borderColor: '#1C1C38' },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  headerRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon:   { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  headerSub:    { color: PREMIUM_COLOR, fontSize: FontSize.xs, marginTop: 2 },
  howBox:       { backgroundColor: 'rgba(255,157,0,0.08)', borderRadius: Radius.md, padding: 12, gap: 7, borderWidth: 1, borderColor: 'rgba(255,157,0,0.2)' },
  howRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  howText:      { color: Colors.textSecondary, fontSize: 11, flex: 1 },
  welcomeBox:   { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(255,157,0,0.06)', borderRadius: Radius.md, padding: 10, borderLeftWidth: 3, borderLeftColor: PREMIUM_COLOR },
  welcomeText:  { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1, fontStyle: 'italic' },
  input:        { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 100, textAlignVertical: 'top' },
  charCount:    { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  balRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balLabel:     { color: Colors.textSubtle, fontSize: FontSize.sm },
  balVal:       { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  insuf:        { color: Colors.error, fontSize: FontSize.xs },
  sendBtn:      { borderRadius: Radius.md, overflow: 'hidden' },
  sendBtnGrad:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  sendBtnText:  { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  cancelBtn:    { alignItems: 'center', paddingVertical: 12 },
  cancelText:   { color: Colors.textSubtle, fontSize: FontSize.sm },
});

// ── Subscriber badge ──────────────────────────────────────────────────────────
function SubscriberBadge({ plan }: { plan: string }) {
  return (
    <LinearGradient colors={['#7C5CFF', '#A855F7']} style={badge.wrap}>
      <MaterialIcons name="star" size={9} color="#fff" />
      <Text style={badge.text}>SUSCRIPTOR · {plan}</Text>
    </LinearGradient>
  );
}
const badge = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  text: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.4 },
});

// ── Main chat screen ──────────────────────────────────────────────────────────
export default function ChatScreen() {
  // Approved Figma: 02 — Direct Conversation — Sofia (FmwCrxtAV5k8jpLFr3RTgy, node 1:112).
  const { userId: partnerId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;
  const {
    messages, conversations, sendMessage, sendMediaMessage, sendVoiceMessage, openOneTimeMedia, retryMessage, loadConversation, loadOlderMessages,
    hasOlderMessages, isLoadingOlder, presenceByUser, typingByUser,
    activateConversation, deactivateConversation, setConversationTyping,
  } = useMessages();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [text,         setText]         = useState('');
  const [isSending,    setIsSending]    = useState(false);
  const [isUploading,  setIsUploading]  = useState(false);
  const [oneTimeMediaUrl, setOneTimeMediaUrl] = useState<string | null>(null);
  const [inputHeight,  setInputHeight]  = useState(INPUT_MIN_HEIGHT);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [composerHeight, setComposerHeight] = useState(72);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [activeVoiceMessageId, setActiveVoiceMessageId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const previousMessageCountRef = useRef(0);
  const isSendingRef = useRef(false);
  const voiceDraftSenderRef = useRef<ChatVoiceDraftSender | null>(null);
  if (!voiceDraftSenderRef.current) voiceDraftSenderRef.current = new ChatVoiceDraftSender();

  // Premium DM state
  const [premiumConfig,   setPremiumConfig]   = useState<{ enabled: boolean; price_bdag: number; welcome_message: string } | null>(null);
  const [premiumSheetVis, setPremiumSheetVis] = useState(false);
  const [subStatus,       setSubStatus]       = useState<{ isSubscribed: boolean; freeDmsRemaining: number; planName: string } | null>(null);
  const [pendingPayment,  setPendingPayment]  = useState<{ payment_id: string; message_id: string; amount: number; creator_earning: number } | null>(null);

  const conversation = conversations.find(c => c.partnerId === partnerId);
  const conversationKey = conversations.find(item => item.partnerId === partnerId)?.conversationId || '';
  const chatMessages = useMemo(() => messages[conversationKey] || [], [messages, conversationKey]);

  useFocusEffect(
    useCallback(() => {
      if (!partnerId) return undefined;
      setActiveMessageConversation(conversationKey || null, partnerId);
      const activation = activateConversation(partnerId);
      void Promise.all([activation, loadConversation(partnerId)]).catch(error => {
        console.warn('[ChatScreen] conversation activation failed', error);
      });
      return () => {
        setOneTimeMediaUrl(null);
        setActiveVoiceMessageId(null);
        setConversationTyping(partnerId, false);
        deactivateConversation(partnerId);
        clearActiveMessageConversation(conversationKey || null, partnerId);
      };
    }, [activateConversation, conversationKey, deactivateConversation, loadConversation, partnerId, setConversationTyping]),
  );

  // ── Load partner's premium DM config + my subscription status ──────────────
  useEffect(() => {
    if (!partnerId || !user?.id) return;
    const load = async () => {
      const [configResult, subResult] = await Promise.all([
        supabase.from('premium_dm_config')
          .select('*').eq('user_id', partnerId).single(),
        supabase.from('creator_subscriptions')
          .select('*, plan:subscription_plans(name)')
          .eq('subscriber_id', user.id)
          .eq('creator_id', partnerId)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
          .single(),
      ]);
      setPremiumConfig(configResult.data ?? null);
      if (subResult.data) {
        setSubStatus({
          isSubscribed: true,
          freeDmsRemaining: Math.max(0, (subResult.data.free_dms_quota ?? 10) - (subResult.data.free_dms_used ?? 0)),
          planName: (subResult.data.plan as any)?.name ?? 'VIP',
        });
      }
    };
    load();
  }, [partnerId, user?.id, supabase]);

  // ── Load pending premium payment (for creator view — show "Cobrar" bar) ────
  useEffect(() => {
    if (!user?.id) return;
    const load = async () => {
      const { data } = await supabase
        .from('premium_dm_payments')
        .select('id, message_id, amount_bdag, creator_earning')
        .eq('sender_id', partnerId ?? '')
        .eq('recipient_id', user.id)
        .eq('status', 'held')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (data) {
        setPendingPayment({
          payment_id: data.id,
          message_id: data.message_id,
          amount: Number(data.amount_bdag),
          creator_earning: Number(data.creator_earning),
        });
      }
    };
    if (partnerId) load();
  }, [partnerId, user?.id, chatMessages.length, supabase]);

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated });
    });

    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated });
    }, 80);
  }, []);

  const handleInputContentSizeChange = useCallback((event: NativeSyntheticEvent<any>) => {
    const nextHeight = Math.min(
      INPUT_MAX_HEIGHT,
      Math.max(INPUT_MIN_HEIGHT, event.nativeEvent.contentSize.height)
    );
    setInputHeight(nextHeight);
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, event => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (chatMessages.length === 0) return;
    const grew = chatMessages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = chatMessages.length;
    if (grew && !isLoadingOlder[conversationKey]) scrollToLatest(true);
  }, [chatMessages.length, conversationKey, isLoadingOlder, partnerId, keyboardHeight, inputHeight, composerHeight, scrollToLatest]);

  // ── Send regular message ──────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!text.trim() || !partnerId || isSendingRef.current) return;
    isSendingRef.current = true; setIsSending(true);
    setConversationTyping(partnerId, false);
    try {
      await sendMessage(partnerId, text.trim());
      setText(''); setInputHeight(INPUT_MIN_HEIGHT);
      scrollToLatest(true);

      // Release only after the reply is durably accepted by the chat server.
      if (pendingPayment && user?.id) {
        const { data } = await supabase.rpc('release_premium_dm', {
          p_creator_id: user.id, p_message_id: pendingPayment.message_id,
        });
        if (data?.success) {
          walletData?.fullSync?.(); setPendingPayment(null);
          showAlert('¡Pago liberado!', `+${Number(data.creator_earned ?? pendingPayment.creator_earning).toFixed(2)} BDAG en tu wallet`);
        }
      }
    } catch {
      showAlert('Mensaje no enviado', 'Toca el indicador de error para reintentar.');
    } finally {
      isSendingRef.current = false; setIsSending(false);
    }
  }, [text, partnerId, sendMessage, pendingPayment, user?.id, supabase, walletData, showAlert, scrollToLatest, setConversationTyping]);

  // ── Send premium DM ───────────────────────────────────────────────────────
  const handleSendPremiumDM = useCallback(async (messageText: string, amount: number) => {
    if (!partnerId || !user?.id) return;
    const { data, error } = await supabase.rpc('send_premium_dm', {
      p_sender_id:    user.id,
      p_recipient_id: partnerId,
      p_amount_bdag:  amount,
      p_message_text: messageText,
    });
    if (error || !data?.success) {
      showAlert('Error', data?.error ?? error?.message ?? 'No se pudo enviar');
      return;
    }
    walletData?.fullSync?.();
    loadConversation(partnerId);
    scrollToLatest(true);
    // Update free DM quota if it was free
    if (data.is_free_dm && subStatus) {
      setSubStatus(prev => prev ? { ...prev, freeDmsRemaining: Math.max(0, prev.freeDmsRemaining - 1) } : prev);
    }
  }, [partnerId, user?.id, supabase, walletData, loadConversation, subStatus, showAlert, scrollToLatest]);

  // ── Release premium payment (creator manually taps "Cobrar") ────────────
  const handleReleasePremiumPayment = useCallback(async () => {
    if (!pendingPayment || !user?.id) return;
    const { data } = await supabase.rpc('release_premium_dm', {
      p_creator_id: user.id,
      p_message_id: pendingPayment.message_id,
    });
    if (data?.success) {
      walletData?.fullSync?.();
      setPendingPayment(null);
      showAlert('¡Pago liberado!', `+${Number(data.creator_earned ?? pendingPayment.creator_earning).toFixed(2)} BDAG`);
    } else {
      showAlert('Error', data?.error ?? 'No se pudo liberar');
    }
  }, [pendingPayment, user?.id, supabase, walletData, showAlert]);

  // ── Pick image ────────────────────────────────────────────────────────────
  const handlePickImage = useCallback(async (mode?: 'normal' | 'one-time') => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permiso denegado', 'Habilita el acceso a la galería'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mode === 'one-time' ? ['images'] : ['images', 'videos'], quality: 0.7,
    });
    if (result.canceled || !result.assets[0] || !user) return;
    const asset = result.assets[0];
    const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video/') === true
      || /\.(mp4|mov)$/i.test(asset.fileName || asset.uri);
    if (isVideo) {
      if (!partnerId) return;
      setIsUploading(true);
      try {
        const mimeType = asset.mimeType || (/\.mov$/i.test(asset.fileName || asset.uri) ? 'video/quicktime' : 'video/mp4');
        const mediaAssetId = await uploadPrivateChatVideo({ uri: asset.uri, mimeType,
          fileName: asset.fileName || undefined, sizeBytes: asset.fileSize });
        await sendMediaMessage(partnerId, { text: 'Video', mediaType: 'video', mediaAssetId });
      } catch {
        showAlert('Mensaje no enviado', 'No se pudo enviar el video. Puedes intentarlo nuevamente.');
      } finally { setIsUploading(false); }
      return;
    }
    const sendSelectedImage = async (oneTime: boolean) => {
      if (!partnerId) return;
      setIsUploading(true);
      try {
        const mimeType = asset.mimeType || detectMimeType(asset.uri, 'image/jpeg');
        const mediaAssetId = await uploadPrivateChatImage({ uri: asset.uri, mimeType,
          fileName: asset.fileName || undefined, sizeBytes: asset.fileSize });
        await sendMediaMessage(partnerId, { text: oneTime ? 'Foto · Ver una vez' : '📷 Imagen',
          mediaType: oneTime ? 'one_time_image' : 'image', mediaAssetId });
      } catch {
        showAlert('Mensaje no enviado', 'No se pudo enviar la imagen. Puedes intentarlo nuevamente.');
      } finally { setIsUploading(false); }
    };
    if (mode) {
      await sendSelectedImage(mode === 'one-time');
      return;
    }
    Alert.alert('Enviar foto', 'Elige cómo compartirla.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Normal', onPress: () => { void sendSelectedImage(false); } },
      { text: 'Ver una vez', onPress: () => { void sendSelectedImage(true); } },
    ]);
  }, [user, partnerId, sendMediaMessage, showAlert]);

  const handleSendVoice = useCallback(async (draft: ChatVoiceDraft) => {
    if (!user?.id || !partnerId) throw new Error('chat_voice_session_invalid');
    await voiceDraftSenderRef.current!.handoff(draft, input => sendVoiceMessage(partnerId, input));
    scrollToLatest(true);
  }, [partnerId, scrollToLatest, sendVoiceMessage, user?.id]);

  useEffect(() => () => { voiceDraftSenderRef.current?.clear(); }, [partnerId, user?.id]);

  // ── Render message ────────────────────────────────────────────────────────
  const renderMessage = useCallback(({ item }: { item: Message }) => {
    const isMine   = item.senderId === user?.id;
    const isImage  = item.mediaType === 'image' && Boolean(item.mediaUrl || item.mediaAssetId)
      && item.deliveryStatus !== 'pending' && item.deliveryStatus !== 'failed';
    const isVideo = item.mediaType === 'video' && Boolean(item.mediaAssetId)
      && item.deliveryStatus !== 'pending' && item.deliveryStatus !== 'failed';
    const isOneTime = item.mediaType === 'one_time_image';
    const isVoice = item.mediaType === 'voice' && Boolean(item.mediaAssetId && item.audioDurationMs && item.audioWaveform?.length === 48)
      && item.deliveryStatus !== 'pending' && item.deliveryStatus !== 'failed';
    const oneTimeConsumed = Boolean(item.mediaConsumedAt) || item.mediaAvailable === false;
    const canOpenOneTime = isOneTime && !isMine && !oneTimeConsumed;
    const isPremium = item.mediaType === 'premium_dm';
    const isCardMedia = isImage || isVideo || isOneTime;
    const handleRetry = () => item.clientMessageId && partnerId
      ? void retryMessage(partnerId, item.clientMessageId)
        .catch(() => showAlert('Mensaje no enviado', 'No se pudo reintentar.'))
      : undefined;

    return (
      <View style={[styles.msgRow, isMine && styles.msgRowMine]}>
        <View style={[styles.bubble, isMine && styles.bubbleMine]}>
          {isMine ? (
            <LinearGradient
              colors={item.deliveryStatus === 'failed'
                ? ['#451B27', '#451B27']
                : isPremium ? [PREMIUM_COLOR, PREMIUM_COLOR2] : ['#5222A8', '#6D28D9']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[styles.bubbleMineGrad, isCardMedia && styles.mediaBubble]}
            >
              {isPremium ? (
                <View style={styles.premiumMsgHeader}>
                  <MaterialIcons name="star" size={11} color="#fff" />
                  <Text style={styles.premiumMsgLabel}>DM Premium</Text>
                </View>
              ) : null}
              {isImage ? (
                <PrivateChatImage assetId={item.mediaAssetId} legacyUrl={item.mediaUrl} />
              ) : null}
              {isVideo ? <PrivateChatVideo assetId={item.mediaAssetId} /> : null}
              {isOneTime ? <View style={[styles.oneTimeStatus, styles.oneTimeCard]}>
                <MaterialCommunityIcons name="eye-off-outline" size={30} color="#F6F7FB" />
                <View style={styles.oneTimeBadge}><Text style={styles.oneTimeBadgeText}>1</Text></View>
                <Text style={styles.oneTimeLabel}>{oneTimeConsumed ? 'Foto abierta' : 'Foto de una sola vista'}</Text>
              </View> : null}
              {isVoice ? <VoiceMessageBubble messageId={item.id} assetId={item.mediaAssetId!}
                durationMs={item.audioDurationMs!} waveform={item.audioWaveform!} isMine
                activeMessageId={activeVoiceMessageId} onActivate={setActiveVoiceMessageId} /> : null}
              {item.mediaType === 'voice' && !isVoice ? <Text style={styles.msgTextMine}>Nota de voz</Text> : null}
              {item.text && item.text !== '📷 Imagen' && item.text !== 'Video' && !isOneTime && !isVoice ? (
                <Text style={styles.msgTextMine}>{item.text}</Text>
              ) : null}
              {item.deliveryStatus === 'failed' ? (
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#FF5263" style={styles.failedAlert} />
              ) : null}
              <View style={[styles.messageMeta, isCardMedia && styles.mediaMeta]}>
                <Text style={[styles.msgTimeMine, isCardMedia && styles.mediaTimeText]}>{timeAgo(item.createdAt)}</Text>
                {item.deliveryStatus !== 'failed' ? <MessageDeliveryIndicator status={item.deliveryStatus} /> : null}
              </View>
            </LinearGradient>
          ) : (
            <View style={[styles.bubbleTheirsInner, isPremium && styles.premiumBubble, isCardMedia && styles.mediaBubble]}>
              {isPremium ? (
                <View style={styles.premiumMsgHeader}>
                  <MaterialIcons name="star" size={11} color={PREMIUM_COLOR} />
                  <Text style={[styles.premiumMsgLabel, { color: PREMIUM_COLOR }]}>DM Premium</Text>
                </View>
              ) : null}
              {isImage ? (
                <PrivateChatImage assetId={item.mediaAssetId} legacyUrl={item.mediaUrl} />
              ) : null}
              {isVideo ? <PrivateChatVideo assetId={item.mediaAssetId} /> : null}
              {isOneTime ? <Pressable disabled={!canOpenOneTime} accessibilityRole="button"
                accessibilityLabel={oneTimeConsumed ? 'Foto abierta' : 'Ver foto una vez'}
                onPress={() => partnerId && openOneTimeMedia(partnerId, item.id).then(setOneTimeMediaUrl)
                  .catch(() => showAlert('Foto no disponible', 'Esta foto ya fue abierta o no tienes acceso.'))}
                style={[styles.oneTimeStatus, styles.oneTimeCard]}>
                <MaterialCommunityIcons name="eye-off-outline" size={30} color="#F6F7FB" />
                <View style={styles.oneTimeBadge}><Text style={styles.oneTimeBadgeText}>1</Text></View>
                <Text style={styles.oneTimeLabel}>{oneTimeConsumed ? 'Foto abierta' : 'Foto de una sola vista'}</Text>
              </Pressable> : null}
              {isVoice ? <VoiceMessageBubble messageId={item.id} assetId={item.mediaAssetId!}
                durationMs={item.audioDurationMs!} waveform={item.audioWaveform!} isMine={false}
                activeMessageId={activeVoiceMessageId} onActivate={setActiveVoiceMessageId} /> : null}
              {item.mediaType === 'voice' && !isVoice ? <Text style={styles.msgText}>Nota de voz</Text> : null}
              {item.text && item.text !== '📷 Imagen' && item.text !== 'Video' && !isOneTime && !isVoice ? (
                <Text style={styles.msgText}>{item.text}</Text>
              ) : null}
              <Text style={[styles.msgTime, isCardMedia && styles.mediaTime]}>{timeAgo(item.createdAt)}</Text>
            </View>
          )}
        </View>

        {isMine && item.deliveryStatus === 'failed'
          ? <View style={styles.deliveryIcon}><MessageDeliveryIndicator status="failed" onRetry={handleRetry} /></View>
          : null}
      </View>
    );
  }, [user, partnerId, retryMessage, openOneTimeMedia, showAlert, activeVoiceMessageId]);

  const partnerName   = conversation?.partnerUsername || 'Usuario';
  const partnerAvatar = conversation?.partnerAvatar;
  const premiumEnabled = premiumConfig?.enabled && partnerId !== user?.id;
  const composerBottom = keyboardHeight > 0 ? keyboardHeight : insets.bottom;
  const composerClearance = composerBottom + composerHeight + 16;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      {oneTimeMediaUrl ? <OneTimeMediaViewer url={oneTimeMediaUrl} onClose={() => setOneTimeMediaUrl(null)} /> : null}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>

        <Pressable style={styles.headerCenter} onPress={() => {}}>
          <View style={{ position: 'relative' }}>
            <Avatar uri={partnerAvatar} username={partnerName} size={46} showBorder />
            {presenceByUser[partnerId || ''] === 'online' ? <View style={styles.avatarOnlineDot} /> : null}
            {subStatus?.isSubscribed ? (
              <View style={styles.subBadgeDot}>
                <MaterialIcons name="star" size={8} color="#fff" />
              </View>
            ) : null}
          </View>
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName}>{partnerName}</Text>
              {premiumEnabled ? (
                <View style={styles.premiumHeaderBadge}>
                  <MaterialIcons name="star" size={9} color={PREMIUM_COLOR} />
                  <Text style={styles.premiumHeaderBadgeText}>PREMIUM</Text>
                </View>
              ) : null}
            </View>
            {typingByUser[partnerId || ''] ? (
              <Text style={styles.typingText}>Escribiendo…</Text>
            ) : presenceByUser[partnerId || ''] === 'online' ? (
              <View style={styles.onlineRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>En línea</Text>
              </View>
            ) : subStatus?.isSubscribed ? (
              <SubscriberBadge plan={subStatus.planName} />
            ) : null}
          </View>
        </Pressable>

        <View style={styles.headerActions}>
          <Pressable hitSlop={8} onPress={() => router.push(`/call/${partnerId}`)} style={styles.headerActionBtn}>
            <MaterialCommunityIcons name="phone-outline" size={21} color="#F6F7FB" />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => router.push(`/video-call/${partnerId}`)} style={styles.headerActionBtn}>
            <MaterialCommunityIcons name="video-outline" size={21} color="#F6F7FB" />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => router.push(`/creator/${partnerId}` as any)} style={styles.headerActionBtn}>
            <MaterialCommunityIcons name="dots-vertical" size={21} color="#9298AD" />
          </Pressable>
        </View>
      </View>

      {/* ── Subscriber benefit bar ──────────────────────────────────────── */}
      {subStatus?.isSubscribed ? (
        <LinearGradient colors={['rgba(124,92,255,0.18)', 'rgba(168,85,247,0.08)']} style={styles.subBar}>
          <MaterialIcons name="star" size={13} color="#A855F7" />
          <Text style={styles.subBarText}>Suscriptor — acceso a contenido exclusivo</Text>
          {subStatus.freeDmsRemaining > 0 && premiumEnabled ? (
            <View style={styles.subBarDMs}>
              <Text style={styles.subBarDMsText}>{subStatus.freeDmsRemaining} DMs gratis</Text>
            </View>
          ) : null}
        </LinearGradient>
      ) : null}

      {/* ── Pending premium payment bar (creator side) ──────────────────── */}
      {pendingPayment ? (
        <Pressable onPress={() => {
          showAlert(
            'Liberar pago Premium DM',
            `Responde al mensaje y recibe ${pendingPayment.creator_earning.toFixed(2)} BDAG`,
            [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Cobrar ahora', onPress: handleReleasePremiumPayment },
            ]
          );
        }} style={styles.pendingPayBar}>
          <LinearGradient colors={['rgba(255,157,0,0.22)', 'rgba(255,90,0,0.12)']} style={styles.pendingPayBarInner}>
            <MaterialIcons name="lock-clock" size={16} color={PREMIUM_COLOR} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingPayTitle}>
                DM Premium pendiente · {pendingPayment.amount.toFixed(0)} BDAG retenidos
              </Text>
              <Text style={styles.pendingPaySub}>Responde al mensaje para cobrar automáticamente</Text>
            </View>
            <View style={styles.cobrarBtn}>
              <Text style={styles.cobrarBtnText}>Cobrar</Text>
            </View>
          </LinearGradient>
        </Pressable>
      ) : null}

      {/* ── Chat area ────────────────────────────────────────────────────── */}
      <View style={styles.chatBody}>
        <View style={[styles.messagePane, { marginBottom: composerClearance }]}>
        {chatMessages.length === 0 ? (
          <View style={styles.emptyChat}>
            <LinearGradient colors={['#7C5CFF22', '#FF2D7811']} style={styles.emptyChatIconWrap}>
              <Avatar uri={partnerAvatar} username={partnerName} size={72} showBorder />
            </LinearGradient>
            <Text style={styles.emptyChatName}>@{partnerName}</Text>
            <Text style={styles.emptyChatSub}>Inicia la conversación</Text>

            {/* Premium DM CTA when chat is empty */}
            {premiumEnabled ? (
              <Pressable onPress={() => setPremiumSheetVis(true)} style={styles.startPremiumBtn}>
                <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={styles.startPremiumBtnGrad}>
                  <MaterialIcons name="star" size={16} color="#fff" />
                  <Text style={styles.startPremiumBtnText}>
                    Enviar DM Premium · {premiumConfig?.price_bdag} BDAG
                  </Text>
                </LinearGradient>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={chatMessages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
            ListHeaderComponent={isLoadingOlder[conversationKey]
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : hasOlderMessages[conversationKey] ? <View style={{ height: 8 }} /> : null}
            ListFooterComponent={<View style={{ height: 12 }} />}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onLayout={() => scrollToLatest(false)}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            scrollEventThrottle={100}
            onScroll={event => {
              if (event.nativeEvent.contentOffset.y <= 24 && hasOlderMessages[conversationKey]) {
                void loadOlderMessages(partnerId || '');
              }
            }}
          />
        )}
        </View>

        {/* ── Input bar ──────────────────────────────────────────────────── */}
        <View style={[
          styles.inputBar,
          {
            bottom: composerBottom,
            paddingBottom: 8,
          },
        ]}
          onLayout={event => {
            const nextHeight = event.nativeEvent.layout.height;
            setComposerHeight(currentHeight =>
              Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight
            );
          }}
        >
          {!voiceRecording ? <>
            <Pressable
              accessibilityLabel={premiumEnabled ? 'Opciones Premium' : 'Adjuntar'}
              onPress={() => premiumEnabled ? setPremiumSheetVis(true) : void handlePickImage()}
              hitSlop={6}
              style={[styles.inputAction, styles.plusAction]}
              disabled={isUploading}
            >
              <MaterialCommunityIcons name="plus" size={21} color="#F6F7FB" />
            </Pressable>
            <Pressable accessibilityLabel="Enviar foto o video" onPress={() => void handlePickImage('normal')}
              hitSlop={6} style={styles.inputAction} disabled={isUploading}>
              {isUploading
                ? <ActivityIndicator size="small" color="#9B5CFF" />
                : <MaterialCommunityIcons name="image-outline" size={20} color="#9298AD" />}
            </Pressable>
            <Pressable accessibilityLabel="Enviar foto de una sola vista" onPress={() => void handlePickImage('one-time')}
              hitSlop={6} style={styles.inputAction} disabled={isUploading}>
              <MaterialCommunityIcons name="eye-off-outline" size={20} color="#9298AD" />
            </Pressable>
          </> : null}

          {!voiceRecording ? <TextInput
            style={[styles.input, { height: inputHeight }]}
            value={text}
            onChangeText={value => {
              setText(value);
              if (partnerId) setConversationTyping(partnerId, value.trim().length > 0);
            }}
            placeholder="Escribe un mensaje…"
            placeholderTextColor={Colors.textSubtle}
            multiline
            onContentSizeChange={handleInputContentSizeChange}
            scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
            maxLength={1000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          /> : null}

          {!voiceRecording ? <Pressable accessibilityLabel="Agregar emoji" onPress={() => setText(value => `${value}😊`)}
            hitSlop={6} style={styles.emojiAction}>
            <MaterialCommunityIcons name="emoticon-happy-outline" size={21} color="#F4C95D" />
          </Pressable> : null}

          {text.trim() && !voiceRecording ? <Pressable
            onPress={handleSend}
            disabled={!text.trim() || isSending}
            style={styles.sendBtn}
          >
            <LinearGradient
              colors={(!text.trim() || isSending)
                ? [Colors.border, Colors.border]
                : ['#7C5CFF', '#FF2D78']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.sendBtnGrad}
            >
              {isSending
                ? <ActivityIndicator size="small" color="#fff" />
                : <MaterialCommunityIcons name="send" size={18} color="#fff" />}
            </LinearGradient>
          </Pressable> : null}

          {!text.trim() ? <VoiceRecorderBar
            identityKey={`${user?.id || ''}:${partnerId || ''}`}
            disabled={!user?.id || !partnerId || isUploading || isSending}
            onRecordingChange={setVoiceRecording}
            onSend={handleSendVoice}
            onError={message => showAlert('Nota de voz', message)}
          /> : null}
        </View>
      </View>

      {/* Premium DM sheet */}
      <PremiumDMSheet
        visible={premiumSheetVis}
        recipientUsername={partnerName}
        dmConfig={premiumConfig}
        balance={balance}
        isFreeFromSub={!!(subStatus?.isSubscribed && (subStatus?.freeDmsRemaining ?? 0) > 0)}
        freeLeft={subStatus?.freeDmsRemaining ?? 0}
        onClose={() => setPremiumSheetVis(false)}
        onSend={handleSendPremiumDM}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080A12' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: 64, paddingHorizontal: 16, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#23283A',
  },
  backBtn: { padding: 4 },
  headerCenter:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerInfo:     { flex: 1, gap: 3 },
  headerNameRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerName:     { color: '#F6F7FB', fontSize: 19, fontWeight: FontWeight.bold },
  premiumHeaderBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,157,0,0.15)', borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  premiumHeaderBadgeText: { color: PREMIUM_COLOR, fontSize: 9, fontWeight: FontWeight.bold },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.accent },
  onlineText: { color: '#9298AD', fontSize: 11 },
  typingText: { color: '#9B5CFF', fontSize: 11 },
  avatarOnlineDot: { position: 'absolute', right: 1, bottom: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: '#35E28A', borderWidth: 2, borderColor: '#080A12' },
  headerActions: { flexDirection: 'row', gap: 2 },
  headerActionBtn: {
    width: 34, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  subBadgeDot: {
    position: 'absolute', bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#A855F7',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.bg,
  },

  // Subscriber bar
  subBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(168,85,247,0.2)' },
  subBarText: { color: '#A855F7', fontSize: FontSize.xs, fontWeight: FontWeight.medium, flex: 1 },
  subBarDMs: { backgroundColor: '#A855F722', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#A855F744' },
  subBarDMsText: { color: '#A855F7', fontSize: 10, fontWeight: FontWeight.bold },

  // Pending payment bar
  pendingPayBar: { marginHorizontal: Spacing.md, marginVertical: Spacing.sm, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,157,0,0.4)' },
  pendingPayBarInner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  pendingPayTitle: { color: PREMIUM_COLOR, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  pendingPaySub: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  cobrarBtn: { backgroundColor: PREMIUM_COLOR, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 7 },
  cobrarBtnText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Empty state
  chatBody: { flex: 1 },
  messagePane: { flex: 1 },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  emptyChatIconWrap: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  emptyChatName: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  emptyChatSub: { color: Colors.textSubtle, fontSize: FontSize.sm },
  startPremiumBtn: { borderRadius: Radius.md, overflow: 'hidden', marginTop: Spacing.sm },
  startPremiumBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  startPremiumBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  // Messages list
  messagesList: { paddingHorizontal: 20, paddingTop: 14, gap: 8 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  msgRowMine: { flexDirection: 'row-reverse' },
  bubble: { maxWidth: '82%' },
  bubbleMine: { borderRadius: Radius.lg, overflow: 'hidden' },
  bubbleMineGrad: { paddingHorizontal: 16, paddingVertical: 10, gap: 4, borderRadius: 16 },
  bubbleTheirsInner: {
    backgroundColor: '#1A1E2B', borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 10, gap: 4,
  },
  mediaBubble: { paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent', overflow: 'hidden' },
  premiumBubble: { borderColor: 'rgba(255,157,0,0.4)', backgroundColor: 'rgba(255,157,0,0.08)' },
  premiumMsgHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  premiumMsgLabel: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  oneTimeStatus: { position: 'relative', alignItems: 'center', justifyContent: 'center', gap: 8 },
  oneTimeCard: { width: 184, height: 92, borderRadius: 16, backgroundColor: '#1B1E29', borderWidth: 1, borderColor: '#23283A' },
  oneTimeBadge: { position: 'absolute', right: 6, top: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#F6F7FB', alignItems: 'center', justifyContent: 'center' },
  oneTimeBadgeText: { color: '#080A12', fontSize: 9, fontWeight: FontWeight.bold },
  oneTimeLabel: { color: '#F6F7FB', fontSize: 10 },
  oneTimeViewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  oneTimeImage: { width: '100%', height: '100%' },
  oneTimeClose: { position: 'absolute', top: 52, right: 20, zIndex: 2, padding: 8 },
  msgText: { color: Colors.textPrimary, fontSize: FontSize.sm, lineHeight: 20 },
  msgTextMine: { color: '#fff', fontSize: FontSize.sm, lineHeight: 20 },
  msgTime: { color: Colors.textSubtle, fontSize: 10, alignSelf: 'flex-end' },
  msgTimeMine: { color: 'rgba(255,255,255,0.6)', fontSize: 10, alignSelf: 'flex-end' },
  messageMeta: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 3 },
  mediaMeta: { position: 'absolute', right: 8, bottom: 6 },
  mediaTime: { position: 'absolute', right: 8, bottom: 6, color: '#FFFFFF' },
  mediaTimeText: { color: '#FFFFFF' },
  deliveryIcon: { alignSelf: 'flex-end', marginBottom: 5 },
  failedAlert: { position: 'absolute', right: 8, top: 9 },

  // Input bar
  inputBar: {
    position: 'absolute', left: 12, right: 12,
    minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 8, paddingVertical: 6,
    borderWidth: 1, borderColor: '#23283A', backgroundColor: '#0E111A', borderRadius: 22,
    zIndex: 100,
    elevation: 24,
  },
  inputAction: { width: 30, height: 38, alignItems: 'center', justifyContent: 'center' },
  plusAction: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#171B29', borderWidth: 1, borderColor: '#30364A' },
  emojiAction: { width: 30, height: 38, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120,
    paddingHorizontal: 10, paddingVertical: 10,
    color: '#F6F7FB', fontSize: 12,
    textAlignVertical: 'top',
  },
  sendBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  sendBtnGrad: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
