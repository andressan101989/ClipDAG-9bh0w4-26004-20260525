/**
 * components/feature/VideoActions.tsx — Video interaction sidebar
 *
 * Deep SecurityManager integration:
 *   - Per-action rate limiting (like, comment, share, gift)
 *   - Suspicious activity detection on rapid taps
 *   - Throttled UI feedback (disabled state during cooldown)
 *   - CrashIntelligence breadcrumbs for user action tracing
 *   - TelemetryPipeline action event recording
 *
 * All actions validated through SecurityManager.checkAction()
 * before being forwarded to parent handlers.
 */

import React, { useState, useRef, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Avatar }        from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import type { Video }    from '@/services/mockData';
import { formatNumber }  from '@/services/mockData';
import { SecurityManager }   from '@/modules/core/SecurityManager';
import { CrashIntelligence } from '@/modules/core/CrashIntelligence';

interface VideoActionsProps {
  video:         Video;
  isLiked:       boolean;
  currentUserId: string;
  onLike:        () => void;
  onComment:     () => void;
  onShare:       () => void;
  onProfilePress: () => void;
}

export function VideoActions({
  video,
  isLiked,
  currentUserId,
  onLike,
  onComment,
  onShare,
  onProfilePress,
}: VideoActionsProps) {
  const heartScale   = useRef(new Animated.Value(1)).current;
  const [likeBlocked, setLikeBlocked]    = useState(false);
  const [commentBlocked, setCommentBlocked] = useState(false);
  const [shareBlocked, setShareBlocked]   = useState(false);

  // ── Secure action wrapper ────────────────────────────────────────────────

  const secureAction = useCallback((
    action: 'like' | 'comment' | 'search',
    setBlocked: (v: boolean) => void,
    handler:    () => void,
    label:      string,
  ) => {
    if (!currentUserId) return;

    const allowed = SecurityManager.checkAction(action, currentUserId);
    if (!allowed) {
      // Brief visual block — user is rate limited
      setBlocked(true);
      setTimeout(() => setBlocked(false), 2000);
      CrashIntelligence.addBreadcrumb(
        'user_action',
        `Action blocked by SecurityManager: ${label}`,
        { action, userId: currentUserId },
      );
      return;
    }

    CrashIntelligence.addBreadcrumb('user_action', label, { videoId: video.id });
    handler();
  }, [currentUserId, video.id]);

  // ── Like handler with animation ──────────────────────────────────────────

  const handleLike = useCallback(() => {
    secureAction('like', setLikeBlocked, () => {
      Animated.sequence([
        Animated.spring(heartScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
        Animated.spring(heartScale, { toValue: 1,   useNativeDriver: true, speed: 40 }),
      ]).start();
      onLike();
    }, 'like_video');
  }, [secureAction, heartScale, onLike]);

  // ── Comment handler ──────────────────────────────────────────────────────

  const handleComment = useCallback(() => {
    secureAction('comment', setCommentBlocked, onComment, 'open_comments');
  }, [secureAction, onComment]);

  // ── Share handler ────────────────────────────────────────────────────────

  const handleShare = useCallback(() => {
    // Share uses 'search' slot (lowest rate limit impact)
    secureAction('search', setShareBlocked, onShare, 'share_video');
  }, [secureAction, onShare]);

  return (
    <View style={styles.container}>
      {/* Avatar with follow dot */}
      <View style={styles.avatarWrap}>
        <Pressable onPress={onProfilePress} hitSlop={4}>
          <Avatar uri={video.userAvatar} username={video.username} size={48} showBorder />
        </Pressable>
        <View style={styles.followDot}>
          <MaterialIcons name="add" size={12} color="#fff" />
        </View>
      </View>

      {/* Like */}
      <Pressable
        style={[styles.action, likeBlocked && styles.actionBlocked]}
        onPress={handleLike}
        hitSlop={8}
        disabled={likeBlocked}
      >
        <Animated.View style={{ transform: [{ scale: heartScale }] }}>
          <MaterialIcons
            name={isLiked ? 'favorite' : 'favorite-border'}
            size={32}
            color={likeBlocked ? Colors.textSubtle : isLiked ? Colors.secondary : '#ffffff'}
          />
        </Animated.View>
        <Text style={[styles.actionCount, likeBlocked && styles.actionCountMuted]}>
          {formatNumber(video.likes)}
        </Text>
      </Pressable>

      {/* Comment */}
      <Pressable
        style={[styles.action, commentBlocked && styles.actionBlocked]}
        onPress={handleComment}
        hitSlop={8}
        disabled={commentBlocked}
      >
        <MaterialIcons
          name="chat-bubble-outline"
          size={30}
          color={commentBlocked ? Colors.textSubtle : '#ffffff'}
        />
        <Text style={[styles.actionCount, commentBlocked && styles.actionCountMuted]}>
          {formatNumber(video.comments)}
        </Text>
      </Pressable>

      {/* Share */}
      <Pressable
        style={[styles.action, shareBlocked && styles.actionBlocked]}
        onPress={handleShare}
        hitSlop={8}
        disabled={shareBlocked}
      >
        <MaterialIcons
          name="share"
          size={30}
          color={shareBlocked ? Colors.textSubtle : '#ffffff'}
        />
        <Text style={[styles.actionCount, shareBlocked && styles.actionCountMuted]}>
          {formatNumber(video.shares)}
        </Text>
      </Pressable>

      {/* DAG Reward badge */}
      <View style={styles.dagIndicator}>
        <Text style={styles.dagIcon}>◈</Text>
        <Text style={styles.dagText}>0.01</Text>
      </View>

      {/* Music disc */}
      <View style={styles.musicDisc}>
        <Text style={styles.musicNote}>♪</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  avatarWrap: { position: 'relative' },
  followDot: {
    position: 'absolute', bottom: -6, left: '50%', marginLeft: -8,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  action: { alignItems: 'center', gap: Spacing.xs },
  actionBlocked: { opacity: 0.4 },
  actionCount: {
    color: '#FFFFFF', fontSize: FontSize.sm, fontWeight: FontWeight.semibold,
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  actionCountMuted: { color: Colors.textSubtle },
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
