import { validateLegalDocument, type LegalDocument } from './core.ts';
import { privacy, terms } from './content.ts';

// INTERNAL EDITORIAL MATERIAL. Neither adapter may render this while the manifest is pending.
// Evidence references are current repository lines or immutable pre-retirement Git lines.
export type DecisionState = 'verified_fact' | 'owner_decision_required' | 'legal_review_required' | 'blocked_unknown';
export type DraftProvenance = { sectionId: string; decisionState: DecisionState; evidenceRefs: string[]; reviewNote: string };
export type CanonicalDraft = { document: LegalDocument; provenance: DraftProvenance[] };

const p = (sectionId: string, decisionState: DecisionState, evidenceRefs: string[], reviewNote: string): DraftProvenance => ({ sectionId, decisionState, evidenceRefs, reviewNote });
const retiredMobileRef = (location: string): string => `git:d13eeec6e1705565cbab9d99cf1d6441c900b336:${location}`;
export const canonicalDrafts: readonly CanonicalDraft[] = [
  { document: privacy, provenance: [
    p('account-profile', 'verified_fact', ['contexts/AuthContext.tsx:286', 'supabase/migrations/20260703212533_migration_to_supabase.sql:47'], 'Confirm production data categories before activation.'),
    p('content-interactions', 'verified_fact', ['contexts/FeedContext.tsx:388', 'supabase/migrations/20260703212533_migration_to_supabase.sql:76'], 'Counters are not a retention policy.'),
    p('stories-media', 'verified_fact', ['supabase/migrations/20260726100000_create_stories_schema.sql:3', 'app/(tabs)/index.tsx:260'], 'Expiry is a visibility gate, not proven comprehensive deletion.'),
    p('content-safety', 'blocked_unknown', ['supabase/functions/content-safety-scan/index.ts:46', 'supabase/functions/content-safety-scan/index.ts:54', 'supabase/functions/content-safety-scan/index.ts:210', 'supabase/functions/content-safety-scan/index.ts:245', 'supabase/functions/content-safety-scan/index.ts:287'], 'Code path and persistence exist; deployed configuration, operational scope and retention unverified.'),
    p('messages-calls', 'verified_fact', ['services/chatService.ts:95', 'supabase/migrations/20260907043715_chat_v2_e_groups.sql:94'], 'Do not infer E2E encryption.'),
    p('live', 'verified_fact', ['supabase/migrations/20260705184732_create_live_streaming_tables.sql:4', 'supabase/functions/agora-token/index.ts:16'], 'Recording/retention unresolved.'),
    p('marketplace', 'verified_fact', ['supabase/migrations/20260731223000_marketplace_mkt_a3b_orders_reservations.sql:27', 'supabase/migrations/20260806100000_held_marketplace_dispute_refunds.sql:109'], 'Do not imply all refunds are available.'),
    p('business-ads', 'verified_fact', ['supabase/migrations/20260918120318_business_team_access_management_bw_j2.sql:5', 'supabase/migrations/20260917125517_business_ads_placements_delivery_bw_f.sql:1'], 'Targeting claim not made.'),
    p('payments-payouts', 'legal_review_required', ['supabase/migrations/20260703212533_migration_to_supabase.sql:198', 'supabase/functions/stripe-webhook/index.ts:25'], 'Economic and legal characterization awaits review.'),
    p('device-notifications', 'blocked_unknown', ['supabase/migrations/20260712130000_authoritative_call_sessions.sql:51', 'services/pushNotifications.ts:27'], 'Deployment logs and retention not verified.'),
    p('service-providers', 'legal_review_required', ['services/agoraService.native.ts:2', 'supabase/functions/stripe-bdag-checkout/index.ts:24', 'supabase/functions/cleanup-stale-media-uploads/index.ts:2', 'supabase/functions/content-safety-scan/index.ts:54'], 'Confirm active provider configuration and legal disclosure, including Workers AI.'),
    p('retention-deletion', 'legal_review_required', ['app/settings.tsx:228', 'app/account-settings.tsx:177', 'supabase/migrations/20260731223000_marketplace_mkt_a3b_orders_reservations.sql:45'], 'Owner policy selected in NPW-F-C4, but no request channel, global deletion procedure or category retention schedule verified.'),
    p('legal-choices-contact', 'legal_review_required', ['contexts/AuthContext.tsx:286', 'app/login.tsx:48'], 'Owner selected account age 13 and creator-exclusive age 18 in NPW-F-C5-B2-C1. Incorporation, contacts, legal review and dates remain open.'),
  ] },
  { document: terms, provenance: [
    p('accounts-eligibility', 'legal_review_required', ['contexts/AuthContext.tsx:286', 'contexts/AuthContext.tsx:302', 'app/login.tsx:48'], 'Owner selected account age 13 and creator-exclusive age 18. DOB collection and private classification are implemented; creator-exclusive access remains non-canonical.'),
    p('content-conduct', 'legal_review_required', ['supabase/migrations/20260703212533_migration_to_supabase.sql:125'], 'Owner proposed limited content license and moderation policy in NPW-F-C4; legal review remains open.'),
    p('messages-live', 'verified_fact', ['services/chatService.ts:95', 'supabase/functions/agora-token/index.ts:16'], 'No guaranteed availability or revenue.'),
    p('marketplace', 'legal_review_required', ['supabase/migrations/20260731223000_marketplace_mkt_a3b_orders_reservations.sql:42', 'supabase/migrations/20260806100000_held_marketplace_dispute_refunds.sql:109'], 'Buyer/seller legal obligations unresolved.'),
    p('business-ads', 'verified_fact', ['supabase/migrations/20260918120318_business_team_access_management_bw_j2.sql:5', 'supabase/migrations/20260917125517_business_ads_placements_delivery_bw_f.sql:1'], 'Contractual ad terms unresolved.'),
    p('bdag-payments', 'legal_review_required', ['supabase/migrations/20260703212533_migration_to_supabase.sql:198', 'supabase/functions/bdag-withdraw/index.ts:287'], 'Owner defined cautious ecosystem-unit wording; specialist legal characterization and flow validation remain open.'),
    p('refunds-payouts', 'legal_review_required', ['supabase/migrations/20260806100000_held_marketplace_dispute_refunds.sql:117', 'supabase/functions/_shared/bdagPayoutPrecision.ts:1'], 'Owner rejected universal guarantees and fixed timing; operation-specific terms and legal review remain open.'),
    p('moderation-termination', 'legal_review_required', ['supabase/functions/admin-user-moderation/index.ts:21', 'app/settings.tsx:227'], 'No universal deletion or notice claim.'),
    p('third-parties', 'legal_review_required', ['supabase/functions/agora-token/index.ts:3', 'supabase/functions/stripe-bdag-checkout/index.ts:2'], 'Contractual allocation unresolved.'),
    p('legal-terms', 'legal_review_required', [retiredMobileRef('app/terms-of-service.tsx:193')], 'Florida and Miami-Dade owner policy draft, no mandatory arbitration; legal review, entity verification, liability, notice and effective date open.'),
  ] },
];

export function validateDraftRegistry(entries: readonly CanonicalDraft[]): void {
  if (entries.length !== 2 || entries[0]?.document.id !== 'privacy' || entries[1]?.document.id !== 'terms') throw new Error('legal_draft_registry_invalid');
  for (const entry of entries) {
    validateLegalDocument(entry.document);
    if (entry.provenance.length !== entry.document.sections.length) throw new Error('legal_draft_provenance_invalid');
    entry.document.sections.forEach((section, index) => {
      const meta = entry.provenance[index];
      if (meta?.sectionId !== section.id || !['verified_fact', 'owner_decision_required', 'legal_review_required', 'blocked_unknown'].includes(meta.decisionState)
        || !Array.isArray(meta.evidenceRefs) || (meta.decisionState === 'verified_fact' && meta.evidenceRefs.length === 0)
        || meta.evidenceRefs.some((ref) => typeof ref !== 'string' || !/^(?:(?:app|apps|contexts|services|supabase|shared)\/[\w./()[\]-]+:\d+|git:[0-9a-f]{40}:app\/[\w./()[\]-]+:\d+)$/.test(ref))
        || typeof meta.reviewNote !== 'string' || !meta.reviewNote.trim()) throw new Error('legal_draft_provenance_invalid');
    });
  }
}
validateDraftRegistry(canonicalDrafts);

// Internal audit matrices. They are not imported by the mobile or Astro adapters.
type DataFinding = { category: string; status: 'generated' | 'provided' | 'mixed'; stored: string; purpose: string; processor: string | null; retention: null; deletion: string; wording: string; decisionState: DecisionState; evidenceRefs: string[] };
const data = (category: string, status: DataFinding['status'], stored: string, purpose: string, processor: string | null, deletion: string, wording: string, decisionState: DecisionState, evidenceRefs: string[]): DataFinding =>
  ({ category, status, stored, purpose, processor, retention: null, deletion, wording, decisionState, evidenceRefs });
export const privacyDataMatrix: readonly DataFinding[] = [
  data('account', 'provided', 'Auth identity and profile email', 'registration and sign-in', 'Supabase', 'complete account deletion unverified', 'Account email and identifiers support sign-in.', 'verified_fact', ['contexts/AuthContext.tsx:286', 'contexts/AuthContext.tsx:302']),
  data('profile', 'provided', 'profile fields and preferences', 'identity and presentation', 'Supabase', 'profile edit exists; full erasure unverified', 'Profiles can contain identity and visibility fields.', 'verified_fact', ['supabase/migrations/20260703212533_migration_to_supabase.sql:47']),
  data('content', 'mixed', 'post media, captions, comments, reactions and counts', 'publication and interaction', 'Supabase; media delivery varies', 'post deletion path exists; downstream records unverified', 'Posts and interactions generate content records.', 'verified_fact', ['contexts/FeedContext.tsx:388', 'contexts/FeedContext.tsx:879']),
  data('stories', 'mixed', 'story media and view records', 'time-limited presentation', 'Supabase', 'expiry visibility; asset purge unverified', 'Story visibility is time-limited; deletion lifecycle needs review.', 'blocked_unknown', ['supabase/migrations/20260726100000_create_stories_schema.sql:3']),
  data('messages', 'mixed', 'conversation messages, membership and receipts', 'messaging and delivery state', 'Supabase', 'no global erasure established', 'Direct and group conversations generate messages and receipts.', 'verified_fact', ['services/chatService.ts:95', 'supabase/migrations/20260907043715_chat_v2_e_groups.sql:317']),
  data('media', 'provided', 'images, videos and voice assets; content-safety transcripts and visual results where configured', 'content, communication and conditional content-safety analysis', 'Supabase; Cloudflare media and Workers AI when configured', 'per-asset paths exist; analysis retention unverified', 'Uploaded media supports content and communications; eligible video may undergo configured safety analysis.', 'blocked_unknown', ['contexts/FeedContext.tsx:228', 'services/chatMediaService.ts:125', 'supabase/functions/content-safety-scan/index.ts:210', 'supabase/functions/content-safety-scan/index.ts:287']),
  data('live', 'mixed', 'session and participation records', 'LIVE operation', 'Supabase; Agora for RTC', 'recording and retention unverified', 'LIVE participation generates session and interaction records.', 'blocked_unknown', ['supabase/migrations/20260705184732_create_live_streaming_tables.sql:4', 'supabase/functions/agora-token/index.ts:16']),
  data('marketplace', 'mixed', 'stores, products, order and shipping records', 'commerce and fulfillment', 'Supabase', 'financial/order erasure not established', 'Checkout and orders involve shipping and transaction records.', 'verified_fact', ['supabase/migrations/20260731223000_marketplace_mkt_a3b_orders_reservations.sql:27']),
  data('business', 'mixed', 'memberships, invitations and permissions', 'business access management', 'Supabase', 'revocation is not blanket erasure', 'Business records include member and invitation information.', 'verified_fact', ['supabase/migrations/20260918120318_business_team_access_management_bw_j2.sql:5']),
  data('ads', 'mixed', 'campaign configuration, placements and events', 'delivery and reporting', 'Supabase', 'retention unverified', 'Campaign and delivery records support Ads.', 'verified_fact', ['supabase/migrations/20260917125517_business_ads_placements_delivery_bw_f.sql:1']),
  data('payments', 'generated', 'transactions and ledger entries', 'payment and reconciliation', 'Supabase; Stripe adapter conditional', 'separate financial lifecycle', 'Payment operations generate transaction records.', 'legal_review_required', ['supabase/migrations/20260703212533_migration_to_supabase.sql:198', 'supabase/functions/stripe-webhook/index.ts:92']),
  data('payouts', 'mixed', 'withdrawal request and settlement records', 'payout processing', 'Supabase; chain provider when configured', 'separate financial lifecycle', 'Payout requests and outcomes generate records.', 'legal_review_required', ['supabase/functions/bdag-withdraw/index.ts:381']),
  data('analytics', 'generated', 'commerce, ad and interaction aggregates', 'business reporting', 'Supabase', 'underlying event retention unverified', 'Business analytics summarizes recorded events.', 'verified_fact', ['supabase/migrations/20260918045352_business_unified_analytics_bw_i.sql:5']),
  data('device_technical', 'generated', 'installation, platform, app version and device model', 'call and notification routing', 'Supabase', 'deployment log retention unknown', 'Device registration includes technical metadata.', 'blocked_unknown', ['supabase/migrations/20260712130000_authoritative_call_sessions.sql:51']),
  data('push_notifications', 'mixed', 'push tokens and delivery state', 'notification delivery', 'Expo; Supabase', 'token lifecycle not comprehensive deletion', 'Push delivery requires device tokens.', 'verified_fact', ['services/pushNotifications.ts:27', 'supabase/migrations/20260703212533_migration_to_supabase.sql:66']),
];

export const providerMatrix = [
  { provider: 'Supabase', use: 'Auth, database and storage operations', draft: true, caveat: 'No retention or region inferred', evidenceRefs: ['contexts/AuthContext.tsx:286', 'contexts/FeedContext.tsx:228'] },
  { provider: 'Agora', use: 'LIVE real-time media token and native RTC', draft: true, caveat: 'No recording inferred', evidenceRefs: ['supabase/functions/agora-token/index.ts:3', 'services/agoraService.native.ts:2'] },
  { provider: 'Expo Push', use: 'Device push registration and delivery', draft: true, caveat: 'Permission/configuration dependent', evidenceRefs: ['services/pushNotifications.ts:11', 'services/pushNotifications.ts:27'] },
  { provider: 'Cloudflare', use: 'Selected video/R2 media flows and configuration-gated Workers AI audio transcription and visual safety analysis', draft: true, caveat: 'Deployed configuration, actual processing and retention unverified', evidenceRefs: ['contexts/FeedContext.tsx:103', 'supabase/functions/content-safety-scan/index.ts:54', 'supabase/functions/content-safety-scan/index.ts:210', 'supabase/functions/content-safety-scan/index.ts:287'] },
  { provider: 'Stripe', use: 'Business Test Mode checkout/webhook adapter', draft: true, caveat: 'Availability gated by configuration; no live activation claim', evidenceRefs: ['supabase/functions/stripe-bdag-checkout/index.ts:24', 'supabase/functions/stripe-webhook/index.ts:25'] },
  { provider: 'DeepAR', use: 'Conditional native camera effects integration', draft: false, caveat: 'Active processing and platform availability unverified', evidenceRefs: ['services/deeparService.ts:4'] },
  { provider: 'WalletConnect', use: 'Native external wallet connection path', draft: false, caveat: 'Actual production use and data exchange unverified', evidenceRefs: ['services/walletConnect.ts:4'] },
] as const;

export const financialFacts = [
  { topic: 'BDAG', fact: 'Product balance and transfer flows exist; legal characterization unresolved', evidenceRefs: ['supabase/migrations/20260703212533_migration_to_supabase.sql:214', 'supabase/functions/_shared/bdagEconomics.ts:1'] },
  { topic: 'ledger', fact: 'Server-side ledger accounts and transaction records exist', evidenceRefs: ['supabase/migrations/20260703212533_migration_to_supabase.sql:198', 'supabase/migrations/20260703215405_functions_export_schema.sql:9'] },
  { topic: 'wallet', fact: 'Wallet service and balance authority exist', evidenceRefs: ['services/walletApi.ts:1', 'supabase/migrations/20260711120000_add_get_bdag_wallet_balance.sql:1'] },
  { topic: 'gifts', fact: 'LIVE gifts use a wallet-backed economy; no universal split asserted', evidenceRefs: ['supabase/migrations/20260711090000_live_gifts_use_bdag_wallet.sql:1'] },
  { topic: 'marketplace_settlement', fact: 'Held allocations and conditional release exist', evidenceRefs: ['supabase/migrations/20260801043000_marketplace_mkt_a3c_bdag_payment.sql:26', 'supabase/migrations/20260804100000_marketplace_automatic_settlement_policy.sql:70'] },
  { topic: 'refunds', fact: 'Conditional dispute refund can reverse held funds; not all outcomes refund', evidenceRefs: ['supabase/migrations/20260806100000_held_marketplace_dispute_refunds.sql:117'] },
  { topic: 'payouts', fact: 'Withdrawal requests and net amount checks precede broadcast', evidenceRefs: ['supabase/functions/bdag-withdraw/index.ts:287', 'supabase/functions/bdag-withdraw/index.ts:435'] },
  { topic: 'stripe', fact: 'Test Mode adapter requires configured checkout and verified webhook', evidenceRefs: ['supabase/functions/stripe-bdag-checkout/index.ts:24', 'supabase/functions/stripe-webhook/index.ts:35'] },
  { topic: 'stablecoin', fact: 'Payout conversion uses a dedicated precision contract', evidenceRefs: ['supabase/functions/_shared/bdagPayoutPrecision.ts:1'] },
] as const;

type Classification = 'KEEP_FACTUAL' | 'REWRITE_FACTUAL' | 'REMOVE_UNSUPPORTED' | 'OWNER_DECISION' | 'LEGAL_REVIEW';
const legacy = (claim: string, source: string, classification: Classification, treatment: string, evidenceRefs: string[]) => ({ claim, source, classification, treatment, evidenceRefs });
export const legacyReconciliation = [
  legacy('onspace.ai contacts', '2026 standalone mobile documents', 'OWNER_DECISION', 'No address copied; contacts remain null', [retiredMobileRef('app/privacy-policy.tsx:166'), retiredMobileRef('app/terms-of-service.tsx:79')]),
  legacy('clipdag.io contacts', '2025 mobile legal hub', 'OWNER_DECISION', 'No address copied; legacy hub is retired', [retiredMobileRef('app/legal.tsx:237')]),
  legacy('age 13+', '2025 and 2026 mobile text', 'REWRITE_FACTUAL', 'The owner selects 13+ accounts and 18+ creator-exclusive access; retired copy is not presented as current policy', [retiredMobileRef('app/terms-of-service.tsx:73'), retiredMobileRef('app/legal.tsx:39')]),
  legacy('all-data deletion', '2026 mobile policy and terms', 'REMOVE_UNSUPPORTED', 'Current Settings makes no complete deletion promise; financial/order records have separate lifecycles', ['app/settings.tsx:228', retiredMobileRef('app/terms-of-service.tsx:151')]),
  legacy('settings deletion promise', 'C2 baseline mobile Settings confirmation', 'REMOVE_UNSUPPORTED', 'Historical misleading contradiction documented in C2; C3 replaced both visible Settings prompts with information-only wording', ['shared/legal/RECONCILIATION-C2.md:11', 'app/settings.tsx:228', 'app/account-settings.tsx:177']),
  legacy('0.01 DAG per like', '2025 Monetization hub', 'REMOVE_UNSUPPORTED', 'UI-derived display is not canonical reward authority', [retiredMobileRef('app/legal.tsx:143'), 'contexts/FeedContext.tsx:624']),
  legacy('50 dollar withdrawal threshold', '2025 Monetization hub', 'REMOVE_UNSUPPORTED', 'Payout minimum comes from server configuration, not this legacy claim', [retiredMobileRef('app/legal.tsx:143'), 'supabase/functions/bdag-withdraw/index.ts:287']),
  legacy('10 percent commission', '2025 Monetization hub', 'LEGAL_REVIEW', 'Historical fee setting exists but final contractual rate and applicability unapproved', [retiredMobileRef('app/legal.tsx:151'), 'supabase/migrations/20260801043000_marketplace_mkt_a3c_bdag_payment.sql:17']),
  legacy('seven-day payment', '2025 Monetization hub', 'REMOVE_UNSUPPORTED', 'Settlement has conditional policy and dispute holds; no universal deadline', [retiredMobileRef('app/legal.tsx:151'), 'supabase/migrations/20260804100000_marketplace_automatic_settlement_policy.sql:70']),
  legacy('85/15 gifts', '2025 Monetization hub', 'REMOVE_UNSUPPORTED', 'Gift authority must be assessed independently; split not adopted', [retiredMobileRef('app/legal.tsx:147'), 'supabase/migrations/20260711090000_live_gifts_use_bdag_wallet.sql:1']),
  legacy('2FA', '2025 Privacy hub', 'REMOVE_UNSUPPORTED', 'No app-enforced 2FA established in audited auth path', [retiredMobileRef('app/legal.tsx:77'), 'contexts/AuthContext.tsx:286']),
  legacy('24/7 monitoring', '2025 Privacy hub', 'REMOVE_UNSUPPORTED', 'No operational coverage guarantee established', [retiredMobileRef('app/legal.tsx:77')]),
  legacy('regular audits', '2025 Privacy hub', 'REMOVE_UNSUPPORTED', 'No schedule or attestation established', [retiredMobileRef('app/legal.tsx:77')]),
  legacy('30-day notice', '2025 Terms hub', 'OWNER_DECISION', 'No changes-to-terms notice rule selected', [retiredMobileRef('app/legal.tsx:35')]),
  legacy('immediate changes', '2026 standalone Terms', 'OWNER_DECISION', 'No changes-to-terms notice rule selected', [retiredMobileRef('app/terms-of-service.tsx:185')]),
  legacy('arbitration', '2026 standalone Terms', 'REWRITE_FACTUAL', 'Owner proposes no mandatory arbitration or waivers; legal review pending', [retiredMobileRef('app/terms-of-service.tsx:193')]),
  legacy('jurisdiction', '2026 standalone Terms', 'REWRITE_FACTUAL', 'Owner proposes Florida law and competent Miami-Dade forum subject to mandatory rights; legal review pending', [retiredMobileRef('app/terms-of-service.tsx:193')]),
] as const;
