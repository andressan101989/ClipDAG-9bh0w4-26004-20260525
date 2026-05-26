/**
 * modules/core/index.ts — Core infrastructure barrel
 */
export { EventBus }        from './EventBus';
export type { AppEvents, AppEventName, AppEventPayload } from './EventBus';
export { AppLifecycle }    from './AppLifecycle';
export { Perf }            from './PerformanceMonitor';
