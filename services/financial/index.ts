/**
 * services/financial/index.ts
 *
 * Barrel export — single import point for all financial operations.
 *
 * Usage:
 *   import { transferBDAG, purchaseContent, sendGift } from '@/services/financial';
 *
 * Architecture:
 *   All mutations → bdag-ledger Edge Function → atomic_ledger_transfer() PostgreSQL RPC
 *   All reads     → direct Supabase selects (ledger_accounts, financial_transactions)
 *   No frontend state mutation — backend is single source of truth
 */

export * from './ledgerClient';
export * from './premiumDmClient';
