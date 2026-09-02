/**
 * app/live/watch/[streamId].tsx — Agora live stream viewer screen
 *
 * Reads/writes live_sessions / live_messages and routes paid gifts through
 * send_live_gift() so BDAG moves only through the canonical ledger.
 */
/* eslint-disable react-hooks/exhaustive-deps -- existing LIVE lifecycle effects intentionally use stable refs */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, FlatList, TextInput,
  Keyboard, Platform, ActivityIndicator, Dimensions,
  Alert, Animated, Share,
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
import { RtcSurfaceView, useridToAgoraUid } from '@/services/agoraService';
import { fetchGiftCatalog, fetchWalletBalance, sendLiveGift, type GiftCatalogItem } from '@/services/liveGiftsService';
import { LiveGiftButton } from '@/components/live/gifts/LiveGiftButton';
import { LiveGiftSheet } from '@/components/live/gifts/LiveGiftSheet';
import { LiveGiftOverlay } from '@/components/live/gifts/LiveGiftOverlay';
import { liveGiftEventFromPayload } from '@/components/live/gifts/giftPresentationContract';
import { LiveChatMessageItem } from '@/components/live/LiveChatMessageItem';
import { LiveSessionHeader } from '@/components/live/LiveSessionHeader';
import { LiveBattleStage } from '@/components/live/LiveBattleStage';
import { useLiveGiftAnimations } from '@/hooks/live/useLiveGiftAnimations';
import { useLiveBattleSpectatorState } from '@/hooks/live/useLiveBattleSpectatorState';
import { isLiveBattleStageStatus } from '@/services/liveBattleSpectatorService';
import { LiveCommerceButton } from '@/components/live/commerce/LiveCommerceButton';
import { LiveProductRail } from '@/components/live/shop/LiveProductRail';
import { LiveViewerCommerce } from '@/components/live/commerce/LiveViewerCommerce';
import { fetchLiveSessionProducts, type LiveSessionProduct } from '@/services/liveCommerceService';
import {
  emitLiveReaction,
  enforceLiveParticipantTimer,
  requestToJoinLive,
  respondToLiveHostInvite,
  sendLiveMessage,
  setLiveParticipantPresence,
} from '@/services/liveSessionService';

const POLL_INTERVAL_MS = 3000;
const MAX_MESSAGES     = 50;
const SPAM_THROTTLE_MS = 2500;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface StreamSession {
  id: string;
  hostId: string;
  hostUsername: string;
  title: string;
  viewerCount: number;
  status: 'live' | 'ended';
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
}

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

function getFloorSecondsRemaining(participant: LiveParticipant | null) {
  if (!participant?.floor_started_at) return null;
  if (participant.floor_duration_seconds === null || participant.floor_duration_seconds === undefined) return null;

  const startedAt = new Date(participant.floor_started_at).getTime();
  if (Number.isNaN(startedAt)) return null;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, participant.floor_duration_seconds - elapsed);
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

type HostInviteEvent = {
  id: string;
  payload?: {
    username?: string;
  } | null;
};

type FloatingReaction = {
  id: string;
  emoji: string;
  username?: string | null;
  createdAt: number;
  x: number;
};

function getDisplayUsername(user: any): string {
  return user?.username || user?.email?.split('@')[0] || 'user';
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

function FloatingReactionBubble({ reaction, bottom }: { reaction: FloatingReaction; bottom: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 1900,
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
          opacity: progress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0, 1, 0] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -150] }) },
            { scale: progress.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0.82, 1.08, 1] }) },
          ],
        },
      ]}
    >
      <Text style={styles.floatingReactionEmoji}>{reaction.emoji}</Text>
    </Animated.View>
  );
}

export default function LiveWatchScreen() {
  const { streamId } = useLocalSearchParams<{ streamId: string }>();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;

  const [session,  setSession]  = useState<StreamSession | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [ended,    setEnded]    = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sending,   setSending]   = useState(false);
  const [participantRow, setParticipantRow] = useState<LiveParticipant | null>(null);
  const [promotedToPublisher, setPromotedToPublisher] = useState(false);
  const [watchSeconds, setWatchSeconds] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [composerHeight, setComposerHeight] = useState(72);
  const [floorSecondsRemaining, setFloorSecondsRemaining] = useState<number | null>(null);
  const [hostInvite, setHostInvite] = useState<HostInviteEvent | null>(null);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [giftCatalog, setGiftCatalog] = useState<GiftCatalogItem[]>([]);
  const [giftsEnabled, setGiftsEnabled] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(null);
  const [giftSheetVisible, setGiftSheetVisible] = useState(false);
  const [sendingGiftId, setSendingGiftId] = useState<string | null>(null);
  const [giftFeedback, setGiftFeedback] = useState<string | null>(null);
  const [commerceVisible, setCommerceVisible] = useState(false);
  const [commerceProductId, setCommerceProductId] = useState<string | null>(null);
  const [liveProducts, setLiveProducts] = useState<LiveSessionProduct[]>([]);
  const { activeGift, floatingGifts, reducedMotion, enqueueGift } = useLiveGiftAnimations(streamId);

  const refreshLiveProducts = useCallback(async () => {
    if (!streamId) return;
    try { setLiveProducts(await fetchLiveSessionProducts(streamId)); } catch { /* polling retries safely */ }
  }, [streamId]);
  useEffect(() => {
    if (!streamId || session?.status !== 'live') { setLiveProducts([]); return; }
    void refreshLiveProducts();
    const timer = setInterval(() => void refreshLiveProducts(), 5_000);
    const channel = supabase.channel(`live-commerce:${streamId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'live_session_products', filter: `session_id=eq.${streamId}` }, () => void refreshLiveProducts()).subscribe();
    return () => { clearInterval(timer); void supabase.removeChannel(channel); };
  }, [refreshLiveProducts, session?.status, streamId, supabase]);

  const agora = useAgoraEngine({
    channelName: session?.status === 'live' ? streamId ?? null : null,
    uid: myUid,
    role: 'subscriber',
    profile: 'live-broadcasting',
    liveSessionId: session?.status === 'live' ? streamId : undefined,
    liveRequestedRole: 'viewer',
  });
  const {
    engineReady, joined, remoteUids, error, join, leave, promoteToPublisher,
    isMuted, isCameraOff, toggleMute, toggleCamera,
  } = agora;
  const battleProjection = useLiveBattleSpectatorState(
    streamId ?? null,
    Boolean(user?.id && session?.status === 'live'),
    user?.id ?? null,
  );
  const battleStageVisible = Boolean(
    battleProjection.state && isLiveBattleStageStatus(battleProjection.state.status),
  );
  useEffect(() => {
    if (!battleStageVisible) return;
    setCommerceVisible(false);
    setCommerceProductId(null);
  }, [battleStageVisible]);
  const demoteToAudience = (agora as any).demoteToAudience as undefined | (() => Promise<boolean>);

  const requestSent = participantRow?.role === 'requested';
  const isStructuredCohost = participantRow?.role === 'cohost' && participantRow?.status === 'active';
  const wasRemoved = participantRow?.role === 'removed' || participantRow?.status === 'removed';

  const chatRef     = useRef<FlatList>(null);
  const inputRef    = useRef<TextInput | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMsgRef  = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const sendingRef  = useRef(false);
  const mountedRef  = useRef(true);
  const leftRef     = useRef(false);
  const presenceRegisteredRef = useRef(false);
  const promotingRef = useRef(false);
  const previousRemoteMicMutedRef = useRef<boolean | null>(null);
  const removedHandledRef = useRef(false);
  const timerExpiredHandledRef = useRef(false);
  const lastPromotionKeyRef = useRef<string | null>(null);
  const seenHostInviteIdsRef = useRef<Set<string>>(new Set());
  const seenReactionEventIdsRef = useRef<Set<string>>(new Set());
  const lastReactionAtRef = useRef(0);
  const sendingGiftRef = useRef(false);
  const giftFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    console.log('[LiveWatch] auth user id', user.id);
    let cancelled = false;

    fetchGiftCatalog()
      .then(items => {
        if (cancelled) return;
        setGiftCatalog(items);
        setGiftsEnabled(items.length > 0);
      })
      .catch(err => {
        console.warn('[LiveWatch] fetch gift catalog failed', err?.message ?? err);
        if (!cancelled) setGiftsEnabled(false);
      });

    setWalletBalanceLoading(true);
    setWalletBalanceError(null);
    fetchWalletBalance()
      .then(balance => {
        if (!cancelled) setWalletBalance(balance);
      })
      .catch(err => {
        console.warn('[LiveWatch] fetch wallet balance failed', err?.message ?? err);
        if (!cancelled) {
          setWalletBalance(null);
          setWalletBalanceError('No se pudo cargar el saldo');
        }
      })
      .finally(() => {
        if (!cancelled) setWalletBalanceLoading(false);
      });

    return () => { cancelled = true; };
  }, [user?.id]);

  const showGiftFeedback = useCallback((text: string) => {
    if (giftFeedbackTimeoutRef.current) clearTimeout(giftFeedbackTimeoutRef.current);
    setGiftFeedback(text);
    giftFeedbackTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) setGiftFeedback(null);
    }, 2500);
  }, []);

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

  const addFloatingReaction = useCallback((emoji: string, username?: string | null) => {
    const reaction: FloatingReaction = {
      id: `reaction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      emoji,
      username,
      createdAt: Date.now(),
      x: 0.15 + Math.random() * 0.7,
    };

    setFloatingReactions(prev => [...prev, reaction].slice(-12));
    setTimeout(() => {
      if (!mountedRef.current) return;
      setFloatingReactions(prev => prev.filter(item => item.id !== reaction.id));
    }, 2200);
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

  // ── Fetch session ─────────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    if (!streamId) return false;
    try {
      const { data, error: err } = await supabase
        .from('live_sessions')
        .select(`id, host_id, title, status, viewer_count, started_at, last_heartbeat_at, user_profiles!live_sessions_host_id_fkey(username)`)
        .eq('id', streamId)
        .single();

      if (err || !data) { setEnded(true); setLoading(false); return false; }

      const lastLiveSignal = data.last_heartbeat_at ?? data.started_at;
      const isStaleLive = data.status === 'live' && lastLiveSignal && Date.now() - new Date(lastLiveSignal).getTime() > 90_000;

      setSession({
        id:           data.id,
        hostId:       data.host_id,
        hostUsername: (data as any).user_profiles?.username ?? 'Creator',
        title:        data.title ?? '',
        viewerCount:  data.viewer_count ?? 0,
        status:       isStaleLive ? 'ended' : data.status as 'live' | 'ended',
        startedAt:    data.started_at ?? null,
        lastHeartbeatAt: data.last_heartbeat_at ?? null,
      });
      if (data.status !== 'live' || isStaleLive) setEnded(true);
      setLoading(false);
      return data.status === 'live' && !isStaleLive;
    } catch { setLoading(false); return false; }
  }, [streamId, supabase]);

  // ── Join Agora once session confirmed live ──────────────────────────────
  useEffect(() => {
    if (session?.status === 'live' && engineReady) join();
  }, [session?.status, engineReady]);

  useEffect(() => {
    if (session?.status !== 'live') return;
    const timer = setInterval(() => setWatchSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [session?.status]);

  // ── Viewer count +1 / -1 ─────────────────────────────────────────────────
  // Atomic RPC — the previous read-then-write (select viewer_count, then
  // update with the computed value) lost updates whenever two viewers
  // joined/left concurrently, since both would read the same stale count
  // before either write landed.
  const loadParticipant = useCallback(async () => {
    if (!streamId || !user?.id) return;

    try {
      const { data, error: selectError } = await supabase
        .from('live_participants')
        .select('*')
        .eq('session_id', streamId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (selectError) {
        console.warn('[LiveWatch] load participant failed', selectError.message);
        return;
      }

      setParticipantRow((data as LiveParticipant | null) ?? null);
    } catch (err: any) {
      console.warn('[LiveWatch] participant sync failed', err?.message ?? err);
    }
  }, [streamId, user?.id, supabase]);

  useEffect(() => {
    if (session?.status !== 'live' || !user?.id) return;
    loadParticipant();
  }, [session?.status, user?.id, loadParticipant]);

  useEffect(() => {
    if (session?.status !== 'live' || !streamId || !user?.id) return;

    const channel = supabase
      .channel(`live-participant:${streamId}:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_participants', filter: `session_id=eq.${streamId}` },
        payload => {
          const row = (payload.new || payload.old) as LiveParticipant | null;
          if (row?.user_id === user.id) setParticipantRow(row);
        },
      )
      .subscribe();

    const fallback = setInterval(loadParticipant, POLL_INTERVAL_MS);
    return () => {
      clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [session?.status, streamId, user?.id, supabase, loadParticipant]);

  useEffect(() => {
    if (session?.status !== 'live' || !streamId || !user?.id) return;

    const channel = supabase
      .channel(`live-control-invite:${streamId}:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_control_events', filter: `session_id=eq.${streamId}` },
        payload => {
          const row = payload.new as any;
          if (row?.target_user_id !== user.id) return;
          if (row?.event_type !== 'host_invite') return;
          if (seenHostInviteIdsRef.current.has(row.id)) return;
          seenHostInviteIdsRef.current.add(row.id);
          if (isStructuredCohost || requestSent) return;
          setHostInvite({ id: row.id, payload: row.payload });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.status, streamId, user?.id, supabase, isStructuredCohost, requestSent]);

  useEffect(() => {
    if (session?.status !== 'live' || !streamId) return;

    const channel = supabase
      .channel(`live-reactions:${streamId}:watch`)
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
  }, [session?.status, streamId, supabase, addFloatingReaction, enqueueGift]);

  // ── Poll: session status + viewer count + messages ──────────────────────
  const poll = useCallback(async () => {
    if (!streamId || ended) return;
    try {
      const { data: sData } = await supabase
        .from('live_sessions').select('viewer_count, status, started_at, last_heartbeat_at').eq('id', streamId).single();
      if (sData) {
        setSession(prev => prev ? { ...prev, viewerCount: sData.viewer_count ?? prev.viewerCount } : prev);
        const lastLiveSignal = sData.last_heartbeat_at ?? sData.started_at;
        const isStaleLive = sData.status === 'live' && lastLiveSignal && Date.now() - new Date(lastLiveSignal).getTime() > 90_000;
        if (sData.status === 'ended' || isStaleLive) {
          setEnded(true);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          return;
        }
      }

      let query = supabase
        .from('live_messages')
        .select('id, user_id, username, message, created_at')
        .eq('session_id', streamId)
        .order('created_at', { ascending: true })
        .limit(MAX_MESSAGES);
      if (lastMsgRef.current) query = query.gt('created_at', lastMsgRef.current);

      const { data: mData } = await query;
      if (mData && mData.length > 0) {
        const newMsgs: ChatMessage[] = mData.map((m: any) => ({
          id: m.id, userId: m.user_id, username: m.username,
          message: m.message, createdAt: m.created_at,
        }));
        const messagesWithAvatars = await attachMessageAvatars(supabase, newMsgs, user);
        lastMsgRef.current = mData[mData.length - 1].created_at;
        setMessages(prev => mergeMessages(prev, messagesWithAvatars));
        scrollToLatest(true);
      }
    } catch { /* ignore */ }
  }, [streamId, ended, supabase, scrollToLatest, user]);

  useEffect(() => {
    if (participantRow?.role === 'cohost' && participantRow?.status === 'active') return;
    setPromotedToPublisher(false);
    promotingRef.current = false;
    lastPromotionKeyRef.current = null;
  }, [participantRow?.role, participantRow?.status]);

  useEffect(() => {
    const promotionKey = participantRow
      ? `${participantRow.id}:${participantRow.updated_at}:${participantRow.role}:${participantRow.status}`
      : null;

    if (!isStructuredCohost || wasRemoved || promotingRef.current || !promotionKey) return;
    if (lastPromotionKeyRef.current === promotionKey && promotedToPublisher) return;

    promotingRef.current = true;
    promoteToPublisher().then(ok => {
      if (ok && mountedRef.current) {
        setPromotedToPublisher(true);
        lastPromotionKeyRef.current = promotionKey;
      }
      promotingRef.current = false;
    });
  }, [isStructuredCohost, promotedToPublisher, wasRemoved, participantRow?.id, participantRow?.updated_at, participantRow?.role, participantRow?.status, promoteToPublisher]);

  useEffect(() => {
    if (wasRemoved) return;
    if (!isStructuredCohost) {
      previousRemoteMicMutedRef.current = null;
      return;
    }
    const remoteMicMuted = participantRow?.mic_muted === true;
    const remoteMicLocked = participantRow?.mic_locked === true;
    const previousRemoteMicMuted = previousRemoteMicMutedRef.current;

    if ((remoteMicMuted || remoteMicLocked) && !isMuted) {
      toggleMute();
    } else if (!remoteMicMuted && !remoteMicLocked && previousRemoteMicMuted === true && isMuted) {
      toggleMute();
    }

    previousRemoteMicMutedRef.current = remoteMicMuted;
  }, [isStructuredCohost, wasRemoved, participantRow?.mic_muted, participantRow?.mic_locked, isMuted, toggleMute]);

  useEffect(() => {
    if (!wasRemoved) return;
    if (removedHandledRef.current) return;
    removedHandledRef.current = true;
    setPromotedToPublisher(false);

    if (demoteToAudience) {
      demoteToAudience().then(ok => {
        if (!ok) {
          if (!isMuted) toggleMute();
          if (!isCameraOff) toggleCamera();
        }
      });
      return;
    }

    if (!isMuted) toggleMute();
    if (!isCameraOff) toggleCamera();
  }, [wasRemoved, isMuted, isCameraOff, toggleMute, toggleCamera, demoteToAudience]);

  useEffect(() => {
    if (!wasRemoved) removedHandledRef.current = false;
  }, [wasRemoved]);

  useEffect(() => {
    timerExpiredHandledRef.current = false;
    if (!participantRow?.floor_started_at || participantRow.floor_duration_seconds === null || participantRow.floor_duration_seconds === undefined) {
      setFloorSecondsRemaining(null);
      return;
    }

    const updateRemaining = () => {
      setFloorSecondsRemaining(getFloorSecondsRemaining(participantRow));
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [participantRow?.floor_started_at, participantRow?.floor_duration_seconds]);

  useEffect(() => {
    if (floorSecondsRemaining !== 0 || !isStructuredCohost || timerExpiredHandledRef.current) return;
    timerExpiredHandledRef.current = true;
    if (!isMuted) toggleMute();
    if (streamId && user?.id) {
      enforceLiveParticipantTimer(streamId, user.id).catch((err: any) => {
        console.warn('[LiveWatch] timer enforcement failed', err?.message ?? err);
      });
    }
  }, [floorSecondsRemaining, isStructuredCohost, isMuted, toggleMute, streamId, user?.id]);

  useEffect(() => {
    if (!streamId) { router.back(); return; }
    presenceRegisteredRef.current = false;
    fetchSession();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (!leftRef.current) { leftRef.current = true; leave(); }
      if (presenceRegisteredRef.current) {
        presenceRegisteredRef.current = false;
        setLiveParticipantPresence(streamId, false).catch((err: any) => {
          console.warn('[LiveWatch] leave presence failed', err?.message ?? err);
        });
      }
    };
  }, [streamId]);

  useEffect(() => {
    if (!joined || leftRef.current || presenceRegisteredRef.current || !streamId) return;
    presenceRegisteredRef.current = true;
    setLiveParticipantPresence(streamId, true)
      .then(data => { if (data && mountedRef.current) setParticipantRow(data as LiveParticipant); })
      .catch((err: any) => {
        presenceRegisteredRef.current = false;
        console.warn('[LiveWatch] enter presence failed', err?.message ?? err);
      });
  }, [joined, streamId]);

  // ── Send message ─────────────────────────────────────────────────────────
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
      console.warn('[LiveWatch] send message failed', err?.message ?? err);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [chatInput, user, streamId, sending, supabase, scrollToLatest, dismissKeyboard]);

  const requestToJoin = useCallback(async () => {
    if (!user || !streamId || requestSent || promotedToPublisher || isStructuredCohost) return;
    try {
      const data = await requestToJoinLive(streamId);
      if (data) setParticipantRow(data as LiveParticipant);
    } catch (err: any) {
      setParticipantRow(participantRow);
      console.warn('[LiveWatch] request join failed', err?.message ?? err);
      Alert.alert('No se pudo enviar la solicitud');
    }
  }, [user, streamId, requestSent, promotedToPublisher, isStructuredCohost, participantRow]);

  const acceptHostInvite = useCallback(async () => {
    if (!streamId || !hostInvite) return;
    const invite = hostInvite;
    setHostInvite(null);
    try {
      const data = await respondToLiveHostInvite(streamId, invite.id, true);
      if (data) setParticipantRow(data as LiveParticipant);
    } catch (err: any) {
      console.warn('[LiveWatch] accept invite failed', err?.message ?? err);
      Alert.alert('No se pudo aceptar la invitación');
    }
  }, [streamId, hostInvite]);

  const rejectHostInvite = useCallback(async () => {
    if (!streamId || !hostInvite) return;
    const invite = hostInvite;
    setHostInvite(null);
    try {
      await respondToLiveHostInvite(streamId, invite.id, false);
    } catch (err: any) {
      console.warn('[LiveWatch] reject invite failed', err?.message ?? err);
    }
  }, [streamId, hostInvite]);

  const sendReaction = useCallback(async (emoji: string) => {
    if (!streamId || !user?.id) return;
    const now = Date.now();
    if (now - lastReactionAtRef.current < 600) return;
    lastReactionAtRef.current = now;

    const username = getDisplayUsername(user);
    try {
      const data = await emitLiveReaction(streamId, emoji);
      if (data?.id) seenReactionEventIdsRef.current.add(data.id);
      addFloatingReaction(emoji, username);
    } catch (err: any) {
      console.warn('[LiveWatch] reaction failed', err?.message ?? err);
    }
  }, [streamId, user, supabase, addFloatingReaction]);

  const sendRealGift = useCallback(async (gift: GiftCatalogItem) => {
    if (!streamId || !user?.id) return;
    if (!giftsEnabled) { showGiftFeedback('Regalos no disponibles'); return; }
    if (sendingGiftRef.current) return;
    if (walletBalance === null) { showGiftFeedback('Saldo no disponible'); return; }
    if (walletBalance < gift.priceBdag) { showGiftFeedback('Saldo insuficiente'); return; }

    sendingGiftRef.current = true;
    setSendingGiftId(gift.id);

    const idempotencyKey = `${streamId}:${user.id}:${gift.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    try {
      const result = await sendLiveGift({ sessionId: streamId, giftId: gift.id, idempotencyKey });

      if (!result.success) {
        showGiftFeedback(/insufficient balance/i.test(result.error ?? '') ? 'Saldo insuficiente' : 'No se pudo enviar el regalo');
        console.warn('[LiveWatch] send gift failed', result.error);
        return;
      }

      if (typeof result.new_sender_balance === 'number') setWalletBalance(result.new_sender_balance);
      setWalletBalanceError(null);
      showGiftFeedback(`${gift.name} enviado`);
    } catch (err: any) {
      console.warn('[LiveWatch] send gift failed', err?.message ?? err);
      showGiftFeedback('No se pudo enviar el regalo');
    } finally {
      sendingGiftRef.current = false;
      setSendingGiftId(null);
    }
  }, [streamId, user, giftsEnabled, walletBalance, showGiftFeedback]);

  const shareLive = useCallback(async () => {
    try {
      await Share.share({
        message: session?.title
          ? `Estoy viendo "${session.title}" en OnSpace. Únete al live.`
          : 'Estoy viendo un live en OnSpace. Únete ahora.',
      });
    } catch (err: any) {
      console.warn('[LiveWatch] share failed', err?.message ?? err);
    }
  }, [session?.title]);

  const formatLiveDuration = (seconds: number) =>
    `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Cargando live...</Text>
      </SafeAreaView>
    );
  }

  if (ended || !session) {
    return (
      <SafeAreaView style={styles.endedScreen}>
        <StatusBar style="light" />
        <MaterialIcons name="live-tv" size={52} color={Colors.secondary} />
        <Text style={styles.endedTitle}>Este live ha terminado</Text>
        <Pressable onPress={() => router.back()} style={styles.endedBtn}>
          <Text style={styles.endedBtnText}>Volver</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const battleState = battleProjection.state && isLiveBattleStageStatus(battleProjection.state.status)
    ? battleProjection.state
    : null;
  const canonicalHostUid = useridToAgoraUid(session.hostId);
  const remoteUid = remoteUids.includes(canonicalHostUid) ? canonicalHostUid : remoteUids[0];
  const battleHostUid = battleState?.localHostAgoraUid;
  const battleOpponentUid = battleState?.opponentHostAgoraUid;
  const coHostUids = remoteUids.filter(uid => battleState
    ? uid !== battleHostUid && uid !== battleOpponentUid
    : uid !== remoteUid);
  const composerBottom = keyboardHeight > 0 ? keyboardHeight : insets.bottom;
  const composerClearance = composerBottom + composerHeight + 16;
  const featuredLiveProduct = liveProducts.find(product => product.isFeatured) ?? null;
  const requestIcon = promotedToPublisher || isStructuredCohost ? 'videocam' : requestSent ? 'hourglass-top' : 'person-add-alt-1';
  const requestDisabled = requestSent || promotedToPublisher || isStructuredCohost || !user;
  const floorTimerText = floorSecondsRemaining === null
    ? null
    : `${Math.floor(floorSecondsRemaining / 60)}:${(floorSecondsRemaining % 60).toString().padStart(2, '0')}`;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar style="light" />

      {battleState ? (
        <LiveBattleStage
          state={battleState}
          clockAnchor={battleProjection.clockAnchor}
          topInset={insets.top}
          localHost={{
            username: battleProjection.localHostProfile?.username ?? session.hostUsername,
            avatarUrl: battleProjection.localHostProfile?.avatarUrl ?? null,
          }}
          opponentHost={{
            username: battleProjection.opponentHostProfile?.username ?? 'Host',
            avatarUrl: battleProjection.opponentHostProfile?.avatarUrl ?? null,
          }}
          localSurface={RtcSurfaceView && remoteUids.includes(battleState.localHostAgoraUid)
            ? <RtcSurfaceView canvas={{ uid: battleState.localHostAgoraUid }} style={styles.battleVideo} />
            : null}
          opponentSurface={RtcSurfaceView && remoteUids.includes(battleState.opponentHostAgoraUid)
            ? <RtcSurfaceView canvas={{ uid: battleState.opponentHostAgoraUid }} style={styles.battleVideo} />
            : null}
          actorUserId={user?.id ?? null}
          seriesClientState={battleProjection.clientState}
          seriesActionPending={battleProjection.seriesActionPending}
          seriesErrorMessage={battleProjection.seriesErrorMessage}
          onRequestRematch={battleProjection.requestRematch}
          onAcceptRematch={battleProjection.acceptRematch}
          onRejectRematch={battleProjection.rejectRematch}
        />
      ) : RtcSurfaceView && remoteUid !== undefined ? (
        <RtcSurfaceView canvas={{ uid: remoteUid }} style={styles.videoStream} />
      ) : (
        <View style={styles.videoPlaceholder}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.waitingText}>Conectando con el stream...</Text>
        </View>
      )}

      <Pressable
        style={styles.keyboardDismissLayer}
        onPress={dismissKeyboard}
        accessibilityLabel="Cerrar teclado"
      />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <LinearGradient colors={['rgba(0,0,0,0.45)', 'transparent']} style={styles.topShade} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.58)']} style={styles.bottomShade} pointerEvents="none" />

      <View style={[styles.header,{top:insets.top+8,height:undefined,paddingHorizontal:0,backgroundColor:'transparent',borderWidth:0}]}><LiveSessionHeader hostName={session.hostUsername} viewerCount={session.viewerCount} elapsed={formatLiveDuration(watchSeconds)} onClose={()=>router.back()} battleMode={Boolean(battleState)}/></View>

      {!battleState ? <View style={[styles.titleBlock, { top: insets.top + 88 }]}>
        <Text style={styles.streamTitle} numberOfLines={2}>{session.title}</Text>
        <View style={styles.conversationChip}>
          <MaterialIcons name="chat-bubble-outline" size={14} color="#fff" />
          <Text style={styles.conversationText}>Conversación</Text>
        </View>
      </View> : null}

      {error ? (
        <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>
      ) : null}

      {floatingReactions.map(reaction => (
        <FloatingReactionBubble
          key={reaction.id}
          reaction={reaction}
          bottom={composerClearance + 126}
        />
      ))}

      <LiveGiftOverlay activeGift={activeGift} floatingGifts={floatingGifts} reducedMotion={reducedMotion} />

      {hostInvite ? (
        <View style={[styles.hostInvitePanel, { top: insets.top + 154 }]}>
          <MaterialIcons name="person-add-alt-1" size={17} color="#fff" />
          <Text style={styles.hostInviteText} numberOfLines={1}>El anfitrión quiere subirte</Text>
          <Pressable
            style={[styles.hostInviteBtn, styles.hostInviteRejectBtn]}
            onPress={rejectHostInvite}
            hitSlop={6}
            accessibilityLabel="Rechazar invitación del anfitrión"
          >
            <MaterialIcons name="close" size={16} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.hostInviteBtn, styles.hostInviteAcceptBtn]}
            onPress={acceptHostInvite}
            hitSlop={6}
            accessibilityLabel="Aceptar invitación del anfitrión"
          >
            <MaterialIcons name="check" size={16} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {/* ── Chat + controls ──────────────────────────────────────────────── */}
      {(isStructuredCohost || wasRemoved) ? (
        <View style={[styles.cohostStatusPanel, { top: insets.top + 154 }]}>
          <Pressable
            style={[styles.cohostSelfBtn, (isMuted || participantRow?.mic_locked) && styles.cohostSelfBtnActive, participantRow?.mic_locked && styles.cohostSelfBtnLocked]}
            onPress={() => {
              if (participantRow?.mic_locked) return;
              toggleMute();
            }}
            disabled={!!participantRow?.mic_locked || wasRemoved}
            hitSlop={6}
            accessibilityLabel={participantRow?.mic_locked ? 'Micrófono bloqueado por el anfitrión' : isMuted ? 'Activar micrófono' : 'Silenciar micrófono'}
          >
            <MaterialIcons name={participantRow?.mic_locked ? 'lock' : isMuted ? 'mic-off' : 'mic'} size={15} color="#fff" />
          </Pressable>
          <Pressable
            style={[styles.cohostSelfBtn, isCameraOff && styles.cohostSelfBtnActive]}
            onPress={toggleCamera}
            disabled={wasRemoved}
            hitSlop={6}
            accessibilityLabel={isCameraOff ? 'Activar cámara' : 'Apagar cámara'}
          >
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={15} color="#fff" />
          </Pressable>
          <View style={[styles.floorBadge, !participantRow?.floor_granted && styles.floorBadgeMuted]}>
            <MaterialIcons name={participantRow?.floor_granted ? 'record-voice-over' : 'voice-over-off'} size={13} color="#fff" />
            {floorTimerText ? <Text style={styles.floorBadgeText}>{floorTimerText}</Text> : null}
          </View>
          {wasRemoved ? (
            <View style={styles.floorBadgeMuted}>
              <MaterialIcons name="block" size={14} color="#fff" />
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.actionRail, battleState && styles.battleActionRail]}>
        {!battleState && !featuredLiveProduct?<LiveCommerceButton
          count={liveProducts.length}
          onPress={() => {
            setGiftSheetVisible(false);
            setCommerceProductId(null);
            Keyboard.dismiss();
            setCommerceVisible(true);
          }}
        />:null}
        <Pressable
          style={[styles.actionButton, battleState && styles.battleActionButton]}
          onPress={() => sendReaction('\u2764\uFE0F')}
          hitSlop={6}
          accessibilityLabel="Enviar reacción"
        >
          <MaterialIcons name="favorite" size={25} color="#fff" />
          {battleState ? <Text style={styles.battleActionLabel}>Me gusta</Text> : null}
        </Pressable>
        {battleState ? (
          <Pressable
            style={[styles.actionButton, styles.battleActionButton]}
            onPress={() => {
              setCommerceVisible(false);
              setGiftSheetVisible(true);
            }}
            disabled={!user || session.status !== 'live' || !giftsEnabled || walletBalanceLoading}
            accessibilityRole="button"
            accessibilityLabel="Abrir regalos"
          >
            <MaterialIcons name="card-giftcard" size={23} color="#fff" />
            <Text style={styles.battleActionLabel}>Regalo</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={[styles.actionButton, battleState && styles.battleActionButton]}
          onPress={shareLive}
          hitSlop={6}
          accessibilityLabel="Compartir live"
        >
          <MaterialIcons name="ios-share" size={24} color="#fff" />
          {battleState ? <Text style={styles.battleActionLabel}>Compartir</Text> : null}
        </Pressable>
        <Pressable
          style={[styles.actionButton, battleState && styles.battleActionButton, requestDisabled && styles.actionButtonDisabled]}
          onPress={() => requestToJoin()}
          disabled={requestDisabled}
          accessibilityLabel={wasRemoved ? 'Volver a solicitar subir al live' : 'Solicitar subir al live'}
        >
          <MaterialIcons name={requestIcon} size={24} color="#fff" />
          {battleState ? <Text style={styles.battleActionLabel}>Cámara</Text> : null}
        </Pressable>
      </View>
      {!battleState && featuredLiveProduct ? (
        <LiveProductRail
          product={featuredLiveProduct}
          productCount={liveProducts.length}
          bottom={composerClearance + 10}
          keyboardVisible={keyboardHeight > 0}
          onBuy={() => {
            setGiftSheetVisible(false);
            setCommerceProductId(featuredLiveProduct.id);
            setCommerceVisible(true);
          }}
          onOpenBag={() => {
            setGiftSheetVisible(false);
            setCommerceProductId(null);
            setCommerceVisible(true);
          }}
        />
      ) : null}

      {!battleState && coHostUids.length > 0 && RtcSurfaceView ? (
        <View style={styles.coHostStrip}>
          {coHostUids.slice(0, 2).map(uid => (
            <View key={uid} style={styles.coHostTile}>
              <RtcSurfaceView canvas={{ uid }} style={styles.coHostVideo} />
              <View style={styles.coHostMic}><MaterialIcons name="mic" size={13} color="#fff" /></View>
              <Text style={styles.coHostName}>Invitado</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.bottomSection, battleState && styles.battleBottomSection, { bottom: battleState ? composerClearance + 8 : composerClearance + 86 }]}>
        <FlatList
          ref={chatRef}
          data={messages}
          keyExtractor={item => item.id}
          onContentSizeChange={() => scrollToLatest(false)}
          onLayout={() => scrollToLatest(false)}
          renderItem={({ item }) => (
            <LiveChatMessageItem
              username={item.username}
              message={item.message}
              avatarUrl={item.avatarUrl}
              isHost={item.userId === session.hostId}
            />
          )}
          style={[styles.chatList, battleState && styles.battleChatList]}
          contentContainerStyle={{ gap: 6, paddingVertical: 8, paddingHorizontal: Spacing.md }}
          ListFooterComponent={<View style={{ height: 8 }} />}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />

      </View>

      <LiveGiftSheet
        visible={giftSheetVisible}
        balance={walletBalance}
        catalog={giftCatalog}
        sendingGiftId={sendingGiftId}
        giftsEnabled={giftsEnabled && session.status === 'live'}
        feedback={giftFeedback}
        balanceLoading={walletBalanceLoading}
        balanceError={walletBalanceError}
        onSendGift={sendRealGift}
        onClose={() => setGiftSheetVisible(false)}
      />

      {!battleState && streamId ? (
        <LiveViewerCommerce
          visible={commerceVisible}
          sessionId={streamId}
          products={liveProducts}
          initialProductId={commerceProductId}
          viewerId={user?.id ?? null}
          liveStatus={session?.status ?? null}
          onClose={() => setCommerceVisible(false)}
          onRefresh={refreshLiveProducts}
        />
      ) : null}

      <View
        style={[styles.inputRow, battleState && styles.battleInputRow, { bottom: composerBottom + 8 }]}
        onLayout={event => {
          const nextHeight = event.nativeEvent.layout.height;
          setComposerHeight(current =>
            Math.abs(current - nextHeight) < 1 ? current : nextHeight
          );
        }}
      >
        <LiveGiftButton
          onPress={() => { setCommerceVisible(false); setGiftSheetVisible(true); }}
          disabled={!user || session.status !== 'live' || !giftsEnabled || walletBalanceLoading}
        />
        <TextInput
          ref={inputRef}
          style={[styles.input, battleState && styles.battleInput]}
          value={chatInput}
          onChangeText={setChatInput}
          placeholder="Mensaje..."
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
  loadingScreen: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText:   { color: Colors.textSecondary, fontSize: FontSize.md },
  endedScreen:   { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  endedTitle:    { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  endedBtn:      { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  endedBtnText:  { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },

  container: { flex: 1, backgroundColor: '#050508' },
  videoStream:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  battleVideo:      { flex: 1, backgroundColor: '#000' },
  videoPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surface },
  keyboardDismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  waitingText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  topShade: { position: 'absolute', top: 0, left: 0, right: 0, height: 170, zIndex: 2 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 320, zIndex: 2 },
  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 68,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(20,20,25,0.65)',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(124,92,255,0.7)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: FontWeight.bold },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  hostInfo: { flex: 1 },
  hostName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  hostTitle: { color: 'rgba(255,255,255,0.65)', fontSize: 11 },
  headerMetric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerMetricText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold, maxWidth: SCREEN_WIDTH < 380 ? 58 : 82 },
  headerDivider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.16)' },
  liveBadge: { minWidth: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#FF2D55', borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  liveDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  titleBlock: { position: 'absolute', left: 16, right: 90, zIndex: 9 },
  streamTitle: { color: '#fff', fontSize: 24, fontWeight: FontWeight.bold },
  conversationChip: { marginTop: 10, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  conversationText: { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },

  statsRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: 4 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statText: { color: Colors.textSecondary, fontSize: 11 },

  errorBanner: { marginHorizontal: Spacing.md, backgroundColor: 'rgba(255,45,85,0.15)', borderRadius: Radius.sm, padding: Spacing.xs },
  errorText: { color: Colors.secondary, fontSize: 11, textAlign: 'center' },
  floatingReaction: { position: 'absolute', zIndex: 16, alignItems: 'center', marginLeft: -18 },
  floatingReactionEmoji: { fontSize: 31, textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  actionRail: { position: 'absolute', right: 12, top: SCREEN_HEIGHT * 0.28, gap: 12, zIndex: 9 },
  actionButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  actionButtonDisabled: { opacity: 0.6 },
  battleActionRail: { top: undefined, bottom: 108, gap: 8, alignItems: 'center' },
  battleActionButton: { width: 48, height: 48, borderRadius: 24, gap: 1, backgroundColor: 'rgba(9,10,18,0.74)', borderColor: 'rgba(255,255,255,0.12)' },
  battleActionLabel: { color: '#FFF', fontSize: 8, lineHeight: 10, fontWeight: FontWeight.semibold },
  hostInvitePanel: {
    position: 'absolute',
    left: 16,
    right: 84,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 13,
    paddingRight: 6,
    backgroundColor: 'rgba(0,0,0,0.56)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    zIndex: 12,
  },
  hostInviteText: { flex: 1, color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  hostInviteBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hostInviteRejectBtn: { backgroundColor: 'rgba(255,255,255,0.16)' },
  hostInviteAcceptBtn: { backgroundColor: Colors.primary },
  cohostStatusPanel: { position: 'absolute', left: 16, flexDirection: 'row', alignItems: 'center', gap: 7, zIndex: 10 },
  cohostSelfBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cohostSelfBtnActive: { backgroundColor: 'rgba(124,92,255,0.76)' },
  cohostSelfBtnLocked: { backgroundColor: 'rgba(255,45,85,0.72)' },
  floorBadge: { minWidth: 34, height: 34, borderRadius: 17, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.42)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  floorBadgeMuted: { minWidth: 34, height: 34, borderRadius: 17, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', opacity: 0.82 },
  floorBadgeText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  coHostStrip: { position: 'absolute', right: 12, bottom: 202, width: 138, gap: 12, zIndex: 8 },
  coHostTile: { width: 138, height: 104, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1.5, borderColor: 'rgba(236,72,153,0.62)' },
  coHostVideo: { flex: 1 },
  coHostMic: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center' },
  coHostName: { position: 'absolute', left: 8, bottom: 7, color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  bottomSection: {
    position: 'absolute',
    left: 0,
    right: 0,
    maxHeight: 360,
    zIndex: 7,
  },
  battleBottomSection: { right: 76, maxHeight: 154 },
  chatList: {
    flex: 1,
    maxHeight: SCREEN_HEIGHT * 0.34,
    width: SCREEN_WIDTH * 0.56,
    marginLeft: 12,
  },
  battleChatList: { width: '100%', maxHeight: 154, marginLeft: 4 },

  inputRow: { position: 'absolute', left: 12, right: 12, minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 20, elevation: 20 },
  input: { flex: 1, height: 58, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: Radius.full, paddingHorizontal: 18, color: '#fff', fontSize: FontSize.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  battleInputRow: { minHeight: 50, paddingHorizontal: 0, borderRadius: 25, backgroundColor: 'rgba(9,10,18,0.82)' },
  battleInput: { height: 50, backgroundColor: 'transparent', borderWidth: 0 },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
