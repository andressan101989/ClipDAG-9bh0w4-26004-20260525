export interface AlgoL1CanaryRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface AlgoL1CanaryDevState {
  enrollmentKey: string | null;
}

interface EnrollmentOptions {
  client: AlgoL1CanaryRpcClient;
  isDev: boolean;
  enrollFlag: string | undefined;
  viewerId: string | null;
  clientSessionId: string;
  state: AlgoL1CanaryDevState;
  log?: (message: string) => void;
}

interface FirstPageDiagnosticOptions {
  isDev: boolean;
  rankingMode: string | null;
  policyVersion: string | null;
  rowCount: number;
  log?: (message: string) => void;
}

type EnrollmentRow = {
  status: 'pending';
  request_id: string;
  requested_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canaryDevEnabled(isDev: boolean, enrollFlag: string | undefined): boolean {
  return isDev && enrollFlag === '1';
}

function parseEnrollmentRow(data: unknown): EnrollmentRow | null {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    row.status !== 'pending'
    || typeof row.request_id !== 'string'
    || !UUID_PATTERN.test(row.request_id)
    || typeof row.requested_at !== 'string'
    || !Number.isFinite(Date.parse(row.requested_at))
  ) return null;
  return row as EnrollmentRow;
}

/** Development-only enrollment. The mutable state prevents StrictMode/retry duplicates. */
export async function maybeRequestAlgoL1CanaryEnrollment({
  client,
  isDev,
  enrollFlag,
  viewerId,
  clientSessionId,
  state,
  log = console.log,
}: EnrollmentOptions): Promise<boolean> {
  if (!viewerId) {
    state.enrollmentKey = null;
    return false;
  }
  if (!canaryDevEnabled(isDev, enrollFlag)) return false;

  const enrollmentKey = `${viewerId}:${clientSessionId}`;
  if (state.enrollmentKey === enrollmentKey) return false;
  state.enrollmentKey = enrollmentKey;

  try {
    const { data, error } = await client.rpc('request_my_algo_l1_canary_v1', {});
    if (error) throw new Error('canary enrollment failed');
    const row = parseEnrollmentRow(data);
    if (!row) throw new Error('invalid canary enrollment response');
    log(`[ALGO-L1-CANARY] enrollment=pending request=${row.request_id}`);
    return true;
  } catch {
    log('[ALGO-L1-CANARY] enrollment=failed');
    return false;
  }
}

/** First-page delivery diagnostic. No viewer or content identifiers are logged. */
export function logAlgoL1CanaryFirstPage({
  isDev,
  rankingMode,
  policyVersion,
  rowCount,
  log = console.log,
}: FirstPageDiagnosticOptions): void {
  if (!isDev) return;
  const mode = rankingMode ?? 'empty';
  const policy = policyVersion ?? 'none';
  log(`[ALGO-L1-CANARY] mode=${mode} policy=${policy} rows=${Math.max(0, Math.trunc(rowCount))}`);
}
