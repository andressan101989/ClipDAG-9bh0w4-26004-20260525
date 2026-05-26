/**
 * modules/realtime/SignalingManager.ts — WebRTC signaling over Supabase polling
 *
 * Provides a lightweight signaling channel for WebRTC peer connections
 * without requiring WebSockets (not supported on this backend).
 *
 * Protocol:
 *   - Offer/answer/ICE candidates stored as rows in a supabase signaling table
 *     (future: or via Edge Function ephemeral store)
 *   - Polling at 1s intervals during call setup → reduces to 2s once connected
 *   - All signaling rows are ephemeral: TTL 60 seconds
 *
 * CURRENT STATE: Architecture stub — ready to wire real WebRTC when
 * react-native-webrtc is re-enabled in metro.config.js.
 *
 * Usage:
 *   await SignalingManager.sendOffer(roomId, sdpOffer);
 *   const answer = await SignalingManager.waitForAnswer(roomId);
 *   await SignalingManager.sendIceCandidate(roomId, candidate);
 */

import { EventBus } from '../core/EventBus';
import { PollingManager } from './PollingManager';

export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'end' | 'heartbeat';

export interface SignalMessage {
  type:      SignalType;
  roomId:    string;
  fromId:    string;
  toId?:     string;
  payload:   string;   // JSON-encoded SDP / ICE / meta
  timestamp: number;
}

class SignalingManagerImpl {
  private readonly _pendingMessages = new Map<string, SignalMessage[]>();
  private readonly _messageHandlers = new Map<SignalType, Set<(msg: SignalMessage) => void>>();
  private _pollingRooms = new Set<string>();

  // ── Send ───────────────────────────────────────────────────────────────────

  async sendSignal(msg: Omit<SignalMessage, 'timestamp'>): Promise<{ error?: string }> {
    // TODO: store in Supabase signaling table or Edge Function
    console.log('[SignalingManager] sendSignal:', msg.type, 'room:', msg.roomId);
    return {};
  }

  async sendOffer(roomId: string, fromId: string, sdp: string): Promise<void> {
    await this.sendSignal({ type: 'offer', roomId, fromId, payload: sdp });
  }

  async sendAnswer(roomId: string, fromId: string, sdp: string): Promise<void> {
    await this.sendSignal({ type: 'answer', roomId, fromId, payload: sdp });
  }

  async sendIceCandidate(roomId: string, fromId: string, candidate: string): Promise<void> {
    await this.sendSignal({ type: 'ice-candidate', roomId, fromId, payload: candidate });
  }

  async sendEndSignal(roomId: string, fromId: string): Promise<void> {
    await this.sendSignal({ type: 'end', roomId, fromId, payload: '' });
    this.stopPolling(roomId);
  }

  // ── Receive ────────────────────────────────────────────────────────────────

  /** Start polling for incoming signals for a room. */
  startPolling(roomId: string, localUserId: string): void {
    if (this._pollingRooms.has(roomId)) return;
    this._pollingRooms.add(roomId);

    PollingManager.register({
      key:         `signal:${roomId}`,
      intervalMs:  1000,    // 1s during negotiation
      runImmediately: true,
      fn:          async () => {
        await this._poll(roomId, localUserId);
      },
    });
  }

  stopPolling(roomId: string): void {
    this._pollingRooms.delete(roomId);
    PollingManager.unregister(`signal:${roomId}`);
    this._pendingMessages.delete(roomId);
  }

  /** Register a handler for a specific signal type. */
  onSignal(type: SignalType, handler: (msg: SignalMessage) => void): () => void {
    if (!this._messageHandlers.has(type)) {
      this._messageHandlers.set(type, new Set());
    }
    this._messageHandlers.get(type)!.add(handler);
    return () => this._messageHandlers.get(type)?.delete(handler);
  }

  /** Wait for a specific signal type (Promise-based, with timeout). */
  waitFor(type: SignalType, roomId: string, timeoutMs = 30_000): Promise<SignalMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout waiting for ${type} signal in room ${roomId}`));
      }, timeoutMs);

      const unsub = this.onSignal(type, (msg) => {
        if (msg.roomId === roomId) {
          clearTimeout(timer);
          unsub();
          resolve(msg);
        }
      });
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _poll(roomId: string, localUserId: string): Promise<void> {
    // TODO: query Supabase for new signal rows addressed to localUserId in roomId
    // On receipt → dispatch to registered handlers
    const messages = this._pendingMessages.get(roomId) ?? [];
    for (const msg of messages) {
      const handlers = this._messageHandlers.get(msg.type);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg); } catch { /* isolate */ }
        }
      }
    }
    this._pendingMessages.set(roomId, []);
  }

  /** Inject a message (e.g. from push notification or test). */
  _injectMessage(msg: SignalMessage): void {
    const list = this._pendingMessages.get(msg.roomId) ?? [];
    list.push(msg);
    this._pendingMessages.set(msg.roomId, list);
  }
}

export const SignalingManager = new SignalingManagerImpl();
