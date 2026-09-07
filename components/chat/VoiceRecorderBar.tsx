import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { AppLifecycle } from '@/modules/core/AppLifecycle';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  CHAT_VOICE_MAX_DURATION_MS,
  discardChatVoiceDraft,
  enableChatVoiceRecordingMode,
  ensureChatVoicePermission,
  formatVoiceDuration,
  meteringToVoiceLevel,
  normalizeVoiceWaveform,
  restoreChatVoicePlaybackMode,
  type ChatVoiceDraft,
} from '@/services/chatVoiceService';

type Props = {
  identityKey: string;
  disabled?: boolean;
  onSend: (draft: ChatVoiceDraft) => Promise<void>;
  onError: (message: string) => void;
  onRecordingChange?: (active: boolean) => void;
};

export function VoiceRecorderBar({ identityKey, disabled, onSend, onError, onRecordingChange }: Props) {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const status = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'ready' | 'sending'>('idle');
  const [draft, setDraft] = useState<ChatVoiceDraft | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const levelsRef = useRef<number[]>([]);
  const operationRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const cancelRef = useRef<() => Promise<void>>(async () => undefined);

  const restoreMode = useCallback(() => restoreChatVoicePlaybackMode().catch(() => undefined), []);

  const stopToDraft = useCallback(async (): Promise<ChatVoiceDraft | null> => {
    if (operationRef.current || phase !== 'recording') return draft;
    operationRef.current = true;
    const generation = generationRef.current;
    const durationMs = Math.min(CHAT_VOICE_MAX_DURATION_MS, Math.max(0, status.durationMillis));
    try {
      await recorder.stop();
      await restoreMode();
      const uri = recorder.uri;
      if (generation !== generationRef.current || !uri || durationMs < 1) {
        if (uri) discardChatVoiceDraft(uri);
        if (mountedRef.current && generation === generationRef.current) {
          setPhase('idle'); onError('La grabación está vacía.');
        }
        return null;
      }
      const next = { uri, mimeType: 'audio/mp4' as const, durationMs,
        waveform: normalizeVoiceWaveform(levelsRef.current) };
      setDraft(next); setPhase('ready');
      return next;
    } catch {
      await restoreMode(); setPhase('idle'); onError('No se pudo finalizar la grabación.'); return null;
    } finally { operationRef.current = false; }
  }, [draft, onError, phase, recorder, restoreMode, status.durationMillis]);

  const cancel = useCallback(async () => {
    if (operationRef.current) return;
    operationRef.current = true; generationRef.current += 1;
    try { if (recorder.isRecording) await recorder.stop(); } catch { /* already stopped */ }
    const uri = draft?.uri ?? recorder.uri; if (uri) discardChatVoiceDraft(uri);
    levelsRef.current = []; setLevels([]); setDraft(null); setPhase('idle');
    await restoreMode(); operationRef.current = false;
  }, [draft?.uri, recorder, restoreMode]);
  cancelRef.current = cancel;

  const start = useCallback(async () => {
    if (disabled || operationRef.current || phase !== 'idle') return;
    operationRef.current = true; const generation = ++generationRef.current;
    try {
      if (!(await ensureChatVoicePermission())) { onError('Activa el permiso del micrófono para grabar una nota de voz.'); return; }
      if (generation !== generationRef.current || !mountedRef.current) return;
      await enableChatVoiceRecordingMode();
      if (generation !== generationRef.current || !mountedRef.current) { await restoreMode(); return; }
      await recorder.prepareToRecordAsync();
      if (generation !== generationRef.current || !mountedRef.current) { await restoreMode(); return; }
      levelsRef.current = []; setLevels([]); setDraft(null);
      recorder.record(); setPhase('recording');
    } catch { await restoreMode(); onError('No se pudo iniciar la grabación.'); }
    finally { operationRef.current = false; }
  }, [disabled, onError, phase, recorder, restoreMode]);

  const send = useCallback(async () => {
    if (operationRef.current || phase === 'sending') return;
    const ready = phase === 'recording' ? await stopToDraft() : draft;
    if (!ready) return;
    operationRef.current = true; const generation = generationRef.current; setPhase('sending');
    try {
      await onSend(ready); discardChatVoiceDraft(ready.uri);
      if (mountedRef.current && generation === generationRef.current) {
        levelsRef.current = []; setLevels([]); setDraft(null); setPhase('idle');
      }
    } catch {
      if (mountedRef.current && generation === generationRef.current) {
        setPhase('ready'); onError('No se pudo enviar la nota de voz. Inténtalo nuevamente.');
      }
    }
    finally { operationRef.current = false; }
  }, [draft, onError, onSend, phase, stopToDraft]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const level = meteringToVoiceLevel(status.metering);
    levelsRef.current = [...levelsRef.current.slice(-95), level];
    setLevels(levelsRef.current.slice(-48));
    if (status.durationMillis >= CHAT_VOICE_MAX_DURATION_MS) void stopToDraft();
  }, [phase, status.durationMillis, status.metering, stopToDraft]);

  useEffect(() => {
    const unsubscribe = AppLifecycle.onBackground(() => { void cancel(); });
    return unsubscribe;
  }, [cancel]);

  useEffect(() => { onRecordingChange?.(phase !== 'idle'); }, [onRecordingChange, phase]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; generationRef.current += 1; void cancelRef.current(); };
  }, [identityKey]);

  if (phase === 'idle') return (
    <Pressable accessibilityRole="button" accessibilityLabel="Grabar nota de voz"
      disabled={disabled} onPress={start} hitSlop={8} style={styles.micButton}>
      <MaterialCommunityIcons name="microphone-outline" size={22} color={Colors.textSecondary} />
    </Pressable>
  );

  const shownLevels = normalizeVoiceWaveform(levels);
  return <View style={styles.bar}>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancelar nota de voz" onPress={() => void cancel()} style={styles.action}>
      <MaterialCommunityIcons name="delete-outline" size={22} color={Colors.error} />
    </Pressable>
    <View style={styles.recordingDot} />
    <Text style={styles.duration}>{formatVoiceDuration(draft?.durationMs ?? status.durationMillis)}</Text>
    <View style={styles.waveform} accessibilityLabel="Forma de onda de la grabación">
      {shownLevels.map((level, index) => <View key={index} style={[styles.waveBar, { height: 3 + level * 0.14 }]} />)}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Enviar nota de voz" onPress={() => void send()} style={styles.send}>
      {phase === 'sending' ? <ActivityIndicator size="small" color="#fff" />
        : <MaterialCommunityIcons name="send" size={18} color="#fff" />}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  micButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, paddingHorizontal: Spacing.sm },
  action: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  duration: { minWidth: 36, color: Colors.textPrimary, fontVariant: ['tabular-nums'], fontSize: 12 },
  waveform: { flex: 1, height: 24, flexDirection: 'row', alignItems: 'center', gap: 1 },
  waveBar: { flex: 1, minWidth: 1, borderRadius: 1, backgroundColor: Colors.primary },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
});
