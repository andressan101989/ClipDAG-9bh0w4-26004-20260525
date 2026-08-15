export interface MarketplaceCursorPage<T, C> {
  items: T[];
  nextCursor: C | null;
}
export interface MarketplaceCursorCollection<T, C> {
  items: T[];
  nextCursor: C | null;
}

export function mergeMarketplaceCursorPage<T extends { id: string }, C>(
  current: MarketplaceCursorCollection<T, C>,
  page: MarketplaceCursorPage<T, C>,
  reset = false,
): MarketplaceCursorCollection<T, C> {
  const source = reset ? [] : current.items;
  const byId = new Map(source.map((item) => [item.id, item]));
  page.items.forEach((item) => byId.set(item.id, item));
  return { items: [...byId.values()], nextCursor: page.nextCursor };
}
