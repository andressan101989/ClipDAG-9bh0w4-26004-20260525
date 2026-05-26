/**
 * modules/realtime/SignalingManager.ts — Real Supabase signaling for WebRTC
 *
 * Uses the `signaling_messages` table in Supabase to exchange:
 *   - SDP offers / answers
 *   - ICE candidates
 *   - End signals / heartbeats
 *
 * Protocol:
 *   - Messages are inserted as rows with a 60s TTL (expires_at)
 *   - Polling at 1s intervals fetches rows addressed to localUserId
 *   - Each polled row is dispatched to registered signal handlers
 *   - Processed rows are deleted to keep the table small
 *
 * Table schema (ensure this migration has been applied):
 *   signaling_messages (
 *     id          uuid primary key default gen_random_uuid(),
 *     room_id     text not null,
 *     from_id     text not null,
 *     to_id       text,
 *     type        text not null,   -- offer|answer|ice-candidate|end|heartbeat
 *     payload     text not null,
 *     created_at  timestamptz default now(),
 *     expires_at  timestamptz default (now() + '60 seconds')
 *   )
 */

import { getSupabaseClient } from '@/template';
import { PollingManager }    from './PollingManager';

export type SignalType = 'offer' | 'answer' | 'ice-candidate' | 'end' | 'heartbeat';

export interface SignalMessage {
  type:      SignalType;
  roomId:    string;
  fromId:    string;
  toId?:     string;
  payload:   string;
  timestamp: number;
}

// ── SignalingManager ──────────────────────────────────────────────────────────

class SignalingManagerImpl {
  private readonly _messageHandlers = new Map<SignalType, Set<(msg: SignalMessage) => void>>();
  private readonly _pollingRooms    = new Set<string>();
  private readonly _processedIds    = new Set<string>();   // dedup guard

  // ── Send ───────────────────────────────────────────────────────────────────

  async sendSignal(msg: Omit<SignalMessage, 'timestamp'>): Promise<{ error?: string }> {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('signaling_messages').insert({
        room_id:    msg.roomId,
        from_id:    msg.fromId,
        to_id:      msg.toId ?? null,
        type:       msg.type,
        payload:    msg.payload,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      if (error) {
        console.warn('[SignalingManager] send error:', error.message);
        return { error: error.message };
      }
      return {};
    } catch (e: any) {
      console.warn('[SignalingManager] send exception:', e?.message);
      return { error: e?.message };
    }
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

  /** Alias used by CallManager */
  async sendEnd(roomId: string, fromId: string): Promise<void> {
    return this.sendEndSignal(roomId, fromId);
  }

  // ── Receive ────────────────────────────────────────────────────────────────

  startPolling(roomId: string, localUserId: string): void {
    if (this._pollingRooms.has(roomId)) return;
    this._pollingRooms.add(roomId);

    PollingManager.register({
      key:            `signal:${roomId}`,
      intervalMs:     1_000,
      runImmediately: true,
      fn:             () => this._poll(roomId, localUserId),
    });

    console.log('[SignalingManager] polling started for room:', roomId);
  }

  stopPolling(roomId: string): void {
    this._pollingRooms.delete(roomId);
    PollingManager.unregister(`signal:${roomId}`);
    console.log('[SignalingManager] polling stopped for room:', roomId);
  }

  onSignal(type: SignalType, handler: (msg: SignalMessage) => void): () => void {
    if (!this._messageHandlers.has(type)) {
      this._messageHandlers.set(type, new Set());
    }
    this._messageHandlers.get(type)!.add(handler);
    return () => this._messageHandlers.get(type)?.delete(handler);
  }

  waitFor(type: SignalType, roomId: string, timeoutMs = 30_000): Promise<SignalMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new Error(`Timeout waiting for ${type} in room ${roomId}`));
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

  // ── Private poll ──────────────────────────────────────────────────────────

  private async _poll(roomId: string, localUserId: string): Promise<void> {
    try {
      const supabase = getSupabaseClient();

      // Fetch unexpired messages addressed to us (or broadcast) in this room
      const { data, error } = await supabase
        .from('signaling_messages')
        .select('id, room_id, from_id, to_id, type, payload, created_at')
        .eq('room_id', roomId)
        .neq('from_id', localUserId)     // don't receive our own messages
        .gt('expires_at', new Date().toISOString())
        .or(`to_id.is.null,to_id.eq.${localUserId}`)
        .order('created_at', { ascending: true })
        .limit(20);

      if (error) {
        // Table may not exist yet — fail silently
        if (!error.message?.includes('does not exist')) {
          console.warn('[SignalingManager] poll error:', error.message);
        }
        return;
      }

      if (!data || data.length === 0) return;

      const idsToDelete: string[] = [];

      for (const row of data) {
        // Deduplicate
        if (this._processedIds.has(row.id)) continue;
        this._processedIds.add(row.id);

        // Keep dedup set bounded
        if (this._processedIds.size > 500) {
          const it = this._processedIds.values();
          this._processedIds.delete(it.next().value);
        }

        idsToDelete.push(row.id);

        const msg: SignalMessage = {
          type:      row.type as SignalType,
          roomId:    row.room_id,
          fromId:    row.from_id,
          toId:      row.to_id ?? undefined,
          payload:   row.payload,
          timestamp: new Date(row.created_at).getTime(),
        };

        const handlers = this._messageHandlers.get(msg.type);
        if (handlers) {
          for (const h of handlers) {
            try { h(msg); } catch (e: any) {
              console.warn('[SignalingManager] handler error:', e?.message);
            }
          }
        }
      }

      // Delete processed rows to keep table lean
      if (idsToDelete.length > 0) {
        await supabase
          .from('signaling_messages')
          .delete()
          .in('id', idsToDelete)
          .catch(() => { /* non-fatal */ });
      }
    } catch (e: any) {
      console.warn('[SignalingManager] poll exception:', e?.message);
    }
  }
}

export const SignalingManager = new SignalingManagerImpl();
