# ClipDAG — Architecture Reference v6

## Quick Navigation

| Layer | Location | Purpose |
|---|---|---|
| Pages/Routes | `app/` | Expo Router screens (+ `app/debug.tsx` dev panel) |
| Core Infra | `modules/core/` | Platform services (lifecycle, memory, render, GPU, security) |
| Realtime | `modules/realtime/` | Connection, RTC, polling, presence, sync, recovery |
| Media Engine | `modules/media/` | Sessions, compression, bitrate, buffers, recovery |
| Streaming | `modules/streaming/` | StreamSessionManager, LiveOrchestrator, StreamHealthMonitor |
| Creator Studio | `modules/creator/` | Camera, effects, timeline, filters, export, sessions, recovery |
| Gaming | `modules/gaming/` | Engine, matchmaking, anti-cheat, timers, rewards |
| Battle | `modules/battle/` | Battle lifecycle |
| Calls | `modules/calls/` | Call session management |
| Sessions | `modules/sessions/` | Global SessionOrchestrator (conflict + recovery) |
| Background | `background/` | Upload, sync, cleanup, telemetry, cache, realtime workers |
| State Stores | `store/` | Domain stores (auth, call, stream, battle, game, media) |
| Contexts | `contexts/` | React state (Auth, Feed, Messages, Notifications, Shop) |
| Hooks | `hooks/` | Business logic, core utilities, store accessors, navigation |
| Services | `services/` | API clients, SDK wrappers |
| Components | `components/` | UI (feature/, ui/, studio/) |

---

## Core Infrastructure (`modules/core/`)

```
AppLifecycle             — AppState change coordination
EventBus                 — Typed pub/sub (zero circular deps)
CrashManager             — Global error boundary + recovery registry
PerformanceMonitor       — JS FPS, render times, operation durations
ResourceManager          — GPU/camera/mic exclusive resource leases
MemoryPressureMonitor    — 3-tier quality degradation
FrameScheduler           — Per-surface FPS caps, jank detection, thermal FPS caps
ThermalMonitor           — JS timer drift heuristics → thermal state estimate
Diagnostics              — Ring-buffer metrics (memory/screens/uploads/realtime)
RetryStrategy            — Exponential backoff + CircuitBreaker
RenderIsolationManager   — Viewport-aware suspension, scene grouping, batch rendering
LeakDetector             — Resource registration + stale detection + force-cleanup
PowerManager             — Power tier (performance/balanced/saver/emergency)
AdaptiveQualityController — Unified orchestrator wiring all subsystems
RateLimiter              — Token bucket / sliding window / debounce / throttle
BackpressureQueue        — Priority event queues, coalescing, TTL, load shedding
GPUManager               ★ NEW — Texture registry, AR lock, render slots, VRAM budget
SecurityManager          ★ NEW — Abuse protection, rate limits per action, block list
```

### Adaptive Quality Cascade

```
ThermalMonitor.sample()
  → PowerManager.onThermalChange()          [power tier update]
    → GPUManager._onThermalChange()         [shed render slots, VRAM budget]
    → AdaptiveQualityController cascade:
        FrameScheduler.reportThermalState() [FPS cap]
        RenderIsolationManager.suspend*()   [stop dead surfaces]
        PrefetchMediaManager.setPowerMode() [reduce prefetch]
        IntelligentCacheManager.thermal*()  [evict cache]
        AdaptiveBitrateManager.setPower()   [lower bitrate]
        EventBus.emit → UI components       [hide AR, simplify UI]
```

### GPU Resource Hierarchy

```
GPUManager.acquireRenderSlot(owner, priority)
  → Enforces MAX_RENDER_SLOTS[thermalState]
  → Priority eviction: critical > high > normal > low
  → LeakDetector tracking per slot

GPUManager.acquireARSession(owner)
  → Exclusive lock — only one DeepAR instance at a time
  → releaseARSession() frees for next requester

GPUManager.trackTexture(key, sizeKB, ttlMs, onEvict)
  → VRAM budget enforced per thermal state
  → Auto-eviction on TTL expiry (every 10s scan)
  → emergencyRelease() frees all textures + low-priority slots
```

## Realtime Layer (`modules/realtime/`)

```
PollingManager     — Background-aware centralized polling scheduler
ConnectionManager  — Heartbeat, exponential backoff reconnect, circuit breaker
SignalingManager   — WebRTC signaling channel (polling-based SDP/ICE)
RTCManager         ★ NEW — WebRTC peer lifecycle, ICE recovery, renegotiation, stats
PresenceManager    — User online/away/in_call presence
SyncEngine         — Optimistic updates + conflict resolution
EventGateway       — Cross-module event routing with priority
SessionRecovery    — Call/stream/game session recovery after disconnect
```

### RTCManager Resilience Chain

```
RTCPeer.negotiate(role)
  → SignalingManager.startPolling(roomId)   [SDP/ICE via polling]
  → ICE timeout watchdog (15s default)
  → On ICE disconnected: 3s grace → reconnect()
  → On ICE failed: immediate reconnect()
  → Exponential backoff: 500ms * 2^n (max 30s), max 5 attempts
  → On background: video track disabled, audio continues
  → On foreground: video track re-enabled
  → On close: LeakDetector.release() + SignalingManager.stopPolling()
```

## Streaming Infrastructure (`modules/streaming/`)

```
StreamManager              — Basic live session CRUD (Supabase)
StreamSessionManager       ★ NEW — Full host + viewer lifecycle with recovery
StreamHealthMonitor        ★ NEW — Bitrate/quality history, average quality
LiveOrchestrator           ★ NEW — Quality adaptation, reaction queue, moderation
```

### Stream Session Lifecycle

```
Host:
  startHostSession(userId, title)
    → Supabase insert live_sessions
    → PollingManager viewer-count poll (5s)
    → AppLifecycle background handler → 'recovering'
    → AppLifecycle foreground handler → 'live'
    → StreamHealthMonitor.record() every poll
  endHostSession()
    → Supabase update status=ended
    → cleanup() → unregister all polls + LeakDetector

Viewer:
  joinViewerSession(sessionId, userId)
    → PollingManager stream-health poll (3s)
    → StreamHealthMonitor.record()
    → If stream ended → cleanup + EventBus emit
```

## Session Orchestration (`modules/sessions/`)

```
SessionOrchestrator        ★ NEW — Global conflict resolution + recovery coordinator
```

### Session Priority (highest wins)

```
call (10) > creator_capture (8) > stream_host (7) > game (6)
  > stream_viewer (4) > upload (2) > media (1)
```

### Conflict Matrix

```
call          conflicts with: creator_capture, stream_host
creator_capture conflicts with: call, stream_host
stream_host   conflicts with: call, creator_capture
```

## Media Engine (`modules/media/`)

```
UploadQueue             — Priority upload queue with retry + progress
CacheManager            — 2-tier LRU cache (memory + disk)
IntelligentCacheManager — Thermal-aware eviction, session-scoped
MediaSessionManager     — Unified camera/mic/playback session lifecycle
CompressionManager      — Adaptive compression by profile + conditions
AdaptiveBitrateManager  — ABR for streaming/calls/playback with hysteresis
MediaCleanupManager     — Aggressive cleanup on navigation + background
PrefetchMediaManager    — Network+power-aware prefetch
StreamingBufferManager  — Buffer states, stall detection
UploadRecoveryManager   — Persistent upload recovery across restarts
```

## Creator Studio (`modules/creator/`)

```
CameraController         — Camera lifecycle (permission, flip, flash, zoom)
EffectsController        — Skia effects overlay management
EditorController         — Non-destructive edit ops with 50-op undo stack
DraftManager             — Local draft persistence
RenderCompositor         — Async FFmpeg render pipeline
FiltersController        — AR/LUT/Skia filter catalog, download, apply
TimelineController       — Multi-track timeline (video/audio/overlay/effects)
ExportManager            — Full publish pipeline (render→compress→upload→DB)
CreatorSessionManager    — Full session lifecycle with resource coordination
CreatorRecoveryManager   ★ NEW — Autosave every 10s, crash recovery, phase checkpoints
```

### Creator Recovery Flow

```
CreatorRecoveryManager.startAutosave(sessionId, { getTimeline, getCapture })
  → AsyncStorage write every 10s: phase, capturedUri, durationMs, timelineJson

On app crash/kill:
  → AsyncStorage preserves last checkpoint

On next open:
  CreatorRecoveryManager.getPendingRecovery()
  → Returns checkpoint if < 24h old
  → UI shows "Resume session?" dialog
  → On confirm: EditorController.open(capturedUri), TimelineController.restore(json)
  → On dismiss: clearRecovery(sessionId)
```

## Gaming Infrastructure (`modules/gaming/`)

```
GameEngine     — Game session orchestrator with adapter pattern
Matchmaking    — Player matching with polling + timeout
AntiCheat      — Flood/replay/bot detection (client-side first line)
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
UploadWorker.ts    — Network-aware upload processor (WiFi priority)
CleanupWorker.ts   — Periodic temp file + stale cache cleanup
SyncWorker.ts      — Priority-based data sync coordinator
TelemetryWorker.ts ★ NEW — Memory snapshots + GPU/thermal analytics flusher
CacheWorker.ts     ★ NEW — Thermal-driven cache eviction + VRAM maintenance
RealtimeWorker.ts  ★ NEW — Connection health + SessionRecovery + presence heartbeat
```

## Hooks (`hooks/`)

```
hooks/core/
  useCleanup.ts              — Automatic cleanup registry on unmount
  useEventBus.ts             — Subscribe to EventBus events in components
  useRenderIsolation.ts      — Register/unregister render surfaces
  usePowerTier.ts            — Subscribe to PowerManager tier changes
  useLeakTracking.ts         — Track resources for leak detection
  useAdaptiveQuality.ts      — Subscribe to quality profile changes
  useGPU.ts                  ★ NEW — GPU slot/texture/AR lock management
  useSessionOrchestrator.ts  ★ NEW — Register component session for conflict handling

hooks/navigation/
  useScreenLifecycle.ts      — Auto-track screen visibility + cleanup on unmount

hooks/store/
  index.ts                   — Store access hooks

hooks/video/
  useVideoEditor.ts          — Video editing operations
```

---

## Boot Sequence (`app/_layout.tsx`)

```
AppLifecycle.initialize()               // 1. register AppState listeners
CrashManager.initialize()              // 2. global error boundary
ThermalMonitor.start()                  // 3. thermal sampling
PowerManager.initialize()              // 4. thermal → power tier
GPUManager.initialize()                // 5. thermal → GPU slots + VRAM budget
AdaptiveQualityController.initialize() // 6. power tier → all subsystems
Diagnostics.startCollection()          // 7. ring-buffer metrics
LeakDetector.startMonitoring(60_000)   // 8. stale resource scans
CleanupWorker.start()                  // 9. background cleanup
UploadWorker.start()                   // 10. background uploads
TelemetryWorker.start()                // 11. background diagnostics flusher
CacheWorker.start()                    // 12. background cache maintenance
UploadRecoveryManager.initialize()     // 13. restore interrupted uploads
```

---

## Data Flow (Complete)

```
User Action
  → SecurityManager.checkAction()       (abuse gate)
  → RateLimiter.check()                 (anti-spam)
  → BackpressureQueue.push()            (high-freq events)
  → Component calls Hook
  → Hook calls Service
  → Service calls Supabase / Edge Function
  → Service emits EventBus event
  → Context/Store updates state → React re-renders

WebRTC Call
  → RTCManager.createPeer(roomId, local, remote)
  → peer.negotiate('offer')
  → SignalingManager SDP/ICE exchange (polling)
  → On network change: peer.restartICE()
  → On failure: peer.reconnect() with backoff
  → On background: video disabled, audio continues
  → On close: LeakDetector + SignalingManager cleanup

Live Stream
  → StreamSessionManager.startHostSession(userId, title)
  → PollingManager viewer-count poll
  → LiveOrchestrator.adaptQuality() on network degradation
  → LiveOrchestrator.pushReaction() → BackpressureQueue drain
  → On background: phase → 'recovering'
  → On foreground: phase → 'live'

Session Conflict (call interrupts stream)
  → SessionOrchestrator detects call (priority 10) vs stream_host (priority 7)
  → stream_host.onPause() called automatically
  → stream_host pushed to recovery queue
  → On call end: stream_host.onResume() called
  → SessionOrchestrator conflict handler notified

Creator Studio Recovery
  → CreatorRecoveryManager.startAutosave() on session open
  → AsyncStorage written every 10s
  → App killed → checkpoint preserved
  → On next launch: getPendingRecovery() → restore dialog
  → On confirm: restore timeline + captured video

Thermal / Battery Pressure
  → ThermalMonitor → PowerManager → GPUManager + AdaptiveQualityController
  ├── GPUManager: shed render slots, enforce VRAM budget
  ├── FrameScheduler: FPS caps
  ├── RenderIsolationManager: suspend surfaces
  ├── PrefetchMediaManager: reduce prefetch
  ├── IntelligentCacheManager: evict cache
  ├── AdaptiveBitrateManager: lower bitrate
  └── EventBus → UI: hide AR, simplify layout
```

---

## Module Dependency Rules

```
modules/core              ← no internal module deps (foundation layer)
modules/realtime          ← depends on core only
modules/media             ← depends on core only
modules/sessions          ← depends on core + realtime
modules/creator           ← depends on core + media
modules/gaming            ← depends on core + realtime
modules/battle            ← depends on core + realtime + gaming
modules/streaming         ← depends on core + realtime + media
modules/calls             ← depends on core + realtime + media
store/                    ← depends on core (EventBus)
hooks/                    ← depends on modules + store + contexts
contexts/                 ← depends on hooks + services
services/                 ← depends on @/template (Supabase client) only
components/               ← depends on hooks only (no direct module/store imports)
app/                      ← depends on components + hooks only
```

---

## Scaling Checklist (for each new feature)

- [ ] Acquires ResourceManager lease for GPU/camera/mic
- [ ] Acquires GPUManager render slot (use `useGPU` hook)
- [ ] Registers surface with RenderIsolationManager
- [ ] Registers session with SessionOrchestrator (use `useSessionOrchestrator` hook)
- [ ] Uses SecurityManager.checkAction() for all user-triggered actions
- [ ] Uses RateLimiter for high-frequency actions
- [ ] Uses BackpressureQueue for events >10/sec
- [ ] Calls useScreenLifecycle(screenName) in every screen component
- [ ] Registers MediaCleanupManager handler on mount
- [ ] Uses LeakDetector.track() for all async/long-lived resources
- [ ] Subscribes to useAdaptiveQuality() and degrades gracefully
- [ ] Uses IntelligentCacheManager instead of direct CacheManager
- [ ] Registers with SessionRecovery if session-based
- [ ] Uses AdaptiveBitrateManager for video quality
- [ ] Uses StreamingBufferManager for video playback tracking
- [ ] Uses UploadRecoveryManager for uploads
- [ ] Respects AppLifecycle.onBackground() (pause non-essential work)
- [ ] Emits events via EventBus (no direct cross-module calls)
- [ ] Checks ConnectionManager.isHealthy before network operations
- [ ] AR features use GPUManager.acquireARSession() exclusive lock
