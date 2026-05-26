/**
 * modules/core/index.ts — Core infrastructure barrel
 */
export { EventBus }               from './EventBus';
export type { AppEvents, AppEventName, AppEventPayload } from './EventBus';

export { AppLifecycle }           from './AppLifecycle';

export { Perf }                   from './PerformanceMonitor';

export { ResourceManager }        from './ResourceManager';
export type { ResourceType, ResourceLease } from './ResourceManager';

export { MemoryPressureMonitor, useAdaptiveQuality } from './MemoryPressureMonitor';
export type { PressureLevel, QualityProfile }        from './MemoryPressureMonitor';

export { FrameScheduler }         from './FrameScheduler';
export type { RenderPriority, RenderSurface } from './FrameScheduler';

export { ThermalMonitor }         from './ThermalMonitor';
export type { ThermalState }      from './ThermalMonitor';

export { Diagnostics }            from './Diagnostics';
export type { MemorySnapshot, ScreenMetric, UploadMetric, DiagnosticsReport } from './Diagnostics';

export { CrashManager }           from './CrashManager';
export type { CrashRecord, Severity } from './CrashManager';

export { retry, CircuitBreaker }  from './RetryStrategy';
export type { RetryOptions, RetryStrategyType, CircuitState } from './RetryStrategy';
