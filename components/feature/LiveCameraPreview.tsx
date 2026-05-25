import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, Dimensions,
  ActivityIndicator, TextInput, FlatList, KeyboardAvoidingView,
  Platform, Animated, Alert,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { getSupabaseClient } from '@/template';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';

const { width: W } = Dimensions.get('window');

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

interface JoinRequest {
  id: string;
  requesterId: string;
  requesterUsername: string;
  requesterAvatar: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

interface GuestParticipant {
  id: string;
  username: string;
  avatarUrl: string;
  joinedAt: string;
}

interface LiveCameraPreviewProps {
  visible: boolean;
  title: string;
  hostUser: {
    id: string;
    username: string;
    avatar?: string;
  } | null;
  onClose: () => void;
  onStreamStarted: () => void;
}

// Polling interval for chat and requests (ms)
const POLL_INTERVAL = 2500;
const MAX_CHAT_MESSAGES = 100;
const SPAM_THROTTLE_MS = 3000;

export function LiveCameraPreview({
  visible, title, hostUser, onClose, onStreamStarted,
}: LiveCameraPreviewProps) {
  const insets = useSafeAreaInsets();
  const supabase = getSupabaseClient();

  // Camera
  const [facing, setFacing] = useState<CameraType>('front');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  // Stream session
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streamSeconds, setStreamSeconds] = useState(0);
  const [dagEarned, setDagEarned] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);

  // Chat
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingMsg, setIsSendingMsg] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const chatListRef = useRef<FlatList>(null);
  const lastSentRef = useRef(0);

  // Join requests
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [guests, setGuests] = useState<GuestParticipant[]>([]);
  const pendingRequests = joinRequests.filter(r => r.status === 'pending');

  // Timers
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dagTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgIdRef = useRef<string | null>(null);

  // Request badge pulse
  const badgeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (pendingRequests.length > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(badgeAnim, { toValue: 1.3, duration: 400, useNativeDriver: true }),
          Animated.timing(badgeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        ])
      ).start();
    } else {
      badgeAnim.setValue(1);
    }
  }, [pendingRequests.length]);

  useEffect(() => {
    if (visible) {
      (async () => {
        if (!cameraPermission?.granted) await requestCameraPermission();
        if (!micPermission?.granted) await requestMicPermission();
      })();
    } else {
      if (isStreaming) endStream();
    }
  }, [visible]);

  const clearTimers = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (dagTimerRef.current) { clearInterval(dagTimerRef.current); dagTimerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  // ── Poll chat messages ─────────────────────────────────────────────────────
  const pollMessages = useCallback(async (sid: string) => {
    try {
      let query = supabase
        .from('live_messages')
        .select('*')
        .eq('session_id', sid)
        .order('created_at', { ascending: true })
        .limit(50);

      if (lastMsgIdRef.current) {
        query = query.gt('created_at', lastMsgIdRef.current);
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
        lastMsgIdRef.current = data[data.length - 1].created_at;

        setMessages(prev => {
          const combined = [...prev, ...newMsgs];
          return combined.slice(-MAX_CHAT_MESSAGES);
        });

        // Auto-scroll to bottom
        setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } catch (_) {}
  }, [supabase]);

  // ── Poll join requests ─────────────────────────────────────────────────────
  const pollJoinRequests = useCallback(async (sid: string) => {
    try {
      const { data } = await supabase
        .from('live_join_requests')
        .select('*')
        .eq('session_id', sid)
        .order('created_at', { ascending: false });

      if (data) {
        setJoinRequests(data.map((r: any) => ({
          id: r.id,
          requesterId: r.requester_id,
          requesterUsername: r.requester_username,
          requesterAvatar: r.requester_avatar,
          status: r.status,
          createdAt: r.created_at,
        })));

        // Sync guests from accepted requests
        const accepted = data.filter((r: any) => r.status === 'accepted');
        setGuests(accepted.map((r: any) => ({
          id: r.requester_id,
          username: r.requester_username,
          avatarUrl: r.requester_avatar,
          joinedAt: r.created_at,
        })));
      }
    } catch (_) {}
  }, [supabase]);

  // ── Start stream ───────────────────────────────────────────────────────────
  const startStream = async () => {
    if (!hostUser) return;

    try {
      const { data, error } = await supabase
        .from('live_sessions')
        .insert({
          host_id: hostUser.id,
          title: title || 'Live sin titulo',
          status: 'live',
          viewer_count: 0,
        })
        .select()
        .single();

      if (error || !data) {
        console.log('Failed to create session:', error?.message);
        // Continue without DB (local mode)
        startLocalStream(null);
        return;
      }

      setSessionId(data.id);
      startLocalStream(data.id);
    } catch (_) {
      startLocalStream(null);
    }
  };

  const startLocalStream = (sid: string | null) => {
    setIsStreaming(true);
    setStreamSeconds(0);
    setDagEarned(0);
    setViewerCount(Math.floor(Math.random() * 30) + 5);
    setMessages([]);
    lastMsgIdRef.current = null;

    timerRef.current = setInterval(() => {
      setStreamSeconds(s => s + 1);
      setViewerCount(v => Math.max(1, v + Math.floor(Math.random() * 3 - 1)));
    }, 1000);

    dagTimerRef.current = setInterval(() => {
      setDagEarned(d => Number((d + (Math.random() * 0.2 + 0.05)).toFixed(4)));
    }, 8000);

    if (sid) {
      pollRef.current = setInterval(() => {
        pollMessages(sid);
        pollJoinRequests(sid);
      }, POLL_INTERVAL);
    }

    onStreamStarted();
  };

  // ── End stream ─────────────────────────────────────────────────────────────
  const endStream = useCallback(async () => {
    clearTimers();
    setIsStreaming(false);
    setStreamSeconds(0);
    setDagEarned(0);
    setViewerCount(0);
    setMessages([]);
    setJoinRequests([]);
    setGuests([]);

    if (sessionId) {
      try {
        await supabase
          .from('live_sessions')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', sessionId);
      } catch (_) {}
      setSessionId(null);
    }
  }, [sessionId, supabase]);

  const handleEndStream = () => {
    Alert.alert(
      'Finalizar Live',
      `Has ganado ${dagEarned.toFixed(4)} $DAG en esta sesion. Finalizar ahora?`,
      [
        { text: 'Continuar', style: 'cancel' },
        {
          text: 'Finalizar',
          style: 'destructive',
          onPress: async () => {
            await endStream();
            onClose();
          },
        },
      ]
    );
  };

  // ── Send chat message ──────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text || !hostUser || !sessionId) return;

    const now = Date.now();
    if (now - lastSentRef.current < SPAM_THROTTLE_MS) return;
    lastSentRef.current = now;

    setIsSendingMsg(true);
    setChatInput('');

    // Optimistic local message
    const optimisticMsg: LiveMessage = {
      id: `local_${now}`,
      userId: hostUser.id,
      username: hostUser.username,
      avatarUrl: hostUser.avatar || '',
      message: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev.slice(-MAX_CHAT_MESSAGES), optimisticMsg]);
    setTimeout(() => chatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      await supabase.from('live_messages').insert({
        session_id: sessionId,
        user_id: hostUser.id,
        username: hostUser.username,
        avatar_url: hostUser.avatar || '',
        message: text,
      });
    } catch (_) {}

    setIsSendingMsg(false);
  };

  // ── Handle join request ────────────────────────────────────────────────────
  const handleRequest = async (requestId: string, accept: boolean) => {
    const newStatus = accept ? 'accepted' : 'rejected';
    setJoinRequests(prev =>
      prev.map(r => r.id === requestId ? { ...r, status: newStatus } : r)
    );

    try {
      await supabase
        .from('live_join_requests')
        .update({ status: newStatus })
        .eq('id', requestId);
    } catch (_) {}

    if (accept) {
      const req = joinRequests.find(r => r.id === requestId);
      if (req) {
        setGuests(prev => [...prev, {
          id: req.requesterId,
          username: req.requesterUsername,
          avatarUrl: req.requesterAvatar,
          joinedAt: new Date().toISOString(),
        }]);
        // Notify via chat
        const welcomeMsg: LiveMessage = {
          id: `sys_${Date.now()}`,
          userId: 'system',
          username: 'Sistema',
          avatarUrl: '',
          message: `@${req.requesterUsername} se unio al live!`,
          createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev.slice(-MAX_CHAT_MESSAGES), welcomeMsg]);
      }
    }
  };

  const removeGuest = async (guestId: string) => {
    setGuests(prev => prev.filter(g => g.id !== guestId));
    if (sessionId) {
      try {
        await supabase
          .from('live_join_requests')
          .update({ status: 'rejected' })
          .eq('session_id', sessionId)
          .eq('requester_id', guestId);
      } catch (_) {}
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const hasPermissions = cameraPermission?.granted && micPermission?.granted;
  const permissionsDenied = cameraPermission?.granted === false || micPermission?.granted === false;

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderMessage = ({ item }: { item: LiveMessage }) => (
    <View style={[styles.msgRow, item.userId === 'system' && styles.sysMsg]}>
      {item.userId !== 'system' ? (
        <Image
          source={{
            uri: item.avatarUrl ||
              `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(item.username)}`,
          }}
          style={styles.msgAvatar}
          contentFit="cover"
        />
      ) : null}
      <View style={styles.msgContent}>
        {item.userId !== 'system' ? (
          <Text style={styles.msgUsername}>@{item.username}</Text>
        ) : null}
        <Text style={[styles.msgText, item.userId === 'system' && styles.sysMsgText]}>
          {item.message}
        </Text>
      </View>
    </View>
  );

  const renderRequest = ({ item }: { item: JoinRequest }) => {
    if (item.status !== 'pending') return null;
    return (
      <View style={styles.requestCard}>
        <Image
          source={{
            uri: item.requesterAvatar ||
              `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(item.requesterUsername)}`,
          }}
          style={styles.requestAvatar}
          contentFit="cover"
        />
        <View style={styles.requestInfo}>
          <Text style={styles.requestUsername}>@{item.requesterUsername}</Text>
          <Text style={styles.requestSubtext}>Quiere unirse al live</Text>
        </View>
        <View style={styles.requestBtns}>
          <Pressable
            onPress={() => handleRequest(item.id, true)}
            style={styles.requestAccept}
            hitSlop={4}
          >
            <MaterialIcons name="check" size={18} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => handleRequest(item.id, false)}
            style={styles.requestReject}
            hitSlop={4}
          >
            <MaterialIcons name="close" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <StatusBar style="light" />
      <View style={styles.container}>
        {hasPermissions ? (
          <CameraView style={styles.camera} facing={facing}>
            {/* Gradient overlay */}
            <LinearGradient
              colors={['rgba(0,0,0,0.6)', 'transparent', 'transparent', 'rgba(0,0,0,0.75)']}
              locations={[0, 0.25, 0.6, 1]}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />

            {/* ── TOP BAR ─────────────────────────────────────────────────── */}
            <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
              <Pressable onPress={isStreaming ? handleEndStream : onClose} hitSlop={10} style={styles.topBtn}>
                <MaterialIcons name="arrow-back" size={26} color="#fff" />
              </Pressable>

              {isStreaming ? (
                <View style={styles.liveIndicator}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>EN VIVO</Text>
                  <Text style={styles.liveTimer}>{formatTime(streamSeconds)}</Text>
                </View>
              ) : (
                <View style={styles.titleBadge}>
                  <MaterialIcons name="live-tv" size={16} color={Colors.secondary} />
                  <Text style={styles.titleText} numberOfLines={1}>{title || 'Tu live'}</Text>
                </View>
              )}

              <Pressable
                onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}
                hitSlop={10}
                style={styles.topBtn}
              >
                <MaterialIcons name="flip-camera-ios" size={26} color="#fff" />
              </Pressable>
            </View>

            {/* ── STREAM STATS ─────────────────────────────────────────────── */}
            {isStreaming ? (
              <View style={styles.statsRow}>
                <View style={styles.statChip}>
                  <MaterialIcons name="visibility" size={14} color="#fff" />
                  <Text style={styles.statText}>{viewerCount.toLocaleString()}</Text>
                </View>
                <View style={[styles.statChip, styles.dagChip]}>
                  <Text style={styles.dagChipIcon}>◈</Text>
                  <Text style={styles.dagChipText}>{dagEarned.toFixed(4)} $DAG</Text>
                </View>
              </View>
            ) : null}

            {/* ── GUEST PARTICIPANTS ──────────────────────────────────────── */}
            {isStreaming && guests.length > 0 ? (
              <View style={styles.guestsRow}>
                {guests.map(g => (
                  <Pressable
                    key={g.id}
                    onLongPress={() => {
                      Alert.alert(
                        'Participante',
                        `Eliminar a @${g.username} del live?`,
                        [
                          { text: 'Cancelar', style: 'cancel' },
                          { text: 'Eliminar', style: 'destructive', onPress: () => removeGuest(g.id) },
                        ]
                      );
                    }}
                    style={styles.guestChip}
                  >
                    <Image
                      source={{
                        uri: g.avatarUrl ||
                          `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(g.username)}`,
                      }}
                      style={styles.guestAvatar}
                      contentFit="cover"
                    />
                    <Text style={styles.guestName}>@{g.username}</Text>
                    <View style={styles.guestLiveDot} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* ── JOIN REQUESTS BUTTON ─────────────────────────────────────── */}
            {isStreaming ? (
              <View style={styles.sideControls}>
                <Pressable
                  onPress={() => setShowChat(c => !c)}
                  style={styles.sideBtn}
                  hitSlop={8}
                >
                  <MaterialIcons
                    name={showChat ? 'chat' : 'chat-bubble-outline'}
                    size={22}
                    color="#fff"
                  />
                </Pressable>

                <Pressable
                  onPress={() => setShowRequestsPanel(p => !p)}
                  style={styles.sideBtn}
                  hitSlop={8}
                >
                  <MaterialIcons name="group-add" size={22} color="#fff" />
                  {pendingRequests.length > 0 ? (
                    <Animated.View
                      style={[styles.requestBadge, { transform: [{ scale: badgeAnim }] }]}
                    >
                      <Text style={styles.requestBadgeText}>{pendingRequests.length}</Text>
                    </Animated.View>
                  ) : null}
                </Pressable>
              </View>
            ) : null}

            {/* ── JOIN REQUESTS PANEL ──────────────────────────────────────── */}
            {showRequestsPanel && isStreaming ? (
              <View style={styles.requestsPanel}>
                <View style={styles.requestsPanelHeader}>
                  <Text style={styles.requestsPanelTitle}>
                    Solicitudes ({pendingRequests.length})
                  </Text>
                  <Pressable onPress={() => setShowRequestsPanel(false)} hitSlop={8}>
                    <MaterialIcons name="close" size={18} color={Colors.textSecondary} />
                  </Pressable>
                </View>
                {pendingRequests.length === 0 ? (
                  <Text style={styles.noRequests}>No hay solicitudes pendientes</Text>
                ) : (
                  <FlatList
                    data={pendingRequests}
                    keyExtractor={item => item.id}
                    renderItem={renderRequest}
                    style={{ maxHeight: 220 }}
                    showsVerticalScrollIndicator={false}
                  />
                )}
              </View>
            ) : null}

            {/* ── CHAT MESSAGES ────────────────────────────────────────────── */}
            {showChat && isStreaming ? (
              <View style={[styles.chatArea, { bottom: insets.bottom + 120 }]}>
                <FlatList
                  ref={chatListRef}
                  data={messages}
                  keyExtractor={item => item.id}
                  renderItem={renderMessage}
                  showsVerticalScrollIndicator={false}
                  style={styles.chatList}
                  contentContainerStyle={{ gap: 6, paddingVertical: 8 }}
                  inverted={false}
                  onContentSizeChange={() =>
                    chatListRef.current?.scrollToEnd({ animated: true })
                  }
                />
              </View>
            ) : null}

            {/* ── BOTTOM BAR ──────────────────────────────────────────────── */}
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.sm }]}
            >
              {isStreaming ? (
                <View style={styles.streamingBottom}>
                  {/* Chat input */}
                  <View style={styles.chatInputRow}>
                    <TextInput
                      style={styles.chatInput}
                      value={chatInput}
                      onChangeText={setChatInput}
                      placeholder="Escribe un mensaje..."
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      returnKeyType="send"
                      onSubmitEditing={sendMessage}
                      maxLength={200}
                      blurOnSubmit={false}
                    />
                    <Pressable
                      onPress={sendMessage}
                      disabled={!chatInput.trim() || isSendingMsg}
                      style={[styles.sendBtn, (!chatInput.trim() || isSendingMsg) && styles.sendBtnDisabled]}
                      hitSlop={8}
                    >
                      {isSendingMsg ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <MaterialIcons name="send" size={20} color="#fff" />
                      )}
                    </Pressable>
                  </View>

                  {/* Stop button */}
                  <Pressable onPress={handleEndStream} style={styles.stopBtn}>
                    <View style={styles.stopBtnInner}>
                      <MaterialIcons name="stop" size={28} color="#fff" />
                    </View>
                    <Text style={styles.stopBtnLabel}>Finalizar</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.preStreamControls}>
                  <Text style={styles.preTitle} numberOfLines={2}>{title || 'Tu live'}</Text>
                  <Text style={styles.preSubtitle}>Vista previa de camara activa</Text>
                  <Pressable onPress={startStream} style={styles.goLiveBtn}>
                    <LinearGradient
                      colors={[Colors.secondary, '#FF6B35']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.goLiveBtnGrad}
                    >
                      <View style={styles.liveDotWhite} />
                      <Text style={styles.goLiveBtnText}>INICIAR LIVE</Text>
                    </LinearGradient>
                  </Pressable>
                  <Text style={styles.dagHint}>Ganas $DAG por cada tip de tus fans</Text>
                </View>
              )}
            </KeyboardAvoidingView>
          </CameraView>
        ) : permissionsDenied ? (
          <View style={styles.permView}>
            <MaterialIcons name="videocam-off" size={64} color={Colors.textSubtle} />
            <Text style={styles.permTitle}>Permisos necesarios</Text>
            <Text style={styles.permText}>
              Necesitamos acceso a tu camara y microfono para el live.
              Habilitatlos en los ajustes de tu dispositivo.
            </Text>
            <Pressable onPress={onClose} style={styles.permClose}>
              <Text style={styles.permCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.permView}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.permText}>Solicitando permisos...</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  topBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: Radius.full,
  },
  liveIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.error,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  liveTimer: { color: 'rgba(255,255,255,0.85)', fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  titleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    maxWidth: W * 0.45,
  },
  titleText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  // Stats
  statsRow: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, marginTop: Spacing.xs,
  },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  statText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  dagChip: { backgroundColor: 'rgba(0,212,255,0.25)', borderWidth: 1, borderColor: 'rgba(0,212,255,0.4)' },
  dagChipIcon: { color: Colors.primary, fontSize: 13 },
  dagChipText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Guests
  guestsRow: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, marginTop: Spacing.sm,
    flexWrap: 'wrap',
  },
  guestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1, borderColor: 'rgba(0,255,136,0.4)',
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4,
  },
  guestAvatar: { width: 22, height: 22, borderRadius: 11 },
  guestName: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold },
  guestLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },

  // Side controls
  sideControls: {
    position: 'absolute',
    right: Spacing.md,
    top: '40%',
    gap: Spacing.sm,
  },
  sideBtn: {
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: Radius.full,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  requestBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.secondary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#000',
  },
  requestBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },

  // Join requests panel
  requestsPanel: {
    position: 'absolute',
    right: Spacing.md,
    top: '35%',
    width: W * 0.72,
    backgroundColor: 'rgba(10,10,20,0.92)',
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.primaryDim,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  requestsPanelHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  requestsPanelTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  noRequests: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center', paddingVertical: Spacing.sm },
  requestCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  requestAvatar: { width: 36, height: 36, borderRadius: 18 },
  requestInfo: { flex: 1 },
  requestUsername: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  requestSubtext: { color: Colors.textSubtle, fontSize: FontSize.xs },
  requestBtns: { flexDirection: 'row', gap: 6 },
  requestAccept: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  requestReject: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center',
  },

  // Chat
  chatArea: {
    position: 'absolute',
    left: Spacing.md,
    right: 60,
    maxHeight: 200,
  },
  chatList: { flex: 1 },
  msgRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  sysMsg: {
    backgroundColor: 'rgba(0,255,136,0.12)',
    borderWidth: 1, borderColor: 'rgba(0,255,136,0.2)',
    justifyContent: 'center',
  },
  msgAvatar: { width: 22, height: 22, borderRadius: 11, marginTop: 1 },
  msgContent: { flex: 1 },
  msgUsername: { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.bold, marginBottom: 1 },
  msgText: { color: 'rgba(255,255,255,0.9)', fontSize: FontSize.xs, lineHeight: 16 },
  sysMsgText: { color: Colors.accent, textAlign: 'center', fontSize: 11 },

  // Bottom bar
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  streamingBottom: { paddingHorizontal: Spacing.md, gap: Spacing.sm, alignItems: 'center' },
  chatInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    width: '100%',
  },
  chatInput: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    color: '#fff', fontSize: FontSize.sm,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  stopBtn: { alignItems: 'center', gap: 4 },
  stopBtnInner: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: Colors.error,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)',
  },
  stopBtnLabel: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Pre-stream
  preStreamControls: { alignItems: 'center', gap: Spacing.md, width: '100%', paddingHorizontal: Spacing.lg },
  preTitle: {
    color: '#fff', fontSize: FontSize.lg, fontWeight: FontWeight.bold,
    textAlign: 'center', textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  preSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: FontSize.sm },
  goLiveBtn: { width: '80%', borderRadius: Radius.full, overflow: 'hidden' },
  goLiveBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 15, gap: Spacing.sm,
  },
  liveDotWhite: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#fff' },
  goLiveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold, letterSpacing: 1 },
  dagHint: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },

  // Permissions
  permView: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: Spacing.lg, padding: Spacing.xl,
  },
  permTitle: { color: '#fff', fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  permText: { color: Colors.textSecondary, fontSize: FontSize.md, textAlign: 'center', lineHeight: 22 },
  permClose: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  permCloseText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
});
