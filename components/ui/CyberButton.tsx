import React, { ReactNode } from 'react';
import { Pressable, Text, StyleSheet, ViewStyle, TextStyle, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

interface CyberButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export function CyberButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  fullWidth = false,
}: CyberButtonProps) {
  const height = size === 'sm' ? 36 : size === 'md' ? 48 : 56;
  const fontSize = size === 'sm' ? FontSize.sm : size === 'md' ? FontSize.md : FontSize.lg;
  const px = size === 'sm' ? Spacing.md : size === 'md' ? Spacing.lg : Spacing.xl;

  const isGradient = variant === 'primary' || variant === 'secondary';

  if (isGradient) {
    const colors = variant === 'primary'
      ? ['#00D4FF', '#0066FF'] as [string, string]
      : ['#FF2D55', '#FF6B8A'] as [string, string];

    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          { opacity: pressed || disabled ? 0.7 : 1, alignSelf: fullWidth ? 'stretch' : 'auto' },
          style,
        ]}
      >
        <LinearGradient
          colors={disabled ? ['#333', '#333'] : colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.base, { height, paddingHorizontal: px }]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              {icon}
              <Text style={[styles.labelGradient, { fontSize }]}>{label}</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>
    );
  }

  const outlineColors = {
    outline: { border: Colors.primary, text: Colors.primary, bg: 'transparent' },
    ghost: { border: 'transparent', text: Colors.textSecondary, bg: 'transparent' },
    danger: { border: Colors.error, text: Colors.error, bg: Colors.secondaryDim },
  };
  const c = outlineColors[variant as 'outline' | 'ghost' | 'danger'];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          paddingHorizontal: px,
          borderColor: c.border,
          borderWidth: variant === 'outline' ? 1 : 0,
          backgroundColor: c.bg,
          opacity: pressed || disabled ? 0.7 : 1,
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={Colors.primary} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[styles.label, { fontSize, color: c.text }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    gap: Spacing.sm,
  },
  label: {
    fontWeight: FontWeight.semibold,
  },
  labelGradient: {
    color: '#FFFFFF',
    fontWeight: FontWeight.semibold,
  },
});
