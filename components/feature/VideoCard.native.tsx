import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View, Text, Pressable, StyleSheet, Dimensions, Animated, Share,
  FlatList, NativeScrollEvent, NativeSyntheticEvent, Modal,
} from 'react-native';
// expo-video — lazy-loaded to prevent Hermes crash from dynamic import() syntax
// in expo-video's internal JS when bundled for iOS.
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

// ─────────────────────────────────────────────────────────────────────────────
// CAROUSEL DOT INDICATOR
// ─────────────────────────────────────────────────────────────────────────────
const CarouselDots = memo(function CarouselDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  if (count <= 1) return null;
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]} />
      ))}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CAROUSEL SLIDE — one media item inside a carousel
// ─────────────────────────────────────────────────────────────────────────────
interface CarouselSlideProps {
  uri: string;
  width: number;
  height: number;
  isActive: boolean;
}

const CarouselSlide = memo(function CarouselSlide({ uri, width, height }: CarouselSlideProps) {
  const isVideo = isVideoMedia(uri);
  const [error, setError] = useState(false);

  const player = _useVideoPlayer(isVideo && isValidUrl(uri) ? uri : '', p => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!isVideo || !isValidUrl(uri)) return;
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
        <VideoView player={player} style={{ width, height }} contentFit="cover" nativeControls={false} />
        <View style={styles.carouselVideoIndicator} pointerEvents="none">
          <MaterialCommunityIcons name="play-circle-outline" size={32} color="rgba(255,255,255,0.85)" />
        </View>
      </View>
    );
  }

  return (
    <Image source={{ uri }} style={{ width, height }} contentFit="cover" transition={150} onError={() => setError(true)} />
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CARD HEADER — avatar, username, audio info, follow button (above media)
// ─────────────────────────────────────────────────────────────────────────────
interface CardHeaderProps {
  video: Video;
  isFollowing: boolean;
  onProfilePress: () => void;
  onFollow: () => void;
}

const CardHeader = memo(function CardHeader({ video, isFollowing, onProfilePress, onFollow }: CardHeaderProps) {
  return (
    <View style={styles.cardHeader}>
      <Pressable style={styles.cardHeaderLeft} onPress={onProfilePress} hitSlop={4}>
        <View style={styles.cardAvatarRing}>
          <Avatar uri={video.userAvatar} username={video.username} size={36} />
        </View>
        <View style={styles.cardHeaderMeta}>
          <Text style={styles.cardUsername} numberOfLines={1}>@{video.username}</Text>
          <View style={styles.cardAudioRow}>
            <MaterialCommunityIcons name="music-note" size={10} color={Colors.textSubtle} />
            <Text style={styles.cardAudioName} numberOfLines={1}>{video.music || 'Audio original'}</Text>
          </View>
        </View>
      </Pressable>

      {!isFollowing ? (
        <Pressable onPress={onFollow} hitSlop={6}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.followBtn}>
            <Text style={styles.followBtnText}>Seguir</Text>
          </LinearGradient>
        </Pressable>
      ) : (
        <Pressable onPress={onFollow} style={styles.followingBtn} hitSlop={6}>
          <MaterialIcons name="check" size={11} color={Colors.accent} />
          <Text style={styles.followingBtnText}>Siguiendo</Text>
        </Pressable>
      )}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CARD ACTIONS — horizontal row below media
// ─────────────────────────────────────────────────────────────────────────────
interface CardActionsProps {
  video: Video;
  isLiked: boolean;
  isSaved: boolean;
  currentUserId: string;
  currentUserDagBalance: number;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onSendGift?: VideoCardProps['onSendGift'];
}

const CardActions = memo(function CardActions({
  video, isLiked, isSaved, currentUserId, currentUserDagBalance,
  onLike, onComment, onShare, onSave, onSendGift,
}: CardActionsProps) {
  const [giftVisible, setGiftVisible] = useState(false);
  const likeScale  = useRef(new Animated.Value(1)).current;
  const saveScale  = useRef(new Animated.Value(1)).current;

  const bounce = useCallback((val: Animated.Value, cb: () => void) => {
    Animated.sequence([
      Animated.spring(val, { toValue: 1.3, useNativeDriver: true, speed: 60, bounciness: 12 }),
      Animated.spring(val, { toValue: 1,   useNativeDriver: true, speed: 50 }),
    ]).start();
    cb();
  }, []);

  return (
    <View style={styles.cardActions}>
      {/* Left group: like, comment, share, gift */}
      <View style={styles.cardActionsLeft}>
        <Pressable style={styles.actionItem} onPress={() => bounce(likeScale, onLike)} hitSlop={8}>
          <Animated.View style={{ transform: [{ scale: likeScale }] }}>
            <MaterialIcons
              name={isLiked ? 'favorite' : 'favorite-border'}
              size={27}
              color={isLiked ? Colors.secondary : Colors.textPrimary}
            />
          </Animated.View>
          {(video.likes || 0) > 0 ? (
            <Text style={[styles.actionCount, isLiked ? { color: Colors.secondary } : null]}>
              {formatNumber(video.likes || 0)}
            </Text>
          ) : null}
        </Pressable>

        <Pressable style={styles.actionItem} onPress={onComment} hitSlop={8}>
          <MaterialCommunityIcons name="comment-outline" size={25} color={Colors.textPrimary} />
          {(video.comments || 0) > 0 ? (
            <Text style={styles.actionCount}>{formatNumber(video.comments || 0)}</Text>
          ) : null}
        </Pressable>

        <Pressable style={styles.actionItem} onPress={onShare} hitSlop={8}>
          <MaterialCommunityIcons name="share-variant-outline" size={24} color={Colors.textPrimary} />
          {(video.shares || 0) > 0 ? (
            <Text style={styles.actionCount}>{formatNumber(video.shares || 0)}</Text>
          ) : null}
        </Pressable>

        {onSendGift && currentUserId !== video.userId ? (
          <Pressable style={styles.actionItem} onPress={() => setGiftVisible(true)} hitSlop={8}>
            <Text style={{ fontSize: 22 }}>🎁</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Right: bookmark */}
      <Pressable onPress={() => bounce(saveScale, onSave)} hitSlop={8}>
        <Animated.View style={{ transform: [{ scale: saveScale }] }}>
          <MaterialCommunityIcons
            name={isSaved ? 'bookmark' : 'bookmark-outline'}
            size={27}
            color={isSaved ? Colors.primary : Colors.textPrimary}
          />
        </Animated.View>
      </Pressable>

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
// CARD CAPTION — @username + text + DAG pill (below actions)
// ─────────────────────────────────────────────────────────────────────────────
const CardCaption = memo(function CardCaption({ video, onComment }: { video: Video; onComment: () => void }) {
  return (
    <View style={styles.cardCaption}>
      {video.caption ? (
        <View style={styles.captionRow}>
          <Text style={styles.captionUsername}>@{video.username} </Text>
          <Text style={styles.captionText}>{video.caption}</Text>
        </View>
      ) : null}
      {(video.comments || 0) > 0 ? (
        <Pressable onPress={onComment} hitSlop={4}>
          <Text style={styles.viewCommentsText}>Ver {formatNumber(video.comments || 0)} comentarios</Text>
        </Pressable>
      ) : null}
      <View style={styles.dagPillWrap}>
        <LinearGradient
          colors={['#7C5CFF22', '#FF2D7811']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={styles.dagPill}
        >
          <Text style={styles.dagPillIcon}>◈</Text>
          <Text style={styles.dagPillText}>0.01 $DAG / like</Text>
        </LinearGradient>
      </View>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// FEED CARD — unified Instagram-style card for all media types
//
//  ┌─ CardHeader ──────────────────────────────────────┐
//  │  [Avatar] @username  🎵 audio    [Follow/Siguiendo] │
//  └───────────────────────────────────────────────────┘
//  ┌─ Media (72% screen height) ───────────────────────┐
//  │  image / video / carousel                         │
//  │  [small mute btn bottom-right if video]           │
//  └───────────────────────────────────────────────────┘
//  [• • •]  ← dots, carousel only, below media
//  ┌─ CardActions ─────────────────────────────────────┐
//  │  [❤️ 5.2K]  [💬 234]  [↗ 1K]  [🎁]      [🔖]   │
//  └───────────────────────────────────────────────────┘
//  ┌─ CardCaption ─────────────────────────────────────┐
//  │  @username caption text...                        │
//  │  ◈ 0.01 $DAG / like                              │
//  └───────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────
const FeedCard = memo(function FeedCard(props: VideoCardProps) {
  const {
    video, isActive, isLiked, isSaved = false, isFollowing,
    currentUserDagBalance = 0, currentUserId = '',
    onLike, onComment, onFollow, onSave = () => {}, onProfilePress, onSendGift, onViewTracked,
  } = props;

  const [screenSize, setScreenSize] = useState(Dimensions.get('window'));
  const mediaHeight = Math.round(screenSize.height * 0.72);
  const { width: SCREEN_W } = screenSize;

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreenSize(window));
    return () => sub.remove();
  }, []);

  // ── Media type detection ─────────────────────────────────────────────────
  const videoUrl   = video.videoUrl   || '';
  const thumbUrl   = video.thumbnailUrl || '';
  const mediaUrls  = (video as any).mediaUrls as string[] | undefined;
  const isCarousel = !!mediaUrls && mediaUrls.length > 1;
  // Treat videoUrl or thumbnailUrl as a video if either is a video file
  const isVideo    = !isCarousel && (isVideoMedia(videoUrl) || (!videoUrl && isVideoMedia(thumbUrl)));
  const effectiveVideoUrl = isVideoMedia(videoUrl) ? videoUrl : thumbUrl;
  const hasValidVideo = isVideo && isValidUrl(effectiveVideoUrl);
  const [thumbError, setThumbError] = useState(false);
  const hasValidThumb = isVideo && isValidUrl(thumbUrl) && !thumbError && thumbUrl !== effectiveVideoUrl;

  // ── Video player ─────────────────────────────────────────────────────────
  const player = _useVideoPlayer(hasValidVideo ? effectiveVideoUrl : '', p => {
    p.loop = true;
    p.muted = true;
  });
  const playerRef = useRef(player);
  useEffect(() => { playerRef.current = player; });

  const [isMuted,      setIsMuted]      = useState(_sessionMuted);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!hasValidVideo) return;
    if (!isActive) {
      releasePlayerLock(player as unknown as ManagedPlayer);
      try { player.muted = true;  } catch (_) {}
      try { player.pause();       } catch (_) {}
      setIsFullscreen(false);
    } else {
      acquirePlayerLock(player as unknown as ManagedPlayer);
      try { player.muted = isFullscreen ? false : isMuted; } catch (_) {}
      try { player.play();                                  } catch (_) {}
    }
  }, [player, isActive, hasValidVideo, isMuted, isFullscreen]);

  useEffect(() => {
    if (!hasValidVideo || !isActive) return;
    try { player.muted = isFullscreen ? false : isMuted; } catch (_) {}
    if (!isFullscreen) _sessionMuted = isMuted;
  }, [isMuted, isFullscreen]);

  useEffect(() => {
    return () => { releasePlayerLock(playerRef.current as unknown as ManagedPlayer); };
  }, []);

  // ── View tracking ─────────────────────────────────────────────────────────
  const viewStartRef   = useRef<number | null>(null);
  const viewTrackedRef = useRef(false);
  useEffect(() => {
    if (isActive) {
      viewStartRef.current   = Date.now();
      viewTrackedRef.current = false;
    } else if (viewStartRef.current && !viewTrackedRef.current) {
      viewTrackedRef.current = true;
      onViewTracked?.(Date.now() - viewStartRef.current, false);
      viewStartRef.current = null;
    }
  }, [isActive]);

  // ── Tap / double-tap ──────────────────────────────────────────────────────
  const [showHeart, setShowHeart] = useState(false);
  const heartAnim = useRef(new Animated.Value(0)).current;
  const lastTap   = useRef(0);

  const triggerHeart = useCallback(() => {
    setShowHeart(true);
    Animated.sequence([
      Animated.spring(heartAnim, { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 14 }),
      Animated.delay(480),
      Animated.timing(heartAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setShowHeart(false));
  }, [heartAnim]);

  const handleMediaTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      triggerHeart();
      if (!isLiked) onLike();
    } else if (isVideo && isActive) {
      setIsFullscreen(fs => !fs);
    }
    lastTap.current = now;
  }, [isLiked, onLike, isVideo, isActive, triggerHeart]);

  // ── Carousel state ────────────────────────────────────────────────────────
  const [activeSlide, setActiveSlide] = useState(0);

  const handleCarouselScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setActiveSlide(Math.max(0, Math.min(idx, (mediaUrls?.length ?? 1) - 1)));
  }, [SCREEN_W, mediaUrls?.length]);

  const renderSlide = useCallback(({ item }: { item: string }) => (
    <Pressable onPress={handleMediaTap} activeOpacity={1}>
      <CarouselSlide uri={item} width={SCREEN_W} height={mediaHeight} isActive={false} />
    </Pressable>
  ), [SCREEN_W, mediaHeight, handleMediaTap]);

  // ── Share ─────────────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    try { await Share.share({ message: `Mira esto de @${video.username} en ClipDAG - https://clipdag.io` }); } catch (_) {}
  }, [video.username]);

  // ── Heart overlay (reused in both carousel + single) ─────────────────────
  const heartOverlay = showHeart ? (
    <Animated.View
      style={[styles.doubleTapHeart, {
        opacity: heartAnim,
        transform: [{ scale: heartAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.3] }) }],
      }]}
      pointerEvents="none"
    >
      <Text style={styles.doubleTapHeartEmoji}>❤️</Text>
    </Animated.View>
  ) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.card}>

      {/* ── Header row ── */}
      <CardHeader
        video={video}
        isFollowing={isFollowing}
        onProfilePress={onProfilePress}
        onFollow={onFollow}
      />

      {/* ── Media area ── */}
      <View style={{ width: SCREEN_W, height: mediaHeight, backgroundColor: '#000' }}>
        {isCarousel ? (
          <>
            <FlatList
              style={StyleSheet.absoluteFillObject}
              data={mediaUrls}
              keyExtractor={(_, i) => `slide_${i}`}
              renderItem={renderSlide}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleCarouselScroll}
              decelerationRate="fast"
              snapToInterval={SCREEN_W}
              snapToAlignment="start"
              bounces={false}
              removeClippedSubviews
              maxToRenderPerBatch={2}
              windowSize={3}
            />
            {(mediaUrls!.length) > 1 ? (
              <View style={styles.carouselCountBadge} pointerEvents="none">
                <Text style={styles.carouselCountText}>{activeSlide + 1}/{mediaUrls!.length}</Text>
              </View>
            ) : null}
            {heartOverlay}
          </>
        ) : (
          <Pressable style={StyleSheet.absoluteFillObject} onPress={handleMediaTap} activeOpacity={1}>
            {/* Poster frame for videos */}
            {hasValidThumb ? (
              <Image
                source={{ uri: thumbUrl }}
                style={[StyleSheet.absoluteFillObject, { zIndex: 0 }]}
                contentFit="cover"
                onError={() => setThumbError(true)}
              />
            ) : null}

            {/* Video player */}
            {hasValidVideo ? (
              <VideoView
                player={player}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                nativeControls={false}
              />
            ) : !isVideo ? (
              /* Static image */
              isValidUrl(thumbUrl || videoUrl) ? (
                <Image
                  source={{ uri: thumbUrl || videoUrl }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={[StyleSheet.absoluteFillObject, styles.mediaPlaceholder]}>
                  <MaterialIcons name="photo" size={56} color={Colors.textSubtle} />
                  <Text style={styles.mediaPlaceholderText}>Imagen no disponible</Text>
                </View>
              )
            ) : (
              <View style={[StyleSheet.absoluteFillObject, styles.mediaPlaceholder]}>
                <MaterialIcons name="videocam-off" size={56} color={Colors.textSubtle} />
                <Text style={styles.mediaPlaceholderText}>Video no disponible</Text>
              </View>
            )}

            {heartOverlay}
          </Pressable>
        )}

        {/* Mute toggle — bottom-right corner, video only */}
        {isVideo && hasValidVideo ? (
          <Pressable style={styles.muteBtn} onPress={() => setIsMuted(m => !m)} hitSlop={12}>
            <View style={styles.muteBtnInner}>
              <MaterialCommunityIcons
                name={isMuted ? 'volume-off' : 'volume-high'}
                size={16}
                color="rgba(255,255,255,0.9)"
              />
            </View>
          </Pressable>
        ) : null}

        {/* Small type badge — top-left */}
        {isVideo ? (
          <View style={styles.mediaBadge} pointerEvents="none">
            <MaterialCommunityIcons name="play-circle-outline" size={11} color={Colors.secondary} />
            <Text style={[styles.mediaBadgeText, { color: Colors.secondary }]}>VIDEO</Text>
          </View>
        ) : !isCarousel ? (
          <View style={styles.mediaBadge} pointerEvents="none">
            <MaterialCommunityIcons name="image-outline" size={11} color={Colors.blue} />
            <Text style={[styles.mediaBadgeText, { color: Colors.blue }]}>FOTO</Text>
          </View>
        ) : null}
      </View>

      {/* Carousel dots — between media and action bar */}
      {isCarousel && (mediaUrls?.length ?? 0) > 1 ? (
        <View style={styles.dotsWrap}>
          <CarouselDots count={mediaUrls!.length} activeIndex={activeSlide} />
        </View>
      ) : null}

      {/* ── Action bar ── */}
      <CardActions
        video={video}
        isLiked={isLiked}
        isSaved={isSaved}
        currentUserId={currentUserId}
        currentUserDagBalance={currentUserDagBalance}
        onLike={onLike}
        onComment={onComment}
        onShare={handleShare}
        onSave={onSave}
        onSendGift={onSendGift}
      />

      {/* ── Caption ── */}
      <CardCaption video={video} onComment={onComment} />

      {/* Fullscreen Modal — single tap on video opens this */}
      {isVideo && hasValidVideo ? (
        <Modal
          visible={isFullscreen}
          statusBarTranslucent
          animationType="fade"
          supportedOrientations={['portrait', 'landscape']}
          onRequestClose={() => setIsFullscreen(false)}
        >
          <View style={styles.fullscreenModal}>
            <VideoView
              player={player}
              style={StyleSheet.absoluteFillObject}
              contentFit="contain"
              nativeControls={true}
            />
            <Pressable
              style={styles.fullscreenCloseBtn}
              onPress={() => setIsFullscreen(false)}
              hitSlop={10}
            >
              <MaterialCommunityIcons name="close" size={26} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
        </Modal>
      ) : null}

    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// VideoCard export — routes everything through the unified FeedCard
// ─────────────────────────────────────────────────────────────────────────────
export const VideoCard = memo(function VideoCard(props: VideoCardProps) {
  return <FeedCard {...props} />;
});

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  // ── Card shell ─────────────────────────────────────────────────────────────
  card: {
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },

  // ── Card header ────────────────────────────────────────────────────────────
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm + 2,
    paddingBottom: 10,
    gap: Spacing.sm,
  },
  cardHeaderLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardAvatarRing: {
    borderRadius: 22, overflow: 'hidden',
    borderWidth: 2, borderColor: Colors.primary + '66',
  },
  cardHeaderMeta: { flex: 1, gap: 2 },
  cardUsername: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  cardAudioRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  cardAudioName: {
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    flex: 1,
  },
  followBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: Radius.full,
  },
  followBtnText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  followingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.accentDim,
    borderWidth: 1, borderColor: Colors.accent + '55',
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5,
  },
  followingBtnText: { color: Colors.accent, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // ── Media ──────────────────────────────────────────────────────────────────
  mediaPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, gap: 12,
  },
  mediaPlaceholderText: { color: Colors.textSubtle, fontSize: FontSize.sm },

  mediaBadge: {
    position: 'absolute', top: Spacing.sm, left: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(10,10,15,0.6)', borderRadius: Radius.full,
    paddingHorizontal: 9, paddingVertical: 4, zIndex: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  mediaBadgeText: { fontSize: 9, fontWeight: FontWeight.bold, letterSpacing: 0.8 },

  muteBtn: {
    position: 'absolute', bottom: Spacing.sm, right: Spacing.sm, zIndex: 10,
  },
  muteBtnInner: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(10,10,15,0.65)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },

  doubleTapHeart: {
    position: 'absolute', top: '35%', left: '50%',
    marginLeft: -48, marginTop: -48, zIndex: 20,
  },
  doubleTapHeartEmoji: { fontSize: 96 },

  // ── Carousel ───────────────────────────────────────────────────────────────
  carouselCountBadge: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    backgroundColor: 'rgba(10,10,15,0.7)', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  carouselCountText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.semibold },
  carouselSlideError: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  carouselVideoIndicator: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },

  // Dots between media and actions
  dotsWrap: { paddingVertical: Spacing.xs + 2, alignItems: 'center' },
  dotsRow:  { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot:         { borderRadius: Radius.full },
  dotActive:   { width: 16, height: 5,  backgroundColor: Colors.primary },
  dotInactive: { width: 5,  height: 5,  backgroundColor: 'rgba(255,255,255,0.35)' },

  // ── Action bar ─────────────────────────────────────────────────────────────
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: 10,
    paddingBottom: 4,
  },
  cardActionsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionCount: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },

  // ── Caption ────────────────────────────────────────────────────────────────
  cardCaption: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: 4,
  },
  captionRow: { flexDirection: 'row', flexWrap: 'wrap' },
  captionUsername: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  captionText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 19,
  },
  viewCommentsText: { color: Colors.textSubtle, fontSize: FontSize.xs },
  dagPillWrap: { alignSelf: 'flex-start', marginTop: 2 },
  dagPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(124,92,255,0.2)',
  },
  dagPillIcon: { color: Colors.primaryLight, fontSize: 10 },
  dagPillText: { color: Colors.primaryLight, fontSize: 10, fontWeight: FontWeight.semibold },

  // ── Fullscreen modal ───────────────────────────────────────────────────────
  fullscreenModal: { flex: 1, backgroundColor: '#000' },
  fullscreenCloseBtn: {
    position: 'absolute', top: 48, right: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(10,10,15,0.72)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 30,
  },
});
