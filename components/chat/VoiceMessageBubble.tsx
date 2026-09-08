import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Colors, Radius } from '@/constants/theme';
import {
  formatVoiceDuration,
  getChatVoicePlaybackUrl,
  nextVoiceSpeed,
  restoreChatVoicePlaybackMode,
  type ChatVoiceSpeed,
} from '@/services/chatVoiceService';

type Props = {
  messageId: string;
  assetId: string;
  durationMs: number;
  waveform: number[];
  isMine: boolean;
  activeMessageId: string | null;
  onActivate: (messageId: string) => void;
};

export function VoiceMessageBubble({ messageId, assetId, durationMs, waveform, isMine,
  activeMessageId, onActivate }: Props) {
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState<ChatVoiceSpeed>(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadedAsset, setLoadedAsset] = useState<string | null>(null);
  const [width, setWidth] = useState(1);
  const active = activeMessageId === messageId;
  const activeRef = useRef(activeMessageId); activeRef.current = activeMessageId;
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;
    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
    };
  }, []);

  const isCurrentLifecycle = useCallback((generation: number) => (
    mountedRef.current && lifecycleGenerationRef.current === generation
  ), []);
  const runPlayerCallSafely = useCallback((operation: () => void, reportFailure = true) => {
    if (!mountedRef.current) return false;
    try {
      operation();
      return true;
    } catch {
      if (reportFailure && mountedRef.current) setFailed(true);
      return false;
    }
  }, []);
  const pauseSafely = useCallback((reportFailure = true) => (
    runPlayerCallSafely(() => player.pause(), reportFailure)
  ), [player, runPlayerCallSafely]);
  const replaceSafely = useCallback((uri: string) => (
    runPlayerCallSafely(() => player.replace({ uri }))
  ), [player, runPlayerCallSafely]);
  const playSafely = useCallback(() => (
    runPlayerCallSafely(() => player.play())
  ), [player, runPlayerCallSafely]);
  const setPlaybackRateSafely = useCallback((next: ChatVoiceSpeed) => (
    runPlayerCallSafely(() => player.setPlaybackRate(next, 'high'))
  ), [player, runPlayerCallSafely]);
  const seekSafely = useCallback(async (seconds: number, reportFailure = true) => {
    const generation = lifecycleGenerationRef.current;
    if (!isCurrentLifecycle(generation)) return false;
    try {
      await player.seekTo(seconds);
      return isCurrentLifecycle(generation);
    } catch {
      if (reportFailure && isCurrentLifecycle(generation)) setFailed(true);
      return false;
    }
  }, [isCurrentLifecycle, player]);

  useEffect(() => {
    if (!active && status.playing) pauseSafely(false);
  }, [active, pauseSafely, status.playing]);
  useEffect(() => {
    if (!status.didJustFinish) return;
    pauseSafely(false);
    void seekSafely(0, false);
  }, [pauseSafely, seekSafely, status.didJustFinish]);

  const toggle = useCallback(async () => {
    const generation = lifecycleGenerationRef.current;
    if (!isCurrentLifecycle(generation)) return;
    if (status.playing) { pauseSafely(); return; }
    activeRef.current = messageId; onActivate(messageId);
    try {
      setFailed(false);
      if (loadedAsset !== assetId) {
        setLoading(true);
        const url = await getChatVoicePlaybackUrl(assetId);
        if (!isCurrentLifecycle(generation) || activeRef.current !== messageId) return;
        if (!replaceSafely(url)) return;
        if (!isCurrentLifecycle(generation)) return;
        setLoadedAsset(assetId);
      }
      if (!isCurrentLifecycle(generation) || activeRef.current !== messageId) return;
      await restoreChatVoicePlaybackMode();
      if (!isCurrentLifecycle(generation) || activeRef.current !== messageId) return;
      if (!setPlaybackRateSafely(speed)) return;
      playSafely();
    } catch {
      if (isCurrentLifecycle(generation)) setFailed(true);
    } finally {
      if (isCurrentLifecycle(generation)) setLoading(false);
    }
  }, [assetId, isCurrentLifecycle, loadedAsset, messageId, onActivate, pauseSafely,
    playSafely, replaceSafely, setPlaybackRateSafely, speed, status.playing]);

  const cycleSpeed = useCallback(() => {
    const next = nextVoiceSpeed(speed);
    setSpeed(next);
    setPlaybackRateSafely(next);
  }, [setPlaybackRateSafely, speed]);
  const selectSpeed = useCallback((next: ChatVoiceSpeed) => {
    setSpeed(next);
    setPlaybackRateSafely(next);
  }, [setPlaybackRateSafely]);
  const progress = Math.max(0, Math.min(1, status.currentTime / Math.max(0.001, status.duration || durationMs / 1000)));

  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pausar nota de voz' : 'Reproducir nota de voz'}
      onPress={() => void toggle()} onLongPress={cycleSpeed} style={styles.play}>
      {loading ? <ActivityIndicator size="small" color={isMine ? '#fff' : Colors.primary} />
        : <MaterialCommunityIcons name={failed ? 'reload' : status.playing ? 'pause' : 'play'} size={22} color={isMine ? '#fff' : Colors.primary} />}
    </Pressable>
    <Pressable accessibilityRole="adjustable" accessibilityLabel="Progreso de nota de voz"
      onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))}
      onPress={event => {
        activeRef.current = messageId;
        onActivate(messageId);
        void seekSafely((event.nativeEvent.locationX / width) * (durationMs / 1000));
      }}
      style={styles.waveform}>
      {waveform.map((level, index) => <View key={index} style={[styles.bar, {
        height: 3 + level * 0.16,
        backgroundColor: index / waveform.length <= progress ? (isMine ? '#fff' : Colors.primary) : (isMine ? '#FFFFFF55' : Colors.textSubtle),
      }]} />)}
    </Pressable>
    <Text style={[styles.duration, isMine && styles.mine]}>{formatVoiceDuration(status.playing ? status.currentTime * 1000 : durationMs)}</Text>
    <View style={styles.speedGroup}>
      {([1, 1.5, 2] as ChatVoiceSpeed[]).map(option => (
        <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Velocidad ${option}x`}
          onPress={() => selectSpeed(option)} style={[styles.speed, speed === option && styles.speedActive]}>
          <Text style={[styles.speedText, isMine && styles.mine, speed === option && styles.speedTextActive]}>{option}x</Text>
        </Pressable>
      ))}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: 270, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 6 },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#3A4056', alignItems: 'center', justifyContent: 'center' },
  waveform: { flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 1 },
  bar: { flex: 1, minWidth: 1, borderRadius: 1 },
  duration: { minWidth: 30, color: Colors.textSubtle, fontSize: 10, fontVariant: ['tabular-nums'] },
  speedGroup: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  speed: { minWidth: 27, height: 24, paddingHorizontal: 4, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  speedActive: { backgroundColor: '#4A20A2' },
  speedText: { color: Colors.textSubtle, fontSize: 9, fontWeight: '700' },
  speedTextActive: { color: '#FFFFFF' },
  mine: { color: '#fff' },
});
