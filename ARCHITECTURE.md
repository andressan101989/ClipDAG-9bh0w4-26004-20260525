/**
 * ARCHITECTURE.md — ClipDAG Module Architecture
 * =============================================
 *
 * This file documents the scalable module architecture for ClipDAG.
 * Created as part of the architectural stabilization phase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DIRECTORY STRUCTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * app/                    Expo Router pages (file-based routing, NEVER move)
 * ├── (tabs)/             Main tab screens
 * ├── _layout.tsx         Root layout + all providers
 * └── *.tsx               Individual screens
 *
 * modules/                Feature domain modules (NEW — scalable foundation)
 * ├── core/               Infrastructure singletons
 * │   ├── EventBus.ts     Typed pub/sub (cross-module communication)
 * │   ├── AppLifecycle.ts AppState monitoring + cleanup registry
 * │   └── PerformanceMonitor.ts  Render/op timing ring buffer
 * ├── realtime/
 * │   └── PollingManager.ts  Centralized polling (replaces N setIntervals)
 * ├── media/
 * │   ├── UploadQueue.ts  Concurrent upload queue with retry + progress
 * │   └── CacheManager.ts LRU cache (memory + disk, expo-file-system)
 * ├── calls/
 * │   └── CallManager.ts  Voice/video call lifecycle + useCallState hook
 * ├── streaming/
 * │   └── StreamManager.ts Live stream lifecycle + useStreamState hook
 * └── battle/
 *     └── BattleManager.ts Creator battle system stub
 *
 * contexts/               React Context providers (global app state)
 * ├── AuthContext.tsx      User authentication + profile
 * ├── FeedContext.tsx      Video feed + likes/saves/comments
 * ├── MessagesContext.tsx  DM conversations (polls via PollingManager)
 * ├── NotificationsContext.tsx  (polls via PollingManager)
 * ├── ShopContext.tsx      Marketplace
 * ├── StoriesContext.tsx   Stories
 * └── I18nContext.tsx      Internationalization
 *
 * hooks/                  Business logic hooks
 * ├── core/               Foundation hooks
 * │   ├── useCleanup.ts   Declarative cleanup (intervals, timeouts, polls)
 * │   └── useEventBus.ts  React hook for EventBus subscriptions
 * ├── useAuth.tsx          Auth state consumer
 * ├── useWallet.tsx        BDAG balance + transactions
 * ├── useExternalWallet.native.ts  WalletConnect v2 (iOS/Android)
 * ├── useFeed.tsx          Feed actions consumer
 * ├── useMessages.tsx      Messages consumer
 * └── ...
 *
 * services/               Data layer (API calls, no React)
 * ├── deeparService.ts     DeepAR SDK resolution + filter management
 * ├── walletApi.ts         BDAG deposit/withdrawal/transfer
 * ├── logger.ts            Structured tagged logging
 * └── ...
 *
 * components/
 * ├── ui/                  Atomic UI (Button, Badge, ErrorBoundary)
 * └── feature/             Feature components (VideoCard, StoryViewer, etc.)
 *     └── studio/          Creator Studio (CameraCore, EffectsTab, etc.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY DESIGN DECISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. ADDITIVE MODULES — Existing contexts/hooks/services remain unchanged.
 *    New modules are added alongside, not replacing. Migration is gradual.
 *
 * 2. POLLING OVER REALTIME — Supabase Realtime is not supported on this
 *    backend. PollingManager centralizes all polling with background-awareness
 *    to avoid battery drain and network storms.
 *
 * 3. EVENTBUS FOR DECOUPLING — Cross-module communication uses EventBus.
 *    Example: when wallet balance updates, EventBus.emit('wallet:balance_updated')
 *    — any screen can listen without importing WalletContext directly.
 *
 * 4. LAZY LOADING — Heavy features (DeepAR, WalletConnect) use lazy require()
 *    patterns. Never import at module top-level to prevent iOS startup crashes.
 *
 * 5. UPLOAD QUEUE — All media uploads go through UploadQueue (concurrent
 *    limit, retry, progress via EventBus). Never upload directly from screens.
 *
 * 6. APPLIFECYCLE — All setIntervals/subscriptions are registered with
 *    AppLifecycle.registerCleanup() or PollingManager for centralized teardown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FUTURE MODULE ROADMAP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * modules/webrtc/          WebRTC peer connections (when react-native-webrtc
 *                          is re-enabled in react-native.config.js)
 * modules/gaming/          Mini-game launcher, score board, wagering
 * modules/ai/              OnSpace AI pipeline, prompt templates, model router
 * modules/creator/         Full creator studio (recording, editing, publish)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCALING CHECKLIST
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Before adding a new feature module:
 * [ ] Does it need cross-module state? → Use EventBus
 * [ ] Does it poll? → Use PollingManager
 * [ ] Does it upload media? → Use UploadQueue
 * [ ] Does it cache remote files? → Use CacheManager
 * [ ] Does it have heavy JS? → Use React.lazy / lazy require
 * [ ] Does it use native modules? → Check metro.config.js + react-native.config.js
 * [ ] Does it clean up on unmount? → Use useCleanup hook
 * [ ] Can it crash? → Wrap in <ErrorBoundary module="Feature">
 */

export {};
