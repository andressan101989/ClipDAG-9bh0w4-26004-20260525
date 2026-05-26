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
AppLifecycle.initialize();             // must be first — others register listeners
CrashManager.initialize();             // global error boundary
ThermalMonitor.start();                // start thermal sampling
PowerManager.initialize();             // wire thermal → power tier
GPUManager.initialize();               // wire thermal → GPU slots + VRAM budget
AdaptiveQualityController.initialize(); // wire power tier → all subsystems
Diagnostics.startCollection();         // ring-buffer metrics
TelemetryPipeline.initialize();        // production telemetry pipeline
CrashIntelligence.initialize();        // crash fingerprinting + breadcrumbs
ResourceScheduler.initialize();        // adaptive task scheduler
MemoryOptimizer.initialize();          // buffer pools + allocation tracking
LeakDetector.startMonitoring(60_000);  // scan for stale resources every 60s
CleanupWorker.start();                 // background temp file cleanup
UploadWorker.start();                  // background upload processor
TelemetryWorker.start();               // background diagnostics flusher
CacheWorker.start();                   // background cache maintenance
UploadRecoveryManager.initialize();    // restore interrupted uploads on foreground
ProductionStabilityMode.initialize(); // global adaptive degradation system
RenderQueue.initialize();            // restore queued background renders

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
    <ErrorBoundary module="RootLayout" showReset>
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
            </AuthProvider>
          </I18nProvider>
        </TemplateAuthProvider>
      </SafeAreaProvider>
    </AlertProvider>
    </ErrorBoundary>
  );
}
