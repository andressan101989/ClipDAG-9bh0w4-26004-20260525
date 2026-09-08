import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { AppLifecycle } from '@/modules/core/AppLifecycle';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  CHAT_VOICE_MAX_DURATION_MS,
  CHAT_VOICE_RECORDING_OPTIONS,
  ChatVoiceRecorderLifecycle,
  ChatVoiceRecorderStopGate,
  discardChatVoiceDraft,
  enableChatVoiceRecordingMode,
  ensureChatVoicePermission,
  formatVoiceDuration,
  meteringToVoiceLevel,
  normalizeVoiceWaveform,
  restoreChatVoicePlaybackMode,
  startChatVoiceRecorder,
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
  const recorder = useAudioRecorder({ ...CHAT_VOICE_RECORDING_OPTIONS, isMeteringEnabled: true });
  const status = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'ready' | 'sending'>('idle');
  const [draft, setDraft] = useState<ChatVoiceDraft | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const levelsRef = useRef<number[]>([]);
  const draftRef = useRef<ChatVoiceDraft | null>(null);
  const operationRef = useRef(false);
  const stopGateRef = useRef(new ChatVoiceRecorderStopGate());
  const recorderActiveRef = useRef(false);
  const recorderUriRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const restoreMode = useCallback(() => restoreChatVoicePlaybackMode().catch(() => undefined), []);
  const readRecorderUriSafely = useCallback(() => {
    try { return recorder.uri ?? null; } catch { return null; }
  }, [recorder]);
  const stopRecorder = useCallback(async (cleanup = false) => {
    try {
      await stopGateRef.current.stop(
        () => recorderActiveRef.current,
        async () => {
          await recorder.stop();
          recorderUriRef.current = readRecorderUriSafely();
          recorderActiveRef.current = false;
        },
        { bestEffort: cleanup },
      );
      if (cleanup) recorderActiveRef.current = false;
    } catch (error) {
      if (!cleanup) throw error;
      recorderActiveRef.current = false;
    }
  }, [readRecorderUriSafely, recorder]);
  const cleanupResources = useCallback(async () => {
    await stopRecorder(true);
    const draftUri = draftRef.current?.uri ?? null;
    const recorderUri = recorderUriRef.current;
    if (draftUri) discardChatVoiceDraft(draftUri);
    if (recorderUri && recorderUri !== draftUri) discardChatVoiceDraft(recorderUri);
    draftRef.current = null; levelsRef.current = [];
    recorderUriRef.current = null;
    await restoreMode();
  }, [restoreMode, stopRecorder]);
  const cleanupResourcesRef = useRef(cleanupResources);
  cleanupResourcesRef.current = cleanupResources;
  const lifecycleRef = useRef<ChatVoiceRecorderLifecycle | null>(null);
  if (!lifecycleRef.current) {
    lifecycleRef.current = new ChatVoiceRecorderLifecycle(() => cleanupResourcesRef.current());
  }
  const lifecycle = lifecycleRef.current;

  const stopToDraft = useCallback(async (): Promise<ChatVoiceDraft | null> => {
    if (operationRef.current || phase !== 'recording') return draft;
    operationRef.current = true;
    const stopStartedAt = Date.now();
    const generation = lifecycle.snapshot();
    const durationMs = Math.min(CHAT_VOICE_MAX_DURATION_MS, Math.max(0, status.durationMillis));
    try {
      await stopRecorder();
      await restoreMode();
      const uri = recorderUriRef.current ?? readRecorderUriSafely();
      if (!lifecycle.isCurrent(generation) || !uri || durationMs < 1) {
        if (uri) discardChatVoiceDraft(uri);
        if (mountedRef.current && lifecycle.isCurrent(generation)) {
          setPhase('idle'); onError('La grabación está vacía.');
        }
        return null;
      }
      const next = { uri, mimeType: 'audio/mp4' as const, durationMs,
        waveform: normalizeVoiceWaveform(levelsRef.current) };
      console.info('[ChatVoice]', {
        stage: 'VOICE_STOP_TO_DRAFT_TIMING',
        stop_to_draft_ms: Math.max(0, Date.now() - stopStartedAt),
      });
      draftRef.current = next;
      setDraft(next); setPhase('ready');
      return next;
    } catch {
      await restoreMode(); setPhase('idle'); onError('No se pudo finalizar la grabación.'); return null;
    } finally { operationRef.current = false; }
  }, [draft, lifecycle, onError, phase, readRecorderUriSafely, restoreMode, status.durationMillis, stopRecorder]);

  const cancel = useCallback(async () => {
    const invalidated = lifecycle.invalidate();
    levelsRef.current = [];
    if (mountedRef.current && lifecycle.isCurrent(invalidated.generation)) {
      setLevels([]); setDraft(null); setPhase('idle');
    }
    await invalidated.cleanup;
  }, [lifecycle]);

  const start = useCallback(async () => {
    if (disabled || operationRef.current || phase !== 'idle') return;
    operationRef.current = true;
    try {
      const result = await startChatVoiceRecorder({ lifecycle,
        ensurePermission: ensureChatVoicePermission,
        enableRecordingMode: enableChatVoiceRecordingMode,
        prepare: () => recorder.prepareToRecordAsync(),
        record: () => { recorderUriRef.current = null; recorder.record(); recorderActiveRef.current = true; },
      });
      if (result === 'denied' && mountedRef.current) {
        onError('Activa el permiso del micrófono para grabar una nota de voz.');
      } else if (result === 'started' && mountedRef.current) {
        draftRef.current = null; levelsRef.current = []; setLevels([]); setDraft(null); setPhase('recording');
      }
    } catch { if (mountedRef.current) onError('No se pudo iniciar la grabación.'); }
    finally { operationRef.current = false; }
  }, [disabled, lifecycle, onError, phase, recorder]);

  const send = useCallback(async () => {
    if (operationRef.current || phase === 'sending') return;
    const ready = phase === 'recording' ? await stopToDraft() : draft;
    if (!ready) return;
    operationRef.current = true; const generation = lifecycle.snapshot(); setPhase('sending');
    try {
      await onSend(ready); discardChatVoiceDraft(ready.uri);
      if (mountedRef.current && lifecycle.isCurrent(generation)) {
        draftRef.current = null; levelsRef.current = []; setLevels([]); setDraft(null); setPhase('idle');
      }
    } catch {
      if (mountedRef.current && lifecycle.isCurrent(generation)) {
        setPhase('ready'); onError('No se pudo enviar la nota de voz. Inténtalo nuevamente.');
      }
    }
    finally { operationRef.current = false; }
  }, [draft, lifecycle, onError, onSend, phase, stopToDraft]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const level = meteringToVoiceLevel(status.metering);
    levelsRef.current = [...levelsRef.current.slice(-95), level];
    setLevels(levelsRef.current.slice(-48));
    if (status.durationMillis >= CHAT_VOICE_MAX_DURATION_MS) void stopToDraft();
  }, [phase, status.durationMillis, status.metering, stopToDraft]);

  useEffect(() => {
    const unsubscribe = AppLifecycle.onBackground(() => { void cancel().catch(() => undefined); });
    return unsubscribe;
  }, [cancel]);

  useEffect(() => { onRecordingChange?.(phase !== 'idle'); }, [onRecordingChange, phase]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void lifecycle.invalidate().cleanup.catch(() => undefined);
    };
  }, [identityKey, lifecycle]);

  if (phase === 'idle') return (
    <Pressable accessibilityRole="button" accessibilityLabel="Grabar nota de voz"
      disabled={disabled} onPress={start} hitSlop={8} style={styles.micButton}>
      <MaterialCommunityIcons name="microphone" size={22} color="#FFFFFF" />
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
  micButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#9B5CFF', alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, paddingHorizontal: Spacing.sm },
  action: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  duration: { minWidth: 36, color: Colors.textPrimary, fontVariant: ['tabular-nums'], fontSize: 12 },
  waveform: { flex: 1, height: 24, flexDirection: 'row', alignItems: 'center', gap: 1 },
  waveBar: { flex: 1, minWidth: 1, borderRadius: 1, backgroundColor: Colors.primary },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
});
