export type MarketplaceSponsoredMixItem<
  TOrganic extends { id: string },
  TSponsored extends { campaign_id: string; product_id: string },
> =
  | { kind: "organic"; product: TOrganic; position: number }
  | { kind: "sponsored"; product: TSponsored; position: number };

/** Mixes sponsored cards at the production 1-per-8 insertion boundary. */
export function mixMarketplaceSponsoredProducts<
  TOrganic extends { id: string },
  TSponsored extends { campaign_id: string; product_id: string },
>(
  organic: readonly TOrganic[],
  sponsored: readonly TSponsored[],
): MarketplaceSponsoredMixItem<TOrganic, TSponsored>[] {
  const organicProductIds = new Set(organic.map((product) => product.id));
  return organic.flatMap((product, position) => {
    const candidate =
      position > 0 && position % 8 === 0
        ? sponsored[Math.floor(position / 8) - 1]
        : undefined;
    const organicItem: MarketplaceSponsoredMixItem<TOrganic, TSponsored> = {
      kind: "organic",
      product,
      position,
    };

    if (!candidate || organicProductIds.has(candidate.product_id)) {
      return [organicItem];
    }

    return [
      { kind: "sponsored" as const, product: candidate, position },
      organicItem,
    ];
  });
}

export function marketplaceSponsoredProductRoute(product: {
  campaign_id: string;
  product_id: string;
}) {
  return {
    id: product.product_id,
    source: "ad" as const,
    campaignId: product.campaign_id,
    surface: "marketplace_home" as const,
  };
}

export type SocialFeedItem<TOrganic, TSponsored> =
  | { kind: "organic"; video: TOrganic; organicIndex: number }
  | { kind: "sponsored"; product: TSponsored; position: number };

/** Inserts Feed ads after 4 organic items, then every 8, capped at 3. */
export function mixSocialFeedSponsoredProducts<
  TOrganic,
  TSponsored extends { campaign_id: string },
>(
  organic: readonly TOrganic[],
  sponsored: readonly TSponsored[],
): SocialFeedItem<TOrganic, TSponsored>[] {
  const uniqueSponsored = sponsored.filter(
    (candidate, index, all) =>
      all.findIndex((item) => item.campaign_id === candidate.campaign_id) === index,
  ).slice(0, 3);
  const result: SocialFeedItem<TOrganic, TSponsored>[] = [];
  let adIndex = 0;

  organic.forEach((video, organicIndex) => {
    result.push({ kind: "organic", video, organicIndex });
    const organicCount = organicIndex + 1;
    const isAdBoundary = organicCount === 4 || (organicCount > 4 && (organicCount - 4) % 8 === 0);
    if (isAdBoundary && adIndex < uniqueSponsored.length) {
      result.push({ kind: "sponsored", product: uniqueSponsored[adIndex], position: result.length });
      adIndex += 1;
    }
  });

  return result;
}

export function socialFeedSponsoredProductRoute(product: {
  campaign_id: string;
  product_id: string;
}) {
  return {
    id: product.product_id,
    source: "ad" as const,
    campaignId: product.campaign_id,
    sourceSurface: "social_feed" as const,
  };
}
