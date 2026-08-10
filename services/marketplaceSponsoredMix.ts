export type MarketplaceSponsoredMixItem<
  TOrganic extends { id: string },
  TSponsored extends { campaign_id: string; product_id: string },
> =
  | { kind: "organic"; product: TOrganic; position: number }
  | { kind: "sponsored"; product: TSponsored; position: number };

/**
 * Temporary physical-test accommodation for small catalogs. For 1-7 visible
 * organic products, one matching campaign replaces its organic card. The
 * large-catalog branch intentionally preserves the production 1-per-8 rule.
 */
export function mixMarketplaceSponsoredProducts<
  TOrganic extends { id: string },
  TSponsored extends { campaign_id: string; product_id: string },
>(
  organic: readonly TOrganic[],
  sponsored: readonly TSponsored[],
): MarketplaceSponsoredMixItem<TOrganic, TSponsored>[] {
  if (organic.length > 0 && organic.length < 8) {
    const visibleProductIds = new Set(organic.map((product) => product.id));
    const matchingCampaign = sponsored.find((candidate) =>
      visibleProductIds.has(candidate.product_id),
    );

    return organic.map((product, position) =>
      matchingCampaign?.product_id === product.id
        ? { kind: "sponsored", product: matchingCampaign, position }
        : { kind: "organic", product, position },
    );
  }

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
