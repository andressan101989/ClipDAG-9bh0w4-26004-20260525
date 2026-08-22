import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  marketplaceDisputeResolutionEventLabel,
  marketplaceOrderTimelineItems,
} from '../services/marketplaceOrderPresentation.ts';

const timeline = readFileSync(
  new URL('../components/marketplace/OrderStatus.tsx', import.meta.url),
  'utf8',
);
const seller = readFileSync(new URL('../app/seller/orders/[id].tsx', import.meta.url), 'utf8');
const event = (eventType, createdAt, disputeOutcome = null) => ({
  id: `${eventType}-${createdAt}`,
  eventType,
  fromStatus: null,
  toStatus: null,
  actorRole: 'admin',
  disputeOutcome,
  createdAt,
});

test('dispute resolution and financial event labels are explicit', () => {
  assert.equal(marketplaceDisputeResolutionEventLabel('refund_buyer'), 'Reclamo resuelto: reembolso al comprador');
  assert.equal(marketplaceDisputeResolutionEventLabel('release_seller'), 'Reclamo resuelto a favor del vendedor');
  assert.equal(marketplaceDisputeResolutionEventLabel('reject_claim'), 'Reclamo rechazado por administración');
  assert.equal(marketplaceDisputeResolutionEventLabel(null), 'Reclamo resuelto');
  assert.equal(marketplaceOrderTimelineItems([event('refund_created', '2026-08-22T10:00:00Z')])[0].label, 'Fondos reembolsados al comprador');
  assert.equal(marketplaceOrderTimelineItems([event('escrow_released', '2026-08-22T10:00:00Z')])[0].label, 'Fondos liberados al vendedor');
});

test('seller passes canonical settlement context to the existing timeline', () => {
  assert.match(
    seller,
    /<OrderTimeline events=\{data\.events\} allocationStatus=\{data\.allocation\?\.status\?\?null\} settlement=\{data\.settlement\}\/>/,
  );
  assert.equal((seller.match(/<OrderTimeline/g) ?? []).length, 1);
});

test('derived release requires canonical completed settlement and released allocation', () => {
  const releasedAt = '2026-08-22T12:00:00Z';
  assert.equal(marketplaceOrderTimelineItems([], 'released', {status: 'completed', releasedAt})[0].createdAt, releasedAt);
  assert.deepEqual(marketplaceOrderTimelineItems([], 'held', {status: 'completed', releasedAt}), []);
  assert.deepEqual(marketplaceOrderTimelineItems([], 'released', {status: 'pending', releasedAt}), []);
  assert.doesNotMatch(timeline, /marketplace_order_events|insert\(|\.rpc\(/i);
});

test('raw release event prevents a duplicate derived financial row', () => {
  const items = marketplaceOrderTimelineItems(
    [event('escrow_released', '2026-08-22T11:00:00Z')],
    'released',
    {status: 'completed', releasedAt: '2026-08-22T12:00:00Z'},
  );
  assert.equal(items.filter((item) => item.label === 'Fondos liberados al vendedor').length, 1);
  assert.notEqual(items[0].id, 'derived-settlement-release');
});

test('timeline copies and stably sorts raw and derived items chronologically', () => {
  const events = [
    event('dispute_resolved', '2026-08-22T12:00:00Z', 'reject_claim'),
    event('dispute_opened', '2026-08-22T10:00:00Z'),
  ];
  const originalIds = events.map((item) => item.id);
  const items = marketplaceOrderTimelineItems(events, 'released', {status: 'completed', releasedAt: '2026-08-22T11:00:00Z'});
  assert.deepEqual(items.map((item) => item.label), ['Problema reportado', 'Fondos liberados al vendedor', 'Reclamo rechazado por administración']);
  assert.deepEqual(events.map((item) => item.id), originalIds);
  const tied = marketplaceOrderTimelineItems([
    event('dispute_opened', '2026-08-22T10:00:00Z'),
    event('order_shipped', '2026-08-22T10:00:00Z'),
  ]);
  assert.deepEqual(tied.map((item) => item.label), ['Problema reportado', 'Pedido enviado']);
});

test('event context preserves existing timeline callers and avoids false resolutions', () => {
  assert.equal(marketplaceOrderTimelineItems([event('dispute_opened', '2026-08-22T10:00:00Z')])[0].label, 'Problema reportado');
  assert.match(timeline, /allocationStatus\?:MarketplaceHeldAllocation\['status'\]\|null/);
  assert.match(timeline, /settlement\?:MarketplaceTimelineSettlement\|null/);
  assert.match(timeline, /marketplaceOrderTimelineItems\(events,allocationStatus,settlement\)/);
  assert.doesNotMatch(seller, /disputeOutcome=\{data\.dispute/);
});

test('seller shipped state remains read-only and existing detail sections remain visible', () => {
  assert.match(seller, /data\.order\.status==='confirmed'[^]*Preparar pedido/);
  assert.match(seller, /data\.order\.status==='processing'[^]*Marcar como enviado/);
  assert.match(seller, /Estado de pago/);
  assert.match(seller, /Estado del neto/);
  assert.match(seller, /MarketplaceSellerDisputePanel/);
  assert.doesNotMatch(seller, /data\.order\.status==='shipped'[^]{0,160}(Preparar pedido|Marcar como enviado)/);
});

test('scope stays presentation-only', () => {
  for (const source of [timeline, seller]) {
    assert.doesNotMatch(source, /ledger_debit|ledger_credit|marketplace_order_settlements/i);
  }
});
