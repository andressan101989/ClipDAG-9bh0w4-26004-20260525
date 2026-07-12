import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { LiveGiftEvent } from '@/types/liveGifts';
import { LiveGiftAnimationRenderer } from './LiveGiftAnimationRenderer';

type Props = {
  activeGift: LiveGiftEvent | null;
  floatingGifts: LiveGiftEvent[];
};

export function LiveGiftOverlay({ activeGift, floatingGifts }: Props) {
  return (
    <View pointerEvents="none" style={styles.overlay}>
      {floatingGifts.map(gift => (
        <LiveGiftAnimationRenderer key={gift.transactionId} gift={gift} floating />
      ))}
      {activeGift ? <LiveGiftAnimationRenderer key={activeGift.transactionId} gift={activeGift} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 17,
    elevation: 17,
  },
});
