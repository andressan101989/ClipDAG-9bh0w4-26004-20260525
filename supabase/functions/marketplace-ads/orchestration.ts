export type AdsRpcResult<T = unknown> = { data: T | null; error: unknown | null };
export type SponsoredSurface = "marketplace_home" | "marketplace_search" | "social_feed";

export function parseSponsoredSurface(value: unknown): SponsoredSurface | null {
  return value === "marketplace_home" || value === "marketplace_search" || value === "social_feed"
    ? value
    : null;
}

export async function materializeSponsoredCandidates(
  candidates: { campaign_id: string }[],
  materialize: (campaignId: string) => Promise<AdsRpcResult>,
): Promise<void> {
  for (const candidate of candidates) {
    const result = await materialize(candidate.campaign_id);
    if (result.error) throw result.error;
  }
}
