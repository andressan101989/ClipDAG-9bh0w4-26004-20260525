import { getCollection } from 'astro:content';
import { selectPublishedUpdates } from './updates-core';

const buildInstant = new Date();

/** Sole editorial read path for homepage, index and detail. Evaluated at build time in UTC. */
export async function getPublishedUpdates() {
  return selectPublishedUpdates(await getCollection('whatsNew'), buildInstant);
}
