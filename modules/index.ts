/**
 * modules/index.ts — Root module barrel
 * Single import point for all infrastructure modules.
 *
 * Usage:
 *   import { EventBus, PowerManager, AdaptiveQualityController } from '@/modules';
 *   import { MediaSessionManager, StreamingBufferManager }       from '@/modules';
 *   import { ConnectionManager, SessionRecovery }                from '@/modules';
 *   import { CreatorSessionManager, ExportManager }              from '@/modules';
 */

// Core infrastructure
export * from './core';

// Realtime layer
export * from './realtime';

// Media engine
export * from './media';

// Feature modules
export { BattleManager }  from './battle/BattleManager';
export { CallManager }    from './calls/CallManager';
export { StreamManager }  from './streaming/StreamManager';
export * from './creator';
export * from './gaming';
