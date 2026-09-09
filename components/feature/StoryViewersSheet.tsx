import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { StoryViewerRecord } from '@/contexts/StoriesContext';

interface StoryViewersSheetProps {
  visible: boolean;
  viewers: StoryViewerRecord[];
  totalCount: number;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: boolean;
  onClose: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
}

function viewedTime(value: string): string {
  const viewedAt = new Date(value);
  if (Number.isNaN(viewedAt.getTime())) return '';
  return viewedAt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function StoryViewersSheet({
  visible,
  viewers,
  totalCount,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  onClose,
  onRetry,
  onLoadMore,
}: StoryViewersSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar visualizaciones"
          style={styles.backdrop}
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Visualizaciones</Text>
              <Text style={styles.count}>{totalCount} {totalCount === 1 ? 'persona' : 'personas'}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cerrar lista de visualizaciones"
              hitSlop={10}
              style={styles.closeButton}
              onPress={onClose}
            >
              <MaterialIcons name="close" size={22} color={Colors.textPrimary} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.state}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.stateText}>Cargando visualizaciones…</Text>
            </View>
          ) : error ? (
            <View style={styles.state}>
              <MaterialIcons name="error-outline" size={28} color={Colors.error} />
              <Text style={styles.stateText}>No pudimos cargar las visualizaciones.</Text>
              <Pressable accessibilityRole="button" style={styles.retryButton} onPress={onRetry}>
                <Text style={styles.retryText}>Reintentar</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              style={styles.viewerList}
              data={viewers}
              keyExtractor={item => item.viewerId}
              contentContainerStyle={viewers.length === 0 ? styles.emptyList : styles.list}
              onEndReached={() => {
                if (hasMore && !isLoadingMore) onLoadMore();
              }}
              onEndReachedThreshold={0.35}
              ListEmptyComponent={(
                <View style={styles.state}>
                  <MaterialIcons name="visibility-off" size={30} color={Colors.textSubtle} />
                  <Text style={styles.emptyTitle}>Todavía no hay visualizaciones</Text>
                  <Text style={styles.stateText}>Las personas que vean tu historia aparecerán aquí.</Text>
                </View>
              )}
              ListFooterComponent={isLoadingMore ? (
                <ActivityIndicator style={styles.footerLoader} color={Colors.primary} />
              ) : null}
              renderItem={({ item }) => (
                <View style={styles.viewerRow}>
                  <Avatar
                    uri={item.avatarUrl || undefined}
                    username={item.username}
                    size={42}
                  />
                  <View style={styles.viewerInfo}>
                    <Text style={styles.username}>@{item.username}</Text>
                    <Text style={styles.viewedAt}>{viewedTime(item.viewedAt)}</Text>
                  </View>
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  sheet: {
    maxHeight: '68%',
    minHeight: 300,
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    marginTop: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.borderHighlight,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  count: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceHighlight,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  viewerList: {
    flex: 1,
  },
  emptyList: {
    flexGrow: 1,
  },
  viewerRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderSubtle,
  },
  viewerInfo: {
    flex: 1,
  },
  username: {
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  viewedAt: {
    marginTop: 2,
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
  },
  state: {
    flex: 1,
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  stateText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
  },
  retryText: {
    color: Colors.textOnBrand,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  footerLoader: {
    marginVertical: Spacing.md,
  },
});
