# CHAT-V2-A validation and rollout notes

## Audited baseline

- `messages` is a direct-message table keyed by immutable UUID with
  `sender_id`, `recipient_id`, `text`, `media_url`, `media_type`, `read`, and
  `created_at`. It has no canonical conversation, member, or per-user receipt.
- `premium_dm_payments.message_id`, `message_push_outbox.message_id`, and
  `message_push_deliveries.message_id` refer to the existing message UUID.
- `app/(tabs)/messages.tsx` is registered by the tabs layout and is the active
  inbox. `app/messages.tsx` is an older route with the same URL shape, but it is
  still present in the Expo Router tree and imports the live messages context;
  it is therefore retained until route ownership can be proven at runtime.
- `MessagesContext` was the only application reader/writer of `messages`.
  The message-push dispatcher also reads it, while database triggers create
  outbox rows. Premium DM creates messages inside pre-existing database RPCs.
- `PresenceManager` and `ConnectionManager` attempt to upsert
  `user_presence`, but no migration creates that table. The chat header renders
  `En línea` statically. CHAT-V2-A deliberately leaves both behaviors intact;
  Presence belongs to CHAT-V2-B.

## Migration behavior

`20260906222020_chat_v2_a_canonical_foundation.sql` runs in one transaction
and locks `messages` against concurrent writes while it backfills. Every unique
unordered sender/recipient pair maps to one deterministic direct conversation.
Both members are inserted and every existing message receives its conversation
without changing its UUID or legacy columns.

Every historical message gets a recipient receipt. Existing `read=true` is
represented with `legacy_read=true` and `legacy_delivered=true`; `read_at` and
`delivered_at` remain null because the historical timestamps are unknown. New
acknowledgements use server timestamps and never overwrite an earlier value.

The migration records and verifies message count, the ordered message-ID
digest, Premium DM link count, push outbox count, and push delivery count. It
also rejects null/self direct participants, orphan messages, duplicate direct
pairs, incomplete memberships, receipt count mismatches, and broken Premium DM
references.

Legacy direct inserts remain supported by a temporary one-way BEFORE INSERT
adapter. It derives the direct conversation, members, canonical type, and
client idempotency key. Legacy `read=false -> true` updates write the canonical
receipt. Canonical writes never trust a client-supplied sender and mirror read
state only to keep older clients compatible. Remove these adapters only after
the oldest supported mobile version uses the canonical RPCs.

`recipient_id` remains required in CHAT-V2-A. Before group message sending is
enabled, CHAT-V2-B must make push fan-out and legacy read consumers member-aware;
then it can allow null `recipient_id` for group messages. The conversation,
membership, message type, reply, media asset, consumption policy, audio duration,
and per-member receipt model already supports that transition.

## Controlled deployment order

1. Review the SQL and run it against an isolated database restored from a
   production snapshot.
2. Verify pre/post counts, RLS with three authenticated users, RPC ACLs,
   Premium DM references, push outbox/delivery references, and Realtime events.
3. Apply the database migration before releasing the CHAT-V2-A client. Existing
   clients continue through the compatibility triggers during staged rollout.
4. Release the application and monitor RPC errors, optimistic failures, receipt
   latency, push delivery, Premium DM release, and Realtime reconnects.

No destructive rollback should delete the new columns or tables after clients
write canonical data. Roll back the mobile release first, retain the additive
schema and compatibility triggers, then correct forward. Before production,
the migration can be rolled back safely by restoring the isolated test database
snapshot because it has not been deployed by this change.
