/**
 * app/_layout.tsx — FULL APP RESTORED + AppLifecycle initialized
 *
 * WalletConnect: real WalletConnectModalProvider mounted via
 *   components/feature/WalletConnectProvider.native.tsx (iOS/Android)
 *   components/feature/WalletConnectProvider.tsx (web stub)
 * Metro blocks @walletconnect/* on web/preview only — native EAS builds
 * load the real SDK. Startup crash has been fully resolved.
 */

console.log('[BOOT] 0 - _layout module start');

// Initialize AppLifecycle singleton immediately at module load — before any
// component mounts — so all subsequent onForeground/onBackground registrations
// start receiving events from the very first AppState change.
import { AppLifecycle }          from '@/modules/core/AppLifecycle';
import { CrashManager }          from '@/modules/core/CrashManager';
import { ThermalMonitor }        from '@/modules/core/ThermalMonitor';
import { Diagnostics }           from '@/modules/core/Diagnostics';
import { PowerManager }          from '@/modules/core/PowerManager';
import { LeakDetector }          from '@/modules/core/LeakDetector';
import { GPUManager }                from '@/modules/core/GPUManager';
import { RenderIsolationManager }    from '@/modules/core/RenderIsolationManager';
import { AdaptiveQualityController } from '@/modules/core/AdaptiveQualityController';
import { CleanupWorker }             from '@/background/CleanupWorker';
import { UploadWorker }              from '@/background/UploadWorker';
import { TelemetryWorker }           from '@/background/TelemetryWorker';
import { CacheWorker }               from '@/background/CacheWorker';
import { UploadRecoveryManager }     from '@/modules/media/UploadRecoveryManager';
import { TelemetryPipeline }         from '@/modules/core/TelemetryPipeline';
import { CrashIntelligence }         from '@/modules/core/CrashIntelligence';
import { ResourceScheduler }         from '@/modules/core/ResourceScheduler';
import { MemoryOptimizer }           from '@/modules/core/MemoryOptimizer';
import { ProductionStabilityMode }  from '@/modules/core/ProductionStabilityMode';
import { RenderQueue }              from '@/services/ffmpegService';

// ── Boot sequence (order matters) ────────────────────────────────────────────
try { AppLifecycle.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: AppLifecycle', e); }
try { CrashManager.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: CrashManager', e); }
try { ThermalMonitor.start(); } catch (e) { console.warn('[BOOT] subsystem failed: ThermalMonitor', e); }
try { PowerManager.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: PowerManager', e); }
try { GPUManager.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: GPUManager', e); }
try { AdaptiveQualityController.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: AdaptiveQualityController', e); }
try { Diagnostics.startCollection(); } catch (e) { console.warn('[BOOT] subsystem failed: Diagnostics', e); }
try { TelemetryPipeline.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: TelemetryPipeline', e); }
try { CrashIntelligence.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: CrashIntelligence', e); }
try { ResourceScheduler.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: ResourceScheduler', e); }
try { MemoryOptimizer.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: MemoryOptimizer', e); }
try { LeakDetector.startMonitoring(60_000); } catch (e) { console.warn('[BOOT] subsystem failed: LeakDetector', e); }
try { CleanupWorker.start(); } catch (e) { console.warn('[BOOT] subsystem failed: CleanupWorker', e); }
try { UploadWorker.start(); } catch (e) { console.warn('[BOOT] subsystem failed: UploadWorker', e); }
try { TelemetryWorker.start(); } catch (e) { console.warn('[BOOT] subsystem failed: TelemetryWorker', e); }
try { CacheWorker.start(); } catch (e) { console.warn('[BOOT] subsystem failed: CacheWorker', e); }
try { UploadRecoveryManager.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: UploadRecoveryManager', e); }
try { ProductionStabilityMode.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: ProductionStabilityMode', e); }
try { RenderQueue.initialize(); } catch (e) { console.warn('[BOOT] subsystem failed: RenderQueue', e); }

import { useContext } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
console.log('[BOOT] 1 - expo-router imported');

import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

import { SafeAreaProvider } from 'react-native-safe-area-context';
console.log('[BOOT] 2 - safe-area imported');

import { AlertProvider } from '@/template';
import { AuthProvider as TemplateAuthProvider } from '@/template';
console.log('[BOOT] 3 - template providers imported');

import { I18nProvider } from '@/contexts/I18nContext';
console.log('[BOOT] 4 - I18nProvider imported');

import { AuthProvider, AuthContext } from '@/contexts/AuthContext';
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

// AppShell lives inside AuthProvider so it can read isAuthReady.
// All data providers mount only after auth state is known, preventing
// race conditions where FeedProvider/MessagesProvider etc. fetch with user=null
// and never retry because the user?.id effect dependency never fires again.
function AppShell() {
  const authCtx = useContext(AuthContext);
  const isAuthReady = authCtx?.isAuthReady ?? false;

  if (!isAuthReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0F', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#7C5CFF" />
      </View>
    );
  }

  return (
    <FeedProvider>
      <StoriesProvider>
        <MessagesProvider>
          <NotificationsProvider>
            <ShopProvider>
              <WalletConnectProvider>
                <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="boot-test" />
                <Stack.Screen name="stress-test" />
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
                <Stack.Screen
                  name="live/[sessionId]"
                  options={{ presentation: 'fullScreenModal', headerShown: false }}
                />
                <Stack.Screen
                  name="battle/[roomId]"
                  options={{ presentation: 'fullScreenModal', headerShown: false }}
                />
                </Stack>
              </WalletConnectProvider>
            </ShopProvider>
          </NotificationsProvider>
        </MessagesProvider>
      </StoriesProvider>
    </FeedProvider>
  );
}

export default function RootLayout() {
  console.log('[BOOT] 10 - RootLayout render');
  return (
    <ErrorBoundary module="RootLayout" showReset>
      <AlertProvider>
        <SafeAreaProvider>
          <TemplateAuthProvider>
            <I18nProvider>
              <AuthProvider>
                <AppShell />
              </AuthProvider>
            </I18nProvider>
          </TemplateAuthProvider>
        </SafeAreaProvider>
      </AlertProvider>
    </ErrorBoundary>
  );
}
