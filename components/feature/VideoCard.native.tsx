import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View, Text, Pressable, StyleSheet, Dimensions, Animated, Share,
  FlatList, NativeScrollEvent, NativeSyntheticEvent,
} from 'react-native';
// expo-video — lazy-loaded to prevent Hermes crash from dynamic import() syntax
// in expo-video's internal JS when bundled for iOS.
// Static import of expo-video triggers: "Invalid expression encountered" (main.jsbundle)
let VideoView: any = null;
let _useVideoPlayer: any = (_src: any, _setup?: any): any => null;
try {
  const ev = require('expo-video');
  VideoView       = ev.VideoView      ?? null;
  _useVideoPlayer = ev.useVideoPlayer ?? ((_src: any, _setup?: any) => null);
} catch { /* web / preview — no native build */ }
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from '@/components/ui/SafeImage';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { GiftSheet } from '@/components/feature/GiftSheet';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import { Video, formatNumber } from '@/services/mockData';

// ── Height exports ────────────────────────────────────────────────────────────
export const STORIES_BAR_HEIGHT = 100;
export const TAB_BAR_HEIGHT = 62;
// Video reels occupy the FULL screen height for a truly immersive experience.
// The header + stories bar will fade out when a reel is active (handled in index.tsx).
export const VIDEO_CARD_HEIGHT = Dimensions.get('window').height;

export function getVideoCardHeight(): number {
  return Dimensions.get('window').height;
}

// ── MODULE-LEVEL GLOBAL PLAYER LOCK ──────────────────────────────────────────
interface ManagedPlayer { muted: boolean; pause(): void; play(): void; }
let _activePlayer: ManagedPlayer | null = null;
let _sessionMuted = true;

function acquirePlayerLock(incoming: ManagedPlayer): void {
  if (_activePlayer && _activePlayer !== incoming) {
    try { _activePlayer.muted = true; } catch (_) {}
    try { _activePlayer.pause(); } catch (_) {}
  }
  _activePlayer = incoming;
}

function releasePlayerLock(player: ManagedPlayer): void {
  if (_activePlayer === player) {
    try { player.muted = true; } catch (_) {}
    try { player.pause(); } catch (_) {}
    _activePlayer = null;
  }
}

// ── Media type detection ──────────────────────────────────────────────────────
function isVideoMedia(url: string): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  if (
    clean.includes('gtv-videos-bucket') ||
    clean.includes('commondatastorage.googleapis.com') ||
    clean.includes('/videos/')
  ) return true;
  const ext = clean.split('.').pop() || '';
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'quicktime', 'm4v'].includes(ext);
}

function isValidUrl(url: string): boolean {
  return !!url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://'));
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface VideoCardProps {
  video: Video;
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

// ── Animated action button (memoized) ────────────────────────────────────────
interface ActionBtnProps {
  icon?: string;
  materialIcon?: string;
  emoji?: string;
  count?: string | number;
  label?: string;
  active?: boolean;
  activeColor?: string;
  size?: number;
  onPress: () => void;
}

const ActionBtn = memo(function ActionBtn({
  icon, materialIcon, emoji, count, label,
  active, activeColor = Colors.secondary, size = 24, onPress,
}: ActionBtnProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, speed: 60, bounciness: 12 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }),
    ]).start();
    onPress();
  }, [onPress, scale]);

  return (
    <Pressable style={styles.actionBtn} onPress={handlePress} hitSlop={8}>
      <Animated.View style={[
        styles.actionIconWrap,
        active ? { backgroundColor: activeColor + '22' } : null,
        { transform: [{ scale }] },
      ]}>
        {emoji ? (
          <Text style={{ fontSize: size }}>{emoji}</Text>
        ) : materialIcon ? (
          <MaterialCommunityIcons name={materialIcon as any} size={size} color={active ? activeColor : 'rgba(255,255,255,0.92)'} />
        ) : (
          <MaterialIcons name={icon as any} size={size} color={active ? activeColor : 'rgba(255,255,255,0.92)'} />
        )}
      </Animated.View>
      {(count !== undefined || label) ? (
        <Text style={[styles.actionLabel, active ? { color: activeColor } : null]}>
          {count !== undefined ? (typeof count === 'number' ? formatNumber(count) : count) : label}
        </Text>
      ) : null}
    </Pressable>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CAROUSEL DOT INDICATOR
// ─────────────────────────────────────────────────────────────────────────────
const CarouselDots = memo(function CarouselDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  if (count <= 1) return null;
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]}
        />
      ))}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// REEL OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
interface ReelOverlayProps {
  video: Video;
  isLiked: boolean;
  isSaved: boolean;
  isFollowing: boolean;
  cardHeight: number;
  currentUserDagBalance: number;
  currentUserId: string;
  onLike: () => void;
  onComment: () => void;
  onFollow: () => void;
  onSave: () => void;
  onProfilePress: () => void;
  onShare: () => void;
  onGiftSend?: (recipientId: string, videoId: string | null, giftType: string, dagValue: number) => Promise<{ success: boolean; error?: string }>;
  extraControls?: React.ReactNode;
}

const ReelOverlay = memo(function ReelOverlay({
  video, isLiked, isSaved, isFollowing, cardHeight,
  currentUserDagBalance, currentUserId,
  onLike, onComment, onFollow, onSave, onProfilePress, onShare, onGiftSend,
  extraControls,
}: ReelOverlayProps) {
  const [giftVisible, setGiftVisible] = useState(false);
  const openGift = useCallback(() => setGiftVisible(true), []);
  const closeGift = useCallback(() => setGiftVisible(false), []);

  return (
    <>
      <LinearGradient
        colors={['transparent', 'rgba(10,10,15,0.45)', 'rgba(10,10,15,0.97)']}
        locations={[0.25, 0.62, 1]}
        style={[StyleSheet.absoluteFillObject, { top: cardHeight * 0.35 }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(10,10,15,0.45)', 'transparent']}
        style={[StyleSheet.absoluteFillObject, { bottom: cardHeight * 0.82 }]}
        pointerEvents="none"
      />

      <View style={[styles.reelBottomArea, { paddingBottom: TAB_BAR_HEIGHT + 16 }]} pointerEvents="box-none">
        <View style={styles.reelInfoArea} pointerEvents="box-none">
          <Pressable onPress={onProfilePress} style={styles.reelUserRow}>
            <View style={styles.avatarGlow}>
              <Avatar uri={video.userAvatar} username={video.username} size={42} showBorder />
            </View>
            <View style={styles.userMeta}>
              <Text style={styles.reelUsername}>@{video.username}</Text>
              {!isFollowing ? (
                <Pressable onPress={onFollow} style={styles.followPill} hitSlop={6}>
                  <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.followPillGradient}>
                    <Text style={styles.followPillText}>Seguir</Text>
                  </LinearGradient>
                </Pressable>
              ) : (
                <Pressable onPress={onFollow} style={styles.followPillFollowing} hitSlop={6}>
                  <MaterialIcons name="check" size={10} color={Colors.accent} />
                  <Text style={styles.followPillFollowingText}>Siguiendo</Text>
                </Pressable>
              )}
            </View>
          </Pressable>

          {video.caption ? <Text style={styles.reelCaption} numberOfLines={2}>{video.caption}</Text> : null}

          <View style={styles.musicRow}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.musicDisc}>
              <MaterialCommunityIcons name="music-note" size={10} color="#fff" />
            </LinearGradient>
            <Text style={styles.musicText} numberOfLines={1}>{video.music || 'Sin musica'}</Text>
          </View>

          <View style={styles.dagPill}>
            <LinearGradient colors={['#7C5CFF33', '#FF2D7822']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.dagPillGrad}>
              <Text style={styles.dagPillIcon}>◈</Text>
              <Text style={styles.dagPillText}>0.01 $DAG / like</Text>
            </LinearGradient>
          </View>
        </View>

        <View style={styles.reelActionsCol}>
          {extraControls}
          <ActionBtn icon={isLiked ? 'favorite' : 'favorite-border'} count={video.likes} active={isLiked} activeColor={Colors.secondary} onPress={onLike} />
          <ActionBtn icon="chat-bubble-outline" count={video.comments} onPress={onComment} />
          <ActionBtn materialIcon={isSaved ? 'bookmark' : 'bookmark-outline'} label="Guardar" active={isSaved} activeColor={Colors.primary} onPress={onSave} />
          <ActionBtn materialIcon="share-variant-outline" count={video.shares} onPress={onShare} />
          {onGiftSend && currentUserId !== video.userId ? (
            <ActionBtn emoji="🎁" label="Gift" onPress={openGift} />
          ) : null}
          <View style={styles.dagBadge}>
            <Text style={styles.dagBadgeSymbol}>◈</Text>
            <Text style={styles.dagBadgeLabel}>DAG</Text>
          </View>
        </View>
      </View>

      {onGiftSend ? (
        <GiftSheet
          visible={giftVisible}
          recipientUsername={video.username}
          recipientId={video.userId}
          videoId={video.id}
          currentDagBalance={currentUserDagBalance}
          onClose={closeGift}
          onSend={onGiftSend}
        />
      ) : null}
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CAROUSEL SLIDE — one media item inside a carousel
// ─────────────────────────────────────────────────────────────────────────────
interface CarouselSlideProps {
  uri: string;
  width: number;
  isActive: boolean;
  aspectRatio: number;
}

const CarouselSlide = memo(function CarouselSlide({ uri, width, isActive: _isActive, aspectRatio }: CarouselSlideProps) {
  const isVideo = isVideoMedia(uri);
  const height = width * aspectRatio;
  const [error, setError] = useState(false);

  const player = _useVideoPlayer(isVideo && isValidUrl(uri) ? uri : '', p => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!isVideo || !isValidUrl(uri)) return;
    // Carousel video slides always stay muted/paused for performance
    try { player.muted = true; player.pause(); } catch (_) {}
  }, []);

  if (!isValidUrl(uri) || error) {
    return (
      <View style={[styles.carouselSlideError, { width, height }]}>
        <MaterialIcons name="broken-image" size={40} color={Colors.textSubtle} />
      </View>
    );
  }

  if (isVideo) {
    return (
      <View style={{ width, height, backgroundColor: '#000' }}>
        <VideoView
          player={player}
          style={{ width, height }}
          contentFit="cover"
          nativeControls={false}
        />
        <View style={styles.carouselVideoIndicator} pointerEvents="none">
          <MaterialCommunityIcons name="play-circle-outline" size={32} color="rgba(255,255,255,0.85)" />
        </View>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width, height }}
      contentFit="cover"
      transition={150}
      onError={() => setError(true)}
    />
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTAGRAM POST CARD — single image
// ─────────────────────────────────────────────────────────────────────────────
const InstagramPostCard = memo(function InstagramPostCard(props: VideoCardProps) {
  const {
    video, isLiked, isSaved = false, isFollowing,
    currentUserDagBalance = 0, currentUserId = '',
    onLike, onComment, onFollow, onSave = () => {}, onProfilePress, onSendGift,
  } = props;

  const [giftVisible, setGiftVisible] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [likedScale] = useState(new Animated.Value(1));
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const heartAnim = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);

  const { width: SCREEN_W } = Dimensions.get('window');
  const mediaUrl = video.thumbnailUrl || video.videoUrl;
  const hasValidImage = isValidUrl(mediaUrl) && !imgError;

  const computedHeight = React.useMemo(() => {
    if (imgDims.w > 0 && imgDims.h > 0) {
      const ratio = imgDims.h / imgDims.w;
      return SCREEN_W * Math.min(1.25, Math.max(0.8, ratio));
    }
    return SCREEN_W;
  }, [imgDims.w, imgDims.h, SCREEN_W]);

  const handleImageLoad = useCallback((e: any) => {
    const { width, height } = e.source || {};
    if (width && height) setImgDims({ w: width, h: height });
  }, []);

  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      setShowDoubleTapHeart(true);
      Animated.sequence([
        Animated.spring(heartAnim, { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 14 }),
        Animated.delay(480),
        Animated.timing(heartAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(() => setShowDoubleTapHeart(false));
      if (!isLiked) onLike();
    }
    lastTap.current = now;
  }, [isLiked, onLike, heartAnim]);

  const handleShare = useCallback(async () => {
    try { await Share.share({ message: `Mira esta foto de @${video.username} en ClipDAG - https://clipdag.io` }); } catch (_) {}
  }, [video.username]);

  const animateLike = useCallback(() => {
    Animated.sequence([
      Animated.spring(likedScale, { toValue: 1.3, useNativeDriver: true, speed: 50, bounciness: 14 }),
      Animated.spring(likedScale, { toValue: 1, useNativeDriver: true, speed: 50 }),
    ]).start();
    onLike();
  }, [onLike, likedScale]);

  return (
    <View style={[styles.postCard, { width: SCREEN_W }]}>
      {/* Header */}
      <View style={styles.postHeader}>
        <Pressable onPress={onProfilePress} style={styles.postHeaderLeft} hitSlop={4}>
          <View style={styles.postAvatarRing}>
            <Avatar uri={video.userAvatar} username={video.username} size={38} />
          </View>
          <View style={styles.postHeaderMeta}>
            <Text style={styles.postUsername}>@{video.username}</Text>
            {video.music && video.music !== 'Sin musica' ? (
              <View style={styles.postSubRow}>
                <MaterialCommunityIcons name="music-note" size={10} color={Colors.primary} />
                <Text style={styles.postMusicName} numberOfLines={1}>{video.music}</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.postHeaderRight}>
          {!isFollowing ? (
            <Pressable onPress={onFollow} hitSlop={6}>
              <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.postFollowBtn}>
                <Text style={styles.postFollowBtnText}>Seguir</Text>
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable onPress={onFollow} style={styles.postFollowingBtn} hitSlop={6}>
              <MaterialIcons name="check" size={11} color={Colors.accent} />
              <Text style={styles.postFollowingBtnText}>Siguiendo</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Media */}
      <Pressable onPress={handleDoubleTap} activeOpacity={1}>
        <View style={{ width: SCREEN_W, height: computedHeight, backgroundColor: Colors.surface }}>
          {hasValidImage ? (
            <Image
              source={{ uri: mediaUrl }}
              style={{ width: SCREEN_W, height: computedHeight }}
              contentFit="cover"
              transition={200}
              onLoad={handleImageLoad}
              onError={() => setImgError(true)}
            />
          ) : (
            <View style={[styles.postImgPlaceholder, { height: computedHeight }]}>
              <MaterialIcons name="photo" size={44} color={Colors.textSubtle} />
            </View>
          )}
          {showDoubleTapHeart ? (
            <Animated.View
              style={[styles.doubleTapHeart, {
                opacity: heartAnim,
                transform: [{ scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.3] }) }],
              }]}
              pointerEvents="none"
            >
              <Text style={styles.doubleTapHeartEmoji}>❤️</Text>
            </Animated.View>
          ) : null}
          <View style={styles.postMediaBadge} pointerEvents="none">
            <MaterialIcons name="photo" size={10} color={Colors.blue} />
          </View>
        </View>
      </Pressable>

      {/* Action bar */}
      <View style={styles.postActionBar}>
        <View style={styles.postActionLeft}>
          <Pressable onPress={animateLike} hitSlop={8}>
            <Animated.View style={{ transform: [{ scale: likedScale }] }}>
              <MaterialIcons name={isLiked ? 'favorite' : 'favorite-border'} size={28} color={isLiked ? Colors.secondary : Colors.textPrimary} />
            </Animated.View>
          </Pressable>
          <Pressable onPress={onComment} hitSlop={8}>
            <MaterialCommunityIcons name="comment-outline" size={26} color={Colors.textPrimary} />
          </Pressable>
          <Pressable onPress={handleShare} hitSlop={8}>
            <MaterialCommunityIcons name="share-variant-outline" size={25} color={Colors.textPrimary} />
          </Pressable>
          {onSendGift && currentUserId !== video.userId ? (
            <Pressable onPress={() => setGiftVisible(true)} hitSlop={8}>
              <Text style={{ fontSize: 23 }}>🎁</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onSave} hitSlop={8}>
          <MaterialCommunityIcons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={27} color={isSaved ? Colors.primary : Colors.textPrimary} />
        </Pressable>
      </View>

      {/* Likes count */}
      <View style={styles.postLikesRow}>
        <Text style={styles.postLikesText}>{formatNumber(video.likes || 0)} Me gustas</Text>
      </View>

      {/* Caption */}
      {video.caption ? (
        <View style={styles.postCaptionRow}>
          <Text style={styles.postCaptionUsername}>@{video.username} </Text>
          <Text style={styles.postCaptionText}>{video.caption}</Text>
        </View>
      ) : null}

      {/* Comments preview */}
      {(video.comments || 0) > 0 ? (
        <Pressable onPress={onComment} style={styles.postCommentsPreview} hitSlop={4}>
          <Text style={styles.postCommentsPreviewText}>Ver {formatNumber(video.comments || 0)} comentarios</Text>
        </Pressable>
      ) : null}

      {/* DAG earn */}
      <View style={styles.postDagRow}>
        <LinearGradient colors={['#7C5CFF22', '#FF2D7811']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.postDagPill}>
          <Text style={styles.postDagIcon}>◈</Text>
          <Text style={styles.postDagText}>0.01 $DAG por like</Text>
        </LinearGradient>
      </View>

      {onSendGift ? (
        <GiftSheet
          visible={giftVisible}
          recipientUsername={video.username}
          recipientId={video.userId}
          videoId={video.id}
          currentDagBalance={currentUserDagBalance}
          onClose={() => setGiftVisible(false)}
          onSend={onSendGift}
        />
      ) : null}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CAROUSEL POST CARD — Instagram-style multi-image swipe
// ─────────────────────────────────────────────────────────────────────────────
const CarouselPostCard = memo(function CarouselPostCard(props: VideoCardProps) {
  const {
    video, isLiked, isSaved = false, isFollowing,
    currentUserDagBalance = 0, currentUserId = '',
    onLike, onComment, onFollow, onSave = () => {}, onProfilePress, onSendGift,
  } = props;

  const { width: SCREEN_W } = Dimensions.get('window');
  const [activeSlide, setActiveSlide] = useState(0);
  const [likedScale] = useState(new Animated.Value(1));
  const [giftVisible, setGiftVisible] = useState(false);
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const heartAnim = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);

  // Build media array from mediaUrls or fallback to single thumbnailUrl/videoUrl
  const mediaUrls: string[] = React.useMemo(() => {
    const extra = (video as any).mediaUrls as string[] | undefined;
    if (extra && extra.length > 1) return extra;
    const primary = video.thumbnailUrl || video.videoUrl;
    return primary ? [primary] : [];
  }, [video]);

  // Compute card height: Instagram square/portrait (0.8–1.25 ratio)
  const cardHeight = SCREEN_W; // Default 1:1 square for carousel

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setActiveSlide(Math.max(0, Math.min(idx, mediaUrls.length - 1)));
  }, [SCREEN_W, mediaUrls.length]);

  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      setShowDoubleTapHeart(true);
      Animated.sequence([
        Animated.spring(heartAnim, { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 14 }),
        Animated.delay(480),
        Animated.timing(heartAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(() => setShowDoubleTapHeart(false));
      if (!isLiked) onLike();
    }
    lastTap.current = now;
  }, [isLiked, onLike, heartAnim]);

  const animateLike = useCallback(() => {
    Animated.sequence([
      Animated.spring(likedScale, { toValue: 1.3, useNativeDriver: true, speed: 50, bounciness: 14 }),
      Animated.spring(likedScale, { toValue: 1, useNativeDriver: true, speed: 50 }),
    ]).start();
    onLike();
  }, [onLike, likedScale]);

  const handleShare = useCallback(async () => {
    try { await Share.share({ message: `Mira este post de @${video.username} en ClipDAG - https://clipdag.io` }); } catch (_) {}
  }, [video.username]);

  const renderSlide = useCallback(({ item }: { item: string }) => (
    <Pressable onPress={handleDoubleTap} activeOpacity={1}>
      <CarouselSlide uri={item} width={SCREEN_W} isActive={false} aspectRatio={1} />
    </Pressable>
  ), [SCREEN_W, handleDoubleTap]);

  return (
    <View style={[styles.postCard, { width: SCREEN_W }]}>
      {/* Header */}
      <View style={styles.postHeader}>
        <Pressable onPress={onProfilePress} style={styles.postHeaderLeft} hitSlop={4}>
          <View style={styles.postAvatarRing}>
            <Avatar uri={video.userAvatar} username={video.username} size={38} />
          </View>
          <View style={styles.postHeaderMeta}>
            <Text style={styles.postUsername}>@{video.username}</Text>
            {mediaUrls.length > 1 ? (
              <View style={styles.postSubRow}>
                <MaterialCommunityIcons name="image-multiple-outline" size={10} color={Colors.blue} />
                <Text style={[styles.postMusicName, { color: Colors.blue }]}>{mediaUrls.length} fotos</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.postHeaderRight}>
          {!isFollowing ? (
            <Pressable onPress={onFollow} hitSlop={6}>
              <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.postFollowBtn}>
                <Text style={styles.postFollowBtnText}>Seguir</Text>
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable onPress={onFollow} style={styles.postFollowingBtn} hitSlop={6}>
              <MaterialIcons name="check" size={11} color={Colors.accent} />
              <Text style={styles.postFollowingBtnText}>Siguiendo</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Carousel */}
      <View style={{ width: SCREEN_W, height: cardHeight }}>
        <FlatList
          data={mediaUrls}
          keyExtractor={(_, i) => `slide_${i}`}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
          decelerationRate="fast"
          snapToInterval={SCREEN_W}
          snapToAlignment="start"
          bounces={false}
          removeClippedSubviews
          maxToRenderPerBatch={2}
          windowSize={3}
        />

        {/* Double-tap heart */}
        {showDoubleTapHeart ? (
          <Animated.View
            style={[styles.doubleTapHeart, {
              opacity: heartAnim,
              transform: [{ scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.3] }) }],
            }]}
            pointerEvents="none"
          >
            <Text style={styles.doubleTapHeartEmoji}>❤️</Text>
          </Animated.View>
        ) : null}

        {/* Carousel counter badge top-right */}
        {mediaUrls.length > 1 ? (
          <View style={styles.carouselCountBadge} pointerEvents="none">
            <Text style={styles.carouselCountText}>{activeSlide + 1}/{mediaUrls.length}</Text>
          </View>
        ) : null}

        {/* Dot indicator */}
        <View style={styles.dotsWrap} pointerEvents="none">
          <CarouselDots count={mediaUrls.length} activeIndex={activeSlide} />
        </View>
      </View>

      {/* Action bar */}
      <View style={styles.postActionBar}>
        <View style={styles.postActionLeft}>
          <Pressable onPress={animateLike} hitSlop={8}>
            <Animated.View style={{ transform: [{ scale: likedScale }] }}>
              <MaterialIcons name={isLiked ? 'favorite' : 'favorite-border'} size={28} color={isLiked ? Colors.secondary : Colors.textPrimary} />
            </Animated.View>
          </Pressable>
          <Pressable onPress={onComment} hitSlop={8}>
            <MaterialCommunityIcons name="comment-outline" size={26} color={Colors.textPrimary} />
          </Pressable>
          <Pressable onPress={handleShare} hitSlop={8}>
            <MaterialCommunityIcons name="share-variant-outline" size={25} color={Colors.textPrimary} />
          </Pressable>
          {onSendGift && currentUserId !== video.userId ? (
            <Pressable onPress={() => setGiftVisible(true)} hitSlop={8}>
              <Text style={{ fontSize: 23 }}>🎁</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onSave} hitSlop={8}>
          <MaterialCommunityIcons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={27} color={isSaved ? Colors.primary : Colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.postLikesRow}>
        <Text style={styles.postLikesText}>{formatNumber(video.likes || 0)} Me gustas</Text>
      </View>

      {video.caption ? (
        <View style={styles.postCaptionRow}>
          <Text style={styles.postCaptionUsername}>@{video.username} </Text>
          <Text style={styles.postCaptionText}>{video.caption}</Text>
        </View>
      ) : null}

      {(video.comments || 0) > 0 ? (
        <Pressable onPress={onComment} style={styles.postCommentsPreview} hitSlop={4}>
          <Text style={styles.postCommentsPreviewText}>Ver {formatNumber(video.comments || 0)} comentarios</Text>
        </Pressable>
      ) : null}

      <View style={styles.postDagRow}>
        <LinearGradient colors={['#7C5CFF22', '#FF2D7811']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.postDagPill}>
          <Text style={styles.postDagIcon}>◈</Text>
          <Text style={styles.postDagText}>0.01 $DAG por like</Text>
        </LinearGradient>
      </View>

      {onSendGift ? (
        <GiftSheet
          visible={giftVisible}
          recipientUsername={video.username}
          recipientId={video.userId}
          videoId={video.id}
          currentDagBalance={currentUserDagBalance}
          onClose={() => setGiftVisible(false)}
          onSend={onSendGift}
        />
      ) : null}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO REEL CARD — full-screen TikTok-style
// ─────────────────────────────────────────────────────────────────────────────
const VideoReelCard = memo(function VideoReelCard(props: VideoCardProps) {
  const {
    video, isActive, isLiked, isSaved = false, isFollowing,
    currentUserDagBalance = 0, currentUserId = '',
    onLike, onComment, onFollow, onSave = () => {}, onProfilePress, onSendGift, onViewTracked,
  } = props;

  const [screenSize, setScreenSize] = useState(Dimensions.get('window'));
  // Full screen height — header fades out in feed when this reel is active
  const cardHeight = screenSize.height;

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreenSize(window));
    return () => sub.remove();
  }, []);

  const [isMuted, setIsMuted] = useState(_sessionMuted);
  const [isPaused, setIsPaused] = useState(false);
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const heartAnim = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);
  const viewStartRef = useRef<number | null>(null);
  const viewTrackedRef = useRef(false);

  const hasValidVideo = isValidUrl(video.videoUrl);
  const hasValidThumb = isValidUrl(video.thumbnailUrl) && !thumbError;

  const player = _useVideoPlayer(hasValidVideo ? video.videoUrl : '', p => {
    p.loop = true;
    p.muted = true;
  });

  const playerRef = useRef(player);
  useEffect(() => { playerRef.current = player; });

  // Strict single-player audio isolation
  useEffect(() => {
    if (!hasValidVideo) return;
    if (!isActive) {
      releasePlayerLock(player as unknown as ManagedPlayer);
      try { player.muted = true; } catch (_) {}
      try { player.pause(); } catch (_) {}
      setIsPaused(false);
    } else if (!isPaused) {
      acquirePlayerLock(player as unknown as ManagedPlayer);
      try { player.muted = isMuted; } catch (_) {}
      try { player.play(); } catch (_) {}
    } else {
      releasePlayerLock(player as unknown as ManagedPlayer);
      try { player.muted = true; } catch (_) {}
      try { player.pause(); } catch (_) {}
    }
  }, [isActive, isPaused, hasValidVideo]);

  // Sync mute
  useEffect(() => {
    if (!hasValidVideo || !isActive || isPaused) return;
    try { player.muted = isMuted; } catch (_) {}
    _sessionMuted = isMuted;
  }, [isMuted, hasValidVideo, isActive, isPaused]);

  // View tracking
  useEffect(() => {
    if (isActive) {
      viewStartRef.current = Date.now();
      viewTrackedRef.current = false;
    } else if (viewStartRef.current && !viewTrackedRef.current) {
      viewTrackedRef.current = true;
      onViewTracked?.(Date.now() - viewStartRef.current, false);
      viewStartRef.current = null;
    }
  }, [isActive]);

  // Hard stop on unmount
  useEffect(() => {
    return () => { releasePlayerLock(playerRef.current as unknown as ManagedPlayer); };
  }, []);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      setShowDoubleTapHeart(true);
      Animated.sequence([
        Animated.spring(heartAnim, { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 14 }),
        Animated.delay(480),
        Animated.timing(heartAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(() => setShowDoubleTapHeart(false));
      if (!isLiked) onLike();
    } else if (isActive) {
      setIsPaused(p => !p);
    }
    lastTap.current = now;
  }, [isLiked, onLike, heartAnim, isActive]);

  const handleShare = useCallback(async () => {
    try { await Share.share({ message: `Mira este video de @${video.username} en ClipDAG - https://clipdag.io` }); } catch (_) {}
  }, [video.username]);

  const toggleMute = useCallback(() => setIsMuted(m => !m), []);

  const muteControl = (
    <Pressable style={styles.muteBtn} onPress={toggleMute} hitSlop={10}>
      <View style={styles.muteBtnInner}>
        <MaterialCommunityIcons name={isMuted ? 'volume-off' : 'volume-high'} size={18} color="rgba(255,255,255,0.9)" />
      </View>
    </Pressable>
  );

  return (
    <View style={{ width: screenSize.width, height: cardHeight, backgroundColor: '#000' }}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={handleTap}>
        {hasValidThumb ? (
          <Image source={{ uri: video.thumbnailUrl }} style={[StyleSheet.absoluteFillObject, { zIndex: 0 }]} contentFit="cover" transition={200} onError={() => setThumbError(true)} />
        ) : null}
        {hasValidVideo ? (
          <VideoView player={player} style={StyleSheet.absoluteFillObject} contentFit="cover" nativeControls={false} />
        ) : (
          <View style={[StyleSheet.absoluteFillObject, styles.mediaPlaceholder]}>
            <MaterialIcons name="videocam-off" size={56} color={Colors.textSubtle} />
            <Text style={styles.mediaPlaceholderText}>Video no disponible</Text>
          </View>
        )}
        {isPaused && isActive ? (
          <View style={styles.pauseOverlay} pointerEvents="none">
            <View style={styles.pauseIcon}>
              <MaterialCommunityIcons name="pause" size={36} color="rgba(255,255,255,0.95)" />
            </View>
          </View>
        ) : null}
        {showDoubleTapHeart ? (
          <Animated.View style={[styles.doubleTapHeart, { opacity: heartAnim, transform: [{ scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.3] }) }] }]} pointerEvents="none">
            <Text style={styles.doubleTapHeartEmoji}>❤️</Text>
          </Animated.View>
        ) : null}
      </Pressable>

      <View style={styles.mediaBadge} pointerEvents="none">
        <MaterialCommunityIcons name="play-circle-outline" size={11} color={Colors.secondary} />
        <Text style={[styles.mediaBadgeText, { color: Colors.secondary }]}>VIDEO</Text>
      </View>

      <ReelOverlay
        video={video} isLiked={isLiked} isSaved={isSaved} isFollowing={isFollowing}
        cardHeight={cardHeight} currentUserDagBalance={currentUserDagBalance} currentUserId={currentUserId}
        onLike={onLike} onComment={onComment} onFollow={onFollow} onSave={onSave}
        onProfilePress={onProfilePress} onShare={handleShare} onGiftSend={onSendGift}
        extraControls={muteControl}
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main export — routes to correct card type
// ─────────────────────────────────────────────────────────────────────────────
export const VideoCard = memo(function VideoCard(props: VideoCardProps) {
  const videoUrl = props.video.videoUrl || '';
  const thumbnailUrl = props.video.thumbnailUrl || '';
  const mediaUrls = (props.video as any).mediaUrls as string[] | undefined;

  // Carousel: multiple media items
  if (mediaUrls && mediaUrls.length > 1) return <CarouselPostCard {...props} />;

  // Video reel
  if (isVideoMedia(videoUrl)) return <VideoReelCard {...props} />;
  if (!videoUrl && isVideoMedia(thumbnailUrl)) {
    return <VideoReelCard {...{ ...props, video: { ...props.video, videoUrl: thumbnailUrl } }} />;
  }

  // Single image → Instagram post card
  return <InstagramPostCard {...props} />;
});

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, gap: 12 },
  mediaPlaceholderText: { color: Colors.textSubtle, fontSize: FontSize.sm },

  pauseOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  pauseIcon: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: 'rgba(10,10,15,0.65)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
  },

  doubleTapHeart: { position: 'absolute', top: '35%', left: '50%', marginLeft: -48, marginTop: -48, zIndex: 20 },
  doubleTapHeartEmoji: { fontSize: 96 },

  mediaBadge: {
    position: 'absolute', top: 56, left: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(10,10,15,0.6)', borderRadius: Radius.full,
    paddingHorizontal: 9, paddingVertical: 4, zIndex: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  mediaBadgeText: { fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.8 },

  // Carousel
  dotsWrap: { position: 'absolute', bottom: Spacing.sm, left: 0, right: 0, alignItems: 'center' },
  dotsRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { borderRadius: Radius.full },
  dotActive: { width: 16, height: 5, backgroundColor: Colors.primary },
  dotInactive: { width: 5, height: 5, backgroundColor: 'rgba(255,255,255,0.4)' },

  carouselCountBadge: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(10,10,15,0.7)', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  carouselCountText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold },

  carouselSlideError: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface },
  carouselVideoIndicator: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },

  // Reel overlay
  reelBottomArea: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: Spacing.md, gap: Spacing.sm, zIndex: 10,
  },
  reelInfoArea: { flex: 1, gap: 10, paddingBottom: 4 },
  reelUserRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarGlow: { shadowColor: '#7C5CFF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 8, elevation: 0 },
  userMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  reelUsername: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold, textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  followPill: { borderRadius: Radius.full, overflow: 'hidden' },
  followPillGradient: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: Radius.full },
  followPillText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  followPillFollowing: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.accentDim, borderWidth: 1, borderColor: Colors.accent + '55', borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 3 },
  followPillFollowingText: { color: Colors.accent, fontSize: 11, fontWeight: FontWeight.semibold },
  reelCaption: { color: 'rgba(255,255,255,0.92)', fontSize: FontSize.sm, lineHeight: 19, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  musicDisc: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  musicText: { color: 'rgba(255,255,255,0.7)', fontSize: FontSize.xs, flex: 1 },
  dagPill: { alignSelf: 'flex-start', borderRadius: Radius.full, overflow: 'hidden' },
  dagPillGrad: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(124,92,255,0.3)' },
  dagPillIcon: { color: Colors.primaryLight, fontSize: 11 },
  dagPillText: { color: Colors.primaryLight, fontSize: 10, fontWeight: FontWeight.semibold },
  reelActionsCol: { alignItems: 'center', gap: 2, paddingBottom: Spacing.xs, minWidth: 52 },
  actionBtn: { alignItems: 'center', gap: 2, paddingVertical: 5 },
  actionIconWrap: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: FontWeight.semibold, textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  dagBadge: { alignItems: 'center', backgroundColor: 'rgba(124,92,255,0.15)', borderWidth: 1, borderColor: 'rgba(124,92,255,0.4)', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5, marginTop: 4 },
  dagBadgeSymbol: { color: Colors.primaryLight, fontSize: 14, fontWeight: FontWeight.bold },
  dagBadgeLabel: { color: Colors.primaryLight, fontSize: 9, fontWeight: FontWeight.semibold },
  muteBtn: { marginBottom: Spacing.xs },
  muteBtnInner: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(10,10,15,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  // Instagram post card
  postCard: { backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle, paddingBottom: Spacing.sm },
  postHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 10, gap: Spacing.sm },
  postHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  postAvatarRing: { borderRadius: 22, overflow: 'hidden', borderWidth: 2, borderColor: Colors.primary + '66' },
  postHeaderMeta: { flex: 1, gap: 1 },
  postUsername: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  postSubRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  postMusicName: { color: Colors.primary, fontSize: FontSize.xs, flex: 1 },
  postHeaderRight: { alignItems: 'flex-end' },
  postFollowBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full },
  postFollowBtnText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  postFollowingBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.accentDim, borderWidth: 1, borderColor: Colors.accent + '55', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  postFollowingBtnText: { color: Colors.accent, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  postImgPlaceholder: { width: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface, gap: 10 },
  postMediaBadge: { position: 'absolute', top: Spacing.sm, right: Spacing.sm, backgroundColor: 'rgba(10,10,15,0.55)', borderRadius: Radius.full, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  postActionBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingTop: 10, paddingBottom: 4 },
  postActionLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  postLikesRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, marginBottom: 5 },
  postLikesText: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  postCaptionRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: Spacing.md, marginBottom: 3 },
  postCaptionUsername: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  postCaptionText: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19, flex: 1 },
  postCommentsPreview: { paddingHorizontal: Spacing.md, marginBottom: 4 },
  postCommentsPreviewText: { color: Colors.textSubtle, fontSize: FontSize.xs },
  postDagRow: { paddingHorizontal: Spacing.md, marginTop: 4, alignItems: 'flex-start' },
  postDagPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(124,92,255,0.2)' },
  postDagIcon: { color: Colors.primaryLight, fontSize: 10 },
  postDagText: { color: Colors.primaryLight, fontSize: 10, fontWeight: FontWeight.semibold },
});
