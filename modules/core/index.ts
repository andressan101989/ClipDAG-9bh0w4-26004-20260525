/**
 * modules/core/index.ts — Core infrastructure barrel
 */
export { EventBus }                from './EventBus';
export type { AppEvent, EventMap } from './EventBus';
export { AppLifecycle }            from './AppLifecycle';
export { PerformanceMonitor }      from './PerformanceMonitor';
export { CrashManager }            from './CrashManager';
export { RetryStrategy, CircuitBreaker } from './RetryStrategy';
export { ResourceManager }         from './ResourceManager';
export { MemoryPressureMonitor }   from './MemoryPressureMonitor';
export { FrameScheduler }          from './FrameScheduler';
export type { RenderPriority, RenderSurface } from './FrameScheduler';
export { ThermalMonitor }          from './ThermalMonitor';
export type { ThermalState }       from './ThermalMonitor';
export { Diagnostics }             from './Diagnostics';
export type { DiagnosticsReport, MemorySnapshot, ScreenMetric, UploadMetric } from './Diagnostics';

// Phase 4 additions
export { RenderIsolationManager }  from './RenderIsolationManager';
export type { RenderCategory }     from './RenderIsolationManager';
export { LeakDetector }            from './LeakDetector';
export type { LeakResourceType, LeakRecord, LeakReport } from './LeakDetector';
export { PowerManager }            from './PowerManager';
export type { PowerTier }          from './PowerManager';
export { AdaptiveQualityController } from './AdaptiveQualityController';
export type { QualityLevel, QualityProfile }  from './AdaptiveQualityController';
export { RateLimiter }             from './RateLimiter';
export type { RateLimitConfig, RateLimitAlgorithm } from './RateLimiter';
export { BackpressureQueue }       from './BackpressureQueue';
export type { QueuedEvent, QueueConfig } from './BackpressureQueue';
export { GPUManager }              from './GPUManager';
export type { GPURenderSlot, GPURenderPriority, GPUReport } from './GPUManager';
export { SecurityManager }         from './SecurityManager';
export type { SecurityAction, ThreatLevel, SecurityEvent, UserRestriction } from './SecurityManager';
export { TelemetryPipeline }       from './TelemetryPipeline';
export type { FPSSample, GPUSample, ThermalTransition, RTCAnalytic, StreamAnalytic, NavTiming, MemoryTrend, WorkerDiagnostic, FrameDropEvent, TelemetrySummary } from './TelemetryPipeline';
export { CrashIntelligence }       from './CrashIntelligence';
export type { CrashFingerprint, Breadcrumb, DiagnosticsBundle } from './CrashIntelligence';
export { ResourceScheduler }       from './ResourceScheduler';
export type { TaskPriority, ScheduledTask, RepeatingTask } from './ResourceScheduler';
export { MemoryOptimizer }             from './MemoryOptimizer';
export type { AllocationRecord, PoolStats } from './MemoryOptimizer';
export { ProductionStabilityMode }     from './ProductionStabilityMode';
export type { StabilityMode, StabilityReport } from './ProductionStabilityMode';
