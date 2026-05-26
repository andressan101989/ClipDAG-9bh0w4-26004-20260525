/**
 * app/index.tsx — STARTUP ISOLATION MODE
 *
 * Redirects to /boot-test during provider isolation debugging.
 * Normal auth-based routing is commented out below.
 *
 * RESTORE NORMAL FLOW:
 *   1. Uncomment the original import/logic block
 *   2. Remove the BootRedirect component
 *   3. Ensure AuthProvider is active in app/_layout.tsx (Phase 4+)
 */

import React from 'react';
import { Redirect } from 'expo-router';

console.log('[BOOT] index.tsx — module evaluated');

export default function Index() {
  console.log('[BOOT] Index render — redirecting to boot-test');
  // ── ISOLATION MODE: bypass all auth hooks ──────────────────────────────
  return <Redirect href="/boot-test" />;

  // ── NORMAL FLOW (restore after Phase 4 confirmed stable) ───────────────
  // const { isAuthenticated, isLoading } = useAuth();
  // if (isLoading) {
  //   return (
  //     <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
  //       <ActivityIndicator color={Colors.primary} size="large" />
  //     </View>
  //   );
  // }
  // return <Redirect href={isAuthenticated ? '/(tabs)' : '/login'} />;
}
