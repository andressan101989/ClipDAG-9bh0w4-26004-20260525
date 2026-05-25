import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMessages } from '@/hooks/useMessages';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { getSupabaseClient } from '@/template';
import { useAlert } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';
import { uploadFileFromUri, detectMimeType } from '@/contexts/FeedContext';
import type { Message } from '@/contexts/MessagesContext';

const PREMIUM_COLOR  = '#FF9D00';
const PREMIUM_COLOR2 = '#FF5A00';

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
  const { userId: partnerId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;
  const { messages, conversations, sendMessage, loadConversation, markConversationRead } = useMessages();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [text,         setText]         = useState('');
  const [isSending,    setIsSending]    = useState(false);
  const [isUploading,  setIsUploading]  = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Premium DM state
  const [premiumConfig,   setPremiumConfig]   = useState<{ enabled: boolean; price_bdag: number; welcome_message: string } | null>(null);
  const [premiumSheetVis, setPremiumSheetVis] = useState(false);
  const [subStatus,       setSubStatus]       = useState<{ isSubscribed: boolean; freeDmsRemaining: number; planName: string } | null>(null);
  const [pendingPayment,  setPendingPayment]  = useState<{ payment_id: string; message_id: string; amount: number; creator_earning: number } | null>(null);

  const conversation = conversations.find(c => c.partnerId === partnerId);
  const chatMessages = messages[partnerId || ''] || [];

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
  }, [partnerId, user?.id]);

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
  }, [partnerId, user?.id, chatMessages.length]);

  // ── Poll ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!partnerId) return;
    loadConversation(partnerId);
    markConversationRead(partnerId);
    pollRef.current = setInterval(() => loadConversation(partnerId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [partnerId]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [chatMessages.length]);

  // ── Send regular message ──────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!text.trim() || !partnerId || isSending) return;
    setIsSending(true);
    await sendMessage(partnerId, text.trim());
    setText('');
    setIsSending(false);

    // If creator responds to held premium DM, auto-release if there's a pending payment
    if (pendingPayment && user?.id) {
      const { data } = await supabase.rpc('release_premium_dm', {
        p_creator_id: user.id,
        p_message_id: pendingPayment.message_id,
      });
      if (data?.success) {
        walletData?.fullSync?.();
        setPendingPayment(null);
        showAlert(
          '¡Pago liberado!',
          `+${Number(data.creator_earned ?? pendingPayment.creator_earning).toFixed(2)} BDAG en tu wallet`
        );
      }
    }
  }, [text, partnerId, isSending, sendMessage, pendingPayment, user?.id, supabase, walletData, showAlert]);

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
    // Update free DM quota if it was free
    if (data.is_free_dm && subStatus) {
      setSubStatus(prev => prev ? { ...prev, freeDmsRemaining: Math.max(0, prev.freeDmsRemaining - 1) } : prev);
    }
  }, [partnerId, user?.id, supabase, walletData, loadConversation, subStatus, showAlert]);

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
  const handlePickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permiso denegado', 'Habilita el acceso a la galería'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true,
    });
    if (result.canceled || !result.assets[0] || !user) return;

    setIsUploading(true);
    const asset = result.assets[0];
    const mimeType = asset.mimeType || detectMimeType(asset.uri, 'image/jpeg');
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = `${user.id}/chat_${Date.now()}.${ext}`;
    const url = await uploadFileFromUri(supabase, asset.uri, 'images', fileName, mimeType, asset.base64);
    setIsUploading(false);
    if (url && partnerId) await sendMessage(partnerId, '📷 Imagen', url, 'image');
    else showAlert('Error', 'No se pudo enviar la imagen');
  }, [user, supabase, partnerId, sendMessage, showAlert]);

  // ── Render message ────────────────────────────────────────────────────────
  const renderMessage = useCallback(({ item, index }: { item: Message; index: number }) => {
    const isMine   = item.senderId === user?.id;
    const prevMsg  = chatMessages[index - 1];
    const showAv   = !isMine && (!prevMsg || prevMsg.senderId !== item.senderId);
    const isImage  = item.mediaType === 'image' && item.mediaUrl;
    const isPremium = item.mediaType === 'premium_dm';

    return (
      <View style={[styles.msgRow, isMine && styles.msgRowMine]}>
        {!isMine ? (
          <View style={{ width: 30, alignSelf: 'flex-end', marginBottom: 4 }}>
            {showAv ? (
              <Avatar uri={conversation?.partnerAvatar} username={conversation?.partnerUsername} size={28} />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.bubble, isMine && styles.bubbleMine]}>
          {isMine ? (
            <LinearGradient
              colors={isPremium ? [PREMIUM_COLOR, PREMIUM_COLOR2] : ['#7C5CFF', '#B44FFF']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.bubbleMineGrad}
            >
              {isPremium ? (
                <View style={styles.premiumMsgHeader}>
                  <MaterialIcons name="star" size={11} color="#fff" />
                  <Text style={styles.premiumMsgLabel}>DM Premium</Text>
                </View>
              ) : null}
              {isImage ? (
                <Image source={{ uri: item.mediaUrl }} style={styles.msgImage} contentFit="cover" transition={200} />
              ) : null}
              {item.text && item.text !== '📷 Imagen' ? (
                <Text style={styles.msgTextMine}>{item.text}</Text>
              ) : null}
              <Text style={styles.msgTimeMine}>{timeAgo(item.createdAt)}</Text>
            </LinearGradient>
          ) : (
            <View style={[styles.bubbleTheirsInner, isPremium && styles.premiumBubble]}>
              {isPremium ? (
                <View style={styles.premiumMsgHeader}>
                  <MaterialIcons name="star" size={11} color={PREMIUM_COLOR} />
                  <Text style={[styles.premiumMsgLabel, { color: PREMIUM_COLOR }]}>DM Premium</Text>
                </View>
              ) : null}
              {isImage ? (
                <Image source={{ uri: item.mediaUrl }} style={styles.msgImage} contentFit="cover" transition={200} />
              ) : null}
              {item.text && item.text !== '📷 Imagen' ? (
                <Text style={styles.msgText}>{item.text}</Text>
              ) : null}
              <Text style={styles.msgTime}>{timeAgo(item.createdAt)}</Text>
            </View>
          )}
        </View>

        {isMine ? (
          <MaterialCommunityIcons
            name={item.read ? 'check-all' : 'check'}
            size={12}
            color={item.read ? Colors.primary : Colors.textSubtle}
            style={{ alignSelf: 'flex-end', marginBottom: 6 }}
          />
        ) : null}
      </View>
    );
  }, [user, chatMessages, conversation]);

  const partnerName   = conversation?.partnerUsername || 'Usuario';
  const partnerAvatar = conversation?.partnerAvatar;
  const premiumEnabled = premiumConfig?.enabled && partnerId !== user?.id;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>

        <Pressable style={styles.headerCenter} onPress={() => {}}>
          <View style={{ position: 'relative' }}>
            <Avatar uri={partnerAvatar} username={partnerName} size={36} showBorder />
            {subStatus?.isSubscribed ? (
              <View style={styles.subBadgeDot}>
                <MaterialIcons name="star" size={8} color="#fff" />
              </View>
            ) : null}
          </View>
          <View style={styles.headerInfo}>
            <View style={styles.headerNameRow}>
              <Text style={styles.headerName}>@{partnerName}</Text>
              {premiumEnabled ? (
                <View style={styles.premiumHeaderBadge}>
                  <MaterialIcons name="star" size={9} color={PREMIUM_COLOR} />
                  <Text style={styles.premiumHeaderBadgeText}>PREMIUM</Text>
                </View>
              ) : null}
            </View>
            {subStatus?.isSubscribed ? (
              <SubscriberBadge plan={subStatus.planName} />
            ) : (
              <View style={styles.onlineRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.onlineText}>En línea</Text>
              </View>
            )}
          </View>
        </Pressable>

        <View style={styles.headerActions}>
          <Pressable hitSlop={8} onPress={() => router.push(`/call/${partnerId}`)} style={styles.headerActionBtn}>
            <MaterialCommunityIcons name="phone-outline" size={20} color={Colors.primary} />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => router.push(`/videocall/${partnerId}`)} style={styles.headerActionBtn}>
            <MaterialCommunityIcons name="video-outline" size={20} color={Colors.primary} />
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
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
            contentContainerStyle={[styles.messagesList, { paddingBottom: insets.bottom + 8 }]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {/* ── Input bar ──────────────────────────────────────────────────── */}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          {/* Image picker */}
          <Pressable onPress={handlePickImage} hitSlop={8} style={styles.inputAction} disabled={isUploading}>
            {isUploading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <MaterialCommunityIcons name="image-outline" size={22} color={Colors.textSecondary} />}
          </Pressable>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Escribe un mensaje..."
            placeholderTextColor={Colors.textSubtle}
            multiline
            maxLength={1000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />

          {/* Premium DM button (only when recipient has it enabled) */}
          {premiumEnabled && !text.trim() ? (
            <Pressable onPress={() => setPremiumSheetVis(true)} style={styles.premiumBtn} hitSlop={4}>
              <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={styles.premiumBtnGrad}>
                <MaterialIcons name="star" size={16} color="#fff" />
              </LinearGradient>
            </Pressable>
          ) : null}

          <Pressable
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
          </Pressable>
        </View>
      </KeyboardAvoidingView>

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
  container: { flex: 1, backgroundColor: Colors.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  headerCenter:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerInfo:     { flex: 1, gap: 3 },
  headerNameRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerName:     { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  premiumHeaderBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,157,0,0.15)', borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 2 },
  premiumHeaderBadgeText: { color: PREMIUM_COLOR, fontSize: 9, fontWeight: FontWeight.bold },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.accent },
  onlineText: { color: Colors.accent, fontSize: FontSize.xs },
  headerActions: { flexDirection: 'row', gap: Spacing.xs },
  headerActionBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '33',
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
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  emptyChatIconWrap: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  emptyChatName: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  emptyChatSub: { color: Colors.textSubtle, fontSize: FontSize.sm },
  startPremiumBtn: { borderRadius: Radius.md, overflow: 'hidden', marginTop: Spacing.sm },
  startPremiumBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  startPremiumBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  // Messages list
  messagesList: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md, gap: 8 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  msgRowMine: { flexDirection: 'row-reverse' },
  bubble: { maxWidth: '75%' },
  bubbleMine: { borderRadius: Radius.lg, overflow: 'hidden' },
  bubbleMineGrad: { paddingHorizontal: 14, paddingVertical: 10, gap: 4, borderRadius: Radius.lg, borderBottomRightRadius: 4 },
  bubbleTheirsInner: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10, gap: 4, borderWidth: 1, borderColor: Colors.border,
  },
  premiumBubble: { borderColor: 'rgba(255,157,0,0.4)', backgroundColor: 'rgba(255,157,0,0.08)' },
  premiumMsgHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  premiumMsgLabel: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  msgImage: { width: 200, height: 200, borderRadius: Radius.md },
  msgText: { color: Colors.textPrimary, fontSize: FontSize.sm, lineHeight: 20 },
  msgTextMine: { color: '#fff', fontSize: FontSize.sm, lineHeight: 20 },
  msgTime: { color: Colors.textSubtle, fontSize: 10, alignSelf: 'flex-end' },
  msgTimeMine: { color: 'rgba(255,255,255,0.6)', fontSize: 10, alignSelf: 'flex-end' },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg,
  },
  inputAction: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, minHeight: 42, maxHeight: 120,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    color: Colors.textPrimary, fontSize: FontSize.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  premiumBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  premiumBtnGrad: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  sendBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  sendBtnGrad: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
