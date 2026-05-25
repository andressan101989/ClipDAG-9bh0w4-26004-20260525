import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

interface DAGBadgeProps {
  amount: number;
  size?: 'sm' | 'md' | 'lg';
}

export function DAGBadge({ amount, size = 'md' }: DAGBadgeProps) {
  const fontSize = size === 'sm' ? FontSize.xs : size === 'md' ? FontSize.sm : FontSize.md;
  const iconSize = size === 'sm' ? 10 : size === 'md' ? 13 : 16;
  const px = size === 'sm' ? Spacing.sm : size === 'md' ? Spacing.md : Spacing.lg;
  const py = size === 'sm' ? 3 : size === 'md' ? 5 : 8;

  return (
    <LinearGradient
      colors={['#00D4FF', '#0066FF']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.badge, { paddingHorizontal: px, paddingVertical: py, borderRadius: Radius.full }]}
    >
      <Text style={[styles.icon, { fontSize: iconSize }]}>◈</Text>
      <Text style={[styles.amount, { fontSize }]}>{amount.toFixed(2)} $DAG</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  icon: {
    color: '#fff',
    fontWeight: FontWeight.bold,
  },
  amount: {
    color: '#fff',
    fontWeight: FontWeight.semibold,
  },
});
