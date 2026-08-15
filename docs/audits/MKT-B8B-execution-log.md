# MKT-B8B Marketplace Operations Core — Execution Log

## Baseline

- Starting SHA: `a8d481d19f1eb71e364f86966af26cca3da148de`
- Branch: `codex/mkt-a4b-premium-integration`
- Build: 22
- Starting remote migration: `20260811028000_marketplace_admin_web_foundation.sql`
- B8S and B8A remote read-only audits: healthy before implementation.
- Scope: Marketplace operations inside `apps/admin-web`; no Expo routes, B8C, B8D, EAS, or historical migration edits.

## Authority audit

- Admin identity remains the B8S-protected `user_profiles.is_admin` state reached through `marketplace_actor_is_admin()` and the private `marketplace_require_admin()` guard. Actor identity is always derived from `auth.uid()`.
- Dispute finance remains exclusively in the canonical `resolve_marketplace_dispute(...)` authority. It owns held refund, held release, manual review, rejection, post-settlement B7R delegation, locks, idempotency, frozen allocations, and ledger movement.
- The authenticated B8B dispute wrapper elevates only inside a fixed-search-path server function, after deriving and validating the protected admin. It restores the original request role on success and exception and passes the derived actor to the canonical resolver.
- Seller state transitions reuse `approve_marketplace_seller`, `reject_marketplace_seller`, `suspend_marketplace_seller`, and `restore_marketplace_seller`.
- Store state remains observational in B8B. There is no general store editor. Seller suspension is the canonical public eligibility gate; the current canonical seller suspension does not rewrite an otherwise active store row.
- No canonical product moderation command existed. B8B adds a narrow state machine over existing `moderation_status`; rejection/suspension changes an active product to `paused`, while approval never republishes it. Price, inventory, variants, shipping, promotions, offers, commission, and history are untouched.

## Migration and contracts

- Forward migration: `20260811029000_marketplace_admin_operations_core.sql`.
- Capabilities: `marketplace:read`, `marketplace:disputes`, `marketplace:sellers`, `marketplace:products`. These inform the UI; every RPC independently enforces admin authority.
- Bounded keyset read RPCs (hard maximum 100): dispute list/detail, seller list/detail, product list/detail.
- Mutation RPCs: `admin_resolve_marketplace_dispute`, `admin_moderate_marketplace_seller`, and `admin_moderate_marketplace_product`.
- All mutation RPCs derive the actor, validate transitions/reasons, serialize the target/command where needed, use UUID idempotency keys, return canonical receipts, and audit successful operations.
- No browser parameter accepts actor/admin/resolver identity, amounts, splits, BPS, accounts, transaction IDs, or allocation values.

## Privileged action audit

- `marketplace_admin_action_audit` is append-only and server-written.
- Unique `(actor_id, idempotency_key)` prevents duplicate history on retry.
- Authenticated/anon clients have no table DML. A trigger rejects UPDATE and DELETE even for an accidental future grant.
- Rows contain server-derived actor, enumerated action/target, idempotency identity, bounded reason, request fingerprint, and a safe canonical receipt. They contain no token, credential, private PII, or financial authority input.
- `reconcile_marketplace_admin_operations()` exposes eight real integrity counters.

## Web operations UX

- Existing OnSpace Admin shell extended with Disputas, Vendedores, and Productos.
- Dispute detail requires explicit confirmation and reason for all commands; deliberate commands use fresh UUID idempotency keys, disable while pending, and refetch canonical state after success.
- Seller detail exposes approve/reject/suspend/restore only. Store details are read-only.
- Product detail exposes approve/reject/suspend only; there is no catalog editor.
- Every new list/detail/receipt passes explicit runtime validation for UUIDs, dates, money, state strings, arrays, nested nullable objects, and cursors. Malformed payloads use existing controlled error/retry states.
- Lists use one bounded server projection and detail uses one RPC: no client N+1 fan-out.

## Disposable proof

- Hard guard: localhost/127.0.0.1 port 55422 only.
- Anonymous, ordinary authenticated, forged metadata, and B8S self-promotion attacks denied.
- Protected admin succeeded and received explicit capabilities.
- Held full refund used canonical authority and moved the exact gross once.
- Manual review created no financial transaction; release seller used canonical settlement authority; reject claim moved no money.
- Same-key retry returned one effective result/audit row; a conflicting later final outcome was rejected without partial state.
- Seller approve/reject/suspend/restore, self-moderation denial, public eligibility gating, and retry behavior passed.
- Product approve/reject, required reason, public suppression, retry behavior, and unchanged price/stock passed.
- Audit append-only/immutable/client-DML denial passed.
- B8B reconciliation: 8/8 zero. Persistent B8B proof fixtures: zero.
- Existing B7F/B7R/dispute proofs remain the authority for multi-creator and post-settlement concurrency/economics; B8B does not duplicate those calculations.

## Gates and deployment

- Implementation commits:
  - `4722feb` `feat: add marketplace admin operations authority`
  - `418ff7d` `feat: add marketplace admin operations web`
  - `0374a7e` `test: prove marketplace admin operations core`
- Final implementation SHA before this documentation-only evidence commit: `0374a7ed0baee240ce0ac13c1f59dcd054e07d8c`. The final branch SHA is reported in the handoff after the evidence commit and push; a Git commit cannot embed its own resulting SHA.
- Focused B8S/B8A/B8B Node tests: 32/32 passed.
- Admin web tests: 25/25 passed; ESLint: 0 errors and 0 warnings; Vite/TypeScript production build: passed.
- Full root Node suite: 683/683 passed, 0 failed.
- Root TypeScript: unchanged 187-diagnostic unrelated baseline; zero diagnostics from B8B-modified TypeScript files.
- iOS export: passed. Build remained 22. No EAS command was run.
- Disposable B8B proof: passed, including authorization, canonical dispute outcomes, idempotent retry, conflicting final-decision protection, seller/product state machines, immutable audit history, 8/8 B8B reconciliation, and zero persistent fixtures.
- Inherited proofs passed sequentially: B3 analytics; B7A 36/36; B7B 23/23; B7C 28/28; B7D 18/18; B7E; B7F 27/27; B7R 32/32; dispute/refund; order lifecycle; shipping; publication; promotions; runtime; fixtures; Ads finance, eligibility, finalization, and delivery/events.
- Remote predeploy audit: passed at `20260811028000`; B8B objects absent and all inherited authority/reconciliation gates healthy.
- Linked dry-run: exactly `20260811029000_marketplace_admin_operations_core.sql`; no seeds, roles, or historical migrations.
- Deployment: exactly `20260811029000_marketplace_admin_operations_core.sql` applied.
- Remote post-deploy audit: passed at `20260811029000`; B8B objects and grants healthy, audit client writes denied, anonymous mutations denied, `reconcile_marketplace_admin_operations()` 8/8 zero, inherited reconciliations zero, escrow 71/71, fixture users zero, and failure hooks absent.
- Disposable database container was destroyed before push.

## Scope statement

B8C and B8D were not started. No arbitrary ledger/balance authority, service-role browser secret, mobile admin UI, or historical migration rewrite was introduced.
