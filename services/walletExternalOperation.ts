import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'onspace.wallet.external_operation.v1';
const MAX_AGE_MS = 5 * 60 * 1000;
let pendingAt = 0;

export async function markWalletExternalOperation(): Promise<void> {
  pendingAt = Date.now();
  await AsyncStorage.setItem(KEY, String(pendingAt));
}

export async function consumeRecentWalletExternalOperation(): Promise<boolean> {
  const stored = Number(await AsyncStorage.getItem(KEY)) || pendingAt;
  pendingAt = 0;
  await AsyncStorage.removeItem(KEY);
  return stored > 0 && Date.now() - stored <= MAX_AGE_MS;
}

