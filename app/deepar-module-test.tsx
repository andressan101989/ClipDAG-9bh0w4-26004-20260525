/**
 * app/deepar-module-test.tsx
 *
 * Smoke test: Expo module registration + native view lifecycle + effect loading.
 *
 * assets/deepar/flower_crown.deepar is a 1-byte placeholder.
 * DeepAR will fire onErrorWithCode (expected) — proving the full path-resolution
 * chain works. Replace with a real .deepar from developer.deepar.ai to test
 * actual effect loading.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  NativeModules, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import { DeepARTestViewRegistered } from 'deepar-test-view';
import { DeepARFabricView, type DeepARFabricViewRef } from 'deepar-fabric-view';

const API_KEY = 'd01f969cc04481c9949b9d678ff7b95ed55c9a34231af88d6510c12b1d311ea07dd0aba19fafcee1';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FLOWER_CROWN_MODULE = require('../assets/deepar/flower_crown.deepar');

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
  const testViewMeta   = proxy?.viewManagersMetadata?.DeepARTestView   ?? null;
  const fabricViewMeta = proxy?.viewManagersMetadata?.DeepARFabricView ?? null;

  const loadEffect = useCallback(async () => {
    try {
      setStatus('resolving bundled asset…');

      const asset = Asset.fromModule(FLOWER_CROWN_MODULE);
      await asset.downloadAsync();

      console.log('[EffectProbe] asset uri:', asset.localUri);

      if (!asset.localUri) {
        setStatus('❌ asset localUri is null');
        return;
      }

      // Copy to writable cache dir — expo-asset URIs may be read-only on iOS.
      const dir  = FileSystem.cacheDirectory + 'deepar_filters/';
      const dest = dir + 'flower_crown.deepar';
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      await FileSystem.copyAsync({ from: asset.localUri, to: dest });

      const fileInfo = await FileSystem.getInfoAsync(dest, { size: true });
      console.log('[EffectProbe] copied path:', dest);
      console.log('[EffectProbe] file exists:', fileInfo.exists);
      console.log('[EffectProbe] file size:',  fileInfo.size ?? 0, 'bytes');

      if (!fileInfo.exists) {
        setStatus('❌ copy failed — file missing after copyAsync');
        return;
      }

      // Strip file:// — DeepAR SDK requires raw POSIX path.
      const localPath = dest.replace('file://', '');
      setEffectPath(localPath);

      console.log('[EffectProbe] calling switchEffect path:', localPath);
      setStatus('calling switchEffect…');
      await deepARRef.current?.switchEffect(localPath);
      setStatus(`✅ switchEffect called — ${fileInfo.size ?? 0} bytes — watch [DeepARNative] for result`);
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
      setStatus(`❌ ${msg}`);
    }
  }, []);

  const logState = useCallback(() => {
    const state = {
      status,
      effectPath,
      refPresent:     !!deepARRef.current,
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
          <Text style={s.btnSub}>flower_crown (bundled)</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnAlt]} onPress={clearEffect}>
          <Text style={s.btnText}>Clear effect</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnLog]} onPress={logState}>
          <Text style={s.btnText}>Log test state</Text>
        </Pressable>
      </View>

      <View style={s.section}>
        <DiagRow label="Status"      value={status} />
        <DiagRow label="Effect path" value={effectPath ? `…${effectPath.slice(-28)}` : 'none'} />
        <DiagRow label="Ref present" value={deepARRef.current ? '✅ yes' : '⏳ pending'} />
      </View>

      <Text style={s.hint}>
        Bundled asset is a 1-byte placeholder — DeepAR will fire onErrorWithCode (expected).{'\n'}
        Replace assets/deepar/flower_crown.deepar with a real .deepar to test effect loading.
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
        Open Metro / Xcode console — search [DeepARNative] / [EffectProbe].
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
