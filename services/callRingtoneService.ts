import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Platform } from 'react-native';
import { getNativeStateStrict } from '@/services/iosCallKitService';

type CallSoundKind = 'incoming' | 'outgoing';
type StopCallSoundsOptions = { preserveCallKitAudioSession?: boolean };

type ActiveCallSound = {
  kind: CallSoundKind;
  callId: string;
  generation: number;
  sound: Audio.Sound | null;
  startPromise: Promise<void> | null;
};

const INCOMING_RINGTONE = require('../assets/audio/incoming-ringtone.wav');
const OUTGOING_RINGBACK = require('../assets/audio/outgoing-ringback.wav');

let activeSound: ActiveCallSound | null = null;
let generation = 0;

function warnAudio(message: string, error?: unknown) {
  if (__DEV__) {
    console.warn('[CallRingtone]', message, error instanceof Error ? error.message : error ?? '');
  }
}

async function configureRingtoneAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

async function resetAudioMode() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch (error) {
    warnAudio('Failed to reset audio mode', error);
  }
}

async function unloadSound(sound: Audio.Sound | null) {
  if (!sound) return;
  try { await sound.stopAsync(); } catch { /* already stopped */ }
  try { await sound.unloadAsync(); } catch (error) { warnAudio('Failed to unload sound', error); }
}

async function startCallSound(kind: CallSoundKind, callId: string, volume: number) {
  if (!callId) return;
  if (activeSound?.kind === kind && activeSound.callId === callId) {
    await activeSound.startPromise;
    return;
  }

  await stopAllCallSounds();

  const localGeneration = ++generation;
  const entry: ActiveCallSound = {
    kind,
    callId,
    generation: localGeneration,
    sound: null,
    startPromise: null,
  };
  activeSound = entry;

  entry.startPromise = (async () => {
    try {
      await configureRingtoneAudioMode();
      const { sound } = await Audio.Sound.createAsync(
        kind === 'incoming' ? INCOMING_RINGTONE : OUTGOING_RINGBACK,
        { shouldPlay: true, isLooping: true, volume },
      );

      if (activeSound !== entry || generation !== localGeneration) {
        await unloadSound(sound);
        return;
      }

      entry.sound = sound;
    } catch (error) {
      if (activeSound === entry) activeSound = null;
      warnAudio(`Failed to start ${kind} call sound`, error);
    }
  })();

  await entry.startPromise;
}

async function stopCallSound(kind: CallSoundKind, callId?: string) {
  const entry = activeSound;
  if (!entry || entry.kind !== kind) return;
  if (callId && entry.callId !== callId) return;

  activeSound = null;
  generation += 1;
  await unloadSound(entry.sound);
  await resetAudioMode();
}

export async function startIncomingRingtone(callId: string) {
  await startCallSound('incoming', callId, 1);
}

export async function stopIncomingRingtone(callId?: string) {
  await stopCallSound('incoming', callId);
}

export async function startOutgoingRingback(callId: string) {
  await startCallSound('outgoing', callId, 0.55);
}

export async function stopOutgoingRingback(callId?: string) {
  await stopCallSound('outgoing', callId);
}

export async function stopAllCallSounds(options: StopCallSoundsOptions = {}) {
  const entry = activeSound;
  activeSound = null;
  generation += 1;
  if (entry) {
    await unloadSound(entry.sound);
  }
  if (!options.preserveCallKitAudioSession) {
    await resetAudioMode();
  }
}

export async function stopAllCallSoundsForCall(callId?: string) {
  if (Platform.OS !== 'ios' || !callId) {
    await stopAllCallSounds();
    return;
  }

  let preserveCallKitAudioSession = false;
  try {
    const nativeState = await getNativeStateStrict();
    preserveCallKitAudioSession = nativeState.audioSessionActive
      || (nativeState.hasReportedCall && nativeState.currentCallId === callId);
  } catch {
    // A transient bridge failure must not let expo-av overwrite a session
    // that may already have been configured/activated by CallKit.
    preserveCallKitAudioSession = true;
  }
  await stopAllCallSounds({ preserveCallKitAudioSession });
}
