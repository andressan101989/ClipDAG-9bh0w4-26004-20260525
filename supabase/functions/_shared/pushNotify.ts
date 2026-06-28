/**
 * _shared/pushNotify.ts
 *
 * Shared Deno helper for sending Expo push notifications from edge functions.
 * Looks up push_token from user_profiles, then POSTs to Expo Push API.
 * Non-blocking — errors are logged and swallowed so callers never fail.
 */

export async function sendPushToUser(
  admin: any,
  toUserId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  try {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('push_token')
      .eq('id', toUserId)
      .maybeSingle();

    const token: string | null = profile?.push_token ?? null;
    if (!token || !token.startsWith('ExponentPushToken')) return;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to:    token,
        title,
        body,
        data:  data ?? {},
        sound: 'default',
      }),
    });
  } catch (e: any) {
    console.warn('[pushNotify] sendPushToUser error:', e?.message);
  }
}
