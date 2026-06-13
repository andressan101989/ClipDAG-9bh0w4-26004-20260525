/**
 * app/deepar-module-test.tsx
 *
 * Smoke test: does DeepARTestView appear in NativeUnimoduleProxy?
 *
 * If YES  → the deepar-fabric-view module structure is broken; migrate into clean module.
 * If NO   → Expo iOS module integration is broken globally.
 */

import React from 'react';
import { NativeModules, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

// Importing deepar-test-view fires the top-level console.log in its src/index.ts
import { DeepARTestViewRegistered } from 'deepar-test-view';

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
  const proxy = NativeModules.NativeUnimoduleProxy;
  const vmKeys: string[] = Object.keys(proxy?.viewManagersMetadata ?? {});
  const testViewMeta = proxy?.viewManagersMetadata?.DeepARTestView ?? null;
  const fabricViewMeta = proxy?.viewManagersMetadata?.DeepARFabricView ?? null;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Expo Module Registration Probe</Text>
      <Text style={s.subtitle}>Check Metro logs for [DeepARTestView] entries on load</Text>

      <View style={s.section}>
        <DiagRow label="Platform" value={Platform.OS} />
        <DiagRow label="NativeUnimoduleProxy" value={proxy ? '✅ present' : '❌ null'} />
        <DiagRow
          label="DeepARTestView in proxy"
          value={testViewMeta ? '✅ REGISTERED' : '❌ NOT FOUND'}
        />
        <DiagRow
          label="DeepARFabricView in proxy"
          value={fabricViewMeta ? '✅ REGISTERED' : '❌ NOT FOUND'}
        />
        <DiagRow
          label="deepar-test-view (JS export)"
          value={DeepARTestViewRegistered ? '✅ true' : '❌ false'}
        />
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
        Open Metro / Xcode console and search for "[DeepARTestView]" to see raw proxy dump.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#07070F' },
  content:     { padding: 20, gap: 8 },
  title:       { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  subtitle:    { color: '#555', fontSize: 11, marginBottom: 16 },
  sectionTitle:{ color: '#888', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  section:     { backgroundColor: '#0E0E18', borderRadius: 12, padding: 12, gap: 8 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:       { color: '#888', fontSize: 12 },
  value:       { fontSize: 12, fontWeight: '600' },
  ok:          { color: '#00E5A0' },
  bad:         { color: '#FF3B3B' },
  neutral:     { color: '#ccc' },
  key:         { color: '#7C5CFF', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  empty:       { color: '#444', fontSize: 11, fontStyle: 'italic' },
  hint:        { color: '#333', fontSize: 10, marginTop: 20, textAlign: 'center', lineHeight: 16 },
});
