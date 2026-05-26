/**
 * modules/media/index.ts — Media infrastructure barrel
 */
export { UploadQueue }          from './UploadQueue';
export { CacheManager }         from './CacheManager';
export { IntelligentCacheManager } from './IntelligentCacheManager';
export { MediaSessionManager }  from './MediaSessionManager';
export type { MediaSession, MediaSessionType, MediaSessionState } from './MediaSessionManager';
export { CompressionManager }   from './CompressionManager';
export type { CompressionProfile, CompressionResult, CompressionConfig } from './CompressionManager';
export { AdaptiveBitrateManager } from './AdaptiveBitrateManager';
export type { VideoQualityLevel, QualityConfig, NetworkProbe } from './AdaptiveBitrateManager';
export { MediaCleanupManager }  from './MediaCleanupManager';
export type { CleanupCategory } from './MediaCleanupManager';
export { StreamingBufferManager } from './StreamingBufferManager';
export type { StreamBuffer, StreamType } from './StreamingBufferManager';
export { UploadRecoveryManager }  from './UploadRecoveryManager';
export type { UploadJob }         from './UploadRecoveryManager';
export { PrefetchMediaManager } from './PrefetchMediaManager';
export type { PrefetchTask, PrefetchPriority } from './PrefetchMediaManager';
