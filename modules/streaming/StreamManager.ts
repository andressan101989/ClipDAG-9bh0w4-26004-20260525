/**
 * modules/streaming/StreamManager.ts — Live streaming lifecycle manager (stub v1)
 *
 * Architecture for future implementation:
 *   - Host: stream creation, viewer count tracking, gift reception
 *   - Viewer: stream discovery, join/leave, in-stream chat
 *   - Battle mode: dual-stream layout, voting, real-time score board
 *   - Signaling via Supabase Edge Functions + polling (no WebSocket)
 *
 * CURRENT STATE: Skeleton with types, state machine, and EventBus wiring.
 * Real video transport (WebRTC / RTMP) to be added when infrastructure is ready.
 *
 * EventBus integration:
 *   Emits:  stream:started, stream:ended, stream:viewer_joined, stream:gift_received
 */

import { EventBus } from '../core/EventBus';
import { getSupabaseClient } from '@/template';

// ── Types ─────────────────────────────────────────────────────────────────────
export type StreamStatus = 'idle' | 'preparing' | 'live' | 'ending' | 'ended' | 'error';

export interface LiveSession {
  sessionId:    string;
  hostId:       string;
  title:        string;
  status:       StreamStatus;
  viewerCount:  number;
  startedAt?:   number;
  endedAt?:     number;
}

export interface StreamGift {
  sessionId:  string;
  senderId:   string;
  username:   string;
  giftType:   string;
  dagValue:   number;
  timestamp:  number;
}

// ── Implementation ─────────────────────────────────────────────────────────────
class StreamManagerImpl {
  private _session: LiveSession | null = null;
  private _recentGifts: StreamGift[] = [];

  get currentSession(): LiveSession | null { return this._session; }
  get isLive(): boolean { return this._session?.status === 'live'; }
  get recentGifts(): StreamGift[] { return this._recentGifts.slice(-20); }

  /** Start a new live session as host. */
  async startStream(hostId: string, title: string): Promise<{ sessionId: string } | { error: string }> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('live_sessions')
        .insert({ host_id: hostId, title, status: 'live', viewer_count: 0 })
        .select()
        .single();

      if (error) return { error: error.message };

      this._session = {
        sessionId:   data.id,
        hostId,
        title,
        status:      'live',
        viewerCount: 0,
        startedAt:   Date.now(),
      };

      EventBus.emit('stream:started', { hostId, sessionId: data.id, title });
      console.log('[StreamManager] stream started:', data.id);
      return { sessionId: data.id };
    } catch (e: any) {
      return { error: e?.message ?? 'Error starting stream' };
    }
  }

  /** End the current live session. */
  async endStream(): Promise<void> {
    if (!this._session) return;
    const { sessionId } = this._session;
    try {
      const supabase = getSupabaseClient();
      await supabase
        .from('live_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', sessionId);
    } catch (e: any) {
      console.warn('[StreamManager] endStream error:', e?.message);
    }

    const viewerCount = this._session.viewerCount;
    this._session = null;
    EventBus.emit('stream:ended', { sessionId, viewerCount });
  }

  /** Viewer joins a stream — logs view, increments counter. */
  async joinStream(sessionId: string, userId: string): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      // Optimistic increment
      await supabase.rpc('increment_viewer_count' as any, { session_id: sessionId }).catch(() => {});
    } catch { /* ignore */ }
    EventBus.emit('stream:viewer_joined', { sessionId, userId });
  }

  /** Record an in-stream gift event. */
  receiveGift(gift: Omit<StreamGift, 'timestamp'>): void {
    const entry: StreamGift = { ...gift, timestamp: Date.now() };
    this._recentGifts.push(entry);
    if (this._recentGifts.length > 50) this._recentGifts.shift();
    EventBus.emit('stream:gift_received', {
      sessionId: gift.sessionId,
      giftType:  gift.giftType,
      senderId:  gift.senderId,
    });
  }

  /** Update viewer count from poll. */
  updateViewerCount(count: number): void {
    if (this._session) {
      this._session = { ...this._session, viewerCount: count };
    }
  }

  /** Cleanup on component unmount. */
  reset(): void {
    this._session    = null;
    this._recentGifts = [];
  }
}

export const StreamManager = new StreamManagerImpl();

// ── React hook ─────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react';

export function useStreamState() {
  const [session, setSession] = useState<LiveSession | null>(StreamManager.currentSession);
  const [gifts,   setGifts]   = useState<StreamGift[]>(StreamManager.recentGifts);

  useEffect(() => {
    const unsubs = [
      EventBus.on('stream:started',      () => setSession(StreamManager.currentSession)),
      EventBus.on('stream:ended',        () => setSession(StreamManager.currentSession)),
      EventBus.on('stream:gift_received',() => setGifts([...StreamManager.recentGifts])),
    ];
    return () => { unsubs.forEach(fn => fn()); };
  }, []);

  return {
    session,
    isLive:       session?.status === 'live',
    viewerCount:  session?.viewerCount ?? 0,
    recentGifts:  gifts,
    startStream:  StreamManager.startStream.bind(StreamManager),
    endStream:    StreamManager.endStream.bind(StreamManager),
    joinStream:   StreamManager.joinStream.bind(StreamManager),
  };
}
