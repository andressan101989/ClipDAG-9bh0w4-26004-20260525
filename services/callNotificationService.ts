import * as Notifications from 'expo-notifications';
import { getSupabaseClient } from '@/template';

export type CallNotificationEventType = 'incoming_call' | 'call_cancelled' | 'call_ended';

export async function sendCallNotification(
  callId: string,
  eventType: CallNotificationEventType,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.functions.invoke('send-call-notification', {
    body: {
      call_id: callId,
      event_type: eventType,
    },
  });
  if (error) throw new Error(error.message || 'No se pudo enviar notificacion de llamada');
}

function getCallIdFromNotification(notification: Notifications.Notification): string | null {
  const data = notification.request.content.data ?? {};
  const value = data.call_id ?? data.callId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function dismissPresentedCallNotifications(callId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter(notification => getCallIdFromNotification(notification) === callId)
        .map(notification => Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {})),
    );
  } catch {
    // Dismissal is best-effort and should never affect call state.
  }
}
