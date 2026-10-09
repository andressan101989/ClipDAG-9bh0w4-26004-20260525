import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { createProtectedVideoCommandController } from '@/services/creatorPremiumProtectedVideoRuntime.mjs';

type ProtectedPremiumVideoGrant = {
  contentId: string;
  hlsUrl: string;
  expiresAt: string;
};

type ProtectedPremiumVideoProps = {
  grant: ProtectedPremiumVideoGrant | null;
  generation: number;
  visible: boolean;
  screenProtected: boolean;
  style?: StyleProp<ViewStyle>;
  onError?: () => void;
  onPlaybackStateChange?: (playing: boolean) => void;
};

export function ProtectedPremiumVideo({
  grant,
  generation,
  visible,
  screenProtected,
  style,
  onError,
  onPlaybackStateChange,
}: ProtectedPremiumVideoProps) {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [firstFrameKey, setFirstFrameKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const player = useVideoPlayer(null, instance => {
    instance.loop = false;
    instance.allowsExternalPlayback = false;
    instance.staysActiveInBackground = false;
    instance.showNowPlayingNotification = false;
    instance.keepScreenOnWhilePlaying = false;
  });
  const controller = useMemo(() => createProtectedVideoCommandController(player), [player]);
  const mayMountSource = Boolean(grant && visible && screenProtected);
  const sourceKey = mayMountSource && grant
    ? `${grant.contentId}:${grant.expiresAt}:${generation}`
    : null;
  const currentSourceKeyRef = useRef<string | null>(null);
  currentSourceKeyRef.current = sourceKey;
  const loaded = sourceKey !== null && loadedKey === sourceKey;
  const firstFrame = sourceKey !== null && firstFrameKey === sourceKey;
  const playing = sourceKey !== null && playingKey === sourceKey;

  useEffect(() => {
    if (!sourceKey) return undefined;
    const operationSourceKey = sourceKey;
    let terminal = false;
    const statusSubscription = player.addListener('statusChange', ({ status }) => {
      if (terminal || currentSourceKeyRef.current !== operationSourceKey) return;
      if (status === 'readyToPlay') {
        setLoadedKey(operationSourceKey);
        return;
      }
      if (status === 'error') {
        terminal = true;
        setLoadedKey(null);
        setFirstFrameKey(null);
        setPlayingKey(null);
        onPlaybackStateChange?.(false);
        void controller.invalidate('protected_video_status_error');
        onError?.();
      }
    });
    const playingSubscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (terminal || currentSourceKeyRef.current !== operationSourceKey) return;
      setPlayingKey(isPlaying ? operationSourceKey : null);
      onPlaybackStateChange?.(isPlaying);
    });
    return () => {
      terminal = true;
      statusSubscription.remove();
      playingSubscription.remove();
    };
  }, [controller, onError, onPlaybackStateChange, player, sourceKey]);

  useEffect(() => {
    let active = true;
    currentSourceKeyRef.current = sourceKey;
    onPlaybackStateChange?.(false);

    if (!sourceKey || !grant) {
      void controller.invalidate('protected_video_hidden');
      return () => {
        active = false;
        if (currentSourceKeyRef.current === sourceKey) currentSourceKeyRef.current = null;
      };
    }

    const operationSourceKey = sourceKey;
    setLoadedKey(null);
    setFirstFrameKey(null);
    setPlayingKey(null);
    void controller.load({
      uri: grant.hlsUrl,
      contentId: grant.contentId,
      expiresAt: grant.expiresAt,
    }, generation).then(result => {
      if (!active || currentSourceKeyRef.current !== operationSourceKey) return;
      if (!result) {
        setLoadedKey(null);
        onError?.();
        return;
      }
      if (player.status === 'readyToPlay') setLoadedKey(operationSourceKey);
    }).catch(() => {
      if (!active || currentSourceKeyRef.current !== operationSourceKey) return;
      setLoadedKey(null);
      onError?.();
    });

    return () => {
      active = false;
      if (currentSourceKeyRef.current === operationSourceKey) currentSourceKeyRef.current = null;
      void controller.invalidate('protected_video_effect_cleanup');
    };
  }, [controller, generation, grant, onError, onPlaybackStateChange, player, sourceKey]);

  useEffect(() => () => {
    void controller.dispose();
  }, [controller]);

  const togglePlayback = useCallback(() => {
    if (!loaded || !sourceKey) return;
    if (playing) {
      setPlayingKey(null);
      onPlaybackStateChange?.(false);
      void controller.pause();
      return;
    }
    const operationSourceKey = sourceKey;
    void controller.play(generation).then(didPlay => {
      if (currentSourceKeyRef.current !== operationSourceKey) return;
      setPlayingKey(didPlay ? operationSourceKey : null);
      onPlaybackStateChange?.(didPlay);
      if (!didPlay) onError?.();
    });
  }, [controller, generation, loaded, onError, onPlaybackStateChange, playing, sourceKey]);

  const mediaVisible = mayMountSource && loaded && firstFrame;

  return (
    <View style={[styles.frame, style]}>
      <VideoView
        key={sourceKey ?? 'protected-empty'}
        player={player}
        style={styles.media}
        contentFit="contain"
        nativeControls={false}
        allowsFullscreen={false}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        startsPictureInPictureAutomatically={false}
        allowsVideoFrameAnalysis={false}
        showsTimecodes={false}
        requiresLinearPlayback
        onFirstFrameRender={() => {
          if (sourceKey && currentSourceKeyRef.current === sourceKey) {
            setFirstFrameKey(sourceKey);
          }
        }}
      />
      {!mediaVisible ? <View pointerEvents="none" style={styles.cover} /> : null}
      {loaded && mayMountSource ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pausar contenido Premium' : 'Reproducir contenido Premium'}
          onPress={togglePlayback}
          style={styles.control}
        >
          <Text style={styles.controlText}>{playing ? 'Pausar' : 'Reproducir'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#05060A',
  },
  media: {
    ...StyleSheet.absoluteFillObject,
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: '#05060A',
  },
  control: {
    position: 'absolute',
    zIndex: 3,
    left: Spacing.md,
    bottom: Spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: Colors.overlay,
  },
  controlText: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
});
