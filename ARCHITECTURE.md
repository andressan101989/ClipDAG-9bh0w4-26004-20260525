/**
 * ARCHITECTURE.md — ClipDAG Module Architecture v2
 * ==================================================
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DIRECTORY STRUCTURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * app/                    Expo Router pages (file-based routing — NEVER move files)
 * ├── (tabs)/             Main tab screens
 * ├── _layout.tsx         Root layout + all providers + AppLifecycle + CrashManager
 * └── *.tsx               Individual screens
 *
 * store/                  Domain state stores (singletons, no React dependency)
 * ├── auth.store.ts        Auth user + session state
 * ├── call.store.ts        Voice/video call state machine
 * ├── stream.store.ts      Live stream session + gifts + chat messages
 * ├── battle.store.ts      Creator battle: votes, timer, BDAG pool
 * ├── game.store.ts        Mini-game session: scores, wager, timer
 * ├── media.store.ts       Upload queue items + recording session
 * └── index.ts            Barrel
 *
 * modules/                Feature domain modules
 * ├── core/               Infrastructure singletons
 * │   ├── EventBus.ts     Typed pub/sub (cross-module comms — 30+ event types)
 * │   ├── AppLifecycle.ts AppState monitoring + cleanup registry
 * │   ├── PerformanceMonitor.ts  Render/op timing ring buffer
 * │   ├── ResourceManager.ts    Exclusive GPU/camera/audio lease system
 * │   ├── MemoryPressureMonitor.ts  Adaptive quality (normal/moderate/critical)
 * │   ├── CrashManager.ts       Global error handler + recovery registry
 * │   └── RetryStrategy.ts      retry() + CircuitBreaker
 * ├── realtime/
 * │   ├── PollingManager.ts     Centralized poll coordinator (background-aware)
 * │   ├── SignalingManager.ts   WebRTC SDP/ICE signaling via polling
 * │   ├── PresenceManager.ts    User online/away/streaming/in-call presence
 * │   ├── SyncEngine.ts         Optimistic updates + rollback
 * │   └── EventGateway.ts       Single entry point for all incoming events
 * ├── media/
 * │   ├── UploadQueue.ts        Concurrent upload queue (retry, progress, EventBus)
 * │   └── CacheManager.ts       LRU memory + disk cache (expo-file-system)
 * ├── creator/            Creator Studio (lazy-loaded sub-modules)
 * │   ├── camera/CameraController.ts   Camera lifecycle + adaptive quality
 * │   ├── effects/EffectsController.ts AR/filter pipeline (DeepAR + Skia)
 * │   └── drafts/DraftManager.ts       Draft persistence (AsyncStorage + Supabase)
 * ├── calls/
 * │   └── CallManager.ts        Voice/video call state machine (WebRTC stub)
 * ├── streaming/
 * │   └── StreamManager.ts      Live stream host/viewer lifecycle
 * ├── battle/
 * │   └── BattleManager.ts      Creator battle orchestrator
 * └── gaming/
 *     ├── GameEngine.ts         Game-type-agnostic session manager
 *     └── Matchmaking.ts        Opponent search with polling + timeout
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
 * ├── store/              Reactive store hooks (subscribe to domain stores)
 * │   └── index.ts        useAuthStore, useCallStore, useStreamStore, etc.
 * ├── useAuth.tsx          Auth state consumer (wraps AuthContext)
 * ├── useWallet.tsx        BDAG balance + transactions
 * ├── useExternalWallet.native.ts  WalletConnect v2 (iOS/Android)
 * ├── useFeed.tsx          Feed actions consumer
 * ├── useMessages.tsx      Messages consumer
 * └── ...
 *
 * services/               Data layer (pure functions, no React)
 * ├── deeparService.ts     DeepAR SDK resolution + filter management
 * ├── walletApi.ts         BDAG deposit/withdrawal/transfer
 * ├── logger.ts            Structured tagged logging
 * └── ...
 *
 * components/
 * ├── ui/                  Atomic UI (Button, Badge, ErrorBoundary)
 * └── feature/             Feature components
 *     └── studio/          Creator Studio rendering components
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY DESIGN DECISIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. THREE-TIER STATE ARCHITECTURE
 *    Module stores (singletons) → hooks/store/ (React binding) → components
 *    Stores are plain objects with subscriber sets — no Zustand/MobX/Redux deps.
 *    Cross-store communication happens via EventBus only.
 *
 * 2. EVENTBUS AS DECOUPLING LAYER
 *    No direct imports between domains. E.g.:
 *    WalletStore emits 'wallet:balance_updated' → StreamStore can listen
 *    without importing WalletStore.
 *
 * 3. RESOURCEMANAGER FOR EXCLUSIVE HARDWARE ACCESS
 *    Camera, GPU, microphone, and audio session each have ONE holder at a time.
 *    Requesting a resource forces release from the current holder.
 *    AppLifecycle.onBackground() auto-releases camera + GPU.
 *
 * 4. MEMORY PRESSURE ADAPTATION
 *    MemoryPressureMonitor tracks normal/moderate/critical levels.
 *    CameraController and EffectsController read currentQuality to cap
 *    resolution and disable effects before the OS kills the process.
 *
 * 5. CRASH ISOLATION
 *    CrashManager hooks into ErrorUtils (React Native) and captures
 *    unhandled rejections. Feature-level ErrorBoundary components prevent
 *    one module crashing the entire screen tree.
 *
 * 6. SIGNALING OVER POLLING
 *    WebRTC SDP/ICE exchange uses SignalingManager at 1s poll rate during
 *    call setup (acceptable latency for connection establishment).
 *    Once connected, WebRTC is peer-to-peer — no polling overhead.
 *
 * 7. OPTIMISTIC UPDATES VIA SYNCENGINE
 *    UI updates immediately (apply). Backend commit is async with retry.
 *    On permanent failure: rollback() reverts local state.
 *
 * 8. CREATOR STUDIO LAZY LOADING
 *    CameraController, EffectsController, DraftManager are never initialized
 *    until the user enters Creator Studio. This prevents memory pressure
 *    during normal browsing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DATA FLOW DIAGRAM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Screen/Component
 *       │  reads
 *       ↓
 *   hooks/store/useXxxStore()   ← subscribes to →  store/xxx.store.ts
 *                                                        ↑ writes
 *                                                   Module (CallManager, StreamManager, etc.)
 *                                                        ↑ listens
 *                                                   EventBus.on('domain:event')
 *                                                        ↑ emits
 *                                                   EventGateway.handle(rawEvent)
 *                                                        ↑ feeds
 *                                                   PollingManager / Push Notification
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCALING CHECKLIST (before adding a new feature)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * [ ] Does it need cross-module state?       → Use EventBus, never direct imports
 * [ ] Does it poll?                          → Use PollingManager
 * [ ] Does it upload media?                  → Use UploadQueue
 * [ ] Does it cache remote files?            → Use CacheManager
 * [ ] Does it use exclusive hardware?        → Register with ResourceManager
 * [ ] Does it run heavy JS?                  → Use React.lazy + lazy require
 * [ ] Does it use native modules?            → Check metro.config.js + react-native.config.js
 * [ ] Does it clean up on unmount?           → Use useCleanup hook
 * [ ] Can it crash?                          → Wrap in <ErrorBoundary module="...">
 * [ ] Does it make API calls?                → Use retry() with CircuitBreaker
 * [ ] Does it update state optimistically?   → Use SyncEngine.optimisticUpdate()
 * [ ] Does it check memory pressure?         → Read MemoryPressureMonitor.currentQuality
 * [ ] Is it a game/battle feature?           → Use GameStore/BattleStore + GameEngine
 * [ ] Is it realtime multiplayer?            → Use SignalingManager + PresenceManager
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FUTURE MODULES ROADMAP
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * modules/webrtc/         Real WebRTC peer connections
 *                         (when react-native-webrtc re-enabled in config)
 * modules/ai/             OnSpace AI pipeline, prompt templates, model router
 * modules/creator/editor/ Post-capture video editor (trim, crop, text, stickers)
 * modules/creator/audio/  Music picker + audio mixer
 * modules/creator/rendering/ Video compositor (video + audio + effects tracks)
 * modules/analytics/      Creator analytics + engagement metrics
 */

export {};
