import { NativeModules } from 'react-native';

const proxy = NativeModules.NativeUnimoduleProxy;
const metadata = proxy?.viewManagersMetadata?.DeepARTestView ?? null;

console.log('[DeepARTestView] NativeUnimoduleProxy exists:', !!proxy);
console.log('[DeepARTestView] viewManagersMetadata.DeepARTestView:', metadata);
console.log('[DeepARTestView] all viewManagersMetadata keys:', Object.keys(proxy?.viewManagersMetadata ?? {}));

export const DeepARTestViewRegistered = metadata !== null;
