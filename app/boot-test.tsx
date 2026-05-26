/**
 * app/boot-test.tsx — BOOT ISOLATION SCREEN
 *
 * Zero dependencies. No hooks. No providers. No Supabase. No auth.
 * Pure native View + Text to confirm React tree mounts cleanly.
 *
 * USAGE:
 *   app/index.tsx redirects here during startup isolation.
 *   Once this screen renders → React + expo-router + navigation = OK.
 *   Then uncomment providers in app/_layout.tsx one by one (Phase 2 → 8).
 *
 * NEXT STEPS after confirming this renders:
 *   1. Uncomment Phase 2 (I18nProvider) in _layout.tsx → rebuild → test
 *   2. Uncomment Phase 3 (TemplateAuthProvider) → rebuild → test
 *   3. Uncomment Phase 4 (AuthProvider) → rebuild → test
 *      ← This is where "useAuth must be used within AuthProvider" will STOP crashing
 *   4. Continue through Phase 5–8
 */

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';

console.log('[BOOT] boot-test.tsx — module evaluated');

export default function BootTestScreen() {
  console.log('[BOOT] BootTestScreen — render called');

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <View style={s.card}>
        {/* Green dot — visual confirmation screen rendered */}
        <View style={s.dot} />

        <Text style={s.title}>BOOT OK</Text>
        <Text style={s.sub}>React tree monta correctamente</Text>

        <View style={s.divider} />

        <Row label="Platform"  value={Platform.OS} />
        <Row label="React"     value="mounted ✅" />
        <Row label="Router"    value="active ✅" />
        <Row label="Hermes"    value={typeof HermesInternal !== 'undefined' ? 'ON ✅' : 'OFF'} />
        <Row label="Providers" value="none (isolation mode)" color="#FF9D00" />

        <View style={s.divider} />

        <Text style={s.instructions}>
          Siguiente paso:{'\n'}
          Descomenta Phase 2 en app/_layout.tsx{'\n'}
          y reconstruye con EAS.
        </Text>

        <Text style={s.phase}>📍 Phase 0 — bare boot confirmed</Text>
      </View>
    </View>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

// Hermes global — available only inside a Hermes engine
declare const HermesInternal: any;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07070F',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#0E0E1A',
    borderRadius: 18,
    padding: 28,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: '#1E1E2E',
    gap: 10,
    alignItems: 'center',
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#00E5A0',
    marginBottom: 6,
    shadowColor: '#00E5A0',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    color: '#00E5A0',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 3,
  },
  sub: {
    color: '#888',
    fontSize: 13,
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#1E1E2E',
    width: '100%',
    marginVertical: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 3,
  },
  rowLabel: {
    color: '#555',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  rowValue: {
    color: '#00E5A0',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  instructions: {
    color: '#666',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
  phase: {
    color: '#7C5CFF',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
});
