export type RankedFeedMode = 'chronological' | 'behavioral_l1' | 'behavioral_l2' | 'behavioral_l3' | 'behavioral_l4' | 'behavioral_l5' | 'behavioral_l6';

export interface RankedFeedCursor {
  asOf: string;
  score: string | number;
  createdAt: string;
  id: string;
  policyVersion: string;
}

export interface RankedFeedRequest {
  clientSessionId: string;
  limit?: number;
  cursor?: RankedFeedCursor | null;
}

export interface RankedFeedPage<TVideo> {
  videos: TVideo[];
  cursor: RankedFeedCursor | null;
  hasMore: boolean;
  rankingMode: RankedFeedMode | null;
  policyVersion: string | null;
  observationItems: RankedFeedObservationItem[];
}

export interface RankedFeedObservationItem {
  videoId: string;
  decisionId: string;
  organicPosition: number;
}

export interface RankedFeedRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

type RankedFeedRow = Record<string, unknown> & {
  id: string;
  creator_username: string;
  creator_avatar: string;
  ranking_mode: RankedFeedMode;
  policy_version: string;
  rank_score: string | number;
  feed_as_of: string;
  cursor_score: string | number;
  cursor_created_at: string;
  cursor_id: string;
  effective_page_limit: number;
  ranking_decision_id: string | null;
  ranking_organic_position: number | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validNumeric(value: unknown): value is string | number {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
}

function assertRankedFeedRow(value: unknown): asserts value is RankedFeedRow {
  if (!value || typeof value !== 'object') throw new Error('Invalid ranked feed row');
  const row = value as Record<string, unknown>;
  const validMode = row.ranking_mode === 'chronological'
    || row.ranking_mode === 'behavioral_l1'
    || row.ranking_mode === 'behavioral_l2'
    || row.ranking_mode === 'behavioral_l3'
    || row.ranking_mode === 'behavioral_l4'
    || row.ranking_mode === 'behavioral_l5'
    || row.ranking_mode === 'behavioral_l6';
  if (
    typeof row.id !== 'string' || !UUID_PATTERN.test(row.id)
    || typeof row.cursor_id !== 'string' || !UUID_PATTERN.test(row.cursor_id)
    || typeof row.creator_username !== 'string'
    || typeof row.creator_avatar !== 'string'
    || !validMode
    || typeof row.policy_version !== 'string' || row.policy_version.length === 0
    || !validNumeric(row.rank_score)
    || !validNumeric(row.cursor_score)
    || !validTimestamp(row.created_at)
    || !validTimestamp(row.feed_as_of)
    || !validTimestamp(row.cursor_created_at)
    || !Number.isInteger(row.effective_page_limit)
    || Number(row.effective_page_limit) < 1
    || Number(row.effective_page_limit) > 50
    || !(
      (row.ranking_decision_id === null && row.ranking_organic_position === null)
      || (
        typeof row.ranking_decision_id === 'string'
        && UUID_PATTERN.test(row.ranking_decision_id)
        && Number.isInteger(row.ranking_organic_position)
        && Number(row.ranking_organic_position) > 0
      )
    )
  ) {
    throw new Error('Invalid ranked feed row');
  }
}

/** Thin client for the single server-side organic Feed authority. */
export async function fetchRankedFeedPage<TVideo>(
  client: RankedFeedRpcClient,
  request: RankedFeedRequest,
  mapRow: (row: Record<string, unknown>, username: string, avatar: string) => TVideo,
): Promise<RankedFeedPage<TVideo>> {
  const requestedLimit = request.limit ?? 10;
  if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
    throw new Error('Invalid ranked Feed limit');
  }
  const limit = Math.min(requestedLimit, 50);
  const cursor = request.cursor ?? null;
  const { data, error } = await client.rpc('get_ranked_feed_l1_v1', {
    p_client_session_id: request.clientSessionId,
    p_limit: limit,
    p_as_of: cursor?.asOf ?? null,
    p_before_score: cursor?.score ?? null,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_policy_version: cursor?.policyVersion ?? null,
  });

  if (error) throw new Error(error.message || 'Ranked Feed request failed');
  if (!Array.isArray(data)) throw new Error('Invalid ranked feed response');
  if (data.length === 0) {
    return {
      videos: [],
      cursor: null,
      hasMore: false,
      rankingMode: null,
      policyVersion: null,
      observationItems: [],
    };
  }

  data.forEach(assertRankedFeedRow);
  const first = data[0];
  if (data.some(row => (
    row.ranking_mode !== first.ranking_mode
    || row.policy_version !== first.policy_version
    || row.feed_as_of !== first.feed_as_of
  ))) {
    throw new Error('Invalid ranked feed response');
  }

  const decisionId = first.ranking_decision_id;
  if (decisionId === null) {
    if (data.some(row => row.ranking_decision_id !== null || row.ranking_organic_position !== null)) {
      throw new Error('Invalid ranked feed response');
    }
  } else if (data.some((row, index) => (
    row.ranking_decision_id !== decisionId
    || row.ranking_organic_position !== index + 1
  ))) {
    throw new Error('Invalid ranked feed response');
  }

  const last = data.at(-1)!;
  return {
    videos: data.map(row => mapRow(row, row.creator_username, row.creator_avatar)),
    cursor: {
      asOf: last.feed_as_of,
      score: last.cursor_score,
      createdAt: last.cursor_created_at,
      id: last.cursor_id,
      policyVersion: last.policy_version,
    },
    hasMore: data.length === first.effective_page_limit,
    rankingMode: first.ranking_mode,
    policyVersion: first.policy_version,
    observationItems: decisionId === null ? [] : data.map(row => ({
      videoId: row.id,
      decisionId,
      organicPosition: row.ranking_organic_position!,
    })),
  };
}
