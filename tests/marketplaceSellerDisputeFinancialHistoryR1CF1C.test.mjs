import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timeline = readFileSync(
  new URL('../components/marketplace/OrderStatus.tsx', import.meta.url),
  'utf8',
);
const seller = readFileSync(new URL('../app/seller/orders/[id].tsx', import.meta.url), 'utf8');

test('dispute resolution and financial event labels are explicit', () => {
  assert.match(timeline, /refund_buyer[^]*Reclamo resuelto: reembolso al comprador/);
  assert.match(timeline, /release_seller[^]*Reclamo resuelto a favor del vendedor/);
  assert.match(timeline, /reject_claim[^]*Reclamo rechazado por administración/);
  assert.match(timeline, /return 'Reclamo resuelto'/);
  assert.match(timeline, /refund_created:'Fondos reembolsados al comprador'/);
  assert.match(timeline, /escrow_released:'Fondos liberados al vendedor'/);
});

test('seller passes canonical dispute and settlement context to the existing timeline', () => {
  assert.match(
    seller,
    /<OrderTimeline events=\{data\.events\} disputeOutcome=\{data\.dispute\?\.outcome\?\?null\} allocationStatus=\{data\.allocation\?\.status\?\?null\} settlement=\{data\.settlement\}\/>/,
  );
  assert.equal((seller.match(/<OrderTimeline/g) ?? []).length, 1);
});

test('derived release requires canonical completed settlement and released allocation', () => {
  assert.match(timeline, /allocationStatus==='released'/);
  assert.match(timeline, /settlement\?\.status==='completed'/);
  assert.match(timeline, /createdAt:settlement\.releasedAt/);
  assert.match(timeline, /eventType:'escrow_released'/);
  assert.doesNotMatch(timeline, /marketplace_order_events|insert\(|\.rpc\(/i);
});

test('raw release event prevents a duplicate derived financial row', () => {
  assert.match(
    timeline,
    /events\.some\(event=>event\.eventType==='escrow_released'\)/,
  );
  assert.match(timeline, /!hasReleaseEvent/);
  assert.equal((timeline.match(/id:'derived-settlement-release'/g) ?? []).length, 1);
});

test('timeline copies and stably sorts raw and derived items chronologically', () => {
  assert.match(timeline, /events\.map\(\(event,sourceIndex\)=>/);
  assert.match(
    timeline,
    /Date\.parse\(left\.createdAt\)-Date\.parse\(right\.createdAt\)/,
  );
  assert.match(timeline, /timestampDifference\|\|left\.sourceIndex-right\.sourceIndex/);
  assert.doesNotMatch(timeline, /events\.sort\(/);
});

test('optional context preserves existing timeline callers and avoids false resolutions', () => {
  assert.match(timeline, /disputeOutcome\?:MarketplaceDisputeOutcome\|null/);
  assert.match(timeline, /allocationStatus\?:MarketplaceHeldAllocation\['status'\]\|null/);
  assert.match(timeline, /settlement\?:TimelineSettlement\|null/);
  assert.match(timeline, /if\(eventType==='dispute_resolved'\)/);
  assert.doesNotMatch(timeline, /dispute_opened[^]*disputeResolutionLabel/);
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
