import {
  LiveBattleRelayError,
  type LiveBattleRelaySnapshot,
} from './liveBattleRelayContract';

export type LiveBattleRelayListener = (snapshot: LiveBattleRelaySnapshot) => void;

const IDLE_SNAPSHOT: LiveBattleRelaySnapshot = {
  state: 'idle',
  battleId: null,
  errorCode: null,
  relayCode: null,
};

/** Web-safe fallback. Channel Media Relay is available only in the native SDK. */
export class LiveBattleRelayService {
  constructor(engine?: unknown) {
    void engine;
  }

  setVisualContinuityHandlers(_handlers: { onReconfigure?: () => void; onStopped?: () => void }): void {
    // Non-native platforms have no relay or native video transition.
  }

  getSnapshot(): LiveBattleRelaySnapshot {
    return { ...IDLE_SNAPSHOT };
  }

  subscribe(listener: LiveBattleRelayListener): () => void {
    listener(this.getSnapshot());
    return () => undefined;
  }

  start(_battleId: string): Promise<LiveBattleRelaySnapshot> {
    return Promise.reject(new LiveBattleRelayError('battle_relay_native_unavailable'));
  }

  transition(_battleId: string): Promise<LiveBattleRelaySnapshot> {
    return Promise.reject(new LiveBattleRelayError('battle_relay_native_unavailable'));
  }

  refreshCredentials(_battleId: string): Promise<LiveBattleRelaySnapshot> {
    return Promise.reject(new LiveBattleRelayError('battle_relay_native_unavailable'));
  }

  stop(): Promise<LiveBattleRelaySnapshot> {
    return Promise.resolve(this.getSnapshot());
  }

  stopImmediately(): void {
    // Web never starts a relay.
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

export type {
  LiveBattleRelayCredentials,
  LiveBattleRelaySnapshot,
  LiveBattleRelayState,
} from './liveBattleRelayContract';
