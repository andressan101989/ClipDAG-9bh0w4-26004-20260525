/**
 * Root push notification handler.
 *
 * Foreground notifications use the in-app banner, except incoming calls:
 * Realtime + IncomingCallModal remains the primary foreground experience.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, Animated, StyleSheet, Platform, AppState, Alert, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAgoraCallSignaling } from '@/contexts/AgoraCallContext';
import { useAuth } from '@/hooks/useAuth';
import { dismissPresentedCallNotifications } from '@/services/callNotificationService';
import { ensureMessageNotificationPermissionState } from '@/services/messageNotificationPermissionService';
import { syncCurrentCallDevice } from '@/services/callDeviceService';
import {
  isMessageChatCurrentlyVisible,
  setMessageNotificationAppState,
} from '@/services/messageNotificationPresentation';
import { getSupabaseClient, useAlert } from '@/template';

const NOTIFICATION_SETTINGS_PROMPT_PREFIX = 'onspace.message_notifications.settings_prompt';

Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const type = notification.request.content.data?.type;
    if (type === 'incoming_call') {
      return {
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    if (
      type === 'message' &&
      isMessageChatCurrentlyVisible({
        conversationId: typeof notification.request.content.data?.conversation_id === 'string'
          ? notification.request.content.data.conversation_id : null,
        senderId: typeof notification.request.content.data?.from_user_id === 'string'
          ? notification.request.content.data.from_user_id : null,
      })
    ) {
      return {
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    return {
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: true,
      shouldSetBadge: true,
    };
  },
});

interface BannerData {
  title: string;
  body: string;
  data: Record<string, string> | null;
}

type CallRow = {
  id: string;
  caller_id: string;
  callee_id: string | null;
  channel_name: string;
  status: string;
  call_type: string;
  expires_at: string | null;
  call_scope?: 'direct' | 'group';
  conversation_id?: string | null;
};

function toStringRecord(data: Notifications.NotificationContent['data']): Record<string, string> | null {
  if (!data) return null;
  const output: Record<string, string> = {};
  Object.entries(data).forEach(([key, value]) => {
    if (typeof value === 'string') output[key] = value;
  });
  return output;
}

function getIncomingCallId(data: Record<string, string> | null): string | null {
  const value = data?.call_id ?? data?.callId ?? null;
  return value && value.length > 0 ? value : null;
}

function isExpired(expiresAt: string | null | undefined): boolean {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
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
      if (data.conversation_type === 'group' && data.conversation_id) router.push(`/chat/group/${data.conversation_id}` as any);
      else if (data.from_user_id) router.push(`/chat/${data.from_user_id}` as any);
      break;
    case 'group_call':
      if (data.roomId) router.push(`/group-call/${data.roomId}` as any);
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, isAuthReady } = useAuth();
  const { showAlert } = useAlert();
  const { presentIncomingCall } = useAgoraCallSignaling();
  const [banner, setBanner] = useState<BannerData | null>(null);
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledResponsesRef = useRef<Set<string>>(new Set());
  const pendingMessageNavigationRef = useRef<Record<string, string> | null>(null);
  const permissionPromptCheckedRef = useRef(false);

  const hideBanner = useCallback(() => {
    if (dismissRef.current) clearTimeout(dismissRef.current);
    Animated.timing(slideAnim, {
      toValue: -120, duration: 250, useNativeDriver: true,
    }).start(() => setBanner(null));
  }, [slideAnim]);

  const showBanner = useCallback((data: BannerData) => {
    if (dismissRef.current) clearTimeout(dismissRef.current);
    setBanner(data);
    Animated.spring(slideAnim, {
      toValue: 0, useNativeDriver: true, speed: 14, bounciness: 4,
    }).start();
    dismissRef.current = setTimeout(() => hideBanner(), 4500);
  }, [hideBanner, slideAnim]);

  const handleIncomingCallTap = useCallback(async (callId: string) => {
    if (!user?.id) return;

    const supabase = getSupabaseClient();
    const { data: call, error } = await supabase
      .from('calls')
      .select('id, caller_id, callee_id, channel_name, status, call_type, expires_at, call_scope, conversation_id')
      .eq('id', callId)
      .maybeSingle<CallRow>();

    if (error || !call) {
      showAlert('Llamada', 'Esta llamada ya termino.');
      return;
    }

    if (call.call_scope === 'group') {
      if (call.status !== 'accepted' || !call.conversation_id) {
        showAlert('Llamada', 'Esta llamada ya termino.');
        return;
      }
      router.push({
        pathname: '/group-call/[roomId]',
        params: {
          roomId: call.id,
          conversationId: call.conversation_id,
          callType: call.call_type === 'audio' ? 'audio' : 'video',
          creatorId: call.caller_id,
        },
      } as any);
      return;
    }

    if (call.callee_id !== user.id) {
      showAlert('Llamada', 'Esta llamada ya termino.');
      return;
    }

    if (
      !['ringing', 'accepted'].includes(call.status) ||
      isExpired(call.expires_at) ||
      !['audio', 'video'].includes(call.call_type)
    ) {
      await dismissPresentedCallNotifications(call.id);
      showAlert('Llamada', 'Esta llamada ya termino.');
      return;
    }

    if (call.status !== 'ringing') {
      showAlert('Llamada', 'Esta llamada ya fue atendida.');
      return;
    }

    const { data: caller } = await supabase
      .from('public_user_profiles')
      .select('username, display_name, avatar_url')
      .eq('id', call.caller_id)
      .maybeSingle();

    presentIncomingCall({
      callId: call.id,
      callerId: call.caller_id,
      callerName: caller?.display_name || caller?.username || 'Usuario',
      callerAvatar: caller?.avatar_url || '',
      channelName: call.channel_name,
      callType: call.call_type === 'audio' ? 'audio' : 'video',
      expiresAt: call.expires_at ?? undefined,
    });
  }, [presentIncomingCall, router, showAlert, user?.id]);

  const navigateToMessage = useCallback(async (data: Record<string, string>) => {
    if (!user?.id) return;
    if (data.conversation_type === 'group' && data.conversation_id) {
      const { data: membership } = await getSupabaseClient().from('chat_conversation_members')
        .select('conversation_id').eq('conversation_id', data.conversation_id)
        .eq('user_id', user.id).eq('is_active', true).maybeSingle();
      if (!membership) {
        showAlert('Conversación no disponible', 'Ya no tienes acceso a este grupo.');
        router.replace('/(tabs)/messages' as any);
        return;
      }
    }
    navigateToNotification(router, data);
  }, [router, showAlert, user?.id]);

  const handleNotificationData = useCallback(async (
    notificationId: string,
    data: Record<string, string> | null,
  ) => {
    const dedupeKey = `${notificationId}:${getIncomingCallId(data) ?? data?.type ?? 'unknown'}`;
    if (handledResponsesRef.current.has(dedupeKey)) return;
    handledResponsesRef.current.add(dedupeKey);

    if (data?.type === 'incoming_call') {
      // Historical iOS Expo notifications must never bypass D4D ownership.
      // Android continues to use the existing Expo incoming-call flow.
      if (Platform.OS === 'ios') return;
      const callId = getIncomingCallId(data);
      if (callId && isAuthReady) await handleIncomingCallTap(callId);
      return;
    }

    if (data?.type === 'message') {
      if (!isAuthReady || !user?.id) {
        pendingMessageNavigationRef.current = data;
        return;
      }
      await navigateToMessage(data);
      return;
    }

    navigateToNotification(router, data);
  }, [handleIncomingCallTap, isAuthReady, navigateToMessage, router, user?.id]);

  useEffect(() => {
    setMessageNotificationAppState(AppState.currentState);
    const appStateSub = AppState.addEventListener('change', nextState => {
      setMessageNotificationAppState(nextState);
    });

    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      const receivedData = toStringRecord(notification.request.content.data);
      if (receivedData?.type === 'incoming_call') return;
      if (
        receivedData?.type === 'message' &&
        isMessageChatCurrentlyVisible({
          conversationId: receivedData.conversation_id,
          senderId: receivedData.from_user_id,
        })
      ) return;

      const { title, body, data } = notification.request.content;
      showBanner({
        title: title ?? '',
        body: body ?? '',
        data: toStringRecord(data),
      });
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const { data } = response.notification.request.content;
      handleNotificationData(
        response.notification.request.identifier,
        toStringRecord(data),
      ).catch(() => {});
    });

    Notifications.getLastNotificationResponseAsync().then(response => {
      if (!response) return;
      const { data } = response.notification.request.content;
      handleNotificationData(
        response.notification.request.identifier,
        toStringRecord(data),
      ).catch(() => {});
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
      appStateSub.remove();
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
  }, [handleNotificationData, showBanner]);

  useEffect(() => {
    if (!isAuthReady || !user?.id || !pendingMessageNavigationRef.current) return;
    const data = pendingMessageNavigationRef.current;
    pendingMessageNavigationRef.current = null;
    void navigateToMessage(data);
  }, [isAuthReady, navigateToMessage, user?.id]);

  useEffect(() => {
    if (!isAuthReady || !user?.id || permissionPromptCheckedRef.current) return;
    permissionPromptCheckedRef.current = true;

    const checkPermissions = async () => {
      const permission = await ensureMessageNotificationPermissionState();
      if (permission.canReceiveNotifications) {
        syncCurrentCallDevice({ force: true }).catch(() => {});
      }
      if (!permission.requiresSettings && !permission.isProvisional) return;

      const build = Application.nativeBuildVersion ?? 'unknown';
      const promptKey = `${NOTIFICATION_SETTINGS_PROMPT_PREFIX}.${build}`;
      if (await AsyncStorage.getItem(promptKey)) return;
      await AsyncStorage.setItem(promptKey, new Date().toISOString());

      Alert.alert(
        'Activa las notificaciones',
        permission.isProvisional
          ? 'Las notificaciones provisionales pueden llegar silenciosamente. Activa Pantalla bloqueada, Banners y Sonidos en Configuración.'
          : 'Para recibir mensajes cuando OnSpace esté cerrada o el iPhone esté bloqueado, activa Pantalla bloqueada, Banners y Sonidos en Configuración.',
        [
          { text: 'Ahora no', style: 'cancel' },
          {
            text: 'Abrir Configuración',
            onPress: () => { Linking.openSettings().catch(() => {}); },
          },
        ],
      );
    };

    checkPermissions().catch(() => {});
  }, [isAuthReady, user?.id]);

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
          if (banner.data?.type === 'message') void navigateToMessage(banner.data);
          else navigateToNotification(router, banner.data);
        }}
      >
        <View style={styles.iconWrap}>
          <MaterialIcons name="notifications" size={20} color={Colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.bannerTitle} numberOfLines={1}>{banner.title}</Text>
          <Text style={styles.bannerBody} numberOfLines={2}>{banner.body}</Text>
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
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconWrap: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(124,92,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  bannerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  bannerBody: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  closeBtn: { padding: 4 },
});
