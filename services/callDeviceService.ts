import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { generateUUID } from '@/services/agoraService';
import { deactivateCallDevice, registerCallDevice } from '@/services/callSessionService';
import {
  ensureIosCallKitStarted,
  getIosVoipPushToken,
  onIosVoipTokenUpdated,
  stopIosVoipTokenListener,
} from '@/services/iosCallKitService';
import { getSupabaseClient } from '@/template';

const INSTALLATION_ID_KEY = 'onspace.call.installation_id';
const LAST_SYNC_KEY = 'onspace.call_device.last_sync_at';
const LAST_VOIP_SYNC_KEY = 'onspace.call_device.last_voip_sync_at';
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VOIP_SYNC_COOLDOWN_MS = 60 * 1000;
const CALLS_CHANNEL_ID = 'calls';

type DevicePushToken = Awaited<ReturnType<typeof Notifications.getDevicePushTokenAsync>>;
type CallDeviceSyncOptions = {
  force?: boolean;
  nativeTokenOverride?: DevicePushToken | null;
  voipTokenOverride?: string | null;
};

let syncDrainPromise: Promise<string | null> | null = null;
let pendingSyncOptions: CallDeviceSyncOptions | null = null;
let pushTokenSubscription: { remove: () => void } | null = null;
let appStateSubscription: { remove: () => void } | null = null;

function isSupportedPlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function warn(message: string, error?: unknown) {
  if (__DEV__) console.warn(message, error);
}

function debug(message: string, data?: Record<string, unknown>) {
  if (__DEV__) console.log(message, data ?? {});
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

async function shouldThrottleVoipSync(): Promise<boolean> {
  const lastSyncRaw = await getStored(LAST_VOIP_SYNC_KEY);
  const lastSync = lastSyncRaw ? Number(lastSyncRaw) : 0;
  return Number.isFinite(lastSync) && Date.now() - lastSync < VOIP_SYNC_COOLDOWN_MS;
}

function mergeSyncOptions(
  current: CallDeviceSyncOptions | null,
  incoming: CallDeviceSyncOptions
): CallDeviceSyncOptions {
  const merged: CallDeviceSyncOptions = {
    ...(current ?? {}),
    force: Boolean(current?.force || incoming.force),
  };
  if ('nativeTokenOverride' in incoming) {
    merged.nativeTokenOverride = incoming.nativeTokenOverride;
  }
  if ('voipTokenOverride' in incoming) {
    merged.voipTokenOverride = incoming.voipTokenOverride;
  }
  return merged;
}

async function drainSyncQueue(): Promise<string | null> {
  let lastResult: string | null = null;

  while (pendingSyncOptions) {
    const options = pendingSyncOptions;
    pendingSyncOptions = null;
    lastResult = await runSingleCallDeviceSync(options);
  }

  return lastResult;
}

function startSyncDrain(): Promise<string | null> {
  syncDrainPromise = drainSyncQueue().finally(async () => {
    if (pendingSyncOptions) {
      debug('[CallDevice] sync drain restarting for pending request');
      await startSyncDrain();
      return;
    }
    syncDrainPromise = null;
  });
  return syncDrainPromise;
}

export async function syncCurrentCallDevice(options: CallDeviceSyncOptions = {}): Promise<string | null> {
  if (!isSupportedPlatform() || Platform.OS === 'web') return null;
  pendingSyncOptions = mergeSyncOptions(pendingSyncOptions, options);

  if (syncDrainPromise) {
    debug('[CallDevice] sync queued behind active request', {
      force: Boolean(options.force),
      hasNativeTokenOverride: Boolean(options.nativeTokenOverride),
      hasVoipTokenOverride: Boolean(normalizeToken(options.voipTokenOverride)),
    });
    return syncDrainPromise;
  }

  return startSyncDrain();
}

async function runSingleCallDeviceSync(options: CallDeviceSyncOptions = {}): Promise<string | null> {
    try {
      const voipOverride = normalizeToken(options.voipTokenOverride);
      const hasVoipOverride = Boolean(voipOverride);
      debug('[CallDevice] sync requested', {
        platform: Platform.OS,
        force: Boolean(options.force),
        hasNativeTokenOverride: Boolean(options.nativeTokenOverride),
        hasVoipTokenOverride: hasVoipOverride,
      });
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      if (await shouldThrottle(Boolean(options.force || options.nativeTokenOverride || hasVoipOverride))) {
        debug('[CallDevice] sync throttled');
        return null;
      }

      await configureCallsChannel();

      const installationId = await getOrCreateInstallationId();
      const hasPermission = hasVoipOverride ? false : await getNotificationPermission();
      const nativeToken = hasPermission
        ? options.nativeTokenOverride ?? await getNativePushToken()
        : null;
      const nativePushToken = normalizeToken(nativeToken?.data);
      const expoPushToken = hasPermission ? await getExpoPushToken(nativeToken) : null;
      // IOS-A: register_call_device() does `coalesce(excluded.voip_push_token,
      // call_devices.voip_push_token)` on conflict, so passing null here
      // (Android, web, or an iOS build without the native module compiled
      // in yet) never wipes out an existing remote value.
      const voipPushToken = Platform.OS === 'ios'
        ? voipOverride ?? await getIosVoipPushToken()
        : null;
      debug('[CallDevice] register_call_device payload', {
        platform: Platform.OS,
        hasExpoPushToken: Boolean(expoPushToken),
        hasNativePushToken: Boolean(nativePushToken),
        hasVoipPushToken: Boolean(voipPushToken),
        voipTokenLength: voipPushToken?.length ?? 0,
      });

      const deviceId = await registerCallDevice({
        installationId,
        platform: Platform.OS as 'ios' | 'android',
        expoPushToken,
        nativePushToken,
        voipPushToken,
        appVersion: getAppVersion(),
        deviceModel: getDeviceModel(),
      });

      await setStored(LAST_SYNC_KEY, String(Date.now()));
      await setStored(`onspace.call_device.${user.id}.device_id`, deviceId);
      if (expoPushToken) await setStored(`onspace.call_device.${user.id}.expo_push_token`, expoPushToken);
      if (nativePushToken) await setStored(`onspace.call_device.${user.id}.native_push_token`, nativePushToken);
      if (voipPushToken) await setStored(LAST_VOIP_SYNC_KEY, String(Date.now()));
      debug('[CallDevice] sync success', { hasDeviceId: Boolean(deviceId) });
      return deviceId;
    } catch (error) {
      warn('[CallDevice] sync failed', error);
      return null;
    }
}

export function startCallDeviceTokenListeners(): void {
  if (!isSupportedPlatform() || Platform.OS === 'web') return;

  if (Platform.OS === 'ios') {
    debug('[CallDevice] starting iOS CallKit token listener');
    onIosVoipTokenUpdated(token => {
      debug('[CallDevice] voip token update requested forced sync');
      syncCurrentCallDevice({ force: true, voipTokenOverride: token }).catch(() => {});
    });
    ensureIosCallKitStarted();
    getIosVoipPushToken()
      .then(token => {
        if (token) {
          debug('[CallDevice] persisted voip token requested forced sync', {
            present: true,
            length: token.length,
          });
          syncCurrentCallDevice({ force: true, voipTokenOverride: token }).catch(() => {});
        }
      })
      .catch(() => {});
  }

  if (!pushTokenSubscription) {
    pushTokenSubscription = Notifications.addPushTokenListener(token => {
      debug('[CallDevice] native push token listener requested forced sync');
      syncCurrentCallDevice({ force: true, nativeTokenOverride: token }).catch(() => {});
    });
  }

  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        debug('[CallDevice] app active requested sync');
        if (Platform.OS === 'ios') {
          getIosVoipPushToken()
            .then(async token => {
              if (token && !(await shouldThrottleVoipSync())) {
                syncCurrentCallDevice({ force: true, voipTokenOverride: token }).catch(() => {});
                return;
              }
              syncCurrentCallDevice().catch(() => {});
            })
            .catch(() => {
              syncCurrentCallDevice().catch(() => {});
            });
          return;
        }
        syncCurrentCallDevice().catch(() => {});
      }
    });
  }
}

export function stopCallDeviceTokenListeners(): void {
  debug('[CallDevice] stopping token listeners');
  pushTokenSubscription?.remove();
  pushTokenSubscription = null;
  appStateSubscription?.remove();
  appStateSubscription = null;
  stopIosVoipTokenListener();
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
