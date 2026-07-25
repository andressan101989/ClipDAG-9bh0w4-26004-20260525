import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type MessageNotificationPermissionState = {
  canReceiveNotifications: boolean;
  canShowAlerts: boolean;
  canPlaySounds: boolean;
  canSetBadge: boolean;
  canShowInNotificationCenter: boolean;
  canShowOnLockScreen: boolean;
  authorizationStatus: string;
  isProvisional: boolean;
  requiresSettings: boolean;
};

export function normalizeMessageNotificationPermissions(
  permissions: Notifications.NotificationPermissionsStatus,
): MessageNotificationPermissionState {
  if (Platform.OS !== 'ios') {
    const granted = permissions.status === 'granted';
    return {
      canReceiveNotifications: granted,
      canShowAlerts: granted,
      canPlaySounds: granted,
      canSetBadge: granted,
      canShowInNotificationCenter: granted,
      canShowOnLockScreen: granted,
      authorizationStatus: permissions.status,
      isProvisional: false,
      requiresSettings: permissions.status === 'denied',
    };
  }

  const iosStatus = permissions.ios?.status;
  const authorized = iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED;
  const provisional = iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const ephemeral = iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL;
  const canReceive = authorized || provisional || ephemeral;
  const canShowAlerts = permissions.ios?.allowsAlert === true;
  const canPlaySounds = permissions.ios?.allowsSound === true;
  const canSetBadge = permissions.ios?.allowsBadge === true;
  const canShowInNotificationCenter =
    permissions.ios?.allowsDisplayInNotificationCenter === true;
  const canShowOnLockScreen = permissions.ios?.allowsDisplayOnLockScreen === true;

  return {
    canReceiveNotifications: canReceive,
    canShowAlerts,
    canPlaySounds,
    canSetBadge,
    canShowInNotificationCenter,
    canShowOnLockScreen,
    authorizationStatus: Notifications.IosAuthorizationStatus[iosStatus ?? 0] ?? 'UNKNOWN',
    isProvisional: provisional,
    requiresSettings:
      iosStatus === Notifications.IosAuthorizationStatus.DENIED ||
      (canReceive && (
        !canShowAlerts ||
        !canPlaySounds ||
        !canSetBadge ||
        !canShowInNotificationCenter ||
        !canShowOnLockScreen
      )),
  };
}

export async function getMessageNotificationPermissionState():
Promise<MessageNotificationPermissionState> {
  return normalizeMessageNotificationPermissions(await Notifications.getPermissionsAsync());
}

export async function ensureMessageNotificationPermissionState():
Promise<MessageNotificationPermissionState> {
  const current = await Notifications.getPermissionsAsync();
  const notDetermined = Platform.OS === 'ios'
    ? current.ios?.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED
    : current.status === 'undetermined';
  if (!notDetermined) return normalizeMessageNotificationPermissions(current);

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
      allowBadge: true,
    },
  });
  return normalizeMessageNotificationPermissions(requested);
}
