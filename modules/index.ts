/**
 * modules/index.ts — Root module barrel
 * Single import point for all infrastructure modules.
 *
 * Usage:
 *   import { EventBus, PowerManager, AdaptiveQualityController } from '@/modules';
 *   import { MediaSessionManager, StreamingBufferManager }       from '@/modules';
 *   import { ConnectionManager, RTCManager, SessionRecovery }    from '@/modules';
 *   import { CreatorSessionManager, ExportManager }              from '@/modules';
 *   import { StreamSessionManager, StreamHealthMonitor }         from '@/modules';
 *   import { GPUManager, SecurityManager }                       from '@/modules';
 *   import { SessionOrchestrator }                               from '@/modules';
 */

// Core infrastructure
export * from './core';

// Realtime layer
export * from './realtime';

// Media engine
export * from './media';

// Session orchestration
export * from './sessions';

// Feature modules
export { BattleManager }  from './battle/BattleManager';
export { CallManager }    from './calls/CallManager';
export * from './streaming';
export * from './creator';
export * from './gaming';
