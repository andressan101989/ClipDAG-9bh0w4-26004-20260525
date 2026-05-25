import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';

export default function VideoCallScreen() {
  const { userId: partnerId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const [callState, setCallState] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [duration, setDuration] = useState(0);
  const [partnerName, setPartnerName] = useState('Usuario');
  const [partnerAvatar, setPartnerAvatar] = useState('');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Fetch partner info
    if (partnerId) {
      supabase.from('user_profiles').select('username, avatar_url').eq('id', partnerId).single()
        .then(({ data }) => {
          if (data) {
            setPartnerName(data.username || 'Usuario');
            setPartnerAvatar(data.avatar_url || '');
          }
        });
    }
    // Simulate connecting after 2s
    const connectTimer = setTimeout(() => setCallState('connected'), 2000);

    // Pulse animation for ringing state
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();

    return () => {
      clearTimeout(connectTimer);
      pulse.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const handleEndCall = () => {
    setCallState('ended');
    setTimeout(() => router.back(), 1000);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Background gradient */}
      <View style={styles.bg} />

      {/* Partner info */}
      <View style={[styles.topArea, { paddingTop: insets.top + Spacing.lg }]}>
        <Animated.View style={[styles.avatarRing, { transform: [{ scale: callState === 'ringing' ? pulseAnim : 1 }] }]}>
          <View style={styles.avatarCircle}>
            {partnerAvatar ? (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{partnerName.charAt(0).toUpperCase()}</Text>
              </View>
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{partnerName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
        </Animated.View>

        <Text style={styles.partnerName}>@{partnerName}</Text>
        <Text style={styles.callStatus}>
          {callState === 'ringing' ? 'Conectando...' :
           callState === 'connected' ? formatDuration(duration) :
           'Llamada terminada'}
        </Text>

        {callState === 'connected' ? (
          <View style={styles.qualityRow}>
            <MaterialIcons name="signal-cellular-alt" size={14} color={Colors.accent} />
            <Text style={styles.qualityText}>HD • Encriptado</Text>
          </View>
        ) : null}
      </View>

      {/* Local camera preview (simulated) */}
      {callState === 'connected' && !isCameraOff ? (
        <View style={styles.localPreview}>
          <View style={styles.localPreviewInner}>
            <MaterialIcons name="person" size={28} color={Colors.textSubtle} />
          </View>
          <Text style={styles.localPreviewLabel}>Tú</Text>
        </View>
      ) : null}

      {/* Feature info banner */}
      <View style={styles.infoBanner}>
        <MaterialIcons name="info-outline" size={14} color={Colors.warning} />
        <Text style={styles.infoBannerText}>
          Videollamadas P2P — próximamente con WebRTC completo
        </Text>
      </View>

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.controlRow}>
          <Pressable
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
            onPress={() => setIsMuted(m => !m)}
          >
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={24} color={isMuted ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isMuted && { color: '#000' }]}>
              {isMuted ? 'Activar' : 'Silenciar'}
            </Text>
          </Pressable>

          <Pressable style={styles.endCallBtn} onPress={handleEndCall}>
            <MaterialIcons name="call-end" size={30} color="#fff" />
          </Pressable>

          <Pressable
            style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]}
            onPress={() => setIsCameraOff(c => !c)}
          >
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={24} color={isCameraOff ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isCameraOff && { color: '#000' }]}>
              {isCameraOff ? 'Activar' : 'Cámara'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.controlRow2}>
          <Pressable style={styles.controlBtnSm} onPress={() => setIsFrontCamera(f => !f)}>
            <MaterialIcons name="flip-camera-ios" size={20} color={Colors.textSecondary} />
            <Text style={styles.controlLabelSm}>Voltear</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A0A14',
  },
  topArea: { alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  avatarRing: {
    width: 130, height: 130, borderRadius: 65,
    borderWidth: 2, borderColor: Colors.primary + '55',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarCircle: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primary,
    overflow: 'hidden',
  },
  avatarFallback: {
    width: '100%', height: '100%',
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: Colors.primary, fontSize: 44, fontWeight: FontWeight.bold },
  partnerName: {
    color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold,
  },
  callStatus: { color: Colors.textSecondary, fontSize: FontSize.lg },
  qualityRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qualityText: { color: Colors.accent, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  localPreview: {
    position: 'absolute', top: 180, right: Spacing.lg,
    width: 90, height: 120,
    borderRadius: Radius.md, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  localPreviewInner: {
    flex: 1, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  localPreviewLabel: {
    position: 'absolute', bottom: 4, left: 0, right: 0,
    textAlign: 'center', color: '#fff', fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  infoBanner: {
    position: 'absolute', bottom: 180,
    left: Spacing.lg, right: Spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.warningDim, borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.warning + '33',
  },
  infoBannerText: { color: Colors.warning, fontSize: FontSize.xs, flex: 1, lineHeight: 16 },
  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', gap: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  controlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%',
  },
  controlRow2: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xl },
  controlBtn: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    gap: 4,
  },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  controlLabel: { color: Colors.textSecondary, fontSize: 11 },
  endCallBtn: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: Colors.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  controlBtnSm: {
    alignItems: 'center', gap: 4, paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  controlLabelSm: { color: Colors.textSubtle, fontSize: 11 },
});
