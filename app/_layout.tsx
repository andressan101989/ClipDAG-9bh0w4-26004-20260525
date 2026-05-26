/**
 * app/_layout.tsx — FULL APP RESTORED
 *
 * WalletConnect: real WalletConnectModalProvider mounted via
 *   components/feature/WalletConnectProvider.native.tsx (iOS/Android)
 *   components/feature/WalletConnectProvider.tsx (web stub)
 * Metro blocks @walletconnect/* on web/preview only — native EAS builds
 * load the real SDK. Startup crash has been fully resolved.
 */

console.log('[BOOT] 0 - _layout module start');

import { Stack } from 'expo-router';
console.log('[BOOT] 1 - expo-router imported');

import { SafeAreaProvider } from 'react-native-safe-area-context';
console.log('[BOOT] 2 - safe-area imported');

import { AlertProvider } from '@/template';
import { AuthProvider as TemplateAuthProvider } from '@/template';
console.log('[BOOT] 3 - template providers imported');

import { I18nProvider } from '@/contexts/I18nContext';
console.log('[BOOT] 4 - I18nProvider imported');

import { AuthProvider } from '@/contexts/AuthContext';
console.log('[BOOT] 5 - AuthProvider imported');

import { FeedProvider } from '@/contexts/FeedContext';
import { StoriesProvider } from '@/contexts/StoriesContext';
console.log('[BOOT] 6 - Feed+Stories providers imported');

import { MessagesProvider } from '@/contexts/MessagesContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
console.log('[BOOT] 7 - Messages+Notifications providers imported');

import { ShopProvider } from '@/contexts/ShopContext';
console.log('[BOOT] 8 - ShopProvider imported');

import { WalletConnectProvider } from '@/components/feature/WalletConnectProvider';
console.log('[BOOT] 8b - WalletConnectProvider imported');

console.log('[BOOT] 9 - all imports done');

export default function RootLayout() {
  console.log('[BOOT] 10 - RootLayout render');
  return (
    <AlertProvider>
      <SafeAreaProvider>
        <TemplateAuthProvider>
          <I18nProvider>
            <AuthProvider>
              <FeedProvider>
                <StoriesProvider>
                  <MessagesProvider>
                    <NotificationsProvider>
                      <ShopProvider>
                        <WalletConnectProvider>
                          <Stack screenOptions={{ headerShown: false }}>
                          <Stack.Screen name="index" />
                          <Stack.Screen name="boot-test" />
                          <Stack.Screen name="login" />
                          <Stack.Screen name="(tabs)" />
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
                          </Stack>
                        </WalletConnectProvider>
                      </ShopProvider>
                    </NotificationsProvider>
                  </MessagesProvider>
                </StoriesProvider>
              </FeedProvider>
            </AuthProvider>
          </I18nProvider>
        </TemplateAuthProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
