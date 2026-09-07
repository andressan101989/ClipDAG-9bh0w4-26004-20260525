import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import type { ChatDeliveryStatus } from '@/services/chatContract';

export function MessageDeliveryIndicator({ status = 'sent', onRetry }: { status?: ChatDeliveryStatus; onRetry?: () => void }) {
  if (status === 'failed') {
    return <Pressable accessibilityRole="button" accessibilityLabel="Reintentar mensaje" hitSlop={8}
      onPress={onRetry} style={styles.hit}>
      <MaterialCommunityIcons name="reload" size={18} color="#9298AD" />
    </Pressable>;
  }
  return <MaterialCommunityIcons
    accessibilityLabel={status === 'pending' ? 'Pendiente' : status === 'sent' ? 'Enviado' : status === 'delivered' ? 'Entregado' : 'Leído'}
    name={status === 'pending' ? 'clock-outline' : status === 'sent' ? 'check' : 'check-all'} size={14}
    color={status === 'read' ? '#5EDCFF' : Colors.textSubtle}
  />;
}

const styles = StyleSheet.create({
  hit: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#141827', borderWidth: 1, borderColor: '#23283A',
  },
});
