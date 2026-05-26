/**
 * modules/realtime/EventGateway.ts — Centralized incoming event router
 *
 * Single entry point for ALL incoming external events:
 *   - Push notifications (Expo Notifications)
 *   - WebSocket messages (future)
 *   - Polling results
 *   - Deep link parameters
 *
 * Translates external messages into typed EventBus emissions.
 * Ensures no raw notification/socket parsing is scattered across screens.
 *
 * Usage:
 *   // On push notification received
 *   EventGateway.handle({ type: 'call:incoming', payload: { callerId, roomId } });
 *
 *   // From a polling result
 *   EventGateway.handleBatch(messages);
 */

import { EventBus, AppEventName } from '../core/EventBus';
import { CallStore }   from '@/store/call.store';
import { StreamStore } from '@/store/stream.store';
import { BattleStore } from '@/store/battle.store';

export type GatewayEventType =
  | 'call:incoming'
  | 'call:accepted'
  | 'call:ended'
  | 'call:rejected'
  | 'stream:started'
  | 'stream:ended'
  | 'stream:gift'
  | 'battle:challenged'
  | 'battle:accepted'
  | 'battle:ended'
  | 'notification'
  | 'message'
  | 'wallet:deposit'
  | 'system';

export interface GatewayEvent {
  type:      GatewayEventType;
  payload:   Record<string, any>;
  timestamp?: number;
}

class EventGatewayImpl {
  private readonly _middleware: Array<(e: GatewayEvent) => GatewayEvent | null> = [];

  /** Register middleware (e.g. for auth checks, deduplication). */
  use(fn: (e: GatewayEvent) => GatewayEvent | null): void {
    this._middleware.push(fn);
  }

  /** Handle a single incoming event. */
  handle(event: GatewayEvent): void {
    let processed: GatewayEvent | null = { ...event, timestamp: event.timestamp ?? Date.now() };

    for (const mw of this._middleware) {
      processed = mw(processed);
      if (!processed) return; // middleware dropped the event
    }

    this._dispatch(processed);
  }

  /** Handle an array of incoming events (from polling batch). */
  handleBatch(events: GatewayEvent[]): void {
    for (const e of events) this.handle(e);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _dispatch(e: GatewayEvent): void {
    const { type, payload } = e;

    switch (type) {
      case 'call:incoming':
        EventBus.emit('call:incoming', {
          callerId: payload.callerId ?? '',
          callType: payload.callType ?? 'voice',
          roomId:   payload.roomId ?? '',
        });
        break;

      case 'call:accepted':
        EventBus.emit('call:accepted', {
          callId: payload.callId ?? '',
          roomId: payload.roomId ?? '',
        });
        break;

      case 'call:ended':
        EventBus.emit('call:ended', {
          callId:   payload.callId ?? '',
          duration: payload.duration ?? 0,
        });
        break;

      case 'call:rejected':
        EventBus.emit('call:rejected', { callId: payload.callId ?? '' });
        break;

      case 'stream:started':
        EventBus.emit('stream:started', {
          hostId:    payload.hostId ?? '',
          sessionId: payload.sessionId ?? '',
          title:     payload.title ?? '',
        });
        break;

      case 'stream:ended':
        EventBus.emit('stream:ended', {
          sessionId:   payload.sessionId ?? '',
          viewerCount: payload.viewerCount ?? 0,
        });
        break;

      case 'stream:gift':
        EventBus.emit('stream:gift_received', {
          sessionId: payload.sessionId ?? '',
          giftType:  payload.giftType ?? 'heart',
          senderId:  payload.senderId ?? '',
        });
        break;

      case 'battle:challenged':
        EventBus.emit('battle:challenged', {
          challengerId: payload.challengerId ?? '',
          targetId:     payload.targetId ?? '',
          battleId:     payload.battleId ?? '',
        });
        break;

      case 'battle:accepted':
        EventBus.emit('battle:accepted', { battleId: payload.battleId ?? '' });
        break;

      case 'battle:ended':
        EventBus.emit('battle:ended', {
          battleId: payload.battleId ?? '',
          winnerId: payload.winnerId ?? '',
        });
        break;

      case 'message':
        EventBus.emit('chat:message_received', {
          senderId:    payload.senderId ?? '',
          recipientId: payload.recipientId ?? '',
          messageId:   payload.messageId ?? '',
        });
        break;

      case 'notification':
        EventBus.emit('notification:received', {
          type: payload.notificationType ?? 'general',
          id:   payload.id ?? '',
        });
        break;

      case 'wallet:deposit':
        EventBus.emit('wallet:deposit_confirmed', {
          txHash: payload.txHash ?? '',
          amount: payload.amount ?? 0,
          userId: payload.userId ?? '',
        });
        break;

      default:
        console.warn('[EventGateway] unhandled event type:', type);
    }
  }
}

export const EventGateway = new EventGatewayImpl();
