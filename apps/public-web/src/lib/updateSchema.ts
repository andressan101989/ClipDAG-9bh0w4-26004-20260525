import { z } from 'astro/zod';

const utcInstant = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value.replace('Z', '.000Z');
}, 'Use a valid UTC timestamp (YYYY-MM-DDTHH:mm:ssZ)').transform((value) => new Date(value));

export const updateSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  publishedAt: utcInstant,
  updatedAt: utcInstant.optional(),
  category: z.enum(['Product', 'Creators', 'LIVE', 'Marketplace', 'Business', 'Ads', 'Platform']),
  availability: z.enum(['available', 'rolling_out', 'preview', 'coming_soon']),
  tags: z.array(z.string().trim().min(1)).optional(),
  coverImage: z.string().regex(/^\/media\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:avif|webp|png|jpg)$/).optional(),
  coverAlt: z.string().trim().min(1).optional(),
  featured: z.boolean(),
  draft: z.boolean(),
}).strict().superRefine((article, context) => {
  if (article.coverImage && !article.coverAlt) context.addIssue({ code: 'custom', path: ['coverAlt'], message: 'Cover alt is required' });
  if (article.updatedAt && article.updatedAt < article.publishedAt) context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Updated date precedes publication' });
});
