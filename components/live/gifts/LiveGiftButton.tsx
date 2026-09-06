import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

type LiveGiftButtonProps = {
  onPress: () => void;
  disabled?: boolean;
};

export function LiveGiftButton({ onPress, disabled = false }: LiveGiftButtonProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Abrir regalos"
      accessibilityHint="Abre el selector de regalos"
      accessibilityState={{ disabled }}
    >
      <MaterialIcons name="card-giftcard" size={20} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  pressed: { transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.45 },
});
