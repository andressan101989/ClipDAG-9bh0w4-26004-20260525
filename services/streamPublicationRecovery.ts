import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY_PREFIX='clipdag:pending-stream-publication:v1:';

export interface PendingStreamPublicationRecovery {
  ownerId:string;
  assetId:string;
  operationId:string;
  caption:string;
  music:string;
  sourceFingerprint:string;
}

type StoredPendingStreamPublicationRecovery=PendingStreamPublicationRecovery;

function normalizeOwnerId(ownerId:string):string {
  const normalizedOwnerId=ownerId.trim();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(normalizedOwnerId)) {
    throw new Error('invalid_pending_stream_owner');
  }
  return normalizedOwnerId;
}

function storageKey(surface:string,ownerId:string):string {
  const normalizedOwnerId=normalizeOwnerId(ownerId);
  const normalizedSurface=surface.trim();
  if(!/^[a-z0-9-]{1,80}$/i.test(normalizedSurface)) {
    throw new Error('invalid_pending_stream_surface');
  }
  return `${KEY_PREFIX}${normalizedOwnerId}:${normalizedSurface}`;
}

export async function fingerprintStreamSourceIdentity(source:string):Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,source);
}

export async function loadPendingStreamPublication(
  surface:string,
  ownerId:string,
):Promise<PendingStreamPublicationRecovery|null> {
  const normalizedOwnerId=normalizeOwnerId(ownerId);
  const raw=await AsyncStorage.getItem(storageKey(surface,normalizedOwnerId));
  if(!raw) return null;
  const value=JSON.parse(raw) as Partial<StoredPendingStreamPublicationRecovery>;
  if(value.ownerId!==normalizedOwnerId) {
    throw new Error('pending_stream_owner_mismatch');
  }
  if(!value.assetId||!value.operationId||!value.caption||!value.music||!value.sourceFingerprint) {
    throw new Error('invalid_pending_stream_publication');
  }
  return value as StoredPendingStreamPublicationRecovery;
}

export async function savePendingStreamPublication(
  surface:string,
  ownerId:string,
  value:PendingStreamPublicationRecovery,
):Promise<void> {
  const normalizedOwnerId=normalizeOwnerId(ownerId);
  if(value.ownerId!==normalizedOwnerId) throw new Error('pending_stream_owner_mismatch');
  // Only a SHA-256 source identity is stored; local/provider URLs are excluded.
  await AsyncStorage.setItem(
    storageKey(surface,normalizedOwnerId),
    JSON.stringify(value satisfies StoredPendingStreamPublicationRecovery),
  );
}

export async function clearPendingStreamPublication(surface:string,ownerId:string):Promise<void> {
  await AsyncStorage.removeItem(storageKey(surface,ownerId));
}
