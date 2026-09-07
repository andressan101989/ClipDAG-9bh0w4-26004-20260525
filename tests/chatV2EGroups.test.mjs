import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const migration = readFileSync(new URL('../supabase/migrations/20260907043715_chat_v2_e_groups.sql', import.meta.url), 'utf8');
const context = readFileSync(new URL('../contexts/MessagesContext.tsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('../services/chatService.ts', import.meta.url), 'utf8');

function load(source) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  Function('require', 'module', 'exports', output)(() => { throw new Error('unexpected import'); }, module, module.exports);
  return module.exports;
}
const reliability = load(readFileSync(new URL('../services/chatReliability.ts', import.meta.url), 'utf8'));

class GroupModel {
  constructor(owner, members) { this.members = new Map([[owner, 'owner'], ...members.map(id => [id, 'member'])]); this.owner = owner; this.rows = []; this.receipts = []; }
  send(sender, clientId) { const existing=this.rows.find(row=>row.sender===sender&&row.clientId===clientId); if(existing)return existing; assert(this.members.has(sender)); const row={id:`m${this.rows.length+1}`,sender,recipient:null,clientId};this.rows.push(row);for(const id of this.members.keys())if(id!==sender)this.receipts.push({message:row.id,user:id,delivered:false,read:false});return row; }
  ack(message,user,read=false){const receipt=this.receipts.find(row=>row.message===message&&row.user===user);if(!receipt)throw new Error('unauthorized');receipt.delivered=true;receipt.read ||= read;}
  remove(actor,target){assert(actor===this.owner||this.members.get(actor)==='admin');assert(target!==this.owner);if(this.members.get(actor)==='admin')assert(this.members.get(target)==='member');this.members.delete(target);}
  transfer(actor,target){assert.equal(actor,this.owner);assert(this.members.has(target));this.members.set(actor,'admin');this.members.set(target,'owner');this.owner=target;}
  aggregate(message){const rows=this.receipts.filter(row=>row.message===message);return rows.every(row=>row.read)?'read':rows.every(row=>row.delivered)?'delivered':'sent';}
}

test('migration evolves recipient_id without creating parallel group tables',()=>{assert.match(migration,/alter table public\.messages alter column recipient_id drop not null/i);assert.doesNotMatch(migration,/create table\s+public\.(group_messages|group_receipts|group_conversations)/i);});
test('group creation is client-idempotent and bounded to 256 active members',()=>{assert.match(migration,/p_group_id uuid/);assert.match(migration,/chat_group_idempotency_conflict/);assert.match(migration,/cardinality\(v_members\)\+1 > 256/);});
test('one group send creates one message row and N-1 receipts',()=>{const g=new GroupModel('a',['b','c']);const first=g.send('a','same');const retry=g.send('a','same');assert.equal(first,retry);assert.equal(g.rows.length,1);assert.equal(g.rows[0].recipient,null);assert.equal(g.receipts.length,2);});
test('receipts converge independently and aggregate monotonically',()=>{const g=new GroupModel('a',['b','c']);const m=g.send('a','x');g.ack(m.id,'b');assert.equal(g.aggregate(m.id),'sent');g.ack(m.id,'c');assert.equal(g.aggregate(m.id),'delivered');g.ack(m.id,'b',true);assert.equal(g.aggregate(m.id),'delivered');g.ack(m.id,'c',true);assert.equal(g.aggregate(m.id),'read');});
test('a member cannot acknowledge another member receipt',()=>{const g=new GroupModel('a',['b','c']);const m=g.send('a','x');assert.throws(()=>g.ack(m.id,'d'),/unauthorized/);});
test('owner transfer is atomic in the behavioral model',()=>{const g=new GroupModel('a',['b']);g.transfer('a','b');assert.equal(g.owner,'b');assert.deepEqual([...g.members.values()].filter(role=>role==='owner'),['owner']);});
test('admin can remove member but not owner or admin',()=>{const g=new GroupModel('a',['b','c']);g.members.set('b','admin');g.remove('b','c');assert(!g.members.has('c'));assert.throws(()=>g.remove('b','a'));});
test('history access is fenced by current joined_at',()=>{const visible=(joined,created)=>created>=joined;assert.equal(visible(20,10),false);assert.equal(visible(20,20),true);assert.match(migration,/p_created_at >= cm\.joined_at/);});
test('group message types exclude premium and one-time media',()=>{assert.match(migration,/p_message_type not in\('text','image','voice'\)/);});
test('receipt visibility is owner-or-sender only',()=>{assert.match(migration,/user_id=\(select auth\.uid\(\)\)or exists\(select 1 from public\.messages m where m\.id=chat_message_receipts\.message_id and m\.sender_id=\(select auth\.uid\(\)\)\)/);});
test('push safely defers group fanout',()=>{assert.match(migration,/if new\.recipient_id is null[^]*return new/);});
test('client uses one conversation-id keyed message store',()=>{assert.match(context,/messagesRef\.current\[conversationId\]/);assert.doesNotMatch(context,/messagesByGroup|GroupChatContext|MessagesContext2/);});
test('group core operations extend the canonical chat service',()=>{for(const name of ['createChatGroup','addChatGroupMembers','removeChatGroupMember','setChatGroupAdmin','transferChatGroupOwnership','leaveChatGroup'])assert.match(service,new RegExp(`function ${name}`));});
test('group projection returns aggregate receipt counts without N+1 client queries',()=>{assert.match(migration,/recipient_count bigint,delivered_count bigint,read_count bigint/);assert.match(migration,/cross join lateral/);});
test('media authorization applies the membership history fence',()=>{assert.match(migration,/chat_authorize_media_access/);assert.match(migration,/chat_can_read_message\(v_message\.conversation_id,v_message\.created_at\)/);});

test('partial group delivery keeps the sender aggregate sent', () => {
  const decision = reliability.reduceRealtimeReceiptStatus({ current: 'sent', receipt: 'delivered', conversationType: 'group', isMessageSender: true });
  assert.deepEqual(decision, { deliveryStatus: 'sent', reconcileAggregate: true });
});

test('all group deliveries promote only through the aggregate projection', () => {
  assert.equal(reliability.mergeProjectedDeliveryStatus({ current: 'sent', projected: 'delivered', conversationType: 'group', recipientCount: 3 }), 'delivered');
});

test('partial group read cannot mark the sender aggregate read', () => {
  const decision = reliability.reduceRealtimeReceiptStatus({ current: 'delivered', receipt: 'read', conversationType: 'group', isMessageSender: true });
  assert.deepEqual(decision, { deliveryStatus: 'delivered', reconcileAggregate: true });
});

test('all group reads promote through the aggregate projection', () => {
  assert.equal(reliability.mergeProjectedDeliveryStatus({ current: 'delivered', projected: 'read', conversationType: 'group', recipientCount: 3 }), 'read');
});

test('individual read racing an aggregate sent projection finishes sent', () => {
  const receipt = reliability.reduceRealtimeReceiptStatus({ current: 'sent', receipt: 'read', conversationType: 'group', isMessageSender: true });
  assert.equal(receipt.deliveryStatus, 'sent');
  assert.equal(reliability.mergeProjectedDeliveryStatus({ current: receipt.deliveryStatus, projected: 'sent', conversationType: 'group', recipientCount: 3 }), 'sent');
});

test('direct individual receipts remain immediate and monotonic', () => {
  const delivered = reliability.reduceRealtimeReceiptStatus({ current: 'sent', receipt: 'delivered', conversationType: 'direct', isMessageSender: true });
  const read = reliability.reduceRealtimeReceiptStatus({ current: delivered.deliveryStatus, receipt: 'read', conversationType: 'direct', isMessageSender: true });
  assert.equal(delivered.deliveryStatus, 'delivered'); assert.equal(read.deliveryStatus, 'read');
  assert.equal(delivered.reconcileAggregate, false); assert.equal(read.reconcileAggregate, false);
});

test('group aggregate counters reject read while only one of three read', () => {
  const group = new GroupModel('a', ['b', 'c', 'd']); const message = group.send('a', 'counter-case');
  group.ack(message.id, 'b', true); group.ack(message.id, 'c'); group.ack(message.id, 'd');
  const receipts = group.receipts.filter(row => row.message === message.id);
  const projection = { recipientCount: receipts.length, readCount: receipts.filter(row => row.read).length,
    deliveredCount: receipts.filter(row => row.delivered).length, deliveryStatus: group.aggregate(message.id) };
  assert.deepEqual(projection, { recipientCount: 3, readCount: 1, deliveredCount: 3, deliveryStatus: 'delivered' });
});
