/**
 * app/_layout.tsx — DIAGNOSTIC: Provider Chain Stripped
 *
 * ALL context providers disabled to isolate iOS startup crash.
 * Only ErrorBoundary + SafeAreaProvider + Stack remain.
 *
 * If the crash persists with this build → root cause is a native module,
 * Expo plugin, or AppDelegate-level initialization (not JS providers).
 *
 * If the crash disappears → re-enable providers one at a time:
 *   1. AlertProvider
 *   2. TemplateAuthProvider
 *   3. I18nProvider
 *   4. AuthProvider
 *   5. FeedProvider + StoriesProvider
 *   6. MessagesProvider + NotificationsProvider
 *   7. ShopProvider
 *   8. WalletConnectProvider
 */

console.log('[DIAG] 0 - _layout module start');

import { Stack } from 'expo-router';
console.log('[DIAG] 1 - expo-router imported');

import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
console.log('[DIAG] 2 - ErrorBoundary imported');

import { SafeAreaProvider } from 'react-native-safe-area-context';
console.log('[DIAG] 3 - SafeAreaProvider imported');

console.log('[DIAG] 4 - all imports done, rendering bare tree');

export default function RootLayout() {
  console.log('[DIAG] 5 - RootLayout render');
  return (
    <ErrorBoundary module="RootLayout" showReset>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="boot-test" />
          <Stack.Screen
            name="creator-studio"
            options={{ presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="chat/[userId]"
            options={{ headerShown: true, title: '' }}
          />
          <Stack.Screen
            name="creator/[id]"
            options={{ headerShown: true, title: '' }}
          />
          <Stack.Screen
            name="product/[id]"
            options={{ headerShown: true, title: '' }}
          />
          <Stack.Screen
            name="live/[sessionId]"
            options={{ presentation: 'fullScreenModal', headerShown: false }}
          />
          <Stack.Screen
            name="battle/[roomId]"
            options={{ presentation: 'fullScreenModal', headerShown: false }}
          />
        </Stack>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
