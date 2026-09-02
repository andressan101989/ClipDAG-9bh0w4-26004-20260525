import React from 'react';
import type { GiftPresentationEntry } from './giftPresentationQueue';
import { LiveGiftPresentationLayer } from './LiveGiftPresentationLayer';

type Props = {
  activeGift: GiftPresentationEntry | null;
  floatingGifts: readonly GiftPresentationEntry[];
  reducedMotion: boolean;
};

/** Compatibility name for the single shared pointerEvents="none" presentation layer. */
export function LiveGiftOverlay(props: Props) {
  return <LiveGiftPresentationLayer {...props} />;
}
