import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, FontWeight, Spacing } from '@/constants/theme';
import { fetchChatMessageReceipts } from '@/services/chatService';
import type { ChatReceiptDetailRow } from '@/services/chatContract';

export function MessageReceiptSheet({ messageId, visible, onClose }: { messageId: string | null; visible: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ChatReceiptDetailRow[]>([]);
  useEffect(() => { if (!visible || !messageId) return; let active = true; void fetchChatMessageReceipts(messageId).then(value => { if (active) setRows(value); }); return () => { active = false; }; }, [messageId, visible]);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><Pressable style={styles.backdrop} onPress={onClose} /><View style={styles.sheet}><Text style={styles.title}>Información del mensaje</Text>{(['read','delivered','sent'] as const).map(status => <View key={status}><Text style={styles.section}>{status === 'read' ? 'Leído por' : status === 'delivered' ? 'Entregado a' : 'Pendiente'}</Text>{rows.filter(row => row.status === status).map(row => <Text key={row.user_id} style={styles.row}>@{row.username || 'usuario'}{row.read_at || row.delivered_at ? ` · ${new Date(row.read_at || row.delivered_at!).toLocaleString()}` : ''}</Text>)}</View>)}</View></Modal>;
}
const styles=StyleSheet.create({backdrop:{flex:1,backgroundColor:'rgba(0,0,0,.6)'},sheet:{backgroundColor:Colors.surfaceElevated,padding:Spacing.lg,gap:10},title:{color:Colors.textPrimary,fontWeight:FontWeight.bold,fontSize:18},section:{color:Colors.primary,fontWeight:FontWeight.bold,marginTop:8},row:{color:Colors.textSecondary,paddingVertical:5}});
