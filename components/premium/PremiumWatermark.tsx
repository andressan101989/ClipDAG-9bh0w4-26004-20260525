import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';

type PremiumWatermarkProps = {
  visible: boolean;
  userMarker: string;
  sessionMarker: string;
  timestamp: string;
};

function boundedMarker(value: string): string {
  return value.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 16);
}

export const PremiumWatermark = memo(function PremiumWatermark({
  visible,
  userMarker,
  sessionMarker,
  timestamp,
}: PremiumWatermarkProps) {
  if (!visible) return null;

  const user = boundedMarker(userMarker);
  const session = boundedMarker(sessionMarker);
  const time = boundedMarker(timestamp);

  return (
    <View pointerEvents="none" accessibilityElementsHidden style={styles.overlay}>
      <Text style={styles.text}>{`NELYON · ${user} · ${session} · ${time}`}</Text>
      <Text style={[styles.text, styles.second]}>{`NELYON · ${session} · ${user}`}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  text: {
    color: 'rgba(245,245,247,0.48)',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.7,
    textAlign: 'center',
    textShadowColor: Colors.bg,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    transform: [{ rotate: '-13deg' }],
  },
  second: {
    transform: [{ rotate: '13deg' }],
  },
});
