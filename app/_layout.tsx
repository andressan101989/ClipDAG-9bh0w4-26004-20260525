/**
 * app/_layout.tsx — PHASE 0: ABSOLUTE MINIMUM
 *
 * ═══════════════════════════════════════════════════════════════════════
 * STARTUP ISOLATION — TOTAL STRIP
 *
 * REMOVED:
 *   ❌ AlertProvider
 *   ❌ I18nProvider
 *   ❌ TemplateAuthProvider
 *   ❌ AuthProvider
 *   ❌ FeedProvider
 *   ❌ StoriesProvider
 *   ❌ MessagesProvider
 *   ❌ NotificationsProvider
 *   ❌ ShopProvider
 *   ❌ WalletConnectProvider
 *   ❌ GlobalErrorBoundary
 *
 * ONLY:
 *   ✅ SafeAreaProvider  (needed by useSafeAreaInsets in tab bar)
 *   ✅ Stack             (expo-router navigation)
 *
 * RESTORE ORDER (rebuild EAS + test iPhone after EACH step):
 *   Phase 1: Add AlertProvider
 *   Phase 2: Add I18nProvider
 *   Phase 3: Add TemplateAuthProvider
 *   Phase 4: Add AuthProvider
 *   Phase 5: Add FeedProvider
 *   Phase 6: Add StoriesProvider + MessagesProvider + NotificationsProvider
 *   Phase 7: Add ShopProvider
 *   Phase 8: Add WalletConnectProvider  ← highest crash risk
 * ═══════════════════════════════════════════════════════════════════════
 */

console.log('[BOOT] 0 - _layout module start');

import { Stack } from 'expo-router';
console.log('[BOOT] 1 - expo-router imported');

import { SafeAreaProvider } from 'react-native-safe-area-context';
console.log('[BOOT] 2 - safe-area imported');

console.log('[BOOT] 3 - all imports done');

export default function RootLayout() {
  console.log('[BOOT] 4 - RootLayout render');
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="boot-test" />
      </Stack>
    </SafeAreaProvider>
  );
}
