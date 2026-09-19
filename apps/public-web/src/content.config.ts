import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { updateSchema } from './lib/updateSchema';

const whatsNew = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/whats-new' }),
  schema: updateSchema,
});

export const collections = { whatsNew };
