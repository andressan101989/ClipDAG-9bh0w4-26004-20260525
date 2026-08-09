export type AdsRpcResult<T = unknown> = { data: T | null; error: unknown | null };

export async function materializeSponsoredCandidates(
  candidates: { campaign_id: string }[],
  materialize: (campaignId: string) => Promise<AdsRpcResult>,
): Promise<void> {
  for (const candidate of candidates) {
    const result = await materialize(candidate.campaign_id);
    if (result.error) throw result.error;
  }
}
