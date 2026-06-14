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
import * as FileSystem from 'expo-file-system';

import { DeepARTestViewRegistered } from 'deepar-test-view';
import { DeepARFabricView, type DeepARFabricViewRef } from 'deepar-fabric-view';

const API_KEY = 'd01f969cc04481c9949b9d678ff7b95ed55c9a34231af88d6510c12b1d311ea07dd0aba19fafcee1';
const EFFECT_CDN = 'https://storage.deepar.ai/effects/';
const EFFECT_ID  = 'burning_effect';

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
      setStatus('downloading…');
      const dest = FileSystem.cacheDirectory + EFFECT_ID;
      const info = await FileSystem.getInfoAsync(dest);
      let localPath = dest;
      if (!info.exists) {
        const { status: httpStatus } = await FileSystem.downloadAsync(
          EFFECT_CDN + EFFECT_ID,
          dest
        );
        if (httpStatus !== 200) {
          setStatus(`❌ download failed HTTP ${httpStatus}`);
          return;
        }
      }
      const fileInfo = await FileSystem.getInfoAsync(dest);
      if (!fileInfo.exists || (fileInfo.size ?? 0) < 64) {
        setStatus('❌ downloaded file invalid (too small or missing)');
        return;
      }
      // expo-file-system URIs start with file:// — strip for native path
      localPath = dest.replace('file://', '');
      setEffectPath(localPath);
      setStatus(`calling switchEffect…`);
      console.log('[EffectProbe] switchEffect path:', localPath);
      await deepARRef.current?.switchEffect(localPath);
      setStatus(`✅ switchEffect called — path: …${localPath.slice(-24)}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.warn('[EffectProbe] loadEffect error:', msg);
      setStatus(`❌ error: ${msg}`);
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
