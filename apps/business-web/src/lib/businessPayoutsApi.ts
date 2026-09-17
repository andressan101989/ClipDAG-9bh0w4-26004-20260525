import { supabase, type BusinessSupabaseClient } from "./supabase";

type Row = Record<string, unknown>;

export type PayoutStatus = "pending" | "broadcasting" | "completed" | "failed";
export type PayoutCursor = { createdAt: string; id: string };
export type PayoutRail = { token: "USDT" | "USDC"; chainId: string; network: string; decimals: number };

export type WithdrawalConfig = {
  minimumBdag: number;
  maximumBdag: number;
  feeBps: number;
  bdagPerUsd: number;
  maxActivePerUser: number;
  requiredConfirmations: number;
  rails: PayoutRail[];
};

export type WithdrawalQuote = {
  grossBdag: number;
  feeBdag: number;
  netBdag: number;
  estimatedStablecoinAmount: number;
  feeBps: number;
  minimumBdag: number;
  token: string;
  chainId: string;
  network: string;
};

export type BusinessPayout = {
  id: string;
  status: PayoutStatus;
  bdagAmount: number;
  feeBdag: number;
  netBdag: number;
  stablecoinAmount: number;
  tokenType: string;
  chainId: string;
  maskedDestination: string;
  txHash: string | null;
  confirmations: number;
  requiredConfirmations: number;
  createdAt: string;
  broadcastAt: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
};

export type BusinessPayoutPage = {
  businessOwnerId: string;
  bdagBalance: number;
  items: BusinessPayout[];
  nextCursor: PayoutCursor | null;
  summary: {
    pendingCount: number;
    broadcastingCount: number;
    completedCount: number;
    failedCount: number;
    totalCompletedBdag: number;
  };
};

function object(value: unknown, code: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Row;
}
function string(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}
function optionalString(value: unknown) { return typeof value === "string" && value ? value : null; }
function number(value: unknown, code: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}
function unwrapEdge(value: unknown, code: string): Row {
  const envelope = object(value, code);
  if (envelope.success !== true) throw new Error(typeof envelope.error === "string" ? envelope.error : code);
  return object(envelope.data, code);
}
function payoutStatus(value: unknown): PayoutStatus {
  if (value !== "pending" && value !== "broadcasting" && value !== "completed" && value !== "failed") {
    throw new Error("business_payout_invalid");
  }
  return value;
}

export async function getWithdrawalConfig(client: BusinessSupabaseClient = supabase): Promise<WithdrawalConfig> {
  const { data, error } = await client.functions.invoke("bdag-withdraw", { body: { action: "config" } });
  if (error) throw new Error(error.message || "withdrawal_config_unavailable");
  const payload = unwrapEdge(data, "withdrawal_config_invalid");
  if (!Array.isArray(payload.rails)) throw new Error("withdrawal_config_invalid");
  return {
    minimumBdag: number(payload.minimum_bdag, "withdrawal_config_invalid"),
    maximumBdag: number(payload.maximum_bdag, "withdrawal_config_invalid"),
    feeBps: number(payload.fee_bps, "withdrawal_config_invalid"),
    bdagPerUsd: number(payload.bdag_per_usd, "withdrawal_config_invalid"),
    maxActivePerUser: number(payload.max_active_per_user, "withdrawal_config_invalid"),
    requiredConfirmations: number(payload.required_confirmations, "withdrawal_config_invalid"),
    rails: payload.rails.map((value) => {
      const rail = object(value, "withdrawal_config_invalid");
      const token = string(rail.token, "withdrawal_config_invalid");
      if (token !== "USDT" && token !== "USDC") throw new Error("withdrawal_config_invalid");
      return {
        token,
        chainId: string(rail.chain_id, "withdrawal_config_invalid"),
        network: string(rail.network, "withdrawal_config_invalid"),
        decimals: number(rail.decimals, "withdrawal_config_invalid"),
      };
    }),
  };
}

export async function getWithdrawalQuote(
  amount: string,
  rail: Pick<PayoutRail, "chainId" | "token">,
  client: BusinessSupabaseClient = supabase,
): Promise<WithdrawalQuote> {
  const { data, error } = await client.functions.invoke("bdag-withdraw", {
    body: { action: "quote", amount, chain_id: rail.chainId, token_type: rail.token },
  });
  if (error) throw new Error(error.message || "withdrawal_quote_unavailable");
  const payload = unwrapEdge(data, "withdrawal_quote_invalid");
  return {
    grossBdag: number(payload.gross_bdag, "withdrawal_quote_invalid"),
    feeBdag: number(payload.fee_bdag, "withdrawal_quote_invalid"),
    netBdag: number(payload.net_bdag, "withdrawal_quote_invalid"),
    estimatedStablecoinAmount: number(payload.estimated_stablecoin_amount, "withdrawal_quote_invalid"),
    feeBps: number(payload.fee_bps, "withdrawal_quote_invalid"),
    minimumBdag: number(payload.minimum_bdag, "withdrawal_quote_invalid"),
    token: string(payload.token, "withdrawal_quote_invalid"),
    chainId: string(payload.chain_id, "withdrawal_quote_invalid"),
    network: string(payload.network, "withdrawal_quote_invalid"),
  };
}

export async function requestBusinessPayout(
  amount: string,
  destination: string,
  rail: Pick<PayoutRail, "chainId" | "token">,
  idempotencyKey = crypto.randomUUID(),
  client: BusinessSupabaseClient = supabase,
) {
  const { data, error } = await client.functions.invoke("bdag-withdraw", {
    body: {
      action: "request", amount, to_address: destination,
      chain_id: rail.chainId, token_type: rail.token, idempotency_key: idempotencyKey,
    },
  });
  if (error) throw new Error(error.message || "withdrawal_request_failed");
  const payload = unwrapEdge(data, "withdrawal_request_invalid");
  return { id: string(payload.withdrawal_id, "withdrawal_request_invalid"), status: string(payload.status, "withdrawal_request_invalid") };
}

export async function searchBusinessPayouts(
  businessOwnerId: string,
  options: { status?: PayoutStatus; cursor?: PayoutCursor; limit?: number } = {},
  client: BusinessSupabaseClient = supabase,
): Promise<BusinessPayoutPage> {
  const { data, error } = await client.rpc("search_my_business_payouts", {
    p_business_owner_id: businessOwnerId,
    p_status: options.status ?? null,
    p_cursor_created_at: options.cursor?.createdAt ?? null,
    p_cursor_id: options.cursor?.id ?? null,
    p_limit: options.limit ?? 20,
  });
  if (error) throw new Error(error.message || "business_payouts_unavailable");
  const payload = object(data, "business_payouts_invalid");
  const summary = object(payload.summary, "business_payouts_invalid");
  if (!Array.isArray(payload.items)) throw new Error("business_payouts_invalid");
  const cursor = payload.next_cursor == null ? null : object(payload.next_cursor, "business_payouts_invalid");
  return {
    businessOwnerId: string(payload.business_owner_id, "business_payouts_invalid"),
    bdagBalance: number(payload.bdag_balance, "business_payouts_invalid"),
    items: payload.items.map((value) => {
      const row = object(value, "business_payout_invalid");
      return {
        id: string(row.id, "business_payout_invalid"), status: payoutStatus(row.status),
        bdagAmount: number(row.bdag_amount, "business_payout_invalid"), feeBdag: number(row.fee_bdag, "business_payout_invalid"),
        netBdag: number(row.net_bdag, "business_payout_invalid"), stablecoinAmount: number(row.stablecoin_amount, "business_payout_invalid"),
        tokenType: string(row.token_type, "business_payout_invalid"), chainId: string(row.chain_id, "business_payout_invalid"),
        maskedDestination: string(row.masked_destination, "business_payout_invalid"), txHash: optionalString(row.tx_hash),
        confirmations: number(row.confirmations, "business_payout_invalid"), requiredConfirmations: number(row.required_confirmations, "business_payout_invalid"),
        createdAt: string(row.created_at, "business_payout_invalid"), broadcastAt: optionalString(row.broadcast_at),
        confirmedAt: optionalString(row.confirmed_at), completedAt: optionalString(row.completed_at), failedAt: optionalString(row.failed_at),
        failureReason: optionalString(row.failure_reason),
      };
    }),
    nextCursor: cursor ? { createdAt: string(cursor.created_at, "business_payouts_invalid"), id: string(cursor.id, "business_payouts_invalid") } : null,
    summary: {
      pendingCount: number(summary.pending_count, "business_payouts_invalid"),
      broadcastingCount: number(summary.broadcasting_count, "business_payouts_invalid"),
      completedCount: number(summary.completed_count, "business_payouts_invalid"),
      failedCount: number(summary.failed_count, "business_payouts_invalid"),
      totalCompletedBdag: number(summary.total_completed_bdag, "business_payouts_invalid"),
    },
  };
}
