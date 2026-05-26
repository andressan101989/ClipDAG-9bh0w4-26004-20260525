/**
 * modules/gaming/index.ts — Gaming module barrel
 */
export { GameEngine }    from './GameEngine';
export type { GameAdapter } from './GameEngine';
export { Matchmaking }   from './Matchmaking';
export { AntiCheat }     from './AntiCheat';
export type { CheatViolation, ViolationRecord, ActionRecord } from './AntiCheat';
export { TimerManager }  from './TimerManager';
export type { GameTimer } from './TimerManager';
export { RewardsEngine } from './RewardsEngine';
export type { RewardInput, RewardPreview } from './RewardsEngine';
