/**
 * modules/realtime/index.ts — Realtime infrastructure barrel
 */
export { PollingManager }    from './PollingManager';
export { SignalingManager }  from './SignalingManager';
export type { SignalType, SignalMessage } from './SignalingManager';
export { PresenceManager }   from './PresenceManager';
export type { PresenceStatus, PresenceRecord } from './PresenceManager';
export { SyncEngine }        from './SyncEngine';
export type { ConflictStrategy } from './SyncEngine';
export { EventGateway }      from './EventGateway';
export type { GatewayEventType, GatewayEvent } from './EventGateway';
export { ConnectionManager } from './ConnectionManager';
export type { ConnectionState, NetworkType } from './ConnectionManager';
