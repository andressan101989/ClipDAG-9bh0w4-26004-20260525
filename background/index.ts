/**
 * background/index.ts — Background processing infrastructure
 *
 * Decouples heavy processing from the UI thread:
 *   - UploadWorker:   queued file uploads with progress tracking
 *   - CleanupWorker:  cache expiry, temp files, listener teardown
 *   - SyncWorker:     periodic data sync (feed, messages, notifications)
 *   - CacheWorker:    LRU cache management, prefetch strategy
 *   - TelemetryWorker: diagnostic data collection & reporting
 *
 * Design:
 *   - All workers are event-driven via EventBus
 *   - Workers pause when app is in background (AppLifecycle)
 *   - No worker holds UI references — communicate via stores + EventBus
 *   - Each worker has its own error boundary — failure doesn't cascade
 *
 * Note: React Native does not support real Web Workers or SharedArrayBuffer.
 * These "workers" are logical isolation units running on the JS thread,
 * using async/await + queues to avoid blocking renders.
 * For true background execution, use expo-background-fetch (not implemented here).
 */

export { UploadWorker }   from './UploadWorker';
export { CleanupWorker }  from './CleanupWorker';
export { SyncWorker }     from './SyncWorker';
