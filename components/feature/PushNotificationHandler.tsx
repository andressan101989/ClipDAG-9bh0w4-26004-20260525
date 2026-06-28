/**
 * components/feature/PushNotificationHandler.tsx
 *
 * Handles push notifications at the root level:
 *   - Foreground: shows an in-app slide-down banner (instead of system alert)
 *   - Background/killed: navigates to the relevant screen when notification is tapped
 *
 * Mount once inside AppShell (app/_layout.tsx), after the Stack.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Animated, StyleSheet, Platform,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

interface BannerData {
  title: string;
  body:  string;
  data:  Record<string, string> | null;
}

function navigateToNotification(
  router: ReturnType<typeof useRouter>,
  data: Record<string, string> | null,
) {
  if (!data?.type) return;
  switch (data.type) {
    case 'follow':
      if (data.from_user_id) router.push(`/creator/${data.from_user_id}` as any);
      break;
    case 'message':
      if (data.from_user_id) router.push(`/chat/${data.from_user_id}` as any);
      break;
    case 'like':
    case 'comment':
      router.push('/(tabs)' as any);
      break;
    case 'tip':
      router.push('/(tabs)/notifications' as any);
      break;
    default:
      router.push('/(tabs)/notifications' as any);
  }
}

export function PushNotificationHandler() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const [banner, setBanner] = useState<BannerData | null>(null);
  const slideAnim   = useRef(new Animated.Value(-120)).current;
  const dismissRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = (b: BannerData) => {
    if (dismissRef.current) clearTimeout(dismissRef.current);
    setBanner(b);
    Animated.spring(slideAnim, {
      toValue: 0, useNativeDriver: true, speed: 14, bounciness: 4,
    }).start();
    dismissRef.current = setTimeout(() => hideBanner(), 4500);
  };

  const hideBanner = () => {
    if (dismissRef.current) clearTimeout(dismissRef.current);
    Animated.timing(slideAnim, {
      toValue: -120, duration: 250, useNativeDriver: true,
    }).start(() => setBanner(null));
  };

  useEffect(() => {
    // Foreground notifications → show in-app banner
    const receivedSub = Notifications.addNotificationReceivedListener(notif => {
      const { title, body, data } = notif.request.content;
      showBanner({
        title: title ?? '',
        body:  body  ?? '',
        data:  (data as Record<string, string>) ?? null,
      });
    });

    // Tap on notification (app in background or killed)
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const { data } = response.notification.request.content;
      navigateToNotification(router, (data as Record<string, string>) ?? null);
    });

    // App opened from killed state — handle the last tapped notification
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) {
        const { data } = response.notification.request.content;
        navigateToNotification(router, (data as Record<string, string>) ?? null);
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
  }, []);

  if (!banner) return null;

  const topOffset = insets.top + (Platform.OS === 'android' ? 8 : 4);

  return (
    <Animated.View
      style={[
        styles.bannerContainer,
        { top: topOffset, transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        style={styles.banner}
        onPress={() => {
          hideBanner();
          navigateToNotification(router, banner.data);
        }}
      >
        <View style={styles.iconWrap}>
          <MaterialIcons name="notifications" size={20} color={Colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.bannerTitle} numberOfLines={1}>{banner.title}</Text>
          <Text style={styles.bannerBody}  numberOfLines={2}>{banner.body}</Text>
        </View>
        <Pressable onPress={hideBanner} hitSlop={12} style={styles.closeBtn}>
          <MaterialIcons name="close" size={16} color={Colors.textSubtle} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    position: 'absolute',
    left:  Spacing.md,
    right: Spacing.md,
    zIndex: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems:    'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius:  Radius.lg,
    padding:       Spacing.md,
    gap:           Spacing.sm,
    borderWidth:   1,
    borderColor:   Colors.border,
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius:  8,
    elevation:     8,
  },
  iconWrap: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  bannerTitle: {
    color:      Colors.textPrimary,
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  bannerBody: {
    color:     Colors.textSecondary,
    fontSize:  FontSize.xs,
    marginTop: 2,
  },
  closeBtn: { padding: 4 },
});
