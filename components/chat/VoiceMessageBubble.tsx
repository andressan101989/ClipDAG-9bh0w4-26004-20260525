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

  useEffect(() => { if (!active && status.playing) player.pause(); }, [active, player, status.playing]);
  useEffect(() => {
    if (!status.didJustFinish) return;
    player.pause(); void player.seekTo(0);
  }, [player, status.didJustFinish]);
  useEffect(() => () => { player.pause(); }, [player]);

  const toggle = useCallback(async () => {
    if (status.playing) { player.pause(); return; }
    activeRef.current = messageId; onActivate(messageId);
    try {
      setFailed(false);
      if (loadedAsset !== assetId) {
        setLoading(true);
        const url = await getChatVoicePlaybackUrl(assetId);
        if (activeRef.current !== messageId) return;
        player.replace({ uri: url }); setLoadedAsset(assetId);
      }
      if (activeRef.current !== messageId) return;
      await restoreChatVoicePlaybackMode();
      player.setPlaybackRate(speed, 'high'); player.play();
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, [assetId, loadedAsset, messageId, onActivate, player, speed, status.playing]);

  const cycleSpeed = useCallback(() => {
    const next = nextVoiceSpeed(speed); setSpeed(next); player.setPlaybackRate(next, 'high');
  }, [player, speed]);
  const progress = Math.max(0, Math.min(1, status.currentTime / Math.max(0.001, status.duration || durationMs / 1000)));

  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityLabel={status.playing ? 'Pausar nota de voz' : 'Reproducir nota de voz'}
      onPress={() => void toggle()} style={styles.play}>
      {loading ? <ActivityIndicator size="small" color={isMine ? '#fff' : Colors.primary} />
        : <MaterialCommunityIcons name={failed ? 'reload' : status.playing ? 'pause' : 'play'} size={22} color={isMine ? '#fff' : Colors.primary} />}
    </Pressable>
    <Pressable accessibilityRole="adjustable" accessibilityLabel="Progreso de nota de voz"
      onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))}
      onPress={event => { onActivate(messageId); void player.seekTo((event.nativeEvent.locationX / width) * (durationMs / 1000)); }}
      style={styles.waveform}>
      {waveform.map((level, index) => <View key={index} style={[styles.bar, {
        height: 3 + level * 0.16,
        backgroundColor: index / waveform.length <= progress ? (isMine ? '#fff' : Colors.primary) : (isMine ? '#FFFFFF55' : Colors.textSubtle),
      }]} />)}
    </Pressable>
    <Text style={[styles.duration, isMine && styles.mine]}>{formatVoiceDuration(status.playing ? status.currentTime * 1000 : durationMs)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Velocidad ${speed}x`} onPress={cycleSpeed} style={styles.speed}>
      <Text style={[styles.speedText, isMine && styles.mine]}>{speed}x</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: 244, minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 6 },
  play: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  waveform: { flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 1 },
  bar: { flex: 1, minWidth: 1, borderRadius: 1 },
  duration: { minWidth: 30, color: Colors.textSubtle, fontSize: 10, fontVariant: ['tabular-nums'] },
  speed: { minWidth: 30, height: 28, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  speedText: { color: Colors.primary, fontSize: 10, fontWeight: '700' },
  mine: { color: '#fff' },
});
