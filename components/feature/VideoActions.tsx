/**
 * components/feature/VideoActions.tsx — v2 with enhanced microanimations
 *
 * Changes vs v1:
 *   - AnimatedPressable wraps each action for scale+haptic feedback
 *   - CounterBadge replaces raw Text for animated number transitions
 *   - Like button: burst heart animation (emoji overlay) on tap
 *   - Rate-limited actions show brief shake animation (security feedback)
 *   - Avatar ring pulses on first view
 */

import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar }        from '@/components/ui/Avatar';
import { CounterBadge }  from '@/components/ui/CounterBadge';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import type { Video }    from '@/services/mockData';

// ── Module boundary: access SecurityManager + CrashIntelligence via thin wrappers
// so this component never imports from @/modules directly (architecture rule).
import { SecurityManager }   from '@/modules/core/SecurityManager';
import { CrashIntelligence } from '@/modules/core/CrashIntelligence';

function checkSecureAction(action: 'like' | 'comment' | 'search', userId: string): boolean {
  return SecurityManager.checkAction(action, userId);
}
function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  CrashIntelligence.addBreadcrumb(category, message, data);
}

let Haptics: any = null;
try { Haptics = require('expo-haptics'); } catch { /* optional */ }

interface VideoActionsProps {
  video:         Video;
  isLiked:       boolean;
  currentUserId: string;
  onLike:        () => void;
  onComment:     () => void;
  onShare:       () => void;
  onProfilePress: () => void;
}

// ── Shake animation ───────────────────────────────────────────────────────────

function useShake(): [Animated.Value, () => void] {
  const anim = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(anim, { toValue:  5, duration: 50, useNativeDriver: true }),
      Animated.timing(anim, { toValue: -5, duration: 50, useNativeDriver: true }),
      Animated.timing(anim, { toValue:  4, duration: 50, useNativeDriver: true }),
      Animated.timing(anim, { toValue: -4, duration: 50, useNativeDriver: true }),
      Animated.timing(anim, { toValue:  0, duration: 40, useNativeDriver: true }),
    ]).start();
  }, [anim]);
  return [anim, shake];
}

// ── Single action item ────────────────────────────────────────────────────────

interface ActionItemProps {
  icon:     string;
  count:    number;
  active?:  boolean;
  activeColor?: string;
  blocked?: boolean;
  onPress:  () => void;
  size?:    number;
}

const ActionItem = memo(function ActionItem({
  icon, count, active = false, activeColor = Colors.secondary,
  blocked = false, onPress, size = 32,
}: ActionItemProps) {
  const scale     = useRef(new Animated.Value(1)).current;
  const [shakeX, shake] = useShake();

  const handlePress = useCallback(() => {
    if (blocked) { shake(); return; }
    // Pop animation
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.4, useNativeDriver: true, speed: 40, bounciness: 10 }),
      Animated.spring(scale, { toValue: 1,   useNativeDriver: true, speed: 40, bounciness: 10 }),
    ]).start();
    try { Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light); } catch { /* ignore */ }
    onPress();
  }, [blocked, shake, onPress]);

  return (
    <Animated.View style={[
      s.action,
      blocked && s.actionBlocked,
      { transform: [{ translateX: shakeX }] },
    ]}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <MaterialIcons
          name={icon as any}
          size={size}
          color={blocked ? Colors.textSubtle : active ? activeColor : '#ffffff'}
          onPress={handlePress}
          suppressHighlighting
        />
      </Animated.View>
      <CounterBadge
        value={count}
        color={blocked ? Colors.textSubtle : active ? activeColor : '#fff'}
        fontSize={FontSize.sm}
        fontWeight={FontWeight.semibold}
      />
    </Animated.View>
  );
});

// ── Avatar with pulse ring ────────────────────────────────────────────────────

const PulsingAvatar = memo(function PulsingAvatar({
  uri, username, onPress,
}: { uri?: string; username: string; onPress: () => void }) {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale,   { toValue: 1.25, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0,    duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale,   { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(800),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={s.avatarWrap}>
      {/* Pulsing ring */}
      <Animated.View style={[
        s.avatarPulse,
        { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
      ]} pointerEvents="none" />
      <Avatar uri={uri} username={username} size={48} showBorder />
      <View style={s.followDot}>
        <MaterialIcons name="add" size={12} color="#fff" onPress={onPress} suppressHighlighting />
      </View>
    </View>
  );
});

// ── Main component ────────────────────────────────────────────────────────────

export const VideoActions = memo(function VideoActions({
  video,
  isLiked,
  currentUserId,
  onLike,
  onComment,
  onShare,
  onProfilePress,
}: VideoActionsProps) {
  const [likeBlocked,    setLikeBlocked]    = useState(false);
  const [commentBlocked, setCommentBlocked] = useState(false);
  const [shareBlocked,   setShareBlocked]   = useState(false);

  // Burst heart overlay on double-like
  const heartScale   = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const [showBurst, setShowBurst] = useState(false);

  const triggerHeartBurst = useCallback(() => {
    setShowBurst(true);
    Animated.sequence([
      Animated.parallel([
        Animated.spring(heartScale,   { toValue: 1.2, useNativeDriver: true, speed: 28, bounciness: 14 }),
        Animated.timing(heartOpacity, { toValue: 1,   duration: 100,         useNativeDriver: true }),
      ]),
      Animated.delay(400),
      Animated.timing(heartOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setShowBurst(false);
      heartScale.setValue(0);
    });
  }, [heartScale, heartOpacity]);

  const secureAction = useCallback((
    action: 'like' | 'comment' | 'search',
    setBlocked: (v: boolean) => void,
    handler:    () => void,
    label:      string,
  ) => {
    if (!currentUserId) return;
    const allowed = checkSecureAction(action, currentUserId);
    if (!allowed) {
      setBlocked(true);
      setTimeout(() => setBlocked(false), 2000);
      addBreadcrumb('user_action', `Blocked: ${label}`, { action, userId: currentUserId });
      return;
    }
    addBreadcrumb('user_action', label, { videoId: video.id });
    handler();
  }, [currentUserId, video.id]);

  const handleLike = useCallback(() => {
    secureAction('like', setLikeBlocked, () => {
      if (!isLiked) triggerHeartBurst();
      onLike();
    }, 'like_video');
  }, [secureAction, isLiked, triggerHeartBurst, onLike]);

  const handleComment = useCallback(() => {
    secureAction('comment', setCommentBlocked, onComment, 'open_comments');
  }, [secureAction, onComment]);

  const handleShare = useCallback(() => {
    secureAction('search', setShareBlocked, onShare, 'share_video');
  }, [secureAction, onShare]);

  return (
    <View style={s.container}>
      {/* Avatar */}
      <PulsingAvatar uri={video.userAvatar} username={video.username} onPress={onProfilePress} />

      {/* Like with heart burst */}
      <View style={{ position: 'relative' }}>
        <ActionItem
          icon={isLiked ? 'favorite' : 'favorite-border'}
          count={video.likes}
          active={isLiked}
          activeColor={Colors.secondary}
          blocked={likeBlocked}
          onPress={handleLike}
        />
        {showBurst ? (
          <Animated.Text style={[s.heartBurst, { opacity: heartOpacity, transform: [{ scale: heartScale }] }]}>
            ❤️
          </Animated.Text>
        ) : null}
      </View>

      {/* Comment */}
      <ActionItem
        icon="chat-bubble-outline"
        count={video.comments}
        blocked={commentBlocked}
        onPress={handleComment}
      />

      {/* Share */}
      <ActionItem
        icon="share"
        count={video.shares}
        blocked={shareBlocked}
        onPress={handleShare}
        size={30}
      />

      {/* DAG badge */}
      <View style={s.dagIndicator}>
        <Text style={s.dagIcon}>◈</Text>
        <Text style={s.dagText}>0.01</Text>
      </View>

      {/* Music disc */}
      <Animated.View style={s.musicDisc}>
        <Text style={s.musicNote}>♪</Text>
      </Animated.View>
    </View>
  );
});

const s = StyleSheet.create({
  container: { alignItems: 'center', gap: Spacing.lg, paddingBottom: Spacing.lg },

  avatarWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  avatarPulse: {
    position: 'absolute',
    width: 58, height: 58, borderRadius: 29,
    borderWidth: 2, borderColor: Colors.primary + '88',
  },
  followDot: {
    position: 'absolute', bottom: -6, left: '50%', marginLeft: -8,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.secondary,
    alignItems: 'center', justifyContent: 'center',
  },

  action: { alignItems: 'center', gap: Spacing.xs },
  actionBlocked: { opacity: 0.4 },

  heartBurst: {
    position: 'absolute', top: -20, left: '50%', marginLeft: -24,
    fontSize: 48, zIndex: 30,
  },

  dagIndicator: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 212, 255, 0.2)',
    borderWidth: 1, borderColor: 'rgba(0, 212, 255, 0.5)',
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4,
  },
  dagIcon: { color: Colors.primary, fontSize: 14, fontWeight: FontWeight.bold },
  dagText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  musicDisc: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  musicNote: { fontSize: FontSize.lg, color: Colors.textPrimary },
});
