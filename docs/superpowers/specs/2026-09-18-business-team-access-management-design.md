# Business Team Access Management Design

## Scope

BW-J2 adds Team management to Nelyon Business Web without replacing BW-J1. `private.business_memberships` remains the only membership authority, `private.business_membership_capabilities` remains the only runtime permission authority, and `private.business_effective_capabilities()` remains the effective-access resolver. Viewer, Operations, Marketing, Finance, and Manager are client-side presets only; no role row or role bypass is persisted.

## Canonical data model

Add three private, force-RLS tables with no browser grants:

- `private.business_invitations`: business, normalized email, lifecycle timestamps, creator, expiry, and accepting actor.
- `private.business_invitation_capabilities`: immutable capability snapshot used only during acceptance.
- `private.business_team_audit_events`: append-only, sanitized command history.

The invitation table permits `pending`, `accepted`, `declined`, and `revoked`; expiry is derived from `expires_at`. A partial unique index prevents two pending invitations for one normalized email and business. Creation revokes an already-expired pending row before inserting a replacement. Acceptance copies the snapshot atomically into the existing BW-J1 capability table, reusing or reactivating the unique membership row.

## Server API

Expose three authenticated `SECURITY DEFINER` RPCs with `search_path=''`, explicit `auth.uid()` checks, exact grants, and no direct private-table access:

1. `get_my_business_team(uuid)` allows the owner or `business.team.read`/`business.team.manage`. It returns the owner, members, effective capability catalog, and management metadata. Emails and pending invitations are returned only to the owner or a Team Manager.
2. `get_my_pending_business_invitations()` derives the actor email from `auth.users` and returns only non-expired pending invitations for that normalized email.
3. `manage_business_team(text,jsonb)` is the sole mutation path for `create_invitation`, `revoke_invitation`, `accept_invitation`, `decline_invitation`, `set_member_capabilities`, and `revoke_member`.

The command RPC derives actors, owners, target users, target emails, and membership scope server-side. It locks affected rows, validates active catalog codes, rejects empty sets, and records one audit event in the same transaction.

## Delegation model

The owner may grant or remove any active catalog capability. A Team Manager:

- cannot modify self or the owner;
- cannot modify or revoke another current Team Manager;
- cannot grant any capability they do not currently possess;
- cannot grant or remove `business.team.manage`, `business.settings.manage`, `business.finance.read`, `business.payouts.read`, or `business.payouts.manage`;
- can revoke an invitation only when its snapshot contains no protected capability and is a subset of the manager's own capabilities.

`business.team.manage` implies read access only inside the Team read RPC and UI route. BW-J1 global capability semantics remain unchanged.

## Invitation identity and lifecycle

Invitation emails are trimmed, lowercased, length-limited, and syntax-checked. The server rejects the owner, the current actor, active members, duplicate pending invitations, unknown/inactive capabilities, and empty capability sets. The default expiry is seven days.

Acceptance and decline compare the normalized invitation email with the authenticated email selected from `auth.users`; request payload email is ignored because it is not accepted. Acceptance is atomic and idempotent for a previously accepted invitation by the same actor, but an accepted invitation never reactivates a later-revoked membership. Reactivation requires a new pending invitation whose snapshot replaces all prior membership capabilities.

No email provider is added. The UI creates a shareable `/invitations?invitation=<local invitation UUID>` link. The UUID is a locator, not authorization; authenticated email matching remains mandatory.

## Business Web

Add a typed `businessTeamApi`, preset derivation utilities, and `/team`. The page uses the current `BusinessAuthProvider`, capability-aware navigation, responsive cards/tables, an invite dialog, and a permission editor grouped from the server catalog. Sensitive capability toggles are visibly marked and disabled for delegated managers.

Pending invitations are surfaced by a small authenticated inbox available even when the actor has no active business. Accepting an invitation calls the command RPC and then `BusinessAuthProvider.retry()` so the business appears immediately. Revocation removes server access immediately through membership status; the existing provider reconciliation clears an unauthorized persisted business on its next identity refresh.

Each page request is scoped to `currentBusiness.businessOwnerId`, reset on business switch, and guarded by request identity so stale responses cannot overwrite the selected business.

## Testing and safety

Static migration tests prove one membership authority, one invitation authority, one command authority, force RLS, ACLs, protected capabilities, email derivation, atomic acceptance, audit writes, and absence of finance references. Transactional SQL tests create disposable users/businesses, cover owner/reader/manager/cross-business behavior, invitation lifecycle, self-escalation, manager-to-manager protection, reactivation, and runtime revocation, then roll back.

Business unit/UI tests cover payload parsing, exact preset derivation, Custom behavior, owner/member controls, invite acceptance refresh, business-switch clearing, and stale-request protection. Full Business, Admin, relevant Seller/Ads/Analytics/Billing/Payout regressions, lint, builds, advisors, and production counts complete verification. No financial or external provider code changes.
