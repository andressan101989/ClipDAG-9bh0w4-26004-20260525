# ClipDAG — Architecture Reference v5

## Quick Navigation

| Layer | Location | Purpose |
|---|---|---|
| Pages/Routes | `app/` | Expo Router screens (+ `app/debug.tsx` dev panel) |
| Core Infra | `modules/core/` | Platform services (lifecycle, memory, render, crash) |
| Realtime | `modules/realtime/` | Connection, polling, presence, sync, recovery |
| Media Engine | `modules/media/` | Sessions, compression, bitrate, buffers, recovery |
| Creator Studio | `modules/creator/` | Camera, effects, timeline, filters, export, sessions |
| Gaming | `modules/gaming/` | Engine, matchmaking, anti-cheat, timers, rewards |
| Battle | `modules/battle/` | Battle lifecycle |
| Streaming | `modules/streaming/` | Live session management |
| Calls | `modules/calls/` | Call session management |
| Background | `background/` | Upload, sync, cleanup workers |
| State Stores | `store/` | Domain stores (auth, call, stream, battle, game, media) |
| Contexts | `contexts/` | React state (Auth, Feed, Messages, Notifications, Shop) |
| Hooks | `hooks/` | Business logic, core utilities, store accessors, navigation |
| Services | `services/` | API clients, SDK wrappers |
| Components | `components/` | UI (feature/, ui/, studio/) |

---

## Core Infrastructure (`modules/core/`)

```
AppLifecycle             — AppState change coordination (foreground/background/inactive)
EventBus                 — Typed pub/sub (decouples modules, zero circular deps)
CrashManager             — Global error boundary + recovery registry
PerformanceMonitor       — JS FPS, render times, operation durations
ResourceManager          — GPU/camera/mic exclusive resource leases
MemoryPressureMonitor    — 3-tier quality degradation (normal/moderate/critical)
FrameScheduler           — Per-surface FPS caps, jank detection, thermal FPS caps
ThermalMonitor           — JS timer drift heuristics → thermal state estimate
Diagnostics              — Ring-buffer metrics (memory/screens/uploads/realtime)
RetryStrategy            — Exponential backoff + CircuitBreaker
RenderIsolationManager   — Viewport-aware suspension, scene grouping, batch rendering
LeakDetector             — Resource registration + stale detection + force-cleanup
PowerManager             — Power tier (performance/balanced/saver/emergency), thermal-driven
RateLimiter              — Token bucket / sliding window / debounce / throttle
BackpressureQueue        — Priority event queues, coalescing, TTL, load shedding
AdaptiveQualityController — ★ NEW — Unified orchestrator wiring all subsystems
```

### Adaptive Quality Cascade (NEW)

```
ThermalMonitor.sample()
  → PowerManager.onThermalChange()
    → PowerManager tier change
      → AdaptiveQualityController._onPowerTierChange()
        → FrameScheduler.reportThermalState()   [FPS cap]
        → RenderIsolationManager.suspendAllCategories()  [stop dead surfaces]
        → PrefetchMediaManager.setPowerMode()   [reduce prefetch]
        → IntelligentCacheManager.setThermalState()  [evict cache]
        → AdaptiveBitrateManager.onPowerTierChange()  [lower bitrate]
        → EventBus.emit → UI components update  [hide AR, simplify UI]
```

## Realtime Layer (`modules/realtime/`)

```
PollingManager     — Background-aware centralized polling scheduler
ConnectionManager  — Heartbeat, exponential backoff reconnect, circuit breaker
SignalingManager   — WebRTC signaling channel (polling-based)
PresenceManager    — User online/away/in_call presence (heartbeat + TTL)
SyncEngine         — Optimistic updates + conflict resolution
EventGateway       — Cross-module event routing with priority
SessionRecovery    — Call/stream/game session recovery after disconnect
```

## Media Engine (`modules/media/`)

```
UploadQueue             — Priority upload queue with retry + progress
CacheManager            — 2-tier LRU cache (memory + disk, 100MB cap)
IntelligentCacheManager — Thermal-aware eviction, session-scoped, priority TTL
MediaSessionManager     — Unified camera/mic/playback session lifecycle
CompressionManager      — Adaptive image/video compression by profile + conditions
AdaptiveBitrateManager  — ABR for streaming/calls/playback with hysteresis
MediaCleanupManager     — Aggressive cleanup on navigation, background, low memory
PrefetchMediaManager    — Network+power-aware prefetch with priority scheduling
StreamingBufferManager  — ★ NEW — Buffer states, stall detection, multi-stream coordination
UploadRecoveryManager   — ★ NEW — Persistent upload recovery across restarts
```

## Creator Studio (`modules/creator/`)

```
CameraController      — Camera lifecycle (permission, flip, flash, zoom)
EffectsController     — Skia effects overlay management
EditorController      — Non-destructive edit ops with 50-op undo stack
DraftManager          — Local draft persistence (AsyncStorage)
RenderCompositor      — Async FFmpeg render pipeline with progress
FiltersController     — AR/LUT/Skia filter catalog, download, apply
TimelineController    — Multi-track timeline (video/audio/overlay/effects)
ExportManager         — Full publish pipeline (render→compress→upload→DB)
CreatorSessionManager — Full session lifecycle with resource coordination
```

## Gaming Infrastructure (`modules/gaming/`)

```
GameEngine     — Game session orchestrator with adapter pattern
Matchmaking    — Player matching with polling + timeout
AntiCheat      — Flood/replay/bot detection
TimerManager   — Precision countdown timers with server sync
RewardsEngine  — Score calculation, streak bonuses, anti-farming
```

## State Stores (`store/`)

```
auth.store.ts    — User session state (reactive, EventBus-synced)
call.store.ts    — Active call state (participants, status, duration)
stream.store.ts  — Live session state (viewer count, chat, gifts)
battle.store.ts  — Battle session state (opponents, wagers, scores)
game.store.ts    — Game session state (phase, scores, timer, payload)
media.store.ts   — Upload queue + active playback state
```

## Background Workers (`background/`)

```
UploadWorker.ts   — Network-aware upload processor (WiFi priority)
CleanupWorker.ts  — Periodic temp file + stale cache cleanup
SyncWorker.ts     — Priority-based data sync coordinator
```

## Hooks (`hooks/`)

```
hooks/core/
  useCleanup.ts          — Automatic cleanup registry on unmount
  useEventBus.ts         — Subscribe to EventBus events in components
  useRenderIsolation.ts  — Register/unregister render surfaces
  usePowerTier.ts        — Subscribe to PowerManager tier changes
  useLeakTracking.ts     — Track resources for leak detection
  useAdaptiveQuality.ts  — ★ NEW — Subscribe to quality profile changes

hooks/navigation/        — ★ NEW
  useScreenLifecycle.ts  — Auto-track screen visibility + cleanup on unmount

hooks/store/
  index.ts               — Store access hooks

hooks/video/
  useVideoEditor.ts      — Video editing operations
```

## Debug Panel (`app/debug.tsx`) ★ NEW

Real-time developer panel with 5 sections:
- **System**: Power tier, quality level, thermal state, GPU pressure, leak detector
- **Render**: Frame stats per surface, render budget, recent screen durations
- **Realtime**: Connection state, queue depth, reconnect count, latency/miss rate
- **Media**: Upload stats, recovery queue, stream buffer states + stall rates
- **Memory**: Heap snapshots, held ResourceManager leases

Access: `router.push('/debug')` from any screen in development.
Auto-refresh: every 2 seconds.

---

## Boot Sequence (`app/_layout.tsx`)

```
AppLifecycle.initialize()              // 1. register AppState listeners
CrashManager.initialize()             // 2. global error boundary
ThermalMonitor.start()                 // 3. thermal sampling
PowerManager.initialize()             // 4. thermal → power tier
AdaptiveQualityController.initialize() // 5. power tier → all subsystems
Diagnostics.startCollection()         // 6. ring-buffer metrics
LeakDetector.startMonitoring(60_000)  // 7. stale resource scans
CleanupWorker.start()                 // 8. background cleanup
UploadWorker.start()                  // 9. background uploads
UploadRecoveryManager.initialize()    // 10. restore interrupted uploads
```

---

## Data Flow (Complete)

```
User Action
  → RateLimiter.check()              (anti-spam / debounce)
  → BackpressureQueue.push()         (high-frequency events)
  → Component calls Hook
  → Hook calls Service
  → Service calls Supabase / Edge Function
  → Service emits EventBus event
  → Context/Store updates state
  → React re-renders component

Background
  → AppLifecycle.onForeground()
  → PollingManager triggers registered fns
  → ConnectionManager heartbeat
  → SyncWorker.forceSync()
  → UploadRecoveryManager.restorePending()

Thermal / Battery Pressure
  → ThermalMonitor.sample()
  → PowerManager.onThermalChange()
  → AdaptiveQualityController._onPowerTierChange()
  ├── FrameScheduler.reportThermalState()    → FPS caps
  ├── RenderIsolationManager.suspend*()      → drop surfaces
  ├── PrefetchMediaManager.setPowerMode()   → reduce prefetch
  ├── IntelligentCacheManager.thermal*()    → evict cache
  ├── AdaptiveBitrateManager.setPowerTier() → lower bitrate
  └── EventBus → UI components             → hide heavy features

Navigation Away
  → useScreenLifecycle cleanup
  → MediaCleanupManager.cleanupScreen()
  → CreatorSessionManager.close()
  → RenderIsolationManager.suspendScene()
  → ResourceManager releases leases
  → LeakDetector verifies all tokens released

Stream Playback
  → StreamingBufferManager.createBuffer()
  → buffer.reportSegmentLoaded()
  → buffer.onReady() → start playback
  → buffer.onStall() → show spinner
  → buffer.onRecovered() → resume
  → StreamingBufferManager.releaseBuffer() on navigate

Upload with Recovery
  → UploadRecoveryManager.scheduleUpload()
  → Persisted to AsyncStorage
  → UploadQueue.add() called
  → On interruption: job marked 'pending' in storage
  → On next foreground: restorePending() re-queues
  → onJobCompleted() notifies creator
```

---

## Module Dependency Rules

```
modules/core              ← no internal module deps (foundation layer)
modules/realtime          ← depends on core only
modules/media             ← depends on core only
modules/creator           ← depends on core + media
modules/gaming            ← depends on core + realtime
modules/battle            ← depends on core + realtime + gaming
modules/streaming         ← depends on core + realtime + media
modules/calls             ← depends on core + realtime + media
store/                    ← depends on core (EventBus)
hooks/                    ← depends on modules + store + contexts
contexts/                 ← depends on hooks + services
services/                 ← depends on @/template (Supabase client) only
components/               ← depends on hooks only (never direct module/store imports)
app/                      ← depends on components + hooks only
```

---

## Scaling Checklist (for each new feature)

- [ ] Acquires ResourceManager lease for GPU/camera/mic (never raw)
- [ ] Registers surface with RenderIsolationManager (never raw FrameScheduler)
- [ ] Uses RateLimiter for all user-triggered actions
- [ ] Uses BackpressureQueue for high-frequency events (>10/sec)
- [ ] Calls useScreenLifecycle(screenName) in every screen component
- [ ] Registers MediaCleanupManager handler on mount
- [ ] Uses LeakDetector.track() for all async/long-lived resources
- [ ] Subscribes to useAdaptiveQuality() and degrades gracefully (no AR / no Skia)
- [ ] Uses IntelligentCacheManager instead of direct CacheManager
- [ ] Registers with SessionRecovery if session-based (calls, streams, games)
- [ ] Uses AdaptiveBitrateManager for any video quality selection
- [ ] Uses StreamingBufferManager for any video playback buffer tracking
- [ ] Uses UploadRecoveryManager.scheduleUpload() instead of direct UploadQueue
- [ ] Respects AppLifecycle.onBackground() (pauses non-essential work)
- [ ] Emits events via EventBus (never direct cross-module function calls)
- [ ] Stores shared state in domain store (not local useState)
- [ ] Checks ConnectionManager.isHealthy before network operations

---

## Next Immediate Steps

1. **Wire AdaptiveBitrateManager** → network probe recording in StreamManager
2. **Build `app/videocall/[userId].tsx`** UI using CallManager + useAdaptiveQuality
3. **Connect FiltersController** → CameraCore.tsx (replace direct deeparService)
4. **Add `RateLimiter.check('like_action')`** in VideoActions.tsx
5. **Wire `useScreenLifecycle`** in all tab screens (index, profile, messages)
6. **Connect `StreamingBufferManager`** to VideoCard.native.tsx
7. **Test debug panel** at `/debug` with shake trigger via expo-sensors
8. **Wire `UploadRecoveryManager`** in CreatorSessionManager.publish()
