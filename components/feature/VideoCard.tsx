/**
 * components/feature/VideoCard.tsx — Web stub (no expo-video)
 *
 * expo-video has no web build. Metro bundler auto-selects:
 *   • VideoCard.native.tsx  → iOS / Android (full expo-video implementation)
 *   • VideoCard.tsx         → Web (this stub — image-only, no video player)
 */
import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import { formatNumber } from '@/services/mockData';

// ── Re-export height constants ────────────────────────────────────────────────
export const STORIES_BAR_HEIGHT = 100;
export const TAB_BAR_HEIGHT = 62;
export const VIDEO_CARD_HEIGHT = Dimensions.get('window').height;

export function getVideoCardHeight(): number {
  return Dimensions.get('window').height;
}

// ── Types (mirror native) ─────────────────────────────────────────────────────
export interface VideoCardProps {
  video: any;
  isActive: boolean;
  isLiked: boolean;
  isSaved?: boolean;
  isFollowing: boolean;
  currentUserDagBalance?: number;
  currentUserId?: string;
  onLike: () => void;
  onComment: () => void;
  onFollow: () => void;
  onSave?: () => void;
  onProfilePress: () => void;
  onSendGift?: (recipientId: string, videoId: string | null, giftType: string, dagValue: number) => Promise<{ success: boolean; error?: string }>;
  onViewTracked?: (watchDurationMs: number, completed: boolean) => void;
}

// ── Web card — static image preview (no video playback) ──────────────────────
export const VideoCard = memo(function VideoCard(props: VideoCardProps) {
  const { video, isLiked, isSaved = false, isFollowing, onLike, onComment, onFollow, onSave, onProfilePress } = props;
  const { width: W } = Dimensions.get('window');
  const mediaUrl = video.thumbnailUrl || video.videoUrl || '';
  const isVideoMedia = /\.(mp4|mov|avi|mkv|webm)/i.test(mediaUrl);

  return (
    <View style={[sty.card, { width: W }]}>
      {/* Header */}
      <View style={sty.header}>
        <Pressable onPress={onProfilePress} style={sty.headerLeft}>
          <Avatar uri={video.userAvatar} username={video.username} size={36} />
          <View>
            <Text style={sty.username}>@{video.username}</Text>
          </View>
        </Pressable>
        {!isFollowing ? (
          <Pressable onPress={onFollow}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={sty.followBtn}>
              <Text style={sty.followBtnText}>Seguir</Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable onPress={onFollow} style={sty.followingBtn}>
            <Text style={sty.followingBtnText}>Siguiendo</Text>
          </Pressable>
        )}
      </View>

      {/* Media (static) */}
      <View style={[sty.media, { height: W }]}>
        {mediaUrl ? (
          <Image source={{ uri: mediaUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, sty.placeholder]}>
            <MaterialIcons name="videocam-off" size={40} color={Colors.textSubtle} />
          </View>
        )}
        {/* Video indicator overlay */}
        {isVideoMedia ? (
          <View style={sty.videoIndicator}>
            <MaterialCommunityIcons name="play-circle-outline" size={48} color="rgba(255,255,255,0.85)" />
            <Text style={sty.webNote}>Vista previa — Usa la app móvil para ver video</Text>
          </View>
        ) : null}
      </View>

      {/* Actions */}
      <View style={sty.actions}>
        <View style={sty.actionsLeft}>
          <Pressable onPress={onLike} style={sty.actionBtn} hitSlop={8}>
            <MaterialIcons name={isLiked ? 'favorite' : 'favorite-border'} size={26} color={isLiked ? Colors.secondary : Colors.textPrimary} />
            <Text style={sty.actionCount}>{formatNumber(video.likes || 0)}</Text>
          </Pressable>
          <Pressable onPress={onComment} style={sty.actionBtn} hitSlop={8}>
            <MaterialCommunityIcons name="comment-outline" size={24} color={Colors.textPrimary} />
            <Text style={sty.actionCount}>{formatNumber(video.comments || 0)}</Text>
          </Pressable>
        </View>
        <Pressable onPress={onSave} hitSlop={8}>
          <MaterialCommunityIcons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={25} color={isSaved ? Colors.primary : Colors.textPrimary} />
        </Pressable>
      </View>

      {video.caption ? (
        <View style={sty.caption}>
          <Text style={sty.captionUser}>@{video.username} </Text>
          <Text style={sty.captionText}>{video.caption}</Text>
        </View>
      ) : null}
    </View>
  );
});

const sty = StyleSheet.create({
  card:        { backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle, paddingBottom: Spacing.sm },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  username:    { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  followBtn:   { paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full },
  followBtnText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  followingBtn:{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  followingBtnText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  media:       { backgroundColor: Colors.surface, position: 'relative' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  videoIndicator: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)', gap: 12 },
  webNote:     { color: 'rgba(255,255,255,0.7)', fontSize: FontSize.xs, textAlign: 'center', paddingHorizontal: 20 },
  actions:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 4 },
  actionsLeft: { flexDirection: 'row', gap: Spacing.md },
  actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionCount: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  caption:     { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.md, marginTop: 2 },
  captionUser: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  captionText: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19 },
});
