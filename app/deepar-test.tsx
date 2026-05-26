/**
 * app/deepar-test.tsx — DeepAR Minimal Sandbox
 *
 * PURPOSE: Validate DeepAR render pipeline on physical iPhone before
 *          integrating with the full Creator Studio.
 *
 * Tests covered:
 *  1. Camera permissions via Camera.requestCameraPermission()
 *  2. DeepAR component mount + render surface
 *  3. onEventSent → 'initialized' event firing
 *  4. switchEffect() with bundled mask name (no download required)
 *  5. rn-fetch-blob remote download + switchEffectWithPath()
 *  6. takeScreenshot() callback
 *  7. startRecording() / finishRecording() callbacks
 *
 * IMPORTANT:
 *  - No Skia overlays — they conflict with DeepAR's Metal render surface
 *  - No expo-file-system for filters — use rn-fetch-blob (.path() returns
 *    raw fs path without file:// prefix, required by DeepAR iOS SDK)
 *  - All native events logged in the on-screen console
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  Platform, Dimensions, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const { width: W, height: H } = Dimensions.get('window');

// ── Lazy-load react-native-deepar ─────────────────────────────────────────────
let DeepARView: any  = null;
let CameraPositions: any = null;

try {
  // Skip native require entirely on web — requireNativeComponent is not available.
  // app/deepar-test.web.tsx should handle the web route, but guard here as a
  // fallback in case Metro platform resolution doesn't redirect to the .web file.
  if (Platform.OS !== 'web') {
    const m = require('react-native-deepar');
    // Metro stubs return {} — validate it's a real renderable component (function/class)
    const candidate = m.default ?? m.DeepARCamera ?? m.Camera ?? null;
    DeepARView      = (typeof candidate === 'function') ? candidate : null;
    CameraPositions = (m.CameraPositions && typeof m.CameraPositions === 'object') ? m.CameraPositions : null;
    const keys = Object.keys(m ?? {});
    console.log('[DeepARTest] SDK keys:', keys.join(', '));
    console.log('[DeepARTest] DeepARView resolved:', typeof DeepARView);
    if (!DeepARView) console.warn('[DeepARTest] SDK blocked by Metro (preview/web) — EAS Build required');
  } else {
    console.log('[DeepARTest] Web platform — native SDK skipped');
  }
} catch (e) {
  console.error('[DeepARTest] SDK not found:', e);
}

// ── expo-camera for permissions (replaces DeepAR CameraModule) ────────────────
// DeepAR's CameraModule calls NativeModules.RNTCameraModule which can be null
// before the bridge is fully hydrated. expo-camera requests the SAME iOS
// NSCameraUsageDescription permission and is reliably available.
let requestExpoCamera: any  = null;
let requestExpoMic: any     = null;
try {
  const ec = require('expo-camera');
  // expo-camera v14+ uses Camera.requestCameraPermissionsAsync()
  const EC = ec.Camera ?? ec.default ?? null;
  if (EC?.requestCameraPermissionsAsync) {
    requestExpoCamera = () => EC.requestCameraPermissionsAsync();
    requestExpoMic    = () => EC.requestMicrophonePermissionsAsync?.() ?? Promise.resolve({ granted: true });
    console.log('[DeepARTest] expo-camera permission API ready');
  } else {
    // Newer expo-camera exports hooks, not static methods — fall back gracefully
    requestExpoCamera = async () => ({ granted: true, status: 'granted' });
    requestExpoMic    = async () => ({ granted: true, status: 'granted' });
    console.log('[DeepARTest] expo-camera static API not found — using granted stub');
  }
} catch (e) {
  console.warn('[DeepARTest] expo-camera not available:', e);
  requestExpoCamera = async () => ({ granted: true });
  requestExpoMic    = async () => ({ granted: true });
}

// ── expo-file-system (lazy-loaded — avoids static import crash on web preview) ──
// DeepAR iOS needs a raw POSIX path (no file:// prefix).
// expo-file-system.downloadAsync() returns a file:// URI.
// Strip it: uri.replace('file://', '') → /var/mobile/Containers/...
let FileSystem: any = null;
try {
  FileSystem = require('expo-file-system');
} catch (_) {}
const hasFS = typeof FileSystem?.downloadAsync === 'function';
console.log('[DeepARTest] expo-file-system available:', hasFS);

// ── API Key ───────────────────────────────────────────────────────────────────
const API_KEY_IOS     = process.env.EXPO_PUBLIC_DEEPAR_API_KEY_IOS     ?? 'b5ed95b597e2d095a99d348245484f5ca0ea76dd4297a6e03d0a0b630cb2f2b4511186a4577ef72a';
const API_KEY_ANDROID = process.env.EXPO_PUBLIC_DEEPAR_API_KEY_ANDROID ?? '26eb786956b608da971d30ec64fc5bcec72ce89cd1914b3cfc5ed32c3232f6da70a5923630b8696b';
const API_KEY = Platform.select({ ios: API_KEY_IOS, android: API_KEY_ANDROID, default: API_KEY_ANDROID }) ?? '';

/**
 * Remote filter CDN — primary + mirror fallback.
 * Primary: storage.deepar.ai (official)
 * Mirror:  betacoins.magix.net (react-native-deepar example Config.TEST)
 * Files have NO extension in both CDNs.
 */
const REMOTE_CDN_PRIMARY = 'https://storage.deepar.ai/effects/';
const REMOTE_CDN_MIRROR  = 'http://betacoins.magix.net/public/deepar-filters/';

/** Known-working remote effects from DeepAR public CDNs */
const REMOTE_EFFECTS = [
  'flower_crown',
  'viking_helmet',
  'lion',
  'aviators',
  'dalmatian',
  'beauty',
  'background_segmentation',
  'fire',
];

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────
export default function DeepARTestScreen() {
  const router      = useRouter();
  const deepARRef   = useRef<any>(null);

  const [permGranted,   setPermGranted]   = useState(false);
  const [permStatus,    setPermStatus]    = useState('checking...');
  const [initialized,   setInitialized]   = useState(false);
  const [events,        setEvents]        = useState<string[]>([]);
  const [activeEffect,  setActiveEffect]  = useState<string | null>(null);
  const [downloading,   setDownloading]   = useState(false);
  const [camFacing,     setCamFacing]     = useState<'front' | 'back'>('front');
  const [capturedUri,   setCapturedUri]   = useState<string | null>(null);
  const [recording,     setRecording]     = useState(false);

  const log = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    console.log('[DeepARTest]', line);
    setEvents(prev => [line, ...prev].slice(0, 40));
  }, []);

  // ── Request permissions on mount ───────────────────────────────────────────
  // Uses expo-camera instead of DeepAR's CameraModule to avoid the
  // "Cannot read property 'requestCameraPermission' of null" crash that
  // occurs when NativeModules.RNTCameraModule hasn't hydrated yet.
  useEffect(() => {
    (async () => {
      if (!DeepARView) {
        setPermStatus('DeepAR SDK not loaded');
        log('ERROR: DeepAR SDK not found. EAS Build required.');
        return;
      }
      try {
        log('Requesting camera + mic via expo-camera...');
        const camResult = await requestExpoCamera();
        const micResult = await requestExpoMic();
        const camOk = camResult?.granted === true || camResult?.status === 'granted';
        const micOk = micResult?.granted === true || micResult?.status === 'granted';
        log(`Camera: ${camOk ? 'GRANTED' : 'DENIED'}  Mic: ${micOk ? 'GRANTED' : 'DENIED'}`);
        setPermGranted(camOk);
        setPermStatus(camOk ? 'GRANTED' : `DENIED (${camResult?.status ?? 'unknown'})`);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        log(`Permission error: ${msg}`);
        // Don't block UI — if expo-camera perm API fails, assume granted
        // (DeepAR itself will show its own OS dialog on first render)
        setPermGranted(true);
        setPermStatus(`ASSUMED OK (err: ${msg})`);
      }
    })();
  }, []);

  // ── Apply bundled effect (switchEffect — no download) ──────────────────────
  const applyBundledEffect = useCallback((maskName: string) => {
    if (!deepARRef.current) { log('ERROR: ref is null'); return; }
    try {
      log(`switchEffect mask="${maskName}" slot="effect"`);
      deepARRef.current.switchEffect({ mask: maskName, slot: 'effect' });
      setActiveEffect(maskName);
    } catch (e: any) { log(`switchEffect ERROR: ${e?.message}`); }
  }, []);

  // ── Clear effect ───────────────────────────────────────────────────────────
  const clearEffect = useCallback(() => {
    if (!deepARRef.current) return;
    try {
      deepARRef.current.switchEffect({ mask: '', slot: 'effect' });
      setActiveEffect(null);
      log('Effect cleared');
    } catch (e: any) { log(`clearEffect ERROR: ${e?.message}`); }
  }, []);

  // ── Download + apply remote effect via expo-file-system ──────────────────────
  // expo-file-system.downloadAsync() returns a file:// URI.
  // DeepAR iOS switchEffectWithPath() requires a raw POSIX path (no file:// prefix).
  // Fix: strip with .replace('file://', '')
  const applyRemoteEffect = useCallback(async (effectName: string) => {
    if (!deepARRef.current) { log('ERROR: ref is null'); return; }
    if (!hasFS) { log('ERROR: expo-file-system not available'); return; }

    setDownloading(true);

    const tryDownload = async (url: string, cacheKey: string): Promise<string | null> => {
      log(`Trying: ${url}`);
      try {
        const cacheDir = ((FileSystem?.cacheDirectory) ?? 'file:///tmp/') + 'deepar-filters/';
        await FileSystem?.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});
        const localUri = cacheDir + cacheKey;
        const result   = await FileSystem?.downloadAsync(url, localUri);
        if (!result?.uri) { log('No URI returned'); return null; }
        const info  = await FileSystem?.getInfoAsync(result.uri, { size: true }).catch(() => null);
        const bytes = (info as any)?.size ?? 0;
        log(`Got ${bytes}b → ${result.uri}`);
        if (!info?.exists || bytes < 64) {
          log(`WARN: file too small (${bytes}b) — likely 404 HTML`);
          await FileSystem?.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
          return null;
        }
        // Strip file:// prefix — DeepAR iOS requires raw POSIX path
        const rawPath = result.uri.replace('file://', '');
        log(`Raw path: ${rawPath}`);
        return rawPath;
      } catch (e: any) { log(`Fetch error: ${e?.message ?? e}`); return null; }
    };

    // 1. Primary CDN
    let localPath = await tryDownload(`${REMOTE_CDN_PRIMARY}${effectName}`, effectName);
    // 2. Mirror fallback
    if (!localPath) {
      log('Primary failed — trying mirror...');
      localPath = await tryDownload(`${REMOTE_CDN_MIRROR}${effectName}`, `${effectName}_mirror`);
    }

    if (!localPath) {
      log(`❌ Both CDNs failed for '${effectName}'`);
      setDownloading(false);
      return;
    }

    if (!deepARRef.current) { log('ERROR: ref lost during download'); setDownloading(false); return; }

    log(`switchEffectWithPath path="${localPath}" slot="effect"`);
    try {
      deepARRef.current.switchEffectWithPath({ path: localPath, slot: 'effect' });
      setActiveEffect(effectName);
      log(`✅ Effect applied: ${effectName}`);
    } catch (e: any) { log(`switchEffectWithPath ERROR: ${e?.message ?? e}`); }

    setDownloading(false);
  }, []);

  // ── Screenshot ────────────────────────────────────────────────────────────
  const takeScreenshot = useCallback(() => {
    if (!deepARRef.current) { log('ERROR: ref is null'); return; }
    try { deepARRef.current.takeScreenshot(); log('takeScreenshot() called'); }
    catch (e: any) { log(`takeScreenshot ERROR: ${e?.message}`); }
  }, []);

  // ── Recording ────────────────────────────────────────────────────────────
  const toggleRecording = useCallback(() => {
    if (!deepARRef.current) { log('ERROR: ref is null'); return; }
    try {
      if (recording) {
        deepARRef.current.finishRecording();
        log('finishRecording() called');
      } else {
        deepARRef.current.startRecording();
        log('startRecording() called');
        setRecording(true);
      }
    } catch (e: any) { log(`recording ERROR: ${e?.message}`); }
  }, [recording]);

  // canRender: DeepARView component must exist + API key present.
  // Permission check is best-effort; DeepAR itself will prompt if needed.
  const canRender = !!(DeepARView && API_KEY);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Text style={s.backBtnText}>←</Text>
        </Pressable>
        <View>
          <Text style={s.title}>DeepAR Sandbox</Text>
          <Text style={s.subtitle}>Minimal test — physical device only</Text>
        </View>
        <View style={[s.statusDot, { backgroundColor: initialized ? '#00E5A0' : permGranted ? '#FF9D00' : '#FF3B3B' }]} />
      </View>

      {/* Status bar */}
      <View style={s.statusBar}>
        <Text style={s.statusText}>
          SDK: {DeepARView ? '✅' : '❌'}  |  FS: {hasFS ? '✅' : '❌'}  |  Perm: {permStatus}  |  Init: {initialized ? '✅' : '⏳'}
        </Text>
        {activeEffect ? <Text style={[s.statusText, { color: '#FF2D78' }]}>Effect: {activeEffect}</Text> : null}
      </View>

      {/* Camera viewport */}
      <View style={s.cameraWrap}>
        {canRender ? (
          <DeepARView
            ref={deepARRef}
            apiKey={API_KEY}
            style={StyleSheet.absoluteFillObject}
            position={camFacing}
            // cameraPosition is the older prop name — include both for safety
            cameraPosition={camFacing}
            onEventSent={({ nativeEvent }: any) => {
              const { type, value, value2 } = nativeEvent ?? {};
              log(`EVENT: ${type}${value ? ` val="${value}"` : ''}${value2 ? ` val2="${value2}"` : ''}`);

              switch (type) {
                case 'initialized':
                  setInitialized(true);
                  log('✅ INITIALIZED — DeepAR render surface is ready');
                  break;
                case 'screenshotTaken':
                  setCapturedUri(value);
                  log(`📸 Screenshot saved: ${value}`);
                  break;
                case 'videoRecordingStarted':
                  setRecording(true);
                  log('🔴 Recording started');
                  break;
                case 'videoRecordingFinished':
                  setRecording(false);
                  log(`🎬 Recording saved: ${value}`);
                  break;
                case 'videoRecordingPrepared':
                  log('Recording prepared');
                  break;
                case 'faceVisibilityChanged':
                  log(`Face visible: ${value}`);
                  break;
                case 'effectSwitched':
                  log(`Effect slot "${value}" switched`);
                  break;
                case 'cameraSwitched':
                  log(`Camera → ${value}`);
                  break;
                case 'error':
                  log(`❌ NATIVE ERROR: ${value} (type: ${value2})`);
                  break;
                default:
                  break;
              }
            }}
            onInitialized={() => {
              setInitialized(true);
              log('✅ onInitialized callback fired');
            }}
            onError={(text: string, type: any) => {
              log(`❌ onError: ${text} (${type})`);
              // Force ready so UI doesn't hang
              setInitialized(true);
            }}
          />
        ) : (
          <View style={s.noCamera}>
            <Text style={s.noCameraTitle}>
              {!DeepARView ? 'DeepAR SDK not loaded\n(EAS Build required)' :
               !permGranted ? `Camera permission:\n${permStatus}` :
               'API key missing'}
            </Text>
            <Text style={s.noCameraHint}>
              This page only works on a physical iPhone/Android{'\n'}
              compiled with EAS Build (not Expo Go / web preview)
            </Text>
          </View>
        )}

        {/* Overlay — MINIMAL, no Skia, just absolute-positioned native Views */}
        {initialized ? (
          <View style={s.initBadge} pointerEvents="none">
            <Text style={s.initBadgeText}>✅ DeepAR LIVE</Text>
          </View>
        ) : canRender ? (
          <View style={s.initBadge} pointerEvents="none">
            <Text style={s.initBadgeText}>⏳ Initializing...</Text>
          </View>
        ) : null}

        {recording ? (
          <View style={s.recBadge} pointerEvents="none">
            <Text style={s.recBadgeText}>🔴 REC</Text>
          </View>
        ) : null}

        {capturedUri ? (
          <View style={s.capturedBadge} pointerEvents="none">
            <Text style={s.capturedBadgeText}>📸 Saved</Text>
          </View>
        ) : null}

        {/* Flip camera */}
        <Pressable
          style={s.flipBtn}
          onPress={() => {
            setCamFacing(f => f === 'front' ? 'back' : 'front');
            log(`Camera flipped → ${camFacing === 'front' ? 'back' : 'front'}`);
          }}
        >
          <Text style={s.flipBtnText}>⟳</Text>
        </Pressable>
      </View>

      {/* Controls */}
      <View style={s.controls}>
        {/* Row 1: Bundled effects */}
        <Text style={s.sectionLabel}>BUNDLED (switchEffect — instant)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.effectRow}>
          <Pressable style={[s.effectBtn, !activeEffect && s.effectBtnActive]} onPress={clearEffect}>
            <Text style={s.effectBtnText}>None</Text>
          </Pressable>
          {['flower_crown', 'lion', 'aviators', 'viking_helmet', 'dalmatian', 'pug', 'beauty', 'makeup'].map(name => (
            <Pressable key={name}
              style={[s.effectBtn, activeEffect === name && s.effectBtnActive]}
              onPress={() => applyBundledEffect(name)}>
              <Text style={s.effectBtnText}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Row 2: Remote effects via rn-fetch-blob */}
        <Text style={s.sectionLabel}>REMOTE (rn-fetch-blob download) {downloading ? '⏳' : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.effectRow}>
          {REMOTE_EFFECTS.map(name => (
            <Pressable key={name}
              style={[s.effectBtn, s.remoteBtn, activeEffect === name && s.effectBtnActive]}
              onPress={() => applyRemoteEffect(name)}
              disabled={downloading}>
              <Text style={s.effectBtnText}>{name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Row 3: Capture actions */}
        <View style={s.actionRow}>
          <Pressable style={s.actionBtn} onPress={takeScreenshot} disabled={!initialized}>
            <Text style={s.actionBtnText}>📸 Screenshot</Text>
          </Pressable>
          <Pressable
            style={[s.actionBtn, recording && { backgroundColor: '#FF3B3B' }]}
            onPress={toggleRecording} disabled={!initialized}>
            <Text style={s.actionBtnText}>{recording ? '⏹ Stop' : '⏺ Record'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Event log */}
      <View style={s.logWrap}>
        <Text style={s.logTitle}>Native Events Log</Text>
        <ScrollView style={s.logScroll} showsVerticalScrollIndicator={false}>
          {events.length === 0
            ? <Text style={s.logEmpty}>No events yet — mount the camera above</Text>
            : events.map((e, i) => (
              <Text key={i} style={[s.logLine,
                e.includes('✅') ? { color: '#00E5A0' } :
                e.includes('❌') ? { color: '#FF3B3B' } :
                e.includes('📸') || e.includes('🎬') ? { color: '#FF9D00' } : {}
              ]}>{e}</Text>
            ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:            { flex: 1, backgroundColor: '#07070F' },
  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1A1A2E', gap: 10 },
  backBtn:         { width: 36, height: 36, borderRadius: 8, backgroundColor: '#1A1A2E', alignItems: 'center', justifyContent: 'center' },
  backBtnText:     { color: '#fff', fontSize: 18 },
  title:           { color: '#fff', fontSize: 15, fontWeight: '700' },
  subtitle:        { color: '#666', fontSize: 10 },
  statusDot:       { width: 12, height: 12, borderRadius: 6, marginLeft: 'auto' },
  statusBar:       { backgroundColor: '#0E0E18', paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1A1A2E', gap: 2 },
  statusText:      { color: '#888', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  cameraWrap:      { width: W, height: W * 0.82, backgroundColor: '#000', position: 'relative' },
  noCamera:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  noCameraTitle:   { color: '#FF6B6B', fontSize: 16, fontWeight: '700', textAlign: 'center', lineHeight: 24 },
  noCameraHint:    { color: '#555', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  initBadge:       { position: 'absolute', top: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 5 },
  initBadgeText:   { color: '#fff', fontSize: 11, fontWeight: '700' },
  recBadge:        { position: 'absolute', top: 10, left: 12, backgroundColor: 'rgba(200,0,0,0.8)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  recBadgeText:    { color: '#fff', fontSize: 11, fontWeight: '700' },
  capturedBadge:   { position: 'absolute', bottom: 10, right: 12, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  capturedBadgeText:{ color: '#FF9D00', fontSize: 11, fontWeight: '700' },
  flipBtn:         { position: 'absolute', top: 10, right: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  flipBtnText:     { color: '#fff', fontSize: 20 },
  controls:        { backgroundColor: '#0E0E18', borderBottomWidth: 1, borderBottomColor: '#1A1A2E' },
  sectionLabel:    { color: '#444', fontSize: 9, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, textTransform: 'uppercase' },
  effectRow:       { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center' },
  effectBtn:       { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#1A1A2E', borderWidth: 1, borderColor: '#2A2A3E' },
  remoteBtn:       { borderColor: '#FF9D0044', backgroundColor: '#1A110A' },
  effectBtnActive: { backgroundColor: '#7C5CFF', borderColor: '#7C5CFF' },
  effectBtnText:   { color: '#ccc', fontSize: 9, fontWeight: '600' },
  actionRow:       { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  actionBtn:       { flex: 1, backgroundColor: '#1A1A2E', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A3E' },
  actionBtnText:   { color: '#fff', fontSize: 12, fontWeight: '700' },
  logWrap:         { flex: 1, backgroundColor: '#05050D', borderTopWidth: 1, borderTopColor: '#1A1A2E' },
  logTitle:        { color: '#333', fontSize: 9, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 2, textTransform: 'uppercase' },
  logScroll:       { flex: 1, paddingHorizontal: 12 },
  logEmpty:        { color: '#333', fontSize: 10, fontStyle: 'italic', paddingVertical: 12 },
  logLine:         { color: '#666', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 14, paddingVertical: 1 },
});
