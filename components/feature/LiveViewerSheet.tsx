import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet,
  FlatList, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { getSupabaseClient } from '@/template';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { LiveStream, TIP_AMOUNTS, formatNumber } from '@/services/mockData';

const { height: H } = Dimensions.get('window');

// ── Emoji picker ──────────────────────────────────────────────────────────────
const QUICK_EMOJIS = ['❤️','🔥','👏','😍','💯','🚀','😂','🤩','💪','🎉','✨','👑','💎','🫶','⭐'];

function QuickEmojis({ onSelect }: { onSelect: (e: string) => void }) {
  return (
    <View style={emojiStyles.row}>
      {QUICK_EMOJIS.map((e, i) => (
        <Pressable
          key={i}
          onPress={() => onSelect(e)}
          style={({ pressed }) => [emojiStyles.btn, pressed && { opacity: 0.6 }]}
          hitSlop={4}
        >
          <Text style={emojiStyles.emoji}>{e}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const emojiStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    gap: 4,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  btn: {
    width: 38,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
  emoji: { fontSize: 22 },
});

// ── Types ─────────────────────────────────────────────────────────────────────
interface LiveMessage {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string;
  message: string;
  createdAt: string;
  isTip?: boolean;
  tipAmount?: number;
}

interface LiveViewerSheetProps {
  visible: boolean;
  stream: LiveStream | null;
  sessionId?: string | null;
  currentUser: {
    id: string;
    username: string;
    avatar?: string;
  } | null;
  onClose: () => void;
  onSendTip: (amount: number) => void;
}

const POLL_INTERVAL = 2500;
const MAX_MESSAGES = 80;
const SPAM_THROTTLE_MS = 3000;

export function LiveViewerSheet({
  visible, stream, sessionId, currentUser, onClose, onSendTip,
}: LiveViewerSheetProps) {
  const insets = useSafeAreaInsets();
  const supabase = getSupabaseClient();

  const [messages, setMessages] = useState<LiveMessage[]>([
    { id: 's1', userId: 'hodl', username: 'hodl_king', avatarUrl: '', message: 'Increible live! 🔥', createdAt: '' },
    { id: 's2', userId: 'defi', username: 'defi_girl', avatarUrl: '', message: 'El mejor creador de BlockDAG! ❤️', createdAt: '' },
    { id: 's3', userId: 'web3', username: 'web3native', avatarUrl: '', message: 'Cuantos DAG llevas hoy? 💎', createdAt: '' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendingTip, setSendingTip] = useState<number | null>(null);
  const [hasRequestedJoin, setHasRequestedJoin] = useState(false);
  const [joinStatus, setJoinStatus] = useState<'none' | 'pending' | 'accepted' | 'rejected'>('none');
  const [showEmojis, setShowEmojis] = useState(false);

  const chatListRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgTimeRef = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const inputRef = useRef<TextInput>(null);

  // ── Poll messages ──────────────────────────────────────────────────────────
  const pollMessages = useCallback(async (sid: string) => {
    try {
      let query = supabase
        .from('live_messages')
        .select('*')
        .eq('session_id', sid)
        .order('created_at', { ascending: true })
        .limit(30);

      if (lastMsgTimeRef.current) {
        query = query.gt('created_at', lastMsgTimeRef.current);
      }

      const { data } = await query;
      if (data && data.length > 0) {
        const newMsgs: LiveMessage[] = data.map((m: any) => ({
          id: m.id,
          userId: m.user_id,
          username: m.username,
          avatarUrl: m.avatar_url,
          message: m.message,
          createdAt: m.created_at,
        }));
        lastMsgTimeRef.current = data[data.length - 1].created_at;
        setMessages(prev => [...prev, ...newMsgs].slice(-MAX_MESSAGES));
        setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } catch (_) {}
  }, [supabase]);

  const pollJoinStatus = useCallback(async (sid: string) => {
    if (!currentUser || joinStatus !== 'pending') return;
    try {
      const { data } = await supabase
        .from('live_join_requests')
        .select('status')
        .eq('session_id', sid)
        .eq('requester_id', currentUser.id)
        .single();
      if (data) setJoinStatus(data.status as any);
    } catch (_) {}
  }, [supabase, currentUser, joinStatus]);

  useEffect(() => {
    if (visible && sessionId) {
      lastMsgTimeRef.current = null;
      pollMessages(sessionId);
      pollRef.current = setInterval(() => {
        pollMessages(sessionId);
        pollJoinStatus(sessionId);
      }, POLL_INTERVAL);
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [visible, sessionId]);

  useEffect(() => {
    if (!visible) {
      setMessages([
        { id: 's1', userId: 'hodl', username: 'hodl_king', avatarUrl: '', message: 'Increible live! 🔥', createdAt: '' },
        { id: 's2', userId: 'defi', username: 'defi_girl', avatarUrl: '', message: 'El mejor creador de BlockDAG! ❤️', createdAt: '' },
        { id: 's3', userId: 'web3', username: 'web3native', avatarUrl: '', message: 'Cuantos DAG llevas hoy? 💎', createdAt: '' },
      ]);
      setHasRequestedJoin(false);
      setJoinStatus('none');
      setShowEmojis(false);
      lastMsgTimeRef.current = null;
    }
  }, [visible]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setChatInput(prev => prev + emoji);
    inputRef.current?.focus();
  }, []);

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text || !currentUser) return;
    const now = Date.now();
    if (now - lastSentRef.current < SPAM_THROTTLE_MS) return;
    lastSentRef.current = now;

    setIsSending(true);
    setChatInput('');
    setShowEmojis(false);

    const optimistic: LiveMessage = {
      id: `opt_${now}`,
      userId: currentUser.id,
      username: currentUser.username,
      avatarUrl: currentUser.avatar || '',
      message: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev.slice(-MAX_MESSAGES), optimistic]);
    setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);

    if (sessionId) {
      try {
        await supabase.from('live_messages').insert({
          session_id: sessionId,
          user_id: currentUser.id,
          username: currentUser.username,
          avatar_url: currentUser.avatar || '',
          message: text,
        });
      } catch (_) {}
    }
    setIsSending(false);
  };

  const requestJoin = async () => {
    if (!currentUser || !sessionId || hasRequestedJoin) return;
    setHasRequestedJoin(true);
    setJoinStatus('pending');
    try {
      await supabase.from('live_join_requests').insert({
        session_id: sessionId,
        requester_id: currentUser.id,
        requester_username: currentUser.username,
        requester_avatar: currentUser.avatar || '',
        status: 'pending',
      });
    } catch (_) {
      setHasRequestedJoin(false);
      setJoinStatus('none');
    }
  };

  const handleTip = async (amount: number) => {
    setSendingTip(amount);
    await new Promise(r => setTimeout(r, 900));
    setSendingTip(null);
    onSendTip(amount);

    if (currentUser) {
      const tipMsg: LiveMessage = {
        id: `tip_${Date.now()}`,
        userId: currentUser.id,
        username: currentUser.username,
        avatarUrl: currentUser.avatar || '',
        message: `Envio un tip de ${amount} $DAG! 💎`,
        createdAt: new Date().toISOString(),
        isTip: true,
        tipAmount: amount,
      };
      setMessages(prev => [...prev.slice(-MAX_MESSAGES), tipMsg]);
      setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);

      if (sessionId) {
        try {
          await supabase.from('live_messages').insert({
            session_id: sessionId,
            user_id: currentUser.id,
            username: currentUser.username,
            avatar_url: currentUser.avatar || '',
            message: `Envio un tip de ${amount} $DAG! 💎`,
          });
        } catch (_) {}
      }
    }
  };

  if (!stream) return null;

  const renderMessage = ({ item }: { item: LiveMessage }) => (
    <View style={item.isTip ? styles.tipMsgRow : styles.msgRow}>
      {item.isTip ? (
        <LinearGradient
          colors={['rgba(124,92,255,0.2)', 'rgba(255,45,120,0.12)']}
          style={styles.tipMsgBg}
        >
          <Text style={styles.tipMsgIcon}>◈</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.tipMsgUser}>@{item.username}</Text>
            <Text style={styles.tipMsgText}>Envio {item.tipAmount} $DAG! 💎</Text>
          </View>
        </LinearGradient>
      ) : (
        <>
          <Image
            source={{ uri: item.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(item.username)}` }}
            style={styles.msgAvatar}
            contentFit="cover"
          />
          <View style={styles.msgBubble}>
            <Text style={styles.msgUsername}>@{item.username}</Text>
            <Text style={styles.msgText}>{item.message}</Text>
          </View>
        </>
      )}
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheet}
      >
        <View style={[styles.sheetInner, { paddingBottom: showEmojis ? 0 : insets.bottom + Spacing.sm }]}>
          {/* Handle */}
          <View style={styles.handleWrap}>
            <View style={styles.handleBar} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>EN VIVO</Text>
            </View>
            <View style={styles.streamInfo}>
              <Avatar uri={stream.userAvatar} username={stream.username} size={36} showBorder />
              <View style={{ flex: 1 }}>
                <Text style={styles.streamUsername}>@{stream.username}</Text>
                <Text style={styles.streamTitle} numberOfLines={1}>{stream.title}</Text>
              </View>
              <View style={styles.viewersChip}>
                <MaterialIcons name="visibility" size={13} color={Colors.textSecondary} />
                <Text style={styles.viewersText}>{formatNumber(stream.viewers)}</Text>
              </View>
            </View>
            <View style={styles.dagEarned}>
              <Text style={styles.dagEarnedIcon}>◈</Text>
              <Text style={styles.dagEarnedText}>{stream.dagEarned.toFixed(2)} $DAG</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {/* Join request status */}
          {joinStatus !== 'none' ? (
            <View style={[
              styles.joinStatusBar,
              joinStatus === 'accepted' && styles.joinStatusAccepted,
              joinStatus === 'rejected' && styles.joinStatusRejected,
            ]}>
              <MaterialCommunityIcons
                name={joinStatus === 'pending' ? 'clock-outline' : joinStatus === 'accepted' ? 'check-circle' : 'close-circle'}
                size={16}
                color={joinStatus === 'accepted' ? Colors.accent : joinStatus === 'rejected' ? Colors.secondary : Colors.textSecondary}
              />
              <Text style={styles.joinStatusText}>
                {joinStatus === 'pending' ? 'Solicitud enviada, esperando...' :
                  joinStatus === 'accepted' ? 'Aceptado! Ya eres parte del live ✅' :
                    'Solicitud rechazada'}
              </Text>
            </View>
          ) : null}

          {/* Chat */}
          <FlatList
            ref={chatListRef}
            data={messages}
            keyExtractor={(item, i) => `${item.id}_${i}`}
            renderItem={renderMessage}
            style={styles.chatList}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: false })}
          />

          {/* Quick emojis */}
          {showEmojis ? (
            <QuickEmojis onSelect={handleEmojiSelect} />
          ) : null}

          {/* Chat input + actions */}
          <View style={[styles.inputArea, showEmojis && { paddingBottom: insets.bottom + 4 }]}>
            <View style={styles.chatRow}>
              <View style={styles.chatInputWrap}>
                <TextInput
                  ref={inputRef}
                  style={styles.chatInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="Comenta en el live..."
                  placeholderTextColor={Colors.textSubtle}
                  returnKeyType="send"
                  onSubmitEditing={sendMessage}
                  maxLength={200}
                  blurOnSubmit={false}
                  onFocus={() => setShowEmojis(false)}
                />
                <Pressable
                  onPress={() => { setShowEmojis(v => !v); if (!showEmojis) inputRef.current?.blur(); }}
                  style={[styles.emojiBtn, showEmojis && styles.emojiBtnActive]}
                  hitSlop={4}
                >
                  <Text style={{ fontSize: 18 }}>😊</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={sendMessage}
                disabled={!chatInput.trim() || isSending}
                style={[styles.sendBtn, (!chatInput.trim() || isSending) && styles.sendBtnDisabled]}
                hitSlop={8}
              >
                <LinearGradient
                  colors={chatInput.trim() ? ['#7C5CFF', '#FF2D78'] : [Colors.border, Colors.border]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.sendBtnGrad}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialCommunityIcons name="send" size={17} color="#fff" />
                  )}
                </LinearGradient>
              </Pressable>

              {/* Request to join */}
              {!hasRequestedJoin ? (
                <Pressable onPress={requestJoin} style={styles.joinBtn} hitSlop={4}>
                  <MaterialCommunityIcons name="video-plus-outline" size={16} color={Colors.primary} />
                  <Text style={styles.joinBtnText}>Unirse</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Tips */}
            <View style={styles.tipSection}>
              <Text style={styles.tipTitle}>Enviar Tip $DAG</Text>
              <View style={styles.tipRow}>
                {TIP_AMOUNTS.map(amount => (
                  <Pressable
                    key={amount}
                    onPress={() => handleTip(amount)}
                    disabled={sendingTip !== null}
                    style={[styles.tipBtn, sendingTip === amount && styles.tipBtnLoading]}
                  >
                    <LinearGradient
                      colors={['#7C5CFF', '#B44FFF']}
                      style={styles.tipBtnGrad}
                    >
                      {sendingTip === amount ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Text style={styles.tipBtnIcon}>◈</Text>
                          <Text style={styles.tipBtnText}>{amount}</Text>
                        </>
                      )}
                    </LinearGradient>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.tipNote}>Los tips van directamente al creador</Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: { justifyContent: 'flex-end' },
  sheetInner: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: H * 0.84,
  },
  handleWrap: { alignItems: 'center', paddingTop: Spacing.sm, paddingBottom: 4 },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },

  header: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 10 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.error, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 3, alignSelf: 'flex-start',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveBadgeText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  streamInfo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  streamUsername: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  streamTitle: { color: Colors.textSecondary, fontSize: FontSize.xs },
  viewersChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewersText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  dagEarned: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 4, alignSelf: 'flex-start',
  },
  dagEarnedIcon: { color: Colors.primary, fontSize: 13 },
  dagEarnedText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  closeBtn: { position: 'absolute', top: Spacing.sm, right: Spacing.md, padding: 4 },

  joinStatusBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.md, marginBottom: Spacing.xs,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
  },
  joinStatusAccepted: { borderColor: Colors.accent + '44', backgroundColor: Colors.accentDim },
  joinStatusRejected: { borderColor: Colors.secondary + '44', backgroundColor: Colors.secondaryDim },
  joinStatusText: { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1 },

  chatList: { maxHeight: 200, borderTopWidth: 1, borderTopColor: Colors.border },
  chatContent: { padding: Spacing.md, gap: Spacing.sm },

  msgRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  tipMsgRow: { width: '100%' },
  msgAvatar: { width: 26, height: 26, borderRadius: 13 },
  msgBubble: { flex: 1 },
  msgUsername: { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.bold, marginBottom: 1 },
  msgText: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 17 },
  tipMsgBg: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderRadius: Radius.md, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.primary + '33',
  },
  tipMsgIcon: { color: Colors.primary, fontSize: 18 },
  tipMsgUser: { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.bold },
  tipMsgText: { color: Colors.accent, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  inputArea: { borderTopWidth: 1, borderTopColor: Colors.border, padding: Spacing.md, gap: Spacing.md },
  chatRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  chatInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.full, paddingHorizontal: Spacing.md,
  },
  chatInput: {
    flex: 1, color: Colors.textPrimary, fontSize: FontSize.sm,
    paddingVertical: 10,
  },
  emojiBtn: {
    width: 30, height: 30, alignItems: 'center', justifyContent: 'center',
    borderRadius: 15,
  },
  emojiBtnActive: { backgroundColor: Colors.primaryDim },
  sendBtn: { borderRadius: Radius.full, overflow: 'hidden' },
  sendBtnGrad: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: {},
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.primary + '44',
  },
  joinBtnText: { color: Colors.primary, fontSize: 11, fontWeight: FontWeight.semibold },

  tipSection: { gap: Spacing.sm },
  tipTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  tipRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  tipBtn: { borderRadius: Radius.md, overflow: 'hidden' },
  tipBtnLoading: { opacity: 0.6 },
  tipBtnGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minWidth: 60, justifyContent: 'center',
  },
  tipBtnIcon: { color: '#fff', fontSize: 13 },
  tipBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  tipNote: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center' },
});
