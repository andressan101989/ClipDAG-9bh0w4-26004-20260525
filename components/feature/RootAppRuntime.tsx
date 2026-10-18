/**
 * Full application runtime loaded below the root alert/error boundary.
 * Configuration-dependent providers stay here so a startup failure cannot
 * make Expo Router fall back to a provider-less navigator.
 */

import { useContext } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AgoraCallProvider } from '@/contexts/AgoraCallContext';
import { AuthContext, AuthProvider } from '@/contexts/AuthContext';
import { FeedProvider } from '@/contexts/FeedContext';
import { I18nProvider } from '@/contexts/I18nContext';
import { MarketplaceCartProvider } from '@/contexts/MarketplaceCartContext';
import { MessagesProvider } from '@/contexts/MessagesContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { ShopProvider } from '@/contexts/ShopContext';
import { StoriesProvider } from '@/contexts/StoriesContext';
import { IncomingCallModal } from '@/components/feature/IncomingCallModal';
import { IosCallKitActionHandler } from '@/components/feature/IosCallKitActionHandler';
import { PersonalizationGate } from '@/components/feature/PersonalizationGate';
import { PushNotificationHandler } from '@/components/feature/PushNotificationHandler';
import { WalletConnectProvider } from '@/components/feature/WalletConnectProvider';
import { WalletConnectReturnHandler } from '@/components/feature/WalletConnectReturnHandler';
import { NelyonLogo } from '@/components/ui/NelyonLogo';
import { Colors } from '@/constants/theme';
import { AuthProvider as TemplateAuthProvider } from '@/template/auth/supabase/context';

function AppShell() {
  const authCtx = useContext(AuthContext);
  const isAuthReady = authCtx?.isAuthReady ?? false;

  if (!isAuthReady) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <NelyonLogo style={{ width: 260, height: 64, marginBottom: 24 }} />
        <ActivityIndicator size="large" color="#1F79FF" />
      </View>
    );
  }

  return (
    <PersonalizationGate>
      <FeedProvider>
        <StoriesProvider>
          <MessagesProvider>
            <NotificationsProvider>
              <ShopProvider>
                <MarketplaceCartProvider>
                  <WalletConnectProvider>
                    <AgoraCallProvider>
                      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
                        <Stack.Screen name="index" />
                        <Stack.Screen name="boot-test" />
                        <Stack.Screen name="stress-test" />
                        <Stack.Screen name="login" />
                        <Stack.Screen name="onboarding/personalization" />
                        <Stack.Screen name="(tabs)" />
                        <Stack.Screen name="cart" />
                        <Stack.Screen name="checkout" />
                        <Stack.Screen name="checkout/reservation/[id]" />
                        <Stack.Screen name="orders/index" />
                        <Stack.Screen name="orders/[id]" />
                        <Stack.Screen name="seller/orders/index" />
                        <Stack.Screen name="seller/orders/[id]" />
                        <Stack.Screen name="chat/[userId]" options={{ headerShown: false }} />
                        <Stack.Screen name="creator/[id]" options={{ headerShown: true, title: '' }} />
                        <Stack.Screen name="video/[id]" />
                        <Stack.Screen name="my-premium-library" />
                        <Stack.Screen name="creator-premium-offer/[contentId]" />
                        <Stack.Screen name="creator-premium-viewer/[contentId]" />
                        <Stack.Screen name="product/[id]" options={{ headerShown: true, title: '' }} />
                        <Stack.Screen
                          name="live/[sessionId]"
                          options={{ presentation: 'fullScreenModal', headerShown: false }}
                        />
                        <Stack.Screen
                          name="battle/[roomId]"
                          options={{ presentation: 'fullScreenModal', headerShown: false }}
                        />
                        <Stack.Screen
                          name="call/[userId]"
                          options={{ presentation: 'fullScreenModal', headerShown: false }}
                        />
                        <Stack.Screen
                          name="video-call/[userId]"
                          options={{ presentation: 'fullScreenModal', headerShown: false }}
                        />
                        <Stack.Screen
                          name="group-call/[roomId]"
                          options={{ presentation: 'fullScreenModal', headerShown: false }}
                        />
                        <Stack.Screen
                          name="live/broadcast/[streamId]"
                          options={{ presentation: 'fullScreenModal', headerShown: false }}
                        />
                        <Stack.Screen
                          name="live/watch/[streamId]"
                          options={{ presentation: 'fullScreenModal', headerShown: false }}
                        />
                      </Stack>
                      <IncomingCallModal />
                      <PushNotificationHandler />
                      <WalletConnectReturnHandler />
                      <IosCallKitActionHandler />
                    </AgoraCallProvider>
                  </WalletConnectProvider>
                </MarketplaceCartProvider>
              </ShopProvider>
            </NotificationsProvider>
          </MessagesProvider>
        </StoriesProvider>
      </FeedProvider>
    </PersonalizationGate>
  );
}

export default function RootAppRuntime() {
  return (
    <SafeAreaProvider>
      <TemplateAuthProvider>
        <I18nProvider>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </I18nProvider>
      </TemplateAuthProvider>
    </SafeAreaProvider>
  );
}
