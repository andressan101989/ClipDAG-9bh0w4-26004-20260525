/**
 * components/feature/IncomingCallModal.tsx
 *
 * Global incoming-call UI — mounted once in app/_layout.tsx so it can pop up
 * over any screen regardless of where the callee currently is in the app.
 * Purely presentational: all signaling (Realtime subscription, the calls
 * table, the 30s ring timeout) lives in AgoraCallContext.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAgoraCallSignaling } from '@/contexts/AgoraCallContext';

export function IncomingCallModal() {
  const { incomingCall, acceptIncomingCall, rejectIncomingCall } = useAgoraCallSignaling();

  return (
    <Modal visible={!!incomingCall} transparent animationType="fade" statusBarTranslucent>
      {incomingCall ? (
        <View style={styles.overlay}>
          <LinearGradient colors={['#18181F', '#0A0A0F']} style={styles.card}>
            <View style={styles.avatarRing}>
              {incomingCall.callerAvatar ? (
                <Image source={{ uri: incomingCall.callerAvatar }} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <Text style={styles.avatarInitial}>
                  {(incomingCall.callerName || 'U').charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <Text style={styles.callerName}>@{incomingCall.callerName}</Text>
            <Text style={styles.subtitle}>Videollamada entrante...</Text>
            <View style={styles.actionsRow}>
              <View style={styles.actionCol}>
                <Pressable style={[styles.actionBtn, styles.rejectBtn]} onPress={rejectIncomingCall}>
                  <MaterialIcons name="call-end" size={26} color="#fff" />
                </Pressable>
                <Text style={styles.actionLabel}>Rechazar</Text>
              </View>
              <View style={styles.actionCol}>
                <Pressable style={[styles.actionBtn, styles.acceptBtn]} onPress={acceptIncomingCall}>
                  <MaterialIcons name="videocam" size={26} color="#fff" />
                </Pressable>
                <Text style={styles.actionLabel}>Aceptar</Text>
              </View>
            </View>
          </LinearGradient>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xl,
  },
  card: {
    width: '100%', maxWidth: 340, borderRadius: Radius.xl, padding: Spacing.xl,
    alignItems: 'center', gap: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  avatarRing: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated,
    overflow: 'hidden',
  },
  avatarImg:     { width: 84, height: 84, borderRadius: 42 },
  avatarInitial: { color: Colors.primary, fontSize: 32, fontWeight: FontWeight.bold },
  callerName:    { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  subtitle:      { color: Colors.textSecondary, fontSize: FontSize.sm },
  actionsRow:    { flexDirection: 'row', gap: Spacing.xxl, marginTop: Spacing.md },
  actionCol:     { alignItems: 'center', gap: Spacing.xs },
  actionBtn:     { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  rejectBtn:     { backgroundColor: Colors.secondary },
  acceptBtn:     { backgroundColor: Colors.accent },
  actionLabel:   { color: Colors.textSubtle, fontSize: FontSize.xs },
});
