const safeSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type UpdateEntry = { id: string; data: { publishedAt: Date; draft: boolean; featured: boolean } };
type Neighbors = Record<string, { newer: string | null; older: string | null }>;

/** Build-time, UTC-based editorial selection. IDs are the single slug authority. */
export function selectPublishedUpdates<T extends UpdateEntry>(entries: T[], now = new Date()): { items: T[]; featured: T | null; neighbors: Neighbors } {
  const seen = new Set<string>();
  for (const entry of entries) {
    const slug = entry.id;
    if (!safeSlug.test(slug)) throw new Error(`Unsafe update slug: ${slug}`);
    if (seen.has(slug.toLowerCase())) throw new Error(`Duplicate update slug: ${slug}`);
    seen.add(slug.toLowerCase());
  }
  const items = entries
    .filter((entry) => !entry.data.draft && entry.data.publishedAt.getTime() <= now.getTime())
    .sort((left, right) => right.data.publishedAt.getTime() - left.data.publishedAt.getTime() || right.id.localeCompare(left.id));
  const featured = items.find((entry) => entry.data.featured) ?? null;
  const neighbors = Object.fromEntries(items.map((entry, index) => [entry.id, {
    newer: items[index - 1]?.id ?? null,
    older: items[index + 1]?.id ?? null,
  }]));
  return { items, featured, neighbors };
}
