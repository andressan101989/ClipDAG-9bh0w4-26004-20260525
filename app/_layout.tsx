/**
 * app/_layout.tsx — PHASE 1: AlertProvider + I18nProvider
 *
 * ═══════════════════════════════════════════════════════════════════════
 * PROGRESSIVE RESTORE — Phase 1 ACTIVE
 *
 * ✅ SafeAreaProvider  — always needed
 * ✅ AlertProvider     — pure UI, no native modules, no Supabase
 * ✅ I18nProvider      — AsyncStorage only, no Supabase, no native modules
 *
 * NEXT PHASES (rebuild EAS + test iPhone after EACH step):
 *   Phase 2: Add AuthProvider (TemplateAuthProvider + AuthContext)
 *   Phase 3: Add FeedProvider + StoriesProvider
 *   Phase 4: Add MessagesProvider + NotificationsProvider
 *   Phase 5: Add ShopProvider
 *   Phase 6: Add WalletConnectProvider  ← highest crash risk
 *   Phase 7: Restore full app navigation (remove boot-test redirect)
 * ═══════════════════════════════════════════════════════════════════════
 */

console.log('[BOOT] 0 - _layout module start');

import { Stack } from 'expo-router';
console.log('[BOOT] 1 - expo-router imported');

import { SafeAreaProvider } from 'react-native-safe-area-context';
console.log('[BOOT] 2 - safe-area imported');

import { AlertProvider } from '@/template';
console.log('[BOOT] 3 - AlertProvider imported');

import { I18nProvider } from '@/contexts/I18nContext';
console.log('[BOOT] 4 - I18nProvider imported');

console.log('[BOOT] 5 - all imports done');

export default function RootLayout() {
  console.log('[BOOT] 6 - RootLayout render');
  return (
    <AlertProvider>
      <SafeAreaProvider>
        <I18nProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="boot-test" />
          </Stack>
        </I18nProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
