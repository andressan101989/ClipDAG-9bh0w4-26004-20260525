/**
 * components/feature/NotificationToast.tsx
 *
 * Top-of-screen banner shown when a new notification arrives in real time.
 * Rendered globally by NotificationsProvider (see contexts/NotificationsContext.tsx),
 * so it appears above whatever screen the user is currently on.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { AppNotification, NotificationType } from '@/contexts/NotificationsContext';

const NOTIF_CONFIG: Record<NotificationType, { icon: string; gradient: [string, string] }> = {
  like:         { icon: 'heart',          gradient: ['#FF2D78', '#FF6FA8'] },
  comment:      { icon: 'comment',        gradient: ['#7C5CFF', '#B44FFF'] },
  follow:       { icon: 'account-plus',   gradient: ['#00E5A0', '#2D9EFF'] },
  gift:         { icon: 'gift',           gradient: ['#FFB800', '#FF8800'] },
  message:      { icon: 'message-text',   gradient: ['#2D9EFF', '#7C5CFF'] },
  sale:         { icon: 'shopping',       gradient: ['#00E5A0', '#2D9EFF'] },
  order_update: { icon: 'truck-delivery', gradient: ['#2D9EFF', '#7C5CFF'] },
};

const AUTO_DISMISS_MS = 4000;

interface NotificationToastProps {
  notification: AppNotification | null;
  onDismiss: () => void;
  onPress: () => void;
}

export function NotificationToast({ notification, onDismiss, onPress }: NotificationToastProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-140)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!notification) return;

    Animated.spring(translateY, {
      toValue: 0, useNativeDriver: true, damping: 16, mass: 0.9, stiffness: 180,
    }).start();

    dismissTimer.current = setTimeout(() => hide(), AUTO_DISMISS_MS);
    return () => { if (dismissTimer.current) clearTimeout(dismissTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notification?.id]);

  const hide = () => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    Animated.timing(translateY, {
      toValue: -140, duration: 220, useNativeDriver: true,
    }).start(() => onDismiss());
  };

  if (!notification) return null;
  const conf = NOTIF_CONFIG[notification.type] || NOTIF_CONFIG.like;

  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 6, transform: [{ translateY }] }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={styles.card}
        onPress={() => { hide(); onPress(); }}
      >
        <LinearGradient colors={['rgba(20,20,28,0.97)', 'rgba(14,14,20,0.97)']} style={styles.cardGrad}>
          <View style={styles.avatarWrap}>
            <Avatar uri={notification.fromAvatar} username={notification.fromUsername} size={40} />
            <LinearGradient colors={conf.gradient} style={styles.iconBadge}>
              <MaterialCommunityIcons name={conf.icon as any} size={9} color="#fff" />
            </LinearGradient>
          </View>
          <View style={styles.content}>
            <Text style={styles.text} numberOfLines={2}>
              <Text style={styles.username}>@{notification.fromUsername} </Text>
              {notification.message}
            </Text>
          </View>
          <Pressable onPress={hide} hitSlop={10} style={styles.closeBtn}>
            <MaterialCommunityIcons name="close" size={16} color={Colors.textSubtle} />
          </Pressable>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 999, elevation: 20,
  },
  card: {
    borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12,
  },
  cardGrad: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm,
  },
  avatarWrap: { position: 'relative' },
  iconBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#141420',
  },
  content: { flex: 1 },
  text: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 18 },
  username: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  closeBtn: { padding: 4 },
});
