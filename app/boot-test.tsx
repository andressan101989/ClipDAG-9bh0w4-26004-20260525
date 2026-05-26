/**
 * app/boot-test.tsx — ABSOLUTE MINIMUM boot confirmation screen
 *
 * Zero dependencies. No hooks. No providers. No Supabase. No auth.
 * Pure View + Text — if this renders, the JS runtime is alive.
 */

console.log('[BOOT] boot-test evaluated');

import { View, Text } from 'react-native';

export default function BootTest() {
  console.log('[BOOT] BootTest render');
  return (
    <View style={{ flex: 1, backgroundColor: '#07070F', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#00E5A0', fontSize: 32, fontWeight: '800' }}>BOOT OK</Text>
      <Text style={{ color: '#666', fontSize: 13, marginTop: 8 }}>React + Router ✅</Text>
    </View>
  );
}
