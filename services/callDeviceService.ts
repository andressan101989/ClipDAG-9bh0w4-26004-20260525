import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { generateUUID } from '@/services/agoraService';
import { deactivateCallDevice, registerCallDevice } from '@/services/callSessionService';
import { getSupabaseClient } from '@/template';

const INSTALLATION_ID_KEY = 'onspace.call.installation_id';
const LAST_SYNC_KEY = 'onspace.call_device.last_sync_at';
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CALLS_CHANNEL_ID = 'calls';

type DevicePushToken = Awaited<ReturnType<typeof Notifications.getDevicePushTokenAsync>>;

let syncPromise: Promise<string | null> | null = null;
let pushTokenSubscription: { remove: () => void } | null = null;
let appStateSubscription: { remove: () => void } | null = null;

function isSupportedPlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function warn(message: string, error?: unknown) {
  if (__DEV__) console.warn(message, error);
}

function getProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId
  ) as string | undefined;
}

function normalizeToken(token: unknown): string | null {
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null;
}

async function getStored(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setStored(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Storage failure is non-fatal; the next launch can regenerate/sync.
  }
}

async function deleteStored(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Non-fatal.
  }
}

export async function getOrCreateInstallationId(): Promise<string> {
  const existing = await getStored(INSTALLATION_ID_KEY);
  if (existing) return existing;

  const created = generateUUID();
  await setStored(INSTALLATION_ID_KEY, created);
  return created;
}

async function configureCallsChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(CALLS_CHANNEL_ID, {
    name: 'Llamadas',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 350, 250, 350],
    lightColor: '#7C5CFF',
    sound: 'default',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

async function getNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) return false;

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  if (existing.status === 'denied') return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

async function getExpoPushToken(nativeToken?: DevicePushToken | null): Promise<string | null> {
  const projectId = getProjectId();
  const token = await Notifications.getExpoPushTokenAsync({
    ...(projectId ? { projectId } : {}),
    ...(nativeToken ? { devicePushToken: nativeToken } : {}),
  });
  return normalizeToken(token.data);
}

async function getNativePushToken(): Promise<DevicePushToken | null> {
  try {
    return await Notifications.getDevicePushTokenAsync();
  } catch (error) {
    warn('[CallDevice] native push token unavailable', error);
    return null;
  }
}

function getDeviceModel(): string | null {
  const parts = [
    Device.manufacturer,
    Device.modelName,
    Device.osName,
    Device.osVersion,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function getAppVersion(): string | null {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
}

async function shouldThrottle(force: boolean): Promise<boolean> {
  if (force) return false;
  const lastSyncRaw = await getStored(LAST_SYNC_KEY);
  const lastSync = lastSyncRaw ? Number(lastSyncRaw) : 0;
  return Number.isFinite(lastSync) && Date.now() - lastSync < SYNC_INTERVAL_MS;
}

export async function syncCurrentCallDevice(options: {
  force?: boolean;
  nativeTokenOverride?: DevicePushToken | null;
} = {}): Promise<string | null> {
  if (!isSupportedPlatform() || Platform.OS === 'web') return null;
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      if (await shouldThrottle(Boolean(options.force || options.nativeTokenOverride))) {
        return null;
      }

      await configureCallsChannel();
      const hasPermission = await getNotificationPermission();
      if (!hasPermission) return null;

      const installationId = await getOrCreateInstallationId();
      const nativeToken = options.nativeTokenOverride ?? await getNativePushToken();
      const nativePushToken = normalizeToken(nativeToken?.data);
      const expoPushToken = await getExpoPushToken(nativeToken);

      const deviceId = await registerCallDevice({
        installationId,
        platform: Platform.OS as 'ios' | 'android',
        expoPushToken,
        nativePushToken,
        voipPushToken: null,
        appVersion: getAppVersion(),
        deviceModel: getDeviceModel(),
      });

      await setStored(LAST_SYNC_KEY, String(Date.now()));
      await setStored(`onspace.call_device.${user.id}.device_id`, deviceId);
      if (expoPushToken) await setStored(`onspace.call_device.${user.id}.expo_push_token`, expoPushToken);
      if (nativePushToken) await setStored(`onspace.call_device.${user.id}.native_push_token`, nativePushToken);
      return deviceId;
    } catch (error) {
      warn('[CallDevice] sync failed', error);
      return null;
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

export function startCallDeviceTokenListeners(): void {
  if (!isSupportedPlatform() || Platform.OS === 'web') return;

  if (!pushTokenSubscription) {
    pushTokenSubscription = Notifications.addPushTokenListener(token => {
      syncCurrentCallDevice({ force: true, nativeTokenOverride: token }).catch(() => {});
    });
  }

  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        syncCurrentCallDevice().catch(() => {});
      }
    });
  }
}

export function stopCallDeviceTokenListeners(): void {
  pushTokenSubscription?.remove();
  pushTokenSubscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
}

export async function getCurrentCallDeviceId(): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return null;
    return await getStored(`onspace.call_device.${user.id}.device_id`);
  } catch {
    return null;
  }
}

export async function deactivateCurrentCallDevice(): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    const installationId = await getStored(INSTALLATION_ID_KEY);
    if (!installationId) return;

    await deactivateCallDevice(installationId);

    if (user?.id) {
      await deleteStored(`onspace.call_device.${user.id}.device_id`);
      await deleteStored(`onspace.call_device.${user.id}.expo_push_token`);
      await deleteStored(`onspace.call_device.${user.id}.native_push_token`);
    }
    await deleteStored(LAST_SYNC_KEY);
  } catch (error) {
    warn('[CallDevice] deactivate failed', error);
  }
}
