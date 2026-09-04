import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  findNodeHandle,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { getHostInviteRemainingSeconds } from '@/components/live/liveHostInvitationContract';

export type LiveHostInvitationVisualState = 'idle' | 'accepting' | 'rejecting';

type LiveHostInvitationCardProps = {
  visible: boolean;
  expiresAt: number | null;
  action: LiveHostInvitationVisualState;
  reducedMotion: boolean;
  onAccept: () => void;
  onReject: () => void;
  onExpire: () => void;
  returnFocusRef?: React.RefObject<unknown>;
};

function focusAccessibilityTarget(target: unknown) {
  const node = findNodeHandle(target as never);
  if (node) AccessibilityInfo.setAccessibilityFocus(node);
}

export function LiveHostInvitationCard({
  visible,
  expiresAt,
  action,
  reducedMotion,
  onAccept,
  onReject,
  onExpire,
  returnFocusRef,
}: LiveHostInvitationCardProps) {
  const titleRef = useRef<Text | null>(null);
  const previousVisibleRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const [secondsRemaining, setSecondsRemaining] = useState(0);

  useEffect(() => {
    if (!visible || expiresAt === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const update = () => {
      if (!active) return;
      const remaining = getHostInviteRemainingSeconds(expiresAt);
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        onExpire();
        return;
      }
      timer = setTimeout(update, Math.min(1_000, Math.max(100, expiresAt - Date.now())));
    };
    update();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [expiresAt, onExpire, visible]);

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    if (visible) {
      previousVisibleRef.current = true;
      opacity.setValue(reducedMotion ? 1 : 0);
      scale.setValue(reducedMotion ? 1 : 0.96);
      if (!reducedMotion) {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
      }
      focusTimer = setTimeout(() => {
        AccessibilityInfo.announceForAccessibility(
          'El anfitrión te invita a unirte al LIVE. Participarás con cámara y micrófono.',
        );
        focusAccessibilityTarget(titleRef.current);
      }, reducedMotion ? 40 : 200);
    } else if (previousVisibleRef.current) {
      previousVisibleRef.current = false;
      focusTimer = setTimeout(() => focusAccessibilityTarget(returnFocusRef?.current), 40);
    }
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
      opacity.stopAnimation();
      scale.stopAnimation();
    };
  }, [opacity, reducedMotion, returnFocusRef, scale, visible]);

  const busy = action !== 'idle';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={() => { if (!busy) onReject(); }}
    >
      <View
        style={styles.backdrop}
        accessibilityViewIsModal
        accessibilityLiveRegion="assertive"
        importantForAccessibility="yes"
      >
        <Animated.View style={[styles.card, { opacity, transform: [{ scale }] }]}>
          <View style={styles.badge} accessibilityElementsHidden>
            <MaterialIcons name="videocam" size={14} color="#FFF" />
            <Text style={styles.badgeText} maxFontSizeMultiplier={1.25}>SOLICITUD DEL ANFITRIÓN</Text>
          </View>
          <Text
            ref={titleRef}
            style={styles.title}
            accessible
            accessibilityRole="header"
            maxFontSizeMultiplier={1.3}
          >
            El anfitrión te invita{`\n`}a unirte al LIVE
          </Text>
          <Text style={styles.body} maxFontSizeMultiplier={1.35}>
            Participarás con cámara y micrófono. Puedes salir en cualquier momento.
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.button, styles.rejectButton, pressed && !busy && styles.pressed, busy && styles.disabled]}
              onPress={onReject}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Rechazar invitación del anfitrión"
              accessibilityHint="Cierra la invitación y continúa viendo el LIVE"
              accessibilityState={{ disabled: busy, busy: action === 'rejecting' }}
            >
              {action === 'rejecting' ? <ActivityIndicator size="small" color="#FFF" /> : null}
              <Text style={styles.buttonText} maxFontSizeMultiplier={1.2}>Rechazar</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.button, styles.acceptButton, pressed && !busy && styles.pressed, busy && styles.disabled]}
              onPress={onAccept}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Aceptar invitación del anfitrión"
              accessibilityHint="Activa cámara y micrófono para unirte al LIVE"
              accessibilityState={{ disabled: busy, busy: action === 'accepting' }}
            >
              {action === 'accepting' ? <ActivityIndicator size="small" color="#FFF" /> : null}
              <Text style={styles.buttonText} maxFontSizeMultiplier={1.2}>Aceptar</Text>
            </Pressable>
          </View>
          <Text style={styles.countdown} accessibilityLabel={`La invitación vence en ${secondsRemaining} segundos`}>
            La invitación vence en {secondsRemaining} s
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(3,3,5,0.54)',
  },
  card: {
    width: '100%',
    maxWidth: 342,
    minHeight: 282,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 22,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(19,22,33,0.97)',
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 24,
  },
  badge: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(125,59,237,0.28)',
  },
  badgeText: { color: '#DCCBFF', fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0.55 },
  title: { marginTop: 15, color: '#FFF', fontSize: 24, lineHeight: 29, fontWeight: '800', textAlign: 'center' },
  body: { marginTop: 10, maxWidth: 286, color: 'rgba(255,255,255,0.74)', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  actions: { width: '100%', flexDirection: 'row', gap: 12, marginTop: 20 },
  button: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 16 },
  rejectButton: { backgroundColor: '#1F212E', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  acceptButton: { backgroundColor: '#7D3BED' },
  buttonText: { color: '#FFF', fontSize: 15, lineHeight: 19, fontWeight: '800' },
  countdown: { marginTop: 13, color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.88 },
  disabled: { opacity: 0.58 },
});
