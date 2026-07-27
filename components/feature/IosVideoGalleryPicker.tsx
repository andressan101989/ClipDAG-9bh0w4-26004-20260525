import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import { MaterialIcons } from '@expo/vector-icons';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import {
  iosVideoQuery,
  mergeUniqueAssets,
  resolveIosVideoAsset,
  type IosVideoResolutionCode,
  type IosVideoResolutionError,
  type ResolvedIosVideo,
} from '@/services/iosVideoGalleryService';

type Props = {
  visible: boolean;
  onClose: () => void;
  onFiles: () => void;
  onSelected: (video: ResolvedIosVideo) => void;
  onError: (code: IosVideoResolutionCode | 'permission_denied' | 'query_failed') => void;
};

function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function IosVideoGalleryPicker({
  visible,
  onClose,
  onFiles,
  onSelected,
  onError,
}: Props) {
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [endCursor, setEndCursor] = useState<string>();
  const [limited, setLimited] = useState(false);
  const [queryFailed, setQueryFailed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const selectionLockRef = useRef(false);
  const pageLockRef = useRef(false);

  const loadPage = useCallback(async (after?: string) => {
    if (pageLockRef.current) return;
    pageLockRef.current = true;
    if (after) setLoadingMore(true);
    else setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync(iosVideoQuery(after));
      setAssets(current => after ? mergeUniqueAssets(current, page.assets) : page.assets);
      setEndCursor(page.endCursor);
      setHasNextPage(page.hasNextPage);
      setQueryFailed(false);
    } catch {
      console.warn('[Upload] Media library video resolution failed', {
        stage: 'query',
        code: 'query_failed',
      });
      setQueryFailed(true);
      onError('query_failed');
    } finally {
      pageLockRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [onError]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setAssets([]);
    setEndCursor(undefined);
    setHasNextPage(false);
    setQueryFailed(false);
    void (async () => {
      try {
        if (!await MediaLibrary.isAvailableAsync()) throw new Error('unavailable');
        const permission = await MediaLibrary.requestPermissionsAsync(false);
        const accepted = permission.status === 'granted'
          && (permission.accessPrivileges === 'all' || permission.accessPrivileges === 'limited');
        if (!accepted) {
          console.warn('[Upload] Media library video resolution failed', {
            stage: 'permission',
            code: 'permission_denied',
          });
          if (active) onError('permission_denied');
          return;
        }
        if (!active) return;
        setLimited(permission.accessPrivileges === 'limited');
        await loadPage();
      } catch {
        console.warn('[Upload] Media library video resolution failed', {
          stage: 'permission',
          code: 'permission_denied',
        });
        if (active) onError('permission_denied');
      }
    })();
    return () => { active = false; };
  }, [visible, loadPage, onError]);

  const selectAsset = useCallback(async (asset: MediaLibrary.Asset) => {
    if (selectionLockRef.current) return;
    selectionLockRef.current = true;
    setSelectedId(asset.id);
    setPreparing(true);
    setDownloading(false);
    try {
      const video = await resolveIosVideoAsset(asset, setDownloading);
      onSelected(video);
    } catch (error) {
      const safe = error as Partial<IosVideoResolutionError>;
      const code: IosVideoResolutionCode = safe.code === 'download_failed'
        || safe.code === 'video_too_large'
        || safe.code === 'video_too_long'
        || safe.code === 'unsupported_format'
        || safe.code === 'file_unavailable'
        ? safe.code
        : 'file_unavailable';
      console.warn('[Upload] Media library video resolution failed', {
        stage: safe.stage ?? 'validation',
        code,
      });
      onError(code);
    } finally {
      selectionLockRef.current = false;
      setPreparing(false);
      setDownloading(false);
      setSelectedId(undefined);
    }
  }, [onError, onSelected]);

  const manageAccess = useCallback(async () => {
    try {
      await MediaLibrary.presentPermissionsPickerAsync([MediaLibrary.MediaType.video]);
      await loadPage();
    } catch {
      console.warn('[Upload] Media library video resolution failed', {
        stage: 'permission',
        code: 'permissions_picker_failed',
      });
    }
  }, [loadPage]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} disabled={preparing}><Text style={styles.action}>Cerrar</Text></Pressable>
          <Text style={styles.title}>Seleccionar video</Text>
          <Pressable onPress={onFiles} disabled={preparing}><Text style={styles.action}>Archivos</Text></Pressable>
        </View>
        {limited ? (
          <Pressable onPress={manageAccess} disabled={preparing} style={styles.manage}>
            <Text style={styles.manageText}>Administrar acceso</Text>
          </Pressable>
        ) : null}
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.status}>Cargando videos...</Text></View>
        ) : queryFailed ? (
          <View style={styles.center}>
            <Text style={styles.empty}>No se pudieron cargar los videos.</Text>
            <Pressable onPress={() => loadPage()}><Text style={styles.action}>Intentar nuevamente</Text></Pressable>
          </View>
        ) : assets.length === 0 ? (
          <View style={styles.center}><Text style={styles.empty}>No hay videos disponibles.</Text></View>
        ) : (
          <FlatList
            data={assets}
            numColumns={3}
            keyExtractor={asset => asset.id}
            onEndReached={() => {
              if (hasNextPage && endCursor && !pageLockRef.current) void loadPage(endCursor);
            }}
            onEndReachedThreshold={0.5}
            renderItem={({ item }) => (
              <Pressable
                disabled={preparing}
                onPress={() => { void selectAsset(item); }}
                style={styles.tile}
              >
                <Image source={{ uri: item.uri }} style={styles.thumbnail} contentFit="cover" />
                <View style={styles.duration}><Text style={styles.durationText}>{durationLabel(item.duration)}</Text></View>
                {selectedId === item.id ? (
                  <View style={styles.selected}><MaterialIcons name="check-circle" size={28} color={Colors.accent} /></View>
                ) : null}
              </Pressable>
            )}
            ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={Colors.primary} /> : null}
          />
        )}
        {preparing ? (
          <View style={styles.preparing}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.preparingText}>
              {downloading ? 'Descargando video desde iCloud...' : 'Preparando video...'}
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingTop: 54, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  action: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  manage: { alignSelf: 'flex-end', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  manageText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  status: { color: Colors.textSecondary },
  empty: { color: Colors.textSecondary, textAlign: 'center' },
  tile: { width: '33.333%', aspectRatio: 1, padding: 1 },
  thumbnail: { flex: 1, backgroundColor: Colors.surfaceElevated },
  duration: { position: 'absolute', right: 6, bottom: 6, borderRadius: Radius.sm, paddingHorizontal: 5, paddingVertical: 2, backgroundColor: 'rgba(0,0,0,0.72)' },
  durationText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  selected: { position: 'absolute', right: 6, top: 6 },
  footer: { padding: Spacing.lg },
  preparing: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, backgroundColor: 'rgba(0,0,0,0.72)' },
  preparingText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
});
