import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Colors, Radius } from '@/constants/theme';
import { getStandardChatVideoAccess } from '@/services/chatMediaService';

type PrivateChatVideoProps = {
  assetId?: string;
};

function ReadyPrivateChatVideo({ url, onRetry }: { url: string; onRetry: () => void }) {
  const player = useVideoPlayer(url, instance => {
    instance.loop = false;
  });
  const status = useEvent(player, 'statusChange', { status: player.status });

  return <View style={styles.frame}>
    <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
    {status.status === 'error' ? <View style={styles.overlay}>
      <Text style={styles.errorText}>No se pudo reproducir el video.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Reintentar video" onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Reintentar</Text>
      </Pressable>
    </View> : null}
  </View>;
}

export function PrivateChatVideo({ assetId }: PrivateChatVideoProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(false);
    if (!assetId) {
      setError(true);
      return () => { active = false; };
    }
    void getStandardChatVideoAccess(assetId).then(access => {
      if (active) setUrl(access.url);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => { active = false; };
  }, [assetId, attempt]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);

  if (error) return <View style={[styles.frame, styles.center]}>
    <Text style={styles.errorText}>Video no disponible.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Reintentar video" onPress={retry} style={styles.retryButton}>
      <Text style={styles.retryText}>Reintentar</Text>
    </Pressable>
  </View>;
  if (!url) return <View style={[styles.frame, styles.center]}><ActivityIndicator color={Colors.primary} /></View>;
  return <ReadyPrivateChatVideo key={`${assetId}:${attempt}`} url={url} onRetry={retry} />;
}

const styles = StyleSheet.create({
  frame: { width: 248, maxWidth: '100%', aspectRatio: 16 / 9, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: '#05060A' },
  video: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, backgroundColor: '#05060ACC' },
  errorText: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
  retryButton: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.primary },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
