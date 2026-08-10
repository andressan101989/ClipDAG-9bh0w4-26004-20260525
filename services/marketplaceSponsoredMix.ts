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
