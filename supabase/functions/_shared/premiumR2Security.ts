/* eslint-disable import/no-unresolved */
import { PutObjectCommand } from 'npm:@aws-sdk/client-s3@3.637.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.637.0';
import { r2Client } from './r2.ts';

export const PREMIUM_ORIGINAL_CACHE_CONTROL = 'private, no-store';

export function premiumOriginalHasRequiredCacheControl(
  value: unknown,
): boolean {
  return typeof value === 'string'
    && value.trim() === PREMIUM_ORIGINAL_CACHE_CONTROL;
}

export const signPremiumOriginalPutIfAbsent = (
  bucket: string,
  key: string,
  mime: string,
) => getSignedUrl(
  r2Client(),
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mime,
    IfNoneMatch: '*',
    CacheControl: PREMIUM_ORIGINAL_CACHE_CONTROL,
  }),
  {
    expiresIn: 300,
    signableHeaders: new Set([
      'content-type',
      'if-none-match',
      'cache-control',
    ]),
  },
);
