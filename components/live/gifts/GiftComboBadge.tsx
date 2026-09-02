import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const GiftComboBadge = memo(function GiftComboBadge({ count }: { count: number }) {
  if (count <= 1) return null;
  return (
    <View style={styles.badge} accessibilityLabel={`Combo visual por ${count}`}>
      <Text style={styles.text}>×{count}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    minWidth: 38,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFD54A',
    borderWidth: 1,
    borderColor: '#FFF4B0',
  },
  text: { color: '#201400', fontSize: 15, fontWeight: '900' },
});
