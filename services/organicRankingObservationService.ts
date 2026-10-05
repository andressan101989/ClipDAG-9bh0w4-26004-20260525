export type OrganicRankingEngagementAction =
  | 'like'
  | 'unlike'
  | 'save'
  | 'unsave'
  | 'follow'
  | 'unfollow';

export interface OrganicRankingObservationRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface OrganicRankingImpressionInput {
  decisionId: string;
  videoId: string;
  clientEventId: string;
  clientSessionId: string;
  surfacePosition: number;
}

export interface OrganicRankingEngagementInput {
  impressionClientEventId: string;
  clientActionId: string;
  action: OrganicRankingEngagementAction;
}

function firstResult(data: unknown): Record<string, unknown> | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** Fail-soft idempotent write. The single retry reuses the exact clientEventId. */
export async function recordOrganicRankingImpression(
  client: OrganicRankingObservationRpcClient,
  input: OrganicRankingImpressionInput,
): Promise<string | null> {
  const args = {
    p_decision_id: input.decisionId,
    p_video_id: input.videoId,
    p_client_event_id: input.clientEventId,
    p_client_session_id: input.clientSessionId,
    p_surface_position: input.surfacePosition,
  };
  try {
    let response = await client.rpc('record_organic_ranking_impression_v1', args);
    if (response.error) response = await client.rpc('record_organic_ranking_impression_v1', args);
    if (response.error) return null;
    const result = firstResult(response.data);
    return typeof result?.status === 'string' ? result.status : null;
  } catch {
    return null;
  }
}

/** Fail-soft telemetry written only after the canonical business action. */
export async function recordOrganicRankingEngagement(
  client: OrganicRankingObservationRpcClient,
  input: OrganicRankingEngagementInput,
): Promise<string | null> {
  try {
    const response = await client.rpc('record_organic_ranking_engagement_v1', {
      p_impression_client_event_id: input.impressionClientEventId,
      p_client_action_id: input.clientActionId,
      p_action: input.action,
    });
    if (response.error) return null;
    const result = firstResult(response.data);
    return typeof result?.status === 'string' ? result.status : null;
  } catch {
    return null;
  }
}
