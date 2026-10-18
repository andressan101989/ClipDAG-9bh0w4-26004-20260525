/**
 * app/_layout.tsx — configuration-safe Expo Router root
 *
 * Keep this module free of application services that can fail while their
 * runtime configuration is loading. Expo Router must register this default
 * export before it evaluates the rest of the app so every route, including
 * login fallbacks, remains below the canonical AlertProvider.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { AlertProvider } from '@/template/ui/context';

const RootAppRuntime = lazy(() => import('../components/feature/RootAppRuntime'));

interface RootProviderBoundaryProps {
  children: ReactNode;
}

export function RootProviderBoundary({ children }: RootProviderBoundaryProps) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AlertProvider>
        <ErrorBoundary module="RootLayout" showReset>
          {children}
        </ErrorBoundary>
      </AlertProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <RootProviderBoundary>
      <Suspense
        fallback={(
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#05070D',
            }}
          >
            <ActivityIndicator size="large" color="#1F79FF" />
          </View>
        )}
      >
        <RootAppRuntime />
      </Suspense>
    </RootProviderBoundary>
  );
}
