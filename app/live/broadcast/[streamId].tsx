/**
 * app/live/broadcast/[streamId].tsx — Agora live stream broadcaster screen
 *
 * Lives under live/broadcast/ (not live/[streamId].tsx) because expo-router
 * forbids two different dynamic segment names in the same directory, and
 * app/live/[sessionId].tsx already occupies app/live/.
 *
 * Creates the live_sessions row, drives Agora LIVE_BROADCASTING, receives
 * canonical gift events, and renders the same gift animation overlay as viewers.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, FlatList, ScrollView, TextInput, ActivityIndicator, Dimensions,
  Keyboard, Platform, Animated, AppState, AppStateStatus, BackHandler, Alert, Share, useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { useAgoraEngine } from '@/hooks/useAgoraEngine';
import { RtcSurfaceView, useridToAgoraUid, isAgoraAvailable } from '@/services/agoraService';
import {
  controlLiveParticipant,
  decideLiveJoinRequest,
  emitLiveReaction,
  endLiveSession,
  enforceLiveParticipantTimer,
  heartbeatLiveSession,
  inviteLiveParticipant,
  markLiveSessionDisconnected,
  sendLiveMessage,
  startLiveSession,
  type LiveEndReason,
  type LiveHostControlAction,
} from '@/services/liveSessionService';
import { LiveGiftOverlay } from '@/components/live/gifts/LiveGiftOverlay';
import { LiveChatMessageItem } from '@/components/live/LiveChatMessageItem';
import { LiveSessionHeader } from '@/components/live/LiveSessionHeader';
import { LiveBattleStage } from '@/components/live/LiveBattleStage';
import { LiveBattleHostControls } from '@/components/live/LiveBattleHostControls';
import { useLiveGiftAnimations } from '@/hooks/live/useLiveGiftAnimations';
import { useLiveBattleRelayRuntime } from '@/hooks/live/useLiveBattleRelayRuntime';
import { useLiveBattleSpectatorState } from '@/hooks/live/useLiveBattleSpectatorState';
import { isLiveBattleStageStatus } from '@/services/liveBattleSpectatorService';
import type { LiveGiftEvent } from '@/types/liveGifts';
import { LiveHostProductManager } from '@/components/live/commerce/LiveHostProductManager';
import { LiveHostPurchaseFeed } from '@/components/live/commerce/LiveHostPurchaseFeed';
import { LiveProductRail } from '@/components/live/shop/LiveProductRail';
import { fetchLiveSessionProducts, type LiveSessionProduct } from '@/services/liveCommerceService';

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 12_000;
const MAX_MESSAGES     = 50;
const SPAM_THROTTLE_MS = 2500;
const REACTION_ANIMATION_DURATION_MS = 3600;
const REACTION_CLEANUP_DELAY_MS = 3800;
const PRODUCT_HEIGHT_FALLBACK = 88;
const PRODUCT_PLACEHOLDER_HEIGHT = 44;
const PRODUCT_OVERLAY_GAP = 12;
const COHOST_PREVIEW_GAP = 12;
const COHOST_PREVIEW_HEIGHT = 108;
const COHOST_PREVIEW_TOP_CLEARANCE = 108;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  createdAt: string;
  avatarUrl?: string | null;
}

function mergeMessages(prev: ChatMessage[], next: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>();
  [...prev, ...next].forEach(message => byId.set(message.id, message));
  return Array.from(byId.values())
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-MAX_MESSAGES);
}

async function attachMessageAvatars(supabase: ReturnType<typeof getSupabaseClient>, messages: ChatMessage[], fallbackUser?: any): Promise<ChatMessage[]> {
  const userIds = Array.from(new Set(messages.map(message => message.userId).filter(Boolean)));
  if (userIds.length === 0) return messages;

  const { data } = await supabase
    .from('user_profiles')
    .select('id, avatar_url')
    .in('id', userIds);

  const avatarByUserId = new Map<string, string | null>();
  (data ?? []).forEach((profile: any) => avatarByUserId.set(profile.id, profile.avatar_url ?? null));

  return messages.map(message => ({
    ...message,
    avatarUrl: avatarByUserId.get(message.userId) ?? (message.userId === fallbackUser?.id ? fallbackUser?.avatar ?? null : null),
  }));
}

type LiveParticipant = {
  id: string;
  session_id: string;
  user_id: string;
  agora_uid: number | null;
  username: string | null;
  role: 'audience' | 'requested' | 'cohost' | 'removed';
  status: 'active' | 'inactive' | 'removed';
  mic_muted: boolean;
  mic_locked: boolean;
  camera_enabled: boolean;
  floor_granted: boolean;
  floor_started_at: string | null;
  floor_duration_seconds: number | null;
  created_at: string;
  updated_at: string;
};

type FloatingReaction = {
  id: string;
  emoji: string;
  username?: string | null;
  createdAt: number;
  x: number;
  big?: boolean;
};

type HostActionPanel = 'requests' | 'gifts' | 'participants' | 'moderation' | null;

function liveGiftEventFromPayload(row: any, streamId: string): LiveGiftEvent | null {
  const payload = row?.payload ?? {};
  if (row?.event_type !== 'reaction' || payload?.gift_real !== true) return null;
  const transactionId = String(payload.transaction_id ?? row.id ?? '');
  const giftId = String(payload.gift_id ?? '');
  if (!transactionId || !giftId) return null;
  return {
    eventId: row.id ?? null,
    transactionId,
    sessionId: String(payload.session_id ?? row.session_id ?? streamId),
    senderUserId: row.actor_user_id ?? payload.sender_user_id ?? null,
    senderUsername: payload.username ?? payload.sender_username ?? null,
    senderAvatarUrl: payload.avatar_url ?? payload.sender_avatar_url ?? null,
    giftId,
    giftName: String(payload.gift_name ?? payload.label ?? giftId),
    icon: String(payload.icon ?? payload.emoji ?? '\uD83C\uDF81'),
    amountBdag: Number(payload.amount_bdag ?? payload.amount_coins ?? 0),
    category: payload.category ?? 'basic',
    animationType: payload.animation_type ?? 'floating',
    animationAsset: payload.animation_asset ?? null,
    durationMs: Number(payload.duration_ms ?? 1800),
    priority: Number(payload.priority ?? 0),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

function getCohostTimerText(participant: LiveParticipant) {
  if (!participant.floor_started_at) return null;
  if (participant.floor_duration_seconds === null || participant.floor_duration_seconds === undefined) return null;
  const startedAt = new Date(participant.floor_started_at).getTime();
  if (Number.isNaN(startedAt)) return null;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const remaining = Math.max(0, participant.floor_duration_seconds - elapsed);
  return `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, '0')}`;
}

function FloatingReactionBubble({
  reaction,
  bottom,
  viewportHeight,
}: {
  reaction: FloatingReaction;
  bottom: number;
  viewportHeight: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const travelDistance = Math.max(viewportHeight * 0.95, viewportHeight - bottom + 64);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: REACTION_ANIMATION_DURATION_MS,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floatingReaction,
        {
          left: `${reaction.x * 100}%`,
          bottom,
          opacity: progress.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -travelDistance] }) },
            { scale: progress.interpolate({ inputRange: [0, 0.18, 1], outputRange: [reaction.big ? 1.1 : 0.82, reaction.big ? 1.4 : 1.08, reaction.big ? 1.3 : 1] }) },
          ],
        },
      ]}
    >
      <Text style={[styles.floatingReactionEmoji, reaction.big && styles.floatingReactionEmojiBig]}>{reaction.emoji}</Text>
    </Animated.View>
  );
}

export default function LiveBroadcasterScreen() {
  const { streamId } = useLocalSearchParams<{ streamId: string }>();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();
  const { height: viewportHeight } = useWindowDimensions();

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;

  const [title, setTitle]           = useState('');
  const [live, setLive]             = useState(false);
  const [sessionIsCanonicalLive, setSessionIsCanonicalLive] = useState(false);
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');
  const [starting, setStarting]     = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const [cohostTimerTick, setCohostTimerTick] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [composerHeight, setComposerHeight] = useState(72);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [commerceVisible, setCommerceVisible] = useState(false);
  const [moreControlsVisible,setMoreControlsVisible]=useState(false);
  const [hostActionPanel, setHostActionPanel] = useState<HostActionPanel>(null);
  const [liveProducts, setLiveProducts] = useState<LiveSessionProduct[]>([]);
  const featuredLiveProduct = liveProducts.find(product => product.isFeatured) ?? null;
  const featuredProductId = featuredLiveProduct?.id ?? null;
  const [featuredProductMeasurement, setFeaturedProductMeasurement] = useState<{
    productId: string;
    height: number;
  } | null>(null);
  const { activeGift, floatingGifts, enqueueGift } = useLiveGiftAnimations(streamId);

  const handleProductRailLayout = useCallback((height: number) => {
    if (!featuredProductId || !Number.isFinite(height) || height <= 0) return;
    setFeaturedProductMeasurement(current =>
      current?.productId === featuredProductId && Math.abs(current.height - height) < 1
        ? current
        : { productId: featuredProductId, height }
    );
  }, [featuredProductId]);

  const toggleHostActionPanel = useCallback((panel: Exclude<HostActionPanel, null>) => {
    Keyboard.dismiss();
    setHostActionPanel(current => current === panel ? null : panel);
  }, []);

  const refreshLiveProducts = useCallback(async () => {
    if (!streamId || !live) return;
    try { setLiveProducts(await fetchLiveSessionProducts(streamId)); } catch { /* polling retries safely */ }
  }, [live, streamId]);
  useEffect(() => {
    if (!streamId || !live) { setLiveProducts([]); return; }
    void refreshLiveProducts();
    const timer = setInterval(() => void refreshLiveProducts(), 5_000);
    const channel = getSupabaseClient().channel(`live-commerce-host:${streamId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'live_session_products', filter: `session_id=eq.${streamId}` }, () => void refreshLiveProducts()).subscribe();
    return () => { clearInterval(timer); void getSupabaseClient().removeChannel(channel); };
  }, [live, refreshLiveProducts, streamId]);

  const {
    engineReady, joined, error,
    remoteUids, isMuted, isCameraOff, localVideoReady, join, leave, toggleMute, toggleCamera, switchCamera,
    getEngine, registerBeforeEngineRelease,
  } = useAgoraEngine({
    channelName: live ? streamId ?? null : null,
    uid: myUid,
    role: 'publisher',
    profile: 'live-broadcasting',
    liveSessionId: live ? streamId : undefined,
    liveRequestedRole: 'host',
  });

  const battleRuntime = useLiveBattleRelayRuntime({
    liveSessionId: streamId ?? null,
    hostUserId: user?.id ?? null,
    isCanonicalHost: sessionIsCanonicalLive,
    isSessionLive: live && sessionIsCanonicalLive,
    engineReady,
    joined,
    isForeground,
    getEngine,
    registerBeforeEngineRelease,
  });
  const battleProjection = useLiveBattleSpectatorState(
    streamId ?? null,
    Boolean(user?.id && live && sessionIsCanonicalLive),
  );
  const { stop: stopBattleRuntime } = battleRuntime;

  const chatRef    = useRef<FlatList>(null);
  const inputRef   = useRef<TextInput | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgRef = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const sendingRef = useRef(false);
  const endedRef   = useRef(false);
  const mountedRef = useRef(true);
  const liveRef = useRef(false);
  const joinedRef = useRef(false);
  const heartbeatFailuresRef = useRef(0);
  const finalizePromiseRef = useRef<Promise<void> | null>(null);
  const expiredTimerMutedRef = useRef<Set<string>>(new Set());
  const seenReactionEventIdsRef = useRef<Set<string>>(new Set());
  const lastReactionAtRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  const scrollToLatest = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      chatRef.current?.scrollToEnd({ animated });
    });

    setTimeout(() => {
      chatRef.current?.scrollToEnd({ animated });
    }, 80);
  }, []);

  const dismissKeyboard = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const addFloatingReaction = useCallback((emoji: string, username?: string | null, big = false) => {
    const reaction: FloatingReaction = {
      id: `reaction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      emoji,
      username,
      createdAt: Date.now(),
      x: 0.82 + Math.random() * 0.1,
      big,
    };

    setFloatingReactions(prev => [...prev, reaction].slice(-12));
    setTimeout(() => {
      if (!mountedRef.current) return;
      setFloatingReactions(prev => prev.filter(item => item.id !== reaction.id));
    }, REACTION_CLEANUP_DELAY_MS);
  }, []);

  const clearLiveTimers = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
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
    if (messages.length === 0) return;
    scrollToLatest(true);
  }, [messages.length, keyboardHeight, composerHeight, scrollToLatest]);

  // ── Start broadcast: create live_sessions row, then join Agora ──────────
  const handleGoLive = useCallback(async () => {
    if (!user?.id || !streamId || !title.trim() || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await startLiveSession(streamId, title.trim());
      heartbeatFailuresRef.current = 0;
      endedRef.current = false;
      setSessionIsCanonicalLive(true);
      setLive(true);
    } catch (err: any) {
      if (__DEV__) console.warn('[LiveBroadcast] start live failed', err?.message ?? err);
      setStartError('No se pudo iniciar la transmisión. Inténtalo nuevamente.');
      Alert.alert('No se pudo iniciar la transmisión', 'Inténtalo nuevamente.');
      setStarting(false);
    }
  }, [user?.id, streamId, title, starting]);

  useEffect(() => {
    if (live && engineReady) join();
  }, [live, engineReady, join]);

  useEffect(() => {
    if (joined) setStarting(false);
  }, [joined]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setLiveSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);

  useEffect(() => {
    if (!live || !participants.some(p => p.status === 'active' && p.floor_started_at && p.floor_duration_seconds !== null && p.floor_duration_seconds !== undefined)) return;
    const timer = setInterval(() => setCohostTimerTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [live, participants]);

  // ── Poll: viewer count + comments ────────────────────────────────────────
  const poll = useCallback(async () => {
    if (!streamId) return;
    try {
      const { data: sData } = await supabase
        .from('live_sessions').select('viewer_count, status, host_id, ended_at').eq('id', streamId).single();
      if (sData && mountedRef.current) setViewerCount(sData.viewer_count ?? 0);
      const canonicalLive = sData?.status === 'live'
        && sData.ended_at === null
        && sData.host_id === user?.id;
      if (mountedRef.current) setSessionIsCanonicalLive(canonicalLive);
      if (!canonicalLive) void stopBattleRuntime();
      if (sData?.status === 'ended') {
        clearLiveTimers();
        if (mountedRef.current) setLive(false);
        return;
      }

      let query = supabase
        .from('live_messages')
        .select('id, user_id, username, message, created_at')
        .eq('session_id', streamId)
        .order('created_at', { ascending: true })
        .limit(MAX_MESSAGES);
      if (lastMsgRef.current) query = query.gt('created_at', lastMsgRef.current);

      const { data: mData } = await query;
      if (mData && mData.length > 0 && mountedRef.current) {
        const newMsgs: ChatMessage[] = mData.map((m: any) => ({
          id: m.id, userId: m.user_id, username: m.username,
          message: m.message, createdAt: m.created_at,
        }));
        const messagesWithAvatars = await attachMessageAvatars(supabase, newMsgs, user);
        lastMsgRef.current = mData[mData.length - 1].created_at;
        setMessages(prev => mergeMessages(prev, messagesWithAvatars));
        scrollToLatest(true);
      }
    } catch { /* Controlled polling retries on the next interval. */ }
  }, [streamId, supabase, scrollToLatest, user, clearLiveTimers, stopBattleRuntime]);

  useEffect(() => {
    if (!live) return;
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    poll();
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [live, poll]);

  const loadParticipants = useCallback(async () => {
    if (!streamId || !live) return;
    try {
      const { data, error: participantsError } = await supabase
        .from('live_participants')
        .select('*')
        .eq('session_id', streamId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (participantsError) {
        console.warn('[LiveBroadcast] load participants failed', participantsError.message);
        return;
      }

      if (mountedRef.current) setParticipants((data ?? []) as LiveParticipant[]);
    } catch (err: any) {
      console.warn('[LiveBroadcast] participants sync failed', err?.message ?? err);
    }
  }, [streamId, live, supabase]);

  useEffect(() => {
    if (!live || !streamId) return;
    loadParticipants();

    const channel = supabase
      .channel(`live-participants:${streamId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_participants', filter: `session_id=eq.${streamId}` },
        () => loadParticipants(),
      )
      .subscribe();

    const fallback = setInterval(loadParticipants, POLL_INTERVAL_MS);
    return () => {
      clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [live, streamId, supabase, loadParticipants]);

  // ── End broadcast ─────────────────────────────────────────────────────────
  const sendHeartbeat = useCallback(async () => {
    if (!streamId || !liveRef.current || endedRef.current) return;
    try {
      const result = await heartbeatLiveSession(streamId);
      heartbeatFailuresRef.current = result?.ok === false ? heartbeatFailuresRef.current + 1 : 0;
    } catch (err: any) {
      heartbeatFailuresRef.current += 1;
      if (__DEV__ && heartbeatFailuresRef.current >= 2) {
        console.warn('[LiveBroadcast] heartbeat failed', err?.message ?? err);
      }
    }
  }, [streamId]);

  const finalizeLiveSession = useCallback((reason: LiveEndReason = 'host_ended', navigateBack = true) => {
    if (!streamId) return Promise.resolve();
    if (finalizePromiseRef.current) return finalizePromiseRef.current;

    endedRef.current = true;
    liveRef.current = false;
    setSessionIsCanonicalLive(false);
    clearLiveTimers();

    finalizePromiseRef.current = (async () => {
      await stopBattleRuntime();

      try {
        await leave();
      } catch { /* best effort */ }

      try {
        await endLiveSession(streamId, reason);
      } catch (err: any) {
        console.warn('[LiveBroadcast] end live failed', err?.message ?? err);
      }

      if (mountedRef.current) setLive(false);
      if (navigateBack) router.back();
    })();

    return finalizePromiseRef.current;
  }, [streamId, leave, router, clearLiveTimers, stopBattleRuntime]);

  const endBroadcast = useCallback(async () => {
    await finalizeLiveSession('host_ended', true);
  }, [finalizeLiveSession]);

  useEffect(() => {
    if (!live || !streamId) return;

    sendHeartbeat();
    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    };
  }, [live, streamId, sendHeartbeat]);

  useEffect(() => {
    if (!live || !streamId) return;

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      setIsForeground(nextState === 'active');
      if (!liveRef.current || endedRef.current) return;

      if (nextState === 'active') {
        sendHeartbeat();
        return;
      }

      void stopBattleRuntime();

      markLiveSessionDisconnected(streamId).catch((err: any) => {
        if (__DEV__) console.warn('[LiveBroadcast] mark disconnected failed', err?.message ?? err);
      });
    });

    return () => subscription.remove();
  }, [live, streamId, sendHeartbeat, stopBattleRuntime]);

  useEffect(() => {
    if (!live) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      finalizeLiveSession('host_ended', true);
      return true;
    });

    return () => subscription.remove();
  }, [live, finalizeLiveSession]);

  useEffect(() => () => {
    if (!endedRef.current && liveRef.current && streamId) {
      finalizeLiveSession('host_disconnected', false);
    }
  }, [streamId, finalizeLiveSession]);

  const approveParticipantAsCohost = useCallback(async (participant: LiveParticipant) => {
    if (!user?.id || !streamId) return;
    try {
      await decideLiveJoinRequest(streamId, participant.user_id, true);
      await loadParticipants();
    } catch (err: any) {
      console.warn('[LiveBroadcast] approve cohost failed', err?.message ?? err);
    }
  }, [user?.id, streamId, loadParticipants]);

  const acceptJoinRequest = useCallback((participant: LiveParticipant) => {
    approveParticipantAsCohost(participant);
  }, [approveParticipantAsCohost]);

  const rejectJoinRequest = useCallback(async (participant: LiveParticipant) => {
    if (!user?.id || !streamId) return;
    try {
      await decideLiveJoinRequest(streamId, participant.user_id, false);
      await loadParticipants();
    } catch (err: any) {
      console.warn('[LiveBroadcast] reject join failed', err?.message ?? err);
    }
  }, [user?.id, streamId, loadParticipants]);

  const updateCohostControls = useCallback(async (
    participant: LiveParticipant,
    action: LiveHostControlAction,
    durationSeconds: 60 | 120 | null = null,
  ) => {
    try {
      await controlLiveParticipant(streamId, participant.user_id, action, durationSeconds);
      await loadParticipants();
    } catch (err: any) {
      console.warn(`[LiveBroadcast] ${action} failed`, err?.message ?? err);
    }
  }, [streamId, loadParticipants]);

  const toggleCohostMute = useCallback((participant: LiveParticipant) => {
    const nextMuted = !participant.mic_muted;
    updateCohostControls(participant, nextMuted ? 'mute' : 'unmute');
  }, [updateCohostControls]);

  const toggleCohostMicLock = useCallback((participant: LiveParticipant) => {
    const nextLocked = !participant.mic_locked;
    updateCohostControls(participant, nextLocked ? 'lock_mic' : 'unlock_mic');
  }, [updateCohostControls]);

  const toggleCohostFloor = useCallback((participant: LiveParticipant) => {
    const nextGranted = !participant.floor_granted;
    updateCohostControls(participant, nextGranted ? 'grant_floor' : 'revoke_floor');
  }, [updateCohostControls]);

  const setCohostTimer = useCallback((participant: LiveParticipant, seconds: 60 | 120 | null) => {
    updateCohostControls(participant, seconds === null ? 'timer_stop' : 'timer_start', seconds);
  }, [updateCohostControls]);

  const removeCohost = useCallback((participant: LiveParticipant) => {
    updateCohostControls(participant, 'remove_cohost');
  }, [updateCohostControls]);

  const sendHostInviteToAudience = useCallback(async (participant: LiveParticipant) => {
    if (!streamId) return;
    try {
      await inviteLiveParticipant(streamId, participant.user_id);
    } catch (err: any) {
      console.warn('[LiveBroadcast] invite participant failed', err?.message ?? err);
    }
  }, [streamId]);

  useEffect(() => {
    if (!live || !streamId) return;

    const channel = supabase
      .channel(`live-reactions:${streamId}:broadcast`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_control_events', filter: `session_id=eq.${streamId}` },
        payload => {
          const row = payload.new as any;
          if (row?.event_type !== 'reaction') return;
          if (seenReactionEventIdsRef.current.has(row.id)) return;
          seenReactionEventIdsRef.current.add(row.id);
          const giftEvent = liveGiftEventFromPayload(row, streamId);
          if (giftEvent) {
            enqueueGift(giftEvent);
            return;
          }
          addFloatingReaction(row?.payload?.emoji || '\u2764\uFE0F', row?.payload?.username);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [live, streamId, supabase, addFloatingReaction, enqueueGift]);

  useEffect(() => {
    if (!live) return;

    const enforceExpiredTimers = () => {
      participants
        .filter(participant =>
          participant.role === 'cohost' &&
          participant.status === 'active' &&
          participant.floor_started_at &&
          participant.floor_duration_seconds !== null &&
          participant.floor_duration_seconds !== undefined
        )
        .forEach(participant => {
          const startedAt = new Date(participant.floor_started_at as string).getTime();
          if (Number.isNaN(startedAt)) return;
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          const remaining = participant.floor_duration_seconds! - elapsed;
          const timerKey = `${participant.id}:${participant.floor_started_at}`;
          if (remaining > 0 || participant.mic_muted || expiredTimerMutedRef.current.has(timerKey)) return;

          expiredTimerMutedRef.current.add(timerKey);
          enforceLiveParticipantTimer(streamId, participant.user_id)
            .then(() => loadParticipants())
            .catch((err: any) => console.warn('[LiveBroadcast] timer enforcement failed', err?.message ?? err));
        });
    };

    enforceExpiredTimers();
    const timer = setInterval(enforceExpiredTimers, 1000);
    return () => clearInterval(timer);
  }, [live, participants, streamId, loadParticipants]);

  const sendMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !user || !streamId || sending || sendingRef.current) return;
    const now = Date.now();
    if (now - lastSentRef.current < SPAM_THROTTLE_MS) return;
    lastSentRef.current = now;
    sendingRef.current = true;
    setSending(true);
    setChatInput('');

    try {
      const data = await sendLiveMessage(streamId, text);
      if (data) {
        setMessages(prev => mergeMessages(prev, [{
          id: data.id,
          userId: data.user_id,
          username: data.username,
          message: data.message,
          createdAt: data.created_at,
          avatarUrl: user.avatar ?? null,
        }]));
        scrollToLatest(true);
      }
      dismissKeyboard();
    } catch (err: any) {
      console.warn('[LiveBroadcast] send message failed', err?.message ?? err);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [chatInput, user, streamId, sending, scrollToLatest, dismissKeyboard]);

  const sendReaction = useCallback(async (emoji: string) => {
    if (!streamId || !user?.id) return;
    const now = Date.now();
    if (now - lastReactionAtRef.current < 600) return;
    lastReactionAtRef.current = now;

    const username = user.username || user.email?.split('@')[0] || 'host';
    try {
      const data = await emitLiveReaction(streamId, emoji);
      if (data?.id) seenReactionEventIdsRef.current.add(data.id);
      addFloatingReaction(emoji, username);
    } catch (err: any) {
      console.warn('[LiveBroadcast] reaction failed', err?.message ?? err);
    }
  }, [streamId, user, addFloatingReaction]);

  const shareLive = useCallback(async () => {
    try {
      await Share.share({
        message: title.trim()
          ? `Estoy transmitiendo "${title.trim()}" en OnSpace. Únete al LIVE.`
          : 'Estoy transmitiendo en vivo en OnSpace. Únete ahora.',
      });
    } catch (err: any) {
      console.warn('[LiveBroadcast] share failed', err?.message ?? err);
    }
  }, [title]);

  const formatLiveDuration = (seconds: number) =>
    `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  // ── Pre-live: title prompt ───────────────────────────────────────────────
  if (!live) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <StatusBar style="light" />
        <MaterialIcons name="live-tv" size={48} color={Colors.secondary} />
        <Text style={styles.setupTitle}>Ir en vivo</Text>
        <Text style={styles.setupSub}>Dale un título a tu transmisión</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={value => {
            setTitle(value);
            if (startError) setStartError(null);
          }}
          placeholder="¿De qué vas a hablar?"
          placeholderTextColor={Colors.textSubtle}
          maxLength={80}
          autoFocus
        />
        {!isAgoraAvailable() ? (
          <Text style={styles.errorText}>El streaming en vivo no está disponible en este dispositivo</Text>
        ) : null}
        {startError ? (
          <Text style={styles.errorText}>{startError}</Text>
        ) : null}
        <Pressable
          style={[styles.goLiveBtn, (!title.trim() || starting) && styles.goLiveBtnDisabled]}
          onPress={handleGoLive}
          disabled={!title.trim() || starting}
        >
          {starting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.goLiveBtnText}>Comenzar transmisión</Text>}
        </Pressable>
        <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const pendingRequests = participants.filter(p => p.role === 'requested' && p.status === 'active');
  const structuredCohosts = participants.filter(p => p.role === 'cohost' && p.status === 'active');
  const activeAudiences = participants.filter(p =>
    p.role === 'audience' &&
    p.status === 'active' &&
    p.user_id !== user?.id
  );
  const battleState = battleProjection.state && isLiveBattleStageStatus(battleProjection.state.status)
    ? battleProjection.state
    : null;
  const battleOpponentUid = battleState?.opponentHostAgoraUid;
  const cohostRemoteUids = remoteUids.filter(uid => uid !== battleOpponentUid);
  const composerBottom = keyboardHeight > 0 ? keyboardHeight : insets.bottom;
  const composerClearance = composerBottom + composerHeight + 12;
  const controlsBottom = composerBottom + composerHeight + 12;
  const actionsBottom = controlsBottom + 56;
  const productBottom = actionsBottom + 60;
  const effectiveProductHeight = featuredProductMeasurement?.productId === featuredProductId
    ? featuredProductMeasurement.height
    : PRODUCT_HEIGHT_FALLBACK;
  const productOverlayClearance = productBottom
    + (featuredLiveProduct ? effectiveProductHeight : PRODUCT_PLACEHOLDER_HEIGHT)
    + PRODUCT_OVERLAY_GAP;
  const cohostPreviewBottom = productOverlayClearance + COHOST_PREVIEW_GAP;
  const cohostPreviewMaxHeight = Math.max(
    0,
    viewportHeight - cohostPreviewBottom - insets.top - COHOST_PREVIEW_TOP_CLEARANCE
  );
  const hostPanelOccupiesCohostPreview = hostActionPanel !== null || moreControlsVisible;
  const showCohostPreview = cohostPreviewMaxHeight >= COHOST_PREVIEW_HEIGHT
    && !hostPanelOccupiesCohostPreview;
  const chatBottom = keyboardHeight > 0 ? composerClearance + 8 : productOverlayClearance;
  const chatMaxHeight = Math.max(104, viewportHeight - chatBottom - insets.top - 132);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {battleState ? (
        <LiveBattleStage
          state={battleState}
          localLabel="Tú"
          localHost={{
            username: battleProjection.localHostProfile?.username ?? user?.username ?? user?.email?.split('@')[0] ?? 'Host',
            avatarUrl: battleProjection.localHostProfile?.avatarUrl ?? user?.avatar ?? null,
          }}
          opponentHost={{
            username: battleProjection.opponentHostProfile?.username ?? 'Host',
            avatarUrl: battleProjection.opponentHostProfile?.avatarUrl ?? null,
          }}
          localSurface={RtcSurfaceView && localVideoReady && !isCameraOff
            ? <RtcSurfaceView canvas={{ uid: 0 }} style={styles.battleVideo} />
            : null}
          opponentSurface={RtcSurfaceView && remoteUids.includes(battleState.opponentHostAgoraUid)
            ? <RtcSurfaceView canvas={{ uid: battleState.opponentHostAgoraUid }} style={styles.battleVideo} />
            : null}
        />
      ) : RtcSurfaceView && localVideoReady && !isCameraOff ? (
        <RtcSurfaceView canvas={{ uid: 0 }} style={styles.videoStream} />
      ) : (
        <View style={styles.videoPlaceholder}>
          <MaterialIcons name="videocam-off" size={40} color={Colors.textSubtle} />
        </View>
      )}

      <Pressable
        style={styles.keyboardDismissLayer}
        onPress={dismissKeyboard}
        accessibilityLabel="Cerrar teclado"
      />

      <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.topShade} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={styles.bottomShade} pointerEvents="none" />

      {RtcSurfaceView && cohostRemoteUids.length > 0 && showCohostPreview ? (
        <View style={[styles.remoteStrip, { bottom: cohostPreviewBottom, maxHeight: cohostPreviewMaxHeight }]}>
          {cohostRemoteUids.map(uid => (
            <View key={uid} style={styles.remoteTile}>
              <RtcSurfaceView canvas={{ uid }} style={styles.remoteVideo} />
              <View style={styles.remoteBadge}>
                <MaterialIcons name="person" size={13} color="#fff" />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Header overlay ────────────────────────────────────────────────── */}
      <View style={[styles.header,{top:insets.top+8,height:undefined,paddingHorizontal:0,backgroundColor:'transparent',borderWidth:0}]}><LiveSessionHeader hostName={user?.username||user?.email?.split('@')[0]||'Host'} viewerCount={viewerCount} elapsed={formatLiveDuration(liveSeconds)} onClose={endBroadcast} hostV4 /></View>

      {error ? (
        <View style={[styles.errorBanner, { top: insets.top + 48 }]}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {floatingReactions.map(reaction => (
        <FloatingReactionBubble
          key={reaction.id}
          reaction={reaction}
          bottom={composerClearance + 128}
          viewportHeight={viewportHeight}
        />
      ))}

      {keyboardHeight === 0 ? (
        <View style={[styles.engagementRail, { top: insets.top + 188 }]} accessibilityLabel="Interacciones del LIVE">
          <Pressable style={styles.engagementAction} onPress={() => sendReaction('\u2764\uFE0F')} accessibilityRole="button" accessibilityLabel="Enviar Me gusta">
            <MaterialIcons name="favorite" size={22} color="#FF3D8D" />
            <Text style={styles.engagementLabel}>Like</Text>
          </Pressable>
          <Pressable style={styles.engagementAction} onPress={() => inputRef.current?.focus()} accessibilityRole="button" accessibilityLabel="Abrir comentarios del LIVE">
            <MaterialIcons name="chat-bubble-outline" size={20} color="#F8FAFC" />
            <Text style={styles.engagementLabel}>Chat</Text>
          </Pressable>
          <Pressable style={[styles.engagementAction, hostActionPanel === 'gifts' && styles.engagementActionActive]} onPress={() => toggleHostActionPanel('gifts')} accessibilityRole="button" accessibilityLabel="Ver actividad de regalos del LIVE">
            <MaterialIcons name="auto-awesome" size={21} color="#FFB84D" />
            <Text style={styles.engagementLabel}>Gift</Text>
          </Pressable>
          <Pressable style={styles.engagementAction} onPress={shareLive} accessibilityRole="button" accessibilityLabel="Compartir LIVE">
            <MaterialIcons name="ios-share" size={21} color="#F8FAFC" />
            <Text style={styles.engagementLabel}>Share</Text>
          </Pressable>
          {sessionIsCanonicalLive && user?.id && streamId ? (
            <LiveBattleHostControls
              enabled={live && sessionIsCanonicalLive && engineReady && joined && isForeground}
              hostUserId={user.id}
              liveSessionId={streamId}
              presentationTick={liveSeconds}
              snapshot={battleRuntime.snapshot}
              actionPending={battleRuntime.actionPending}
              actionError={battleRuntime.actionError}
              invite={battleRuntime.invite}
              respond={battleRuntime.respond}
              start={battleRuntime.start}
              cancel={battleRuntime.cancel}
              reconcile={battleRuntime.reconcile}
              clearActionError={battleRuntime.clearActionError}
              dismissTerminalBattle={battleRuntime.dismissTerminalBattle}
            />
          ) : null}
        </View>
      ) : null}

      <LiveGiftOverlay activeGift={activeGift} floatingGifts={floatingGifts} />

      {hostActionPanel === 'requests' ? (
        <View style={[styles.requestPanel, { bottom: productOverlayClearance }]}>
          {pendingRequests.length === 0 ? (
            <View style={styles.hostPanelEmpty}>
              <Text style={styles.hostPanelEmptyText}>No hay solicitudes pendientes</Text>
            </View>
          ) : null}
          {pendingRequests.slice(0, 3).map(participant => (
            <View key={participant.id} style={styles.requestRow}>
              <Text style={styles.requestName} numberOfLines={1}>
                @{participant.username || 'Invitado'}
              </Text>
              <View style={styles.requestActions}>
                <Pressable
                  style={[styles.requestActionBtn, styles.requestAcceptBtn]}
                  onPress={() => acceptJoinRequest(participant)}
                  hitSlop={6}
                  accessibilityLabel={`Aceptar solicitud de ${participant.username || 'Invitado'}`}
                >
                  <MaterialIcons name="check" size={16} color="#fff" />
                </Pressable>
                <Pressable
                  style={[styles.requestActionBtn, styles.requestRejectBtn]}
                  onPress={() => rejectJoinRequest(participant)}
                  hitSlop={6}
                  accessibilityLabel={`Rechazar solicitud de ${participant.username || 'Invitado'}`}
                >
                  <MaterialIcons name="close" size={16} color="#fff" />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Chat overlay ──────────────────────────────────────────────────── */}
      {hostActionPanel === 'participants' && activeAudiences.length > 0 ? (
        <View style={[styles.audiencePanel, { bottom: productOverlayClearance }]}>
          {activeAudiences.slice(0, 3).map(participant => (
            <View key={participant.id} style={styles.audienceRow}>
              <MaterialIcons name="people" size={13} color="rgba(255,255,255,0.78)" />
              <Text style={styles.audienceName} numberOfLines={1}>@{participant.username || 'Invitado'}</Text>
              <Pressable
                style={styles.audienceInviteBtn}
                onPress={() => sendHostInviteToAudience(participant)}
                hitSlop={6}
                accessibilityLabel={`Subir a ${participant.username || 'Invitado'} al live`}
              >
                <MaterialIcons name="person-add-alt-1" size={15} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {hostActionPanel === 'participants' && activeAudiences.length === 0 ? (
        <View style={[styles.hostPanelEmpty, styles.hostPanelFloating, { bottom: productOverlayClearance }]}>
          <Text style={styles.hostPanelEmptyText}>No hay espectadores disponibles para invitar</Text>
        </View>
      ) : null}

      {hostActionPanel === 'moderation' ? (
        <View style={[styles.cohostPanel, styles.moderationPanel, { bottom: productOverlayClearance, maxHeight: Math.max(120, viewportHeight - productOverlayClearance - insets.top - 80) }]}>
          <View style={styles.moderationHeading}>
            <MaterialIcons name="shield" size={17} color="#D8B4FE" />
            <Text style={styles.moderationTitle}>Moderación del LIVE</Text>
          </View>
          {structuredCohosts.length === 0 ? (
            <Text style={styles.moderationText}>No hay cohosts activos que moderar.</Text>
          ) : <ScrollView style={styles.moderationList} contentContainerStyle={styles.moderationListContent} showsVerticalScrollIndicator={false}>{structuredCohosts.map(participant => {
            const timerText = cohostTimerTick >= 0 ? getCohostTimerText(participant) : null;
            return (
              <View key={participant.id} style={styles.cohostControlRow}>
                <View style={styles.cohostControlHeader}>
                  <Text style={styles.cohostText} numberOfLines={1}>@{participant.username || 'Invitado'}</Text>
                  {timerText ? <Text style={styles.cohostTimerText}>{timerText}</Text> : null}
                </View>
                <View style={styles.cohostControlActions}>
                  <Pressable
                    style={[styles.cohostIconBtn, participant.mic_muted && styles.cohostIconBtnActive]}
                    onPress={() => toggleCohostMute(participant)}
                    hitSlop={6}
                    accessibilityLabel={participant.mic_muted ? 'Activar micrófono del cohost' : 'Silenciar cohost'}
                  >
                    <MaterialIcons name={participant.mic_muted ? 'mic-off' : 'mic'} size={15} color="#fff" />
                  </Pressable>
                  <Pressable
                    style={[styles.cohostIconBtn, participant.mic_locked && styles.cohostIconBtnActive]}
                    onPress={() => toggleCohostMicLock(participant)}
                    hitSlop={6}
                    accessibilityLabel={participant.mic_locked ? 'Desbloquear micrófono del cohost' : 'Bloquear micrófono del cohost'}
                  >
                    <MaterialIcons name={participant.mic_locked ? 'lock' : 'lock-open'} size={15} color="#fff" />
                  </Pressable>
                  <Pressable
                    style={[styles.cohostIconBtn, participant.floor_granted && styles.cohostIconBtnActive]}
                    onPress={() => toggleCohostFloor(participant)}
                    hitSlop={6}
                    accessibilityLabel={participant.floor_granted ? 'Quitar derecho de palabra' : 'Dar derecho de palabra'}
                  >
                    <MaterialIcons name={participant.floor_granted ? 'record-voice-over' : 'voice-over-off'} size={15} color="#fff" />
                  </Pressable>
                  <Pressable style={[styles.timerBtn, participant.floor_duration_seconds === 60 && styles.timerBtnActive]} onPress={() => setCohostTimer(participant, 60)} hitSlop={6} accessibilityLabel="Timer de un minuto">
                    <Text style={styles.timerBtnText}>1m</Text>
                  </Pressable>
                  <Pressable style={[styles.timerBtn, participant.floor_duration_seconds === 120 && styles.timerBtnActive]} onPress={() => setCohostTimer(participant, 120)} hitSlop={6} accessibilityLabel="Timer de dos minutos">
                    <Text style={styles.timerBtnText}>2m</Text>
                  </Pressable>
                  <Pressable style={[styles.timerBtn, participant.floor_granted && participant.floor_duration_seconds === null && styles.timerBtnActive]} onPress={() => setCohostTimer(participant, null)} hitSlop={6} accessibilityLabel="Timer libre">
                    <Text style={styles.timerBtnText}>∞</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.cohostIconBtn, styles.cohostRemoveBtn]}
                    onPress={() => removeCohost(participant)}
                    hitSlop={6}
                    accessibilityLabel="Bajar cohost del live"
                  >
                    <MaterialIcons name="person-remove" size={15} color="#fff" />
                  </Pressable>
                </View>
              </View>
            );
          })}</ScrollView>}
        </View>
      ) : null}

      {hostActionPanel === 'gifts' ? (
        <View style={[styles.giftActivityPanel, { bottom: productOverlayClearance }]}>
          <MaterialIcons name="auto-awesome" size={18} color="#FF9AAE" />
          <View style={styles.giftActivityCopy}>
            <Text style={styles.giftActivityTitle}>Regalos del LIVE</Text>
            <Text style={styles.giftActivityText} numberOfLines={2}>
              {activeGift || floatingGifts[0]
                ? `${(activeGift ?? floatingGifts[0]).senderUsername || 'Alguien'} envió ${(activeGift ?? floatingGifts[0]).giftName}`
                : 'Los regalos recibidos aparecerán aquí y sobre el video.'}
            </Text>
          </View>
        </View>
      ) : null}

      {hostActionPanel === null ? (
      <View style={[styles.chatArea, { bottom: chatBottom, maxHeight: chatMaxHeight }]}>
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={m => m.id}
          onContentSizeChange={() => scrollToLatest(false)}
          onLayout={() => scrollToLatest(false)}
          renderItem={({ item }) => (
            <LiveChatMessageItem
              username={item.username}
              message={item.message}
              avatarUrl={item.avatarUrl}
              isHost={item.userId === user?.id}
            />
          )}
          contentContainerStyle={{ gap: 4, paddingBottom: 8 }}
          ListFooterComponent={<View style={{ height: 8 }} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>
      ) : null}

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      {keyboardHeight === 0 ? (
      <View style={[styles.hostPrimaryActions, { bottom: actionsBottom }]}>
        <Pressable style={styles.hostPrimaryAction} onPress={() => { Keyboard.dismiss(); setCommerceVisible(true); }} accessibilityRole="button" accessibilityLabel="Fijar o cambiar producto destacado">
          <MaterialIcons name="push-pin" size={17} color="#F8FAFC" />
          <Text style={styles.hostPrimaryActionText}>Fijar</Text>
        </Pressable>
        <Pressable style={styles.hostPrimaryAction} onPress={() => { Keyboard.dismiss(); setCommerceVisible(true); }} accessibilityRole="button" accessibilityLabel="Administrar ofertas y productos del LIVE">
          <MaterialIcons name="bolt" size={18} color="#FFB84D" />
          <Text style={styles.hostPrimaryActionText}>Ofertas</Text>
        </Pressable>
        <Pressable style={[styles.hostPrimaryAction, hostActionPanel === 'requests' && styles.hostPrimaryActionActive]} onPress={() => toggleHostActionPanel('requests')} accessibilityRole="button" accessibilityLabel="Abrir solicitudes para subir al LIVE">
          <MaterialIcons name="radio-button-checked" size={16} color="#FF9AAE" />
          <Text style={styles.hostPrimaryActionText}>Solicitudes</Text>
          {pendingRequests.length > 0 ? <View style={styles.hostPrimaryBadge}><Text style={styles.hostPrimaryBadgeText}>{pendingRequests.length > 99 ? '99+' : pendingRequests.length}</Text></View> : null}
        </Pressable>
        <Pressable style={[styles.hostPrimaryAction, hostActionPanel === 'participants' && styles.hostPrimaryActionActive]} onPress={() => toggleHostActionPanel('participants')} accessibilityRole="button" accessibilityLabel="Invitar o subir participantes al LIVE">
          <MaterialIcons name="person-add-alt-1" size={17} color="#F8FAFC" />
          <Text style={styles.hostPrimaryActionText}>Invitar</Text>
        </Pressable>
        <Pressable style={[styles.hostPrimaryAction, hostActionPanel === 'moderation' && styles.hostPrimaryActionActive]} onPress={() => toggleHostActionPanel('moderation')} accessibilityRole="button" accessibilityLabel="Abrir moderación del LIVE">
          <MaterialIcons name="shield" size={17} color="#D8B4FE" />
          <Text style={styles.hostPrimaryActionText}>Moderar</Text>
        </Pressable>
      </View>
      ) : null}

      {keyboardHeight === 0 ? (
      <View style={[styles.controls, { bottom: controlsBottom }]}>
        <View style={styles.controlGroup}>
          <Pressable
            style={[styles.controlBtn, styles.micControlBtn, isMuted && styles.controlBtnActive]}
            onPress={toggleMute}
            hitSlop={8}
            accessibilityLabel={isMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={20} color={isMuted ? '#000' : '#fff'} />
          </Pressable>
        </View>
        <View style={styles.controlGroup}>
          <Pressable
            style={styles.controlBtn}
            onPress={switchCamera}
            hitSlop={8}
            accessibilityLabel="Cambiar cámara"
          >
            <MaterialIcons name="flip-camera-ios" size={20} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.controlGroup}>
          <Pressable
            style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]}
            onPress={toggleCamera}
            hitSlop={8}
            accessibilityLabel={isCameraOff ? 'Activar cámara' : 'Apagar cámara'}
          >
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={20} color={isCameraOff ? '#000' : '#fff'} />
          </Pressable>
        </View>
        <View style={styles.controlGroup}>
          <Pressable
            style={styles.controlBtn}
            onPress={() => setMoreControlsVisible(value=>!value)}
            hitSlop={8}
            accessibilityLabel="Más controles"
          >
            <MaterialIcons name="more-horiz" size={22} color="#fff" />
          </Pressable>
        </View>
        <Pressable
          style={styles.endBtn}
          onPress={endBroadcast}
          hitSlop={4}
          accessibilityLabel="Finalizar live"
        >
          <MaterialIcons name="call-end" size={22} color="#fff" />
        </Pressable>
      </View>
      ) : null}
      {keyboardHeight === 0 && moreControlsVisible?<View style={[styles.moreControls,{bottom:productOverlayClearance}]}><Text style={styles.secondaryControlText}>Las interacciones están en el rail lateral.</Text></View>:null}
      {featuredLiveProduct ? (
        <LiveProductRail
          key={featuredLiveProduct.id}
          product={featuredLiveProduct}
          productCount={liveProducts.length}
          bottom={productBottom}
          keyboardVisible={keyboardHeight > 0}
          mode="host"
          hostV4
          onLayoutHeight={handleProductRailLayout}
          onBuy={() => setCommerceVisible(true)}
          onOpenBag={() => setCommerceVisible(true)}
        />
      ) : keyboardHeight === 0 && live ? (
        <Pressable style={[styles.addProductCta,{bottom:productBottom}]} onPress={()=>setCommerceVisible(true)} accessibilityRole="button" accessibilityLabel="Agregar producto al LIVE"><MaterialIcons name="add-shopping-cart" size={18} color="#fff"/><Text style={styles.addProductText}>Agregar producto</Text></Pressable>
      ) : null}
      {streamId ? <LiveHostPurchaseFeed sessionId={streamId} /> : null}
      {streamId ? <LiveHostProductManager visible={commerceVisible} sessionId={streamId} onClose={() => setCommerceVisible(false)} onChanged={refreshLiveProducts} /> : null}

      <View
        style={[styles.inputRow, { bottom: composerBottom + 8 }]}
        onLayout={event => {
          const nextHeight = event.nativeEvent.layout.height;
          setComposerHeight(current =>
            Math.abs(current - nextHeight) < 1 ? current : nextHeight
          );
        }}
      >
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={chatInput}
          onChangeText={setChatInput}
          placeholder="Escribe un mensaje..."
          placeholderTextColor="rgba(255,255,255,0.55)"
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          maxLength={200}
          blurOnSubmit={false}
          editable={!!user}
        />
        <Pressable
          style={[styles.sendBtn, (!chatInput.trim() || sending) && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!chatInput.trim() || sending || !user}
          hitSlop={8}
          accessibilityLabel="Enviar mensaje"
        >
          {sending ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="send" size={18} color="#fff" />}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050508' },
  centered:  { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },

  setupTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, marginTop: Spacing.sm },
  setupSub:   { color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md },
  titleInput: {
    width: '100%', backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, color: Colors.textPrimary,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: FontSize.md, marginBottom: Spacing.md,
  },
  goLiveBtn: {
    width: '100%', backgroundColor: Colors.secondary, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
  },
  goLiveBtnDisabled: { opacity: 0.4 },
  goLiveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  cancelText: { color: Colors.textSubtle, fontSize: FontSize.sm },

  videoStream:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  battleVideo:      { flex: 1, backgroundColor: '#000' },
  videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  keyboardDismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 170, zIndex: 2 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 320, zIndex: 2 },
  remoteStrip: { position: 'absolute', left: 20, width: 140, gap: 12, zIndex: 8, overflow: 'hidden' },
  remoteTile: { width: 140, height: 108, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, borderColor: 'rgba(236,72,153,0.62)' },
  remoteVideo: { flex: 1 },
  remoteBadge: { position: 'absolute', left: 8, bottom: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center' },

  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(20,20,25,0.65)',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(124,92,255,0.7)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: FontWeight.bold },
  hostInfo: { flex: 1 },
  hostName: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  hostHandle: { color: 'rgba(255,255,255,0.65)', fontSize: 11 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FF2D55', borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 5,
  },
  liveDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  headerMetric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.16)' },
  liveTimer: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold, maxWidth: SCREEN_WIDTH < 380 ? 58 : 74 },
  viewerChipText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold, maxWidth: SCREEN_WIDTH < 380 ? 58 : 82 },
  headerEndBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,45,85,0.82)', alignItems: 'center', justifyContent: 'center' },
  errorBanner: { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 10, backgroundColor: 'rgba(255,45,85,0.15)', borderRadius: Radius.sm, padding: Spacing.xs },
  errorText: { color: Colors.secondary, fontSize: 11, textAlign: 'center' },
  floatingReaction: {
    position: 'absolute',
    zIndex: 8,
    alignItems: 'center',
    marginLeft: -18,
  },
  floatingReactionEmoji: {
    fontSize: 31,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  floatingReactionEmojiBig: {
    fontSize: 44,
  },
  engagementRail: {
    position: 'absolute',
    right: 14,
    width: 55,
    minHeight: 280,
    zIndex: 12,
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingVertical: 8,
    borderRadius: 27,
    backgroundColor: 'rgba(16,18,26,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  engagementAction: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: 22 },
  engagementActionActive: { backgroundColor: 'rgba(92,44,112,0.72)' },
  engagementActionDisabled: { opacity: 0.5 },
  engagementLabel: { color: '#A4AAB8', fontSize: 8, fontWeight: FontWeight.semibold },

  requestPanel: {
    position: 'absolute',
    left: 20,
    right: 20,
    gap: 7,
    zIndex: 17,
    elevation: 17,
  },
  requestRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 6,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  requestName: { flex: 1, color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  requestActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  requestActionBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  requestAcceptBtn: { backgroundColor: Colors.primary },
  requestRejectBtn: { backgroundColor: 'rgba(255,255,255,0.16)' },
  cohostPanel: {
    position: 'absolute',
    left: 20,
    right: 20,
    gap: 6,
    zIndex: 17,
    elevation: 17,
  },
  cohostControlRow: {
    minHeight: 70,
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cohostControlHeader: { minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cohostText: { flex: 1, minWidth: 0, color: 'rgba(255,255,255,0.88)', fontSize: 11, fontWeight: FontWeight.semibold },
  cohostControlActions: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SCREEN_WIDTH < 380 ? 3 : 5 },
  cohostIconBtn: { width: SCREEN_WIDTH < 380 ? 27 : 30, height: SCREEN_WIDTH < 380 ? 27 : 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cohostIconBtnActive: { backgroundColor: 'rgba(124,92,255,0.78)' },
  cohostRemoveBtn: { backgroundColor: 'rgba(255,45,85,0.74)' },
  timerBtn: { minWidth: SCREEN_WIDTH < 380 ? 24 : 29, height: SCREEN_WIDTH < 380 ? 26 : 28, borderRadius: 14, paddingHorizontal: SCREEN_WIDTH < 380 ? 5 : 7, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  timerBtnActive: { backgroundColor: 'rgba(124,92,255,0.78)' },
  timerBtnText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  cohostTimerText: { width: 34, color: '#fff', fontSize: 10, fontWeight: FontWeight.bold, textAlign: 'right' },
  audiencePanel: { position: 'absolute', left: 20, right: 20, gap: 6, zIndex: 17, elevation: 17 },
  audienceRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 12,
    paddingRight: 5,
    backgroundColor: 'rgba(0,0,0,0.34)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  audienceName: { flex: 1, color: 'rgba(255,255,255,0.86)', fontSize: 11, fontWeight: FontWeight.semibold },
  audienceInviteBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  hostPanelEmpty: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(17,19,27,0.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  hostPanelFloating: { position: 'absolute', left: 20, right: 20, zIndex: 17, elevation: 17 },
  hostPanelEmptyText: { color: 'rgba(255,255,255,0.76)', fontSize: 12, fontWeight: FontWeight.semibold, textAlign: 'center' },
  giftActivityPanel: { position: 'absolute', left: 20, right: 20, minHeight: 64, zIndex: 17, elevation: 17, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(17,19,27,0.95)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.64)' },
  giftActivityCopy: { flex: 1, minWidth: 0, gap: 2 },
  giftActivityTitle: { color: '#fff', fontSize: 13, fontWeight: FontWeight.bold },
  giftActivityText: { color: 'rgba(255,255,255,0.72)', fontSize: 11, lineHeight: 15 },
  moderationPanel: { position: 'absolute', left: 20, right: 20, zIndex: 17, elevation: 17, gap: 8, padding: 12, borderRadius: 20, backgroundColor: 'rgba(17,19,27,0.96)', borderWidth: 1, borderColor: 'rgba(168,85,247,0.55)' },
  moderationHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  moderationTitle: { color: '#fff', fontSize: 13, fontWeight: FontWeight.bold },
  moderationText: { color: 'rgba(255,255,255,0.72)', fontSize: 11 },
  moderationList: { flexGrow: 0 },
  moderationListContent: { gap: 7 },

  chatArea: {
    position: 'absolute',
    left: 20,
    width: SCREEN_WIDTH * 0.56,
    bottom: 108,
    maxHeight: SCREEN_HEIGHT * 0.32,
    zIndex: 7,
  },

  controls: {
    position: 'absolute', left: 38, right: 22,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SCREEN_WIDTH < 370 ? 6 : 12,
    height: 48,
    zIndex: 12,
  },
  controlGroup: { alignItems: 'center' },
  controlBtn: {
    width: SCREEN_WIDTH < 370 ? 42 : 46, height: SCREEN_WIDTH < 370 ? 42 : 46, borderRadius: 23, backgroundColor: 'rgba(17,19,27,0.86)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  micControlBtn: { borderColor: '#A855F7', borderWidth: 2 },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  endBtn: { width: SCREEN_WIDTH < 370 ? 42 : 46, height: SCREEN_WIDTH < 370 ? 42 : 46, backgroundColor: '#FF2D55', borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  hostPrimaryActions: { position: 'absolute', left: 18, right: 18, height: 52, zIndex: 13, flexDirection: 'row', alignItems: 'center', gap: SCREEN_WIDTH < 370 ? 4 : 6 },
  hostPrimaryAction: { flex: 1, minWidth: 0, height: 52, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 2, borderRadius: 17, backgroundColor: 'rgba(18,21,30,0.92)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  hostPrimaryActionWide: { flex: 1.14 },
  hostPrimaryActionActive: { borderColor: 'rgba(168,85,247,0.82)', backgroundColor: 'rgba(65,42,88,0.92)' },
  hostPrimaryActionText: { flexShrink: 1, color: '#A4AAB8', fontSize: SCREEN_WIDTH < 370 ? 7 : 8, fontWeight: FontWeight.semibold, textAlign: 'center' },
  hostPrimaryActionTextCompact: { fontSize: 9 },
  hostPrimaryBadge: { position: 'absolute', top: -8, right: 2, minWidth: 21, height: 21, paddingHorizontal: 4, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF2D78' },
  hostPrimaryBadgeText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  moreControls:{position:'absolute',right:18,zIndex:17,elevation:17,padding:6,borderRadius:18,backgroundColor:'rgba(15,15,22,.9)',borderWidth:1,borderColor:'rgba(255,255,255,.14)'},
  secondaryControl:{minHeight:44,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12},
  secondaryControlText:{color:'#fff',fontSize:12,fontWeight:FontWeight.semibold},
  addProductCta:{position:'absolute',left:16,zIndex:12,minHeight:44,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:14,borderRadius:22,backgroundColor:'rgba(15,15,22,.86)',borderWidth:1,borderColor:'rgba(255,255,255,.16)'},
  addProductText:{color:'#fff',fontSize:12,fontWeight:FontWeight.bold},
  inputRow: { position: 'absolute', left: 20, right: 12, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 20, elevation: 20 },
  input: { flex: 1, height: 44, backgroundColor: 'rgba(17,19,27,0.95)', borderRadius: Radius.full, paddingHorizontal: 18, color: '#fff', fontSize: FontSize.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
