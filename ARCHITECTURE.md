# ClipDAG — Architecture Reference v4

## Quick Navigation

| Layer | Location | Purpose |
|---|---|---|
| Pages/Routes | `app/` | Expo Router screens |
| Core Infra | `modules/core/` | Platform services (lifecycle, memory, render, crash) |
| Realtime | `modules/realtime/` | Connection, polling, presence, sync, recovery |
| Media Engine | `modules/media/` | Sessions, compression, bitrate, prefetch, cleanup |
| Creator Studio | `modules/creator/` | Camera, effects, timeline, filters, export |
| Gaming | `modules/gaming/` | Engine, matchmaking, anti-cheat, timers, rewards |
| Battle | `modules/battle/` | Battle lifecycle |
| Streaming | `modules/streaming/` | Live session management |
| Calls | `modules/calls/` | Call session management |
| Background | `background/` | Upload, sync, cleanup workers |
| State Stores | `store/` | Domain stores (auth, call, stream, battle, game, media) |
| Contexts | `contexts/` | React state (Auth, Feed, Messages, Notifications, Shop) |
| Hooks | `hooks/` | Business logic, core utilities, store accessors |
| Services | `services/` | API clients, SDK wrappers |
| Components | `components/` | UI (feature/, ui/, studio/) |

---

## Core Infrastructure (`modules/core/`)

```
AppLifecycle          — AppState change coordination (foreground/background/inactive)
EventBus              — Typed pub/sub (decouples modules, zero circular deps)
CrashManager          — Global error boundary + recovery registry
PerformanceMonitor    — JS FPS, render times, operation durations
ResourceManager       — GPU/camera/mic exclusive resource leases
MemoryPressureMonitor — 3-tier quality degradation (normal/moderate/critical)
FrameScheduler        — Per-surface FPS caps, jank detection, thermal FPS caps
ThermalMonitor        — JS timer drift heuristics → thermal state estimate
Diagnostics           — Ring-buffer metrics (memory/screens/uploads/realtime)
RetryStrategy         — Exponential backoff + CircuitBreaker
RenderIsolationManager — Viewport-aware suspension, scene grouping, batch rendering ★ NEW
LeakDetector          — Resource registration + stale detection + force-cleanup ★ NEW
PowerManager          — Power tier (performance/balanced/saver/emergency), thermal-driven ★ NEW
RateLimiter           — Token bucket / sliding window / debounce / throttle ★ NEW
BackpressureQueue     — Priority event queues, coalescing, TTL, load shedding ★ NEW
```

## Realtime Layer (`modules/realtime/`)

```
PollingManager        — Background-aware centralized polling scheduler
ConnectionManager     — Heartbeat, exponential backoff reconnect, circuit breaker
SignalingManager      — WebRTC signaling channel (polling-based)
PresenceManager       — User online/away/in_call presence (heartbeat + TTL)
SyncEngine            — Optimistic updates + conflict resolution
EventGateway          — Cross-module event routing with priority
SessionRecovery       — Call/stream/game session recovery after disconnect ★ NEW
```

## Media Engine (`modules/media/`)

```
UploadQueue           — Priority upload queue with retry + progress
CacheManager          — 2-tier LRU cache (memory + disk, 100MB cap)
IntelligentCacheManager — Thermal-aware eviction, session-scoped, priority TTL ★ NEW
MediaSessionManager   — Unified camera/mic/playback session lifecycle ★ NEW
CompressionManager    — Adaptive image/video compression by profile + conditions ★ NEW
AdaptiveBitrateManager — ABR for streaming/calls/playback with hysteresis ★ NEW
MediaCleanupManager   — Aggressive cleanup on navigation, background, low memory ★ NEW
PrefetchMediaManager  — Network+power-aware prefetch with priority scheduling ★ NEW
```

## Creator Studio (`modules/creator/`)

```
CameraController      — Camera lifecycle (permission, flip, flash, zoom)
EffectsController     — Skia effects overlay management
EditorController      — Non-destructive edit ops with 50-op undo stack
DraftManager          — Local draft persistence (AsyncStorage)
RenderCompositor      — Async FFmpeg render pipeline with progress
FiltersController     — AR/LUT/Skia filter catalog, download, apply ★ NEW
TimelineController    — Multi-track timeline (video/audio/overlay/effects) ★ NEW
ExportManager         — Full publish pipeline (render→compress→upload→DB) ★ NEW
CreatorSessionManager — Full session lifecycle with resource coordination ★ NEW
```

## Gaming Infrastructure (`modules/gaming/`)

```
GameEngine            — Game session orchestrator with adapter pattern
Matchmaking           — Player matching with polling + timeout
AntiCheat             — Flood/replay/bot detection
TimerManager          — Precision countdown timers with server sync
RewardsEngine         — Score calculation, streak bonuses, anti-farming
```

## State Stores (`store/`)

```
auth.store.ts         — User session state (reactive, EventBus-synced)
call.store.ts         — Active call state (participants, status, duration)
stream.store.ts       — Live session state (viewer count, chat, gifts)
battle.store.ts       — Battle session state (opponents, wagers, scores)
game.store.ts         — Game session state (phase, scores, timer, payload)
media.store.ts        — Upload queue + active playback state
```

## Background Workers (`background/`)

```
UploadWorker.ts       — Network-aware upload processor (WiFi priority)
CleanupWorker.ts      — Periodic temp file + stale cache cleanup
SyncWorker.ts         — Priority-based data sync coordinator
```

---

## Data Flow (Simplified)

```
User Action
  → RateLimiter.check()          (anti-spam)
  → Component calls Hook
  → Hook calls Service
  → Service calls Supabase / Edge Function
  → Service emits EventBus event
  → Context updates state
  → React re-renders component

Background
  → AppLifecycle.onForeground()
  → PollingManager triggers registered fns
  → ConnectionManager heartbeat
  → SyncWorker.forceSync()

Thermal Pressure
  → ThermalMonitor.sample()
  → PowerManager.onThermalChange()
  → FrameScheduler.reportThermalState()
  → RenderIsolationManager caps/drops surfaces
  → IntelligentCacheManager.thermalEviction()
  → AdaptiveBitrateManager.setPowerMode()

Navigation Away
  → MediaCleanupManager.cleanupScreen()
  → CreatorSessionManager.close()
  → RenderIsolationManager.suspendScene()
  → ResourceManager releases leases
  → LeakDetector verifies all tokens released
```

---

## Scaling Checklist (for each new feature)

- [ ] Acquires ResourceManager lease for GPU/camera (not raw)
- [ ] Registers with FrameScheduler via RenderIsolationManager
- [ ] Uses RateLimiter for user-triggered actions
- [ ] Uses BackpressureQueue for high-frequency events
- [ ] Registers MediaCleanupManager handler on mount
- [ ] Uses LeakDetector.track() for all async resources
- [ ] Subscribes to PowerManager.onTierChange() and degrades gracefully
- [ ] Uses IntelligentCacheManager instead of direct CacheManager for media
- [ ] Registers with SessionRecovery if session-based
- [ ] Uses AdaptiveBitrateManager for video quality
- [ ] Respects AppLifecycle.onBackground() (pauses non-essential work)
- [ ] Emits events via EventBus (never direct cross-module calls)
- [ ] State in domain store (not local useState for shared state)
- [ ] Uses ConnectionManager.isHealthy before network ops

---

## Module Dependency Rules

```
modules/core         ← no internal module deps (foundation)
modules/realtime     ← depends on core only
modules/media        ← depends on core only
modules/creator      ← depends on core + media + gaming (TimerManager)
modules/gaming       ← depends on core + realtime
modules/battle       ← depends on core + realtime + gaming
modules/streaming    ← depends on core + realtime + media
modules/calls        ← depends on core + realtime + media
store/               ← depends on core (EventBus)
hooks/               ← depends on modules + store + contexts
contexts/            ← depends on hooks + services
services/            ← depends on @/template (Supabase client) only
components/          ← depends on hooks only (never direct module/store imports)
app/                 ← depends on components + hooks only
```

---

## Next Steps

1. Wire `SyncWorker.register()` calls in AuthContext (login/logout)
2. Implement `app/(tabs)/index.tsx` FlatList with PrefetchMediaManager
3. Build `app/videocall/[userId].tsx` UI using CallManager + TimerManager
4. Connect `FiltersController` to `CameraCore.tsx` (replace direct deeparService calls)
5. Build in-app debug panel at `app/debug.tsx` using `Diagnostics.getReport()`
6. Implement `CreatorSessionManager.open()` in `app/creator-studio.tsx`
7. Add `RateLimiter.check('like_action')` in VideoActions like handler
8. Wire `AdaptiveBitrateManager` to live streaming quality selector
