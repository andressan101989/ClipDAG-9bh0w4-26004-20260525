import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import type { ChatDeliveryStatus } from '@/services/chatContract';

export function MessageDeliveryIndicator({ status = 'sent', onRetry }: { status?: ChatDeliveryStatus; onRetry?: () => void }) {
  if (status === 'failed') {
    return <Pressable accessibilityRole="button" accessibilityLabel="Reintentar mensaje" hitSlop={8}
      onPress={onRetry} style={styles.hit}>
      <MaterialCommunityIcons name="alert-circle-outline" size={16} color={Colors.error} />
    </Pressable>;
  }
  return <MaterialCommunityIcons
    accessibilityLabel={status === 'pending' ? 'Pendiente' : status === 'sent' ? 'Enviado' : status === 'delivered' ? 'Entregado' : 'Leído'}
    name={status === 'pending' ? 'clock-outline' : status === 'sent' ? 'check' : 'check-all'} size={14}
    color={status === 'read' ? Colors.primaryLight : Colors.textSubtle}
  />;
}

const styles = StyleSheet.create({ hit: { padding: 2 } });
