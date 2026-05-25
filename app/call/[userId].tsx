import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, Vibration,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';

export default function CallScreen() {
  const { userId: partnerId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const [callState, setCallState] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [duration, setDuration] = useState(0);
  const [partnerName, setPartnerName] = useState('Usuario');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (partnerId) {
      supabase.from('user_profiles').select('username').eq('id', partnerId).single()
        .then(({ data }) => { if (data) setPartnerName(data.username || 'Usuario'); });
    }
    Vibration.vibrate([0, 1000, 1000, 1000, 1000, 1000]);
    const connectTimer = setTimeout(() => {
      setCallState('connected');
      Vibration.cancel();
    }, 3000);

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => {
      clearTimeout(connectTimer);
      pulse.stop();
      Vibration.cancel();
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
    Vibration.cancel();
    setCallState('ended');
    setTimeout(() => router.back(), 800);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={[styles.content, { paddingTop: insets.top + Spacing.xxl }]}>
        {/* Avatar rings */}
        <Animated.View style={[styles.ring3, { transform: [{ scale: callState === 'ringing' ? pulseAnim : 1 }] }]} />
        <View style={styles.ring2} />
        <View style={styles.ring1}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{partnerName.charAt(0).toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.partnerName}>@{partnerName}</Text>
        <Text style={styles.callStatus}>
          {callState === 'ringing' ? '🔔 Llamando...' :
           callState === 'connected' ? formatDuration(duration) :
           'Llamada finalizada'}
        </Text>
      </View>

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.controlRow}>
          <View style={styles.controlGroup}>
            <Pressable
              style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
              onPress={() => setIsMuted(m => !m)}
            >
              <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={26} color={isMuted ? '#000' : '#fff'} />
            </Pressable>
            <Text style={styles.controlLabel}>{isMuted ? 'Activar' : 'Silenciar'}</Text>
          </View>

          <View style={styles.controlGroup}>
            <Pressable style={styles.endCallBtn} onPress={handleEndCall}>
              <MaterialIcons name="call-end" size={32} color="#fff" />
            </Pressable>
            <Text style={styles.controlLabel}>Terminar</Text>
          </View>

          <View style={styles.controlGroup}>
            <Pressable
              style={[styles.controlBtn, isSpeaker && styles.controlBtnActive]}
              onPress={() => setIsSpeaker(s => !s)}
            >
              <MaterialIcons name={isSpeaker ? 'volume-up' : 'volume-down'} size={26} color={isSpeaker ? '#000' : '#fff'} />
            </Pressable>
            <Text style={styles.controlLabel}>{isSpeaker ? 'Altavoz' : 'Auricular'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080814' },
  content: { flex: 1, alignItems: 'center', gap: Spacing.lg },
  ring3: {
    position: 'absolute',
    width: 220, height: 220, borderRadius: 110,
    borderWidth: 1, borderColor: Colors.primary + '22',
    top: '15%', alignSelf: 'center',
  },
  ring2: {
    position: 'absolute',
    width: 170, height: 170, borderRadius: 85,
    borderWidth: 1, borderColor: Colors.primary + '44',
    top: '15%', marginTop: 25, alignSelf: 'center',
  },
  ring1: {
    width: 130, height: 130, borderRadius: 65,
    borderWidth: 2, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.xxl,
  },
  avatarCircle: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: Colors.primary, fontSize: 48, fontWeight: FontWeight.bold },
  partnerName: {
    color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold, marginTop: Spacing.xl,
  },
  callStatus: { color: Colors.textSecondary, fontSize: FontSize.lg },
  controls: {
    paddingHorizontal: Spacing.xl, gap: Spacing.lg,
  },
  controlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  controlGroup: { alignItems: 'center', gap: Spacing.xs, width: 80 },
  controlBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  endCallBtn: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: Colors.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  controlLabel: { color: Colors.textSubtle, fontSize: 11 },
});
