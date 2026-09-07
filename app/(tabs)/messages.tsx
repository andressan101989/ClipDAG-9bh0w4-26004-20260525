import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, StyleSheet,
  ActivityIndicator, RefreshControl, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useMessages } from '@/hooks/useMessages';
import { useNotifications } from '@/hooks/useNotifications';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { getSupabaseClient, useAlert } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';

// ── Design tokens ─────────────────────────────────────────────────────────────
const PREMIUM_COLOR  = '#FF9D00';
const PREMIUM_COLOR2 = '#FF5A00';

// ── Premium DM Request Modal ──────────────────────────────────────────────────
interface PremiumDMModalProps {
  visible: boolean;
  recipientUsername: string;
  recipientId: string;
  dmPrice: number;
  onClose: () => void;
  onSend: (text: string, amount: number) => Promise<void>;
  balance: number;
  isFreeFromSub: boolean;
}

function PremiumDMModal({
  visible, recipientUsername, recipientId, dmPrice,
  onClose, onSend, balance, isFreeFromSub,
}: PremiumDMModalProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const insets = useSafeAreaInsets();

  const canAfford = isFreeFromSub || balance >= dmPrice;

  const handleSend = useCallback(async () => {
    if (!message.trim()) return;
    setSending(true);
    await onSend(message.trim(), dmPrice);
    setSending(false);
    setMessage('');
    onClose();
  }, [message, dmPrice, onSend, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <Pressable style={pm.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[pm.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={pm.handle} />

          {/* Header */}
          <View style={pm.header}>
            <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={pm.headerIcon}>
              <MaterialIcons name="mark-email-read" size={18} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={pm.title}>DM Premium a @{recipientUsername}</Text>
              <Text style={pm.subtitle}>
                {isFreeFromSub ? 'Gratis con tu suscripción activa' : `Precio: ${dmPrice} BDAG`}
              </Text>
            </View>
          </View>

          {/* How it works */}
          <View style={pm.howItWorks}>
            {[
              { icon: 'lock-clock', text: 'BDAG retenido hasta que el creador responda' },
              { icon: 'priority-high', text: 'Aparece en el tope de la bandeja del creador' },
              { icon: 'replay', text: 'Reembolso automático si no responde en 72h' },
            ].map(item => (
              <View key={item.text} style={pm.howRow}>
                <MaterialIcons name={item.icon as any} size={13} color={PREMIUM_COLOR} />
                <Text style={pm.howText}>{item.text}</Text>
              </View>
            ))}
          </View>

          {/* Message input */}
          <TextInput
            style={pm.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Escribe tu mensaje prioritario..."
            placeholderTextColor={Colors.textSubtle}
            multiline
            maxLength={500}
            autoFocus
          />
          <Text style={pm.charCount}>{message.length}/500</Text>

          {/* Balance row */}
          {!isFreeFromSub ? (
            <View style={pm.balRow}>
              <Text style={pm.balLabel}>Tu saldo:</Text>
              <Text style={[pm.balVal, { color: canAfford ? Colors.accent : Colors.error }]}>
                {balance.toLocaleString(undefined, { maximumFractionDigits: 0 })} BDAG
              </Text>
              {!canAfford ? <Text style={pm.balInsuf}>· Saldo insuficiente</Text> : null}
            </View>
          ) : (
            <View style={pm.balRow}>
              <MaterialIcons name="star" size={13} color={Colors.accent} />
              <Text style={[pm.balLabel, { color: Colors.accent }]}>DM gratuito incluido en tu suscripción</Text>
            </View>
          )}

          {/* Send button */}
          <Pressable
            style={[pm.sendBtn, (!message.trim() || !canAfford || sending) && { opacity: 0.45 }]}
            onPress={handleSend}
            disabled={!message.trim() || !canAfford || sending}
          >
            <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={pm.sendBtnGrad}>
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialIcons name="send" size={18} color="#fff" />}
              <Text style={pm.sendBtnText}>
                {sending ? 'Enviando...' : isFreeFromSub ? 'Enviar (Gratis)' : `Enviar · ${dmPrice} BDAG`}
              </Text>
            </LinearGradient>
          </Pressable>
          <Pressable style={pm.cancelBtn} onPress={onClose}>
            <Text style={pm.cancelText}>Cancelar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const pm = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet:       { backgroundColor: '#0F0F1E', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: Spacing.lg, gap: Spacing.md, borderTopWidth: 1, borderColor: '#1C1C38' },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon:  { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title:       { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  subtitle:    { color: PREMIUM_COLOR, fontSize: FontSize.xs, marginTop: 1 },
  howItWorks:  { backgroundColor: 'rgba(255,157,0,0.08)', borderRadius: Radius.md, padding: 12, gap: 7, borderWidth: 1, borderColor: 'rgba(255,157,0,0.2)' },
  howRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  howText:     { color: Colors.textSecondary, fontSize: 11, flex: 1 },
  input:       { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 100, textAlignVertical: 'top' },
  charCount:   { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  balRow:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balLabel:    { color: Colors.textSubtle, fontSize: FontSize.sm },
  balVal:      { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  balInsuf:    { color: Colors.error, fontSize: FontSize.xs },
  sendBtn:     { borderRadius: Radius.md, overflow: 'hidden' },
  sendBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  sendBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  cancelBtn:   { alignItems: 'center', paddingVertical: 12 },
  cancelText:  { color: Colors.textSubtle, fontSize: FontSize.sm },
});

// ── Main Messages Screen ──────────────────────────────────────────────────────
export default function MessagesScreen() {
  // Approved Figma: 01 — Messages Inbox (FmwCrxtAV5k8jpLFr3RTgy, node 1:3).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { conversations, isLoading, refreshConversations, presenceByUser } = useMessages();
  const { unreadCount: notifCount } = useNotifications();
  const { showAlert } = useAlert();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;
  const supabase = getSupabaseClient();

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'direct' | 'group' | 'premium'>('all');

  // Premium DM modal
  const [premiumModal, setPremiumModal] = useState<{
    visible: boolean;
    recipientId: string;
    recipientUsername: string;
    dmPrice: number;
    isFree: boolean;
  }>({ visible: false, recipientId: '', recipientUsername: '', dmPrice: 50, isFree: false });

  // Premium DM payments for inbox (creator view)
  const [premiumDMs, setPremiumDMs] = useState<any[]>([]);

  const loadPremiumDMs = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from('premium_dm_payments')
      .select(`
        *,
        sender:user_profiles!sender_id(username, avatar_url)
      `)
      .eq('recipient_id', user.id)
      .eq('status', 'held')
      .order('created_at', { ascending: false })
      .limit(20);
    setPremiumDMs(data ?? []);
  }, [user?.id, supabase]);

  useEffect(() => { loadPremiumDMs(); }, [loadPremiumDMs]);

  // Filter conversations
  const filtered = conversations.filter(c => {
    if (search.trim() && !c.displayName.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeTab === 'direct' && c.conversationType !== 'direct') return false;
    if (activeTab === 'group' && c.conversationType !== 'group') return false;
    if (activeTab === 'premium' && (c.conversationType !== 'direct' || !premiumDMs.some(p => p.sender_id === c.partnerId))) return false;
    return true;
  });

  // Sort: premium DMs at top
  const sortedConversations = [...filtered].sort((a, b) => {
    const aIsPremium = a.conversationType === 'direct' && premiumDMs.some(p => p.sender_id === a.partnerId);
    const bIsPremium = b.conversationType === 'direct' && premiumDMs.some(p => p.sender_id === b.partnerId);
    if (aIsPremium && !bIsPremium) return -1;
    if (!aIsPremium && bIsPremium) return 1;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });

  // Send premium DM
  const handleSendPremiumDM = useCallback(async (text: string, amount: number) => {
    if (!user?.id) return;
    const { data, error } = await supabase.rpc('send_premium_dm', {
      p_sender_id:    user.id,
      p_recipient_id: premiumModal.recipientId,
      p_amount_bdag:  amount,
      p_message_text: text,
    });
    if (error || !data?.success) {
      showAlert('Error', data?.error ?? error?.message ?? 'No se pudo enviar');
      return;
    }
    walletData?.fullSync?.();
    showAlert(
      premiumModal.isFree ? 'DM Premium enviado (gratis)' : 'DM Premium enviado',
      premiumModal.isFree
        ? 'Mensaje prioritario enviado. Tu cuota mensual se redujo.'
        : `${amount} BDAG retenidos · Se liberan al recibir respuesta`
    );
    refreshConversations();
  }, [user?.id, premiumModal, supabase, walletData, showAlert, refreshConversations]);

  // Release payment when creator responds (auto-called from chat)
  const handleReleasePremiumPayment = useCallback(async (messageId: string) => {
    if (!user?.id) return;
    const { data } = await supabase.rpc('release_premium_dm', {
      p_creator_id: user.id,
      p_message_id: messageId,
    });
    if (data?.success) {
      walletData?.fullSync?.();
      loadPremiumDMs();
      showAlert('¡Pago liberado!', `+${data.creator_earned?.toFixed(2)} BDAG en tu wallet`);
    }
  }, [user?.id, supabase, walletData, loadPremiumDMs, showAlert]);

  const TABS = [
    { key: 'all' as const, label: 'Todos', icon: 'circle-outline' },
    { key: 'direct' as const, label: 'Directos', icon: 'account-outline' },
    { key: 'group' as const, label: 'Grupos', icon: 'account-group-outline' },
    { key: 'premium' as const, label: 'Premium', icon: 'crown-outline' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <MaterialCommunityIcons name="chart-donut" size={25} color="#9B5CFF" />
          <View>
            <Text style={styles.headerTitle}>Mensajes</Text>
            <Text style={styles.headerSubtitle}>Conecta. Comparte. Sé tú.</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {notifCount > 0 ? (
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8} style={styles.notifBtn}>
              <MaterialCommunityIcons name="bell-outline" size={22} color={Colors.textSecondary} />
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{notifCount > 9 ? '9+' : notifCount}</Text>
              </View>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8}>
              <MaterialCommunityIcons name="bell-outline" size={22} color={Colors.textSecondary} />
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/new-message')} hitSlop={8} style={styles.newMsgBtn}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.newMsgBtnGrad}>
              <MaterialCommunityIcons name="pencil-outline" size={16} color="#fff" />
            </LinearGradient>
          </Pressable>
          <Pressable onPress={() => router.push('/chat/group/create' as any)} hitSlop={8} style={styles.salaBtn}>
            <MaterialCommunityIcons name="account-multiple-plus-outline" size={20} color={Colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={18} color={Colors.textSubtle} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar conversaciones..."
          placeholderTextColor={Colors.textSubtle}
          returnKeyType="search"
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} />
          </Pressable>
        ) : <MaterialCommunityIcons name="filter-variant" size={18} color="#9298AD" />}
      </View>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tabBtn, activeTab === t.key && styles.tabBtnActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <MaterialCommunityIcons
              name={t.icon as any}
              size={13}
              color={activeTab === t.key ? '#FFFFFF' : '#9298AD'}
            />
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>
              {t.label}
              {t.key === 'premium' && premiumDMs.length > 0 ? ` (${premiumDMs.length})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* ── Premium DMs banner (creator view) ───────────────────────────── */}
      {(activeTab === 'all' || activeTab === 'premium') && premiumDMs.length > 0 ? (
        <View style={styles.premiumBanner}>
          <LinearGradient colors={['rgba(255,157,0,0.15)', 'rgba(255,90,0,0.08)']} style={styles.premiumBannerInner}>
            <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={styles.premiumBannerIcon}>
              <MaterialIcons name="mark-email-read" size={16} color="#fff" />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumBannerTitle}>
                {premiumDMs.length} DM{premiumDMs.length > 1 ? 's' : ''} Premium pendiente{premiumDMs.length > 1 ? 's' : ''}
              </Text>
              <Text style={styles.premiumBannerSub}>Responde para desbloquear el pago BDAG</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={PREMIUM_COLOR} />
          </LinearGradient>
        </View>
      ) : null}

      {/* ── Premium DM list (premium tab) ───────────────────────────────── */}
      {activeTab === 'premium' ? (
        <FlatList
          data={premiumDMs}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 100 + insets.bottom, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { refreshConversations(); loadPremiumDMs(); }} tintColor={PREMIUM_COLOR} />}
          ListEmptyComponent={
            <View style={styles.centered}>
              <MaterialCommunityIcons name="star-circle-outline" size={52} color={Colors.border} />
              <Text style={styles.emptyTitle}>Sin DMs Premium</Text>
              <Text style={styles.emptySubtitle}>Activa Premium DM en tu perfil para recibir mensajes de pago</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isPendingRelease = item.status === 'held';
            return (
              <Pressable
                style={styles.premiumDMItem}
                onPress={() => router.push(`/chat/${item.sender_id}`)}
              >
                <LinearGradient colors={['rgba(255,157,0,0.12)', 'rgba(255,90,0,0.05)']} style={styles.premiumDMInner}>
                  {/* Premium badge top-right */}
                  <View style={styles.premiumDMBadge}>
                    <MaterialIcons name="star" size={10} color={PREMIUM_COLOR} />
                    <Text style={styles.premiumDMBadgeText}>PREMIUM</Text>
                  </View>

                  <Avatar uri={item.sender?.avatar_url} username={item.sender?.username} size={46} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.premiumDMUsername}>@{item.sender?.username}</Text>
                    <Text style={styles.premiumDMAmount}>
                      {Number(item.amount_bdag).toFixed(0)} BDAG retenidos
                    </Text>
                    <Text style={styles.premiumDMExpiry}>
                      Expira: {new Date(item.expires_at).toLocaleDateString()}
                    </Text>
                  </View>
                  {isPendingRelease ? (
                    <Pressable
                      style={styles.releaseBtn}
                      onPress={() => {
                        showAlert(
                          'Liberar pago',
                          `Confirmar respuesta y liberar ${Number(item.creator_earning).toFixed(2)} BDAG`,
                          [
                            { text: 'Cancelar', style: 'cancel' },
                            { text: 'Liberar', onPress: () => handleReleasePremiumPayment(item.message_id) },
                          ]
                        );
                      }}
                    >
                      <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={styles.releaseBtnGrad}>
                        <Text style={styles.releaseBtnText}>Cobrar</Text>
                      </LinearGradient>
                    </Pressable>
                  ) : null}
                </LinearGradient>
              </Pressable>
            );
          }}
        />
      ) : conversations.length === 0 && !isLoading ? (
        <View style={styles.centered}>
          <View style={styles.emptyIconWrap}>
            <LinearGradient colors={['#7C5CFF22', '#FF2D7811']} style={styles.emptyIconGrad}>
              <MaterialCommunityIcons name="message-text-outline" size={40} color={Colors.primary} />
            </LinearGradient>
          </View>
          <Text style={styles.emptyTitle}>Sin mensajes aún</Text>
          <Text style={styles.emptySubtitle}>Toca el botón de edición para iniciar una conversación</Text>
          <Pressable style={styles.startChatBtn} onPress={() => router.push('/new-message')}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.startChatBtnGrad}>
              <Text style={styles.startChatBtnText}>Iniciar conversación</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : isLoading && conversations.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={sortedConversations}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 100 + insets.bottom }}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => { refreshConversations(); loadPremiumDMs(); }}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
          renderItem={({ item }) => {
            const hasUnread = item.unreadCount > 0;
            const isPremium = item.conversationType === 'direct'
              && premiumDMs.some(p => p.sender_id === item.partnerId || p.recipient_id === item.partnerId);
            const premiumPayment = premiumDMs.find(p => p.sender_id === item.partnerId);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.convItem,
                  isPremium && styles.convItemPremium,
                  hasUnread && styles.convItemUnread,
                  pressed && { backgroundColor: Colors.surfaceHighlight },
                ]}
                onPress={() => router.push(item.conversationType === 'group' ? `/chat/group/${item.id}` as any : `/chat/${item.partnerId}`)}
              >
                {/* Premium indicator stripe */}
                {isPremium ? <View style={styles.premiumStripe} /> : null}

                {/* Avatar with online dot */}
                <View style={styles.avatarWrap}>
                  {item.conversationType === 'group' ? (
                    <View style={styles.groupAvatarStack}>
                      <View style={styles.groupAvatarBack}>
                        <MaterialCommunityIcons name="account-group" size={18} color="#9298AD" />
                      </View>
                      <View style={styles.groupAvatarFront}>
                        <Avatar uri={item.avatar} username={item.displayName} size={34} />
                      </View>
                    </View>
                  ) : <Avatar uri={item.avatar} username={item.displayName} size={42} />}
                  {isPremium ? (
                    <View style={[styles.onlineDot, { backgroundColor: PREMIUM_COLOR }]}>
                      <MaterialIcons name="star" size={7} color="#fff" />
                    </View>
                  ) : item.conversationType === 'direct' && item.partnerId && presenceByUser[item.partnerId] === 'online' ? (
                    <View style={styles.onlineDot} />
                  ) : null}
                </View>

                {/* Conversation info */}
                <View style={styles.convInfo}>
                  <View style={styles.convTopRow}>
                    <View style={styles.convNameRow}>
                      <Text style={[styles.convName, hasUnread && styles.convNameBold]}>
                        {item.displayName}
                      </Text>
                      {isPremium ? (
                        <View style={styles.premiumChip}>
                          <MaterialIcons name="star" size={9} color={PREMIUM_COLOR} />
                          <Text style={styles.premiumChipText}>
                            {premiumPayment ? `${Number(premiumPayment.amount_bdag).toFixed(0)} BDAG` : 'PREMIUM'}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.convTime, hasUnread && { color: Colors.primary }]}>
                      {timeAgo(item.lastMessageAt)}
                    </Text>
                  </View>
                  <View style={styles.convBottomRow}>
                    <Text
                      style={[styles.convLastMsg, hasUnread && styles.convLastMsgBold, isPremium && { color: PREMIUM_COLOR + 'CC' }]}
                      numberOfLines={1}
                    >
                      {isPremium ? '⭐ Mensaje Premium prioritario' : (item.lastMessage || 'Inicia la conversación')}
                    </Text>
                    {hasUnread ? (
                      <View style={[styles.unreadBadge, isPremium && { backgroundColor: PREMIUM_COLOR }]}>
                        <Text style={styles.unreadBadgeText}>{item.unreadCount > 9 ? '9+' : item.unreadCount}</Text>
                      </View>
                    ) : (
                      <MaterialCommunityIcons name="check-all" size={16} color={isPremium ? PREMIUM_COLOR : '#5EDCFF'} />
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            search ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>Sin resultados</Text>
                <Text style={styles.emptySubtitle}>Intenta con otro nombre</Text>
              </View>
            ) : null
          }
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nuevo mensaje"
        onPress={() => router.push('/new-message')}
        style={[styles.fab, { bottom: 18 + insets.bottom }]}
      >
        <LinearGradient colors={['#9B5CFF', '#7C3AED']} style={styles.fabGradient}>
          <MaterialCommunityIcons name="pencil-outline" size={22} color="#FFFFFF" />
        </LinearGradient>
      </Pressable>

      {/* Premium DM modal */}
      <PremiumDMModal
        visible={premiumModal.visible}
        recipientUsername={premiumModal.recipientUsername}
        recipientId={premiumModal.recipientId}
        dmPrice={premiumModal.dmPrice}
        balance={balance}
        isFreeFromSub={premiumModal.isFree}
        onClose={() => setPremiumModal(prev => ({ ...prev, visible: false }))}
        onSend={handleSendPremiumDM}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080A12' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 26, fontWeight: FontWeight.bold, color: '#F6F7FB' },
  headerSubtitle: { color: '#9298AD', fontSize: 11, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  notifBtn: { position: 'relative', padding: 2 },
  notifBadge: { position: 'absolute', top: -2, right: -2, backgroundColor: Colors.secondary, borderRadius: Radius.full, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderWidth: 1, borderColor: Colors.bg },
  notifBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },
  salaBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
  },
  newMsgBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  newMsgBtnGrad: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  searchWrap: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#141827', borderRadius: 14, paddingHorizontal: 14, marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderColor: '#23283A' },
  searchInput: { flex: 1, color: '#F6F7FB', fontSize: 14 },

  // Tab bar
  tabBar: { flexDirection: 'row', gap: 8, marginHorizontal: 20, marginBottom: 14 },
  tabBtn: { flex: 1, height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 17, backgroundColor: '#141827', borderWidth: 1, borderColor: '#23283A' },
  tabBtnActive: { backgroundColor: '#381A7A', borderColor: '#9B5CFF' },
  tabText: { color: '#9298AD', fontSize: 11, fontWeight: FontWeight.regular },
  tabTextActive: { color: '#FFFFFF', fontWeight: FontWeight.semibold },

  // Premium banner
  premiumBanner: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,157,0,0.3)' },
  premiumBannerInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  premiumBannerIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  premiumBannerTitle: { color: PREMIUM_COLOR, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  premiumBannerSub: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },

  // Premium DM item
  premiumDMItem: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,157,0,0.3)' },
  premiumDMInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: Spacing.md, position: 'relative' },
  premiumDMBadge: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,157,0,0.15)', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  premiumDMBadgeText: { color: PREMIUM_COLOR, fontSize: 9, fontWeight: FontWeight.bold },
  premiumDMUsername: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  premiumDMAmount: { color: PREMIUM_COLOR, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginTop: 2 },
  premiumDMExpiry: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  releaseBtn: { borderRadius: Radius.md, overflow: 'hidden' },
  releaseBtnGrad: { paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  releaseBtnText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Empty state
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl, paddingTop: 60 },
  emptyIconWrap: { borderRadius: Radius.xl, overflow: 'hidden' },
  emptyIconGrad: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.xl },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySubtitle: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  startChatBtn: { borderRadius: Radius.full, overflow: 'hidden', marginTop: Spacing.xs },
  startChatBtnGrad: { paddingHorizontal: 24, paddingVertical: 12 },
  startChatBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  // Conversation item
  convItem: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: 16, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: '#0F121C', borderRadius: 14, borderWidth: 1, borderColor: '#23283A' },
  convItemUnread: { backgroundColor: '#101421' },
  convItemPremium: { backgroundColor: 'rgba(255,157,0,0.05)' },
  premiumStripe: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, backgroundColor: PREMIUM_COLOR, borderRadius: 2 },
  avatarWrap: { position: 'relative' },
  groupAvatarStack: { width: 52, height: 42 },
  groupAvatarBack: { position: 'absolute', left: 0, top: 2, width: 38, height: 38, borderRadius: 19, backgroundColor: '#171B29', borderWidth: 1, borderColor: '#9298AD', alignItems: 'center', justifyContent: 'center' },
  groupAvatarFront: { position: 'absolute', left: 18, top: 4, width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#9B5CFF', overflow: 'hidden' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#35E28A', borderWidth: 2, borderColor: '#0F121C', alignItems: 'center', justifyContent: 'center' },
  convInfo: { flex: 1, gap: 4 },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  convName: { color: '#F6F7FB', fontSize: 14, fontWeight: FontWeight.semibold },
  convNameBold: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  premiumChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,157,0,0.15)', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  premiumChipText: { color: PREMIUM_COLOR, fontSize: 9, fontWeight: FontWeight.bold },
  convTime: { color: '#9298AD', fontSize: 10 },
  convBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convLastMsg: { color: '#9298AD', fontSize: 11, flex: 1 },
  convLastMsgBold: { color: Colors.textSecondary, fontWeight: FontWeight.medium },
  unreadBadge: { backgroundColor: '#7C3AED', borderRadius: Radius.full, minWidth: 24, height: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadBadgeText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  separator: { height: 0 },
  fab: { position: 'absolute', right: 24, width: 48, height: 48, borderRadius: 24, overflow: 'hidden', zIndex: 20, elevation: 8 },
  fabGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
