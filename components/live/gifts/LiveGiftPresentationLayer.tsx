import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GiftAnimationRenderer } from './GiftAnimationRenderer';
import type { GiftPresentationEntry } from './giftPresentationQueue';

type Props = {
  activeGift: GiftPresentationEntry | null;
  floatingGifts: readonly GiftPresentationEntry[];
  reducedMotion: boolean;
};

export const LiveGiftPresentationLayer = memo(function LiveGiftPresentationLayer({ activeGift, floatingGifts, reducedMotion }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={styles.overlay}
      accessibilityViewIsModal={false}
    >
      <View style={[styles.safePresentationRegion, { top: insets.top, bottom: insets.bottom }]} pointerEvents="none">
        {floatingGifts.map(entry => (
          <GiftAnimationRenderer key={entry.event.eventId} entry={entry} reducedMotion={reducedMotion} />
        ))}
        {activeGift ? (
          <GiftAnimationRenderer key={activeGift.event.eventId} entry={activeGift} reducedMotion={reducedMotion} />
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 17, elevation: 17 },
  safePresentationRegion: { position: 'absolute', left: 0, right: 0 },
});
