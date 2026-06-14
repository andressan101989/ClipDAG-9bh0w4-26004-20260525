/**
 * app/deepar-module-test.tsx
 *
 * Smoke test: does DeepARTestView appear in NativeUnimoduleProxy?
 *
 * If YES  → the deepar-fabric-view module structure is broken; migrate into clean module.
 * If NO   → Expo iOS module integration is broken globally.
 *
 * Note: no local .deepar effect files exist in this project.
 * Effect buttons download burning_effect from storage.deepar.ai (same CDN as production).
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  NativeModules, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { DeepARTestViewRegistered } from 'deepar-test-view';
import { DeepARFabricView, type DeepARFabricViewRef } from 'deepar-fabric-view';

const API_KEY = 'd01f969cc04481c9949b9d678ff7b95ed55c9a34231af88d6510c12b1d311ea07dd0aba19fafcee1';
const EFFECT_CDN = 'https://storage.deepar.ai/effects/';
const EFFECT_ID  = 'burning_effect';
const DOWNLOAD_TIMEOUT_MS = 15_000;

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.value, value.startsWith('✅') ? s.ok : value.startsWith('❌') ? s.bad : s.neutral]}>
        {value}
      </Text>
    </View>
  );
}

export default function DeepARModuleTestScreen() {
  const deepARRef = useRef<DeepARFabricViewRef>(null);
  const [status, setStatus] = useState('idle');
  const [effectPath, setEffectPath] = useState<string | null>(null);

  const proxy = NativeModules.NativeUnimoduleProxy;
  const vmKeys: string[] = Object.keys(proxy?.viewManagersMetadata ?? {});
  const testViewMeta  = proxy?.viewManagersMetadata?.DeepARTestView  ?? null;
  const fabricViewMeta = proxy?.viewManagersMetadata?.DeepARFabricView ?? null;

  const loadEffect = useCallback(async () => {
    try {
      const url = EFFECT_CDN + EFFECT_ID;
      const dest = FileSystem.cacheDirectory + EFFECT_ID + '.deepar';

      console.log('[EffectProbe] cacheDirectory:', FileSystem.cacheDirectory);
      console.log('[EffectProbe] download URL:', url);
      console.log('[EffectProbe] destination:', dest);

      setStatus('checking cache…');
      const cached = await FileSystem.getInfoAsync(dest, { size: true });
      console.log('[EffectProbe] cache check:', JSON.stringify(cached));

      if (!cached.exists || (cached.size ?? 0) < 1024) {
        setStatus('downloading…');
        console.log('[EffectProbe] starting download…');

        const downloadResult = await Promise.race([
          FileSystem.downloadAsync(url, dest),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`)), DOWNLOAD_TIMEOUT_MS)
          ),
        ]);

        console.log('[EffectProbe] download httpStatus:', downloadResult.status);
        console.log('[EffectProbe] download localUri:', downloadResult.uri);

        if (downloadResult.status !== 200) {
          setStatus(`❌ HTTP ${downloadResult.status} from CDN`);
          return;
        }
      } else {
        console.log('[EffectProbe] using cached file size:', cached.size);
        setStatus('cache hit…');
      }

      const fileInfo = await FileSystem.getInfoAsync(dest, { size: true });
      console.log('[EffectProbe] post-download fileInfo:', JSON.stringify(fileInfo));

      if (!fileInfo.exists) {
        setStatus('❌ file missing after download');
        return;
      }
      const size = fileInfo.size ?? 0;
      if (size < 1024) {
        setStatus(`❌ file too small (${size} bytes) — likely HTML error page`);
        return;
      }

      // Strip file:// prefix — DeepAR SDK needs a raw POSIX path
      const localPath = dest.replace('file://', '');
      setEffectPath(localPath);

      console.log('[EffectProbe] switchEffect path:', localPath);
      console.log('[EffectProbe] file size:', size, 'bytes');
      setStatus('calling switchEffect…');
      await deepARRef.current?.switchEffect(localPath);
      setStatus(`✅ switchEffect called — ${size} bytes — …${localPath.slice(-28)}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.warn('[EffectProbe] loadEffect error:', msg);
      setStatus(`❌ ${msg}`);
    }
  }, []);

  const clearEffect = useCallback(async () => {
    try {
      setStatus('calling clearEffect…');
      await deepARRef.current?.clearEffect();
      setStatus('✅ clearEffect called');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.warn('[EffectProbe] clearEffect error:', msg);
      setStatus(`❌ error: ${msg}`);
    }
  }, []);

  const logState = useCallback(() => {
    const state = {
      status,
      effectPath,
      refPresent: !!deepARRef.current,
      switchEffectFn: typeof deepARRef.current?.switchEffect,
      clearEffectFn:  typeof deepARRef.current?.clearEffect,
    };
    console.log('[EffectProbe] current state:', JSON.stringify(state, null, 2));
    setStatus(`logged — ref ${state.refPresent ? 'present' : 'NULL'}`);
  }, [status, effectPath]);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>DeepARFabricView mount test</Text>
      <DeepARFabricView
        ref={deepARRef}
        apiKey={API_KEY}
        style={{
          width: 320,
          height: 320,
          backgroundColor: 'black',
          borderWidth: 2,
          borderColor: '#00ff88',
        }}
      />

      <View style={s.buttons}>
        <Pressable style={s.btn} onPress={loadEffect}>
          <Text style={s.btnText}>Load effect 1</Text>
          <Text style={s.btnSub}>burning_effect (CDN)</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnAlt]} onPress={clearEffect}>
          <Text style={s.btnText}>Clear effect</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnLog]} onPress={logState}>
          <Text style={s.btnText}>Log current test state</Text>
        </Pressable>
      </View>

      <View style={s.section}>
        <DiagRow label="Status" value={status} />
        <DiagRow label="Effect path" value={effectPath ? `…${effectPath.slice(-28)}` : 'none'} />
        <DiagRow label="Ref present" value={deepARRef.current ? '✅ yes' : '⏳ pending'} />
      </View>

      <Text style={s.hint}>
        No local .deepar files in project — effect downloads from storage.deepar.ai on first press.
      </Text>

      <Text style={s.title}>Expo Module Registration Probe</Text>
      <Text style={s.subtitle}>Check Metro logs for [DeepARTestView] entries on load</Text>

      <View style={s.section}>
        <DiagRow label="Platform"              value={Platform.OS} />
        <DiagRow label="NativeUnimoduleProxy"  value={proxy ? '✅ present' : '❌ null'} />
        <DiagRow label="DeepARTestView in proxy"
          value={testViewMeta  ? '✅ REGISTERED' : '❌ NOT FOUND'} />
        <DiagRow label="DeepARFabricView in proxy"
          value={fabricViewMeta ? '✅ REGISTERED' : '❌ NOT FOUND'} />
        <DiagRow label="deepar-test-view (JS export)"
          value={DeepARTestViewRegistered ? '✅ true' : '❌ false'} />
      </View>

      <Text style={s.sectionTitle}>All viewManagersMetadata keys ({vmKeys.length})</Text>
      <View style={s.section}>
        {vmKeys.length === 0 ? (
          <Text style={s.empty}>none</Text>
        ) : (
          vmKeys.map(k => (
            <Text key={k} style={s.key}>• {k}</Text>
          ))
        )}
      </View>

      <Text style={s.hint}>
        Open Metro / Xcode console and search for [DeepARNative] / [EffectProbe] logs.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#07070F' },
  content:      { padding: 20, gap: 8 },
  title:        { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  subtitle:     { color: '#555', fontSize: 11, marginBottom: 16 },
  sectionTitle: { color: '#888', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  section:      { backgroundColor: '#0E0E18', borderRadius: 12, padding: 12, gap: 8 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:        { color: '#888', fontSize: 12 },
  value:        { fontSize: 12, fontWeight: '600' },
  ok:           { color: '#00E5A0' },
  bad:          { color: '#FF3B3B' },
  neutral:      { color: '#ccc' },
  key:          { color: '#7C5CFF', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  empty:        { color: '#444', fontSize: 11, fontStyle: 'italic' },
  hint:         { color: '#333', fontSize: 10, marginTop: 4, marginBottom: 12, textAlign: 'center', lineHeight: 16 },
  buttons:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  btn:          { flex: 1, minWidth: 90, backgroundColor: '#1a1a2e', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#00ff88' },
  btnAlt:       { borderColor: '#FF6B6B' },
  btnLog:       { borderColor: '#7C5CFF' },
  btnText:      { color: '#fff', fontSize: 12, fontWeight: '600' },
  btnSub:       { color: '#555', fontSize: 9, marginTop: 2 },
});
