/**
 * services/pushNotifications.ts
 *
 * Client-side push notification helpers:
 *   registerForPushNotifications() — request permission + get Expo Push Token
 *   savePushToken()                — persist token to user_profiles
 *   sendPushNotification()         — fire-and-forget call to send-notification edge function
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

// Set the foreground handler once at module load so it applies immediately.
// shouldShowAlert: false — we render our own in-app banner (PushNotificationHandler).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  // Push tokens only work on physical devices
  if (!Device.isDevice) return null;

  // Android needs a notification channel before requesting the token
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name:              'Default',
      importance:        Notifications.AndroidImportance.MAX,
      vibrationPattern:  [0, 250, 250, 250],
      lightColor:        '#7C5CFF',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return token;
  } catch (e) {
    console.warn('[Push] getExpoPushTokenAsync error:', e);
    return null;
  }
}

export async function savePushToken(
  supabase: any,
  userId: string,
  token: string,
): Promise<void> {
  try {
    await supabase
      .from('user_profiles')
      .update({ push_token: token })
      .eq('id', userId);
  } catch (e) {
    console.warn('[Push] savePushToken error:', e);
  }
}

export async function sendPushNotification(
  supabase: any,
  toUserId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey     = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey || !supabase) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    // Fire and forget — notification failure must never block the main action
    fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey':        anonKey,
      },
      body: JSON.stringify({ to_user_id: toUserId, title, body, data }),
    }).catch(() => {});
  } catch {
    // non-critical
  }
}
