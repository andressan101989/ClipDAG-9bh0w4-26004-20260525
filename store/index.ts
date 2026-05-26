/**
 * store/index.ts — Store barrel
 *
 * All domain stores are singletons. Import the store you need directly
 * or use the domain-specific hooks (hooks/useXxxStore.ts) for React binding.
 *
 * Store design principles:
 *  - Observable: any code can subscribe() to state changes
 *  - Serializable: state is plain objects (no classes/proxies)
 *  - Isolated: each store owns its domain, no cross-store imports
 *  - EventBus-connected: cross-domain events flow through EventBus
 */

export { AuthStore }   from './auth.store';
export type { AuthUser, AuthState }   from './auth.store';

export { CallStore }   from './call.store';
export type { CallState, CallParticipant, CallType, CallStatus } from './call.store';

export { StreamStore } from './stream.store';
export type { StreamState, StreamGiftEvent, StreamMessage, StreamRole, StreamStatus } from './stream.store';

export { BattleStore } from './battle.store';
export type { BattleState, BattleParticipant, BattleStatus } from './battle.store';

export { GameStore }   from './game.store';
export type { GameState, GamePlayer, GameWager, GameStatus } from './game.store';

export { MediaStore }  from './media.store';
export type { MediaState, UploadItem, RecordingSession } from './media.store';
