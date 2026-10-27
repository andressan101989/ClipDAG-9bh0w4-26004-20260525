import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type {
  StoryInteractiveElementState,
  StoryInteractiveResultResponse,
  StoryInteractiveResultsCursor,
  StoryInteractiveResultsPage,
} from '@/services/storyInteractiveClient';

interface StoryInteractiveResultsSheetProps {
  visible: boolean;
  storyId: string;
  element: StoryInteractiveElementState | null;
  revision: number;
  onClose: () => void;
  onLoad: (
    storyId: string,
    elementId: string,
    cursor?: StoryInteractiveResultsCursor,
    limit?: number,
  ) => Promise<StoryInteractiveResultsPage>;
  onModerate: (
    storyId: string,
    elementId: string,
    respondentId: string,
    action: 'hide',
  ) => Promise<'hidden' | 'blocked'>;
}

export function StoryInteractiveResultsSheet({
  visible,
  storyId,
  element,
  revision,
  onClose,
  onLoad,
  onModerate,
}: StoryInteractiveResultsSheetProps) {
  const [responses, setResponses] = useState<StoryInteractiveResultResponse[]>([]);
  const [page, setPage] = useState<StoryInteractiveResultsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const generationRef = useRef(0);

  const load = useCallback(async (cursor?: StoryInteractiveResultsCursor, append = false) => {
    if (!element) return;
    const generation = ++generationRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setFailed(false);
    try {
      const next = await onLoad(storyId, element.elementId, cursor, 50);
      if (generationRef.current !== generation) return;
      setPage(next);
      setResponses(previous => {
        if (!append) return next.responses;
        const merged = new Map(previous.map(item => [item.respondentId, item]));
        for (const item of next.responses) merged.set(item.respondentId, item);
        return Array.from(merged.values());
      });
    } catch {
      if (generationRef.current === generation) setFailed(true);
    } finally {
      if (generationRef.current === generation) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [element, onLoad, storyId]);

  useEffect(() => {
    generationRef.current += 1;
    setResponses([]);
    setPage(null);
    setFailed(false);
    if (visible && element) void load();
  }, [element, load, revision, visible]);

  const hide = useCallback(async (response: StoryInteractiveResultResponse) => {
    if (!element || response.moderationState === 'blocked') return;
    try {
      const moderationState = await onModerate(
        storyId,
        element.elementId,
        response.respondentId,
        'hide',
      );
      setResponses(current => current.map(item => item.respondentId === response.respondentId
        ? { ...item, moderationState }
        : item));
    } catch {
      setFailed(true);
    }
  }, [element, onModerate, storyId]);

  const renderResponse = ({ item, index }: { item: StoryInteractiveResultResponse; index: number }) => (
    <View style={styles.response}>
      <View style={styles.responseHeader}>
        <Text style={styles.responseNumber}>Respuesta {index + 1}</Text>
        <Text style={styles.responseState}>{item.moderationState}</Text>
      </View>
      <Text style={styles.responseText}>{String(item.payload.text ?? '')}</Text>
      {item.moderationState === 'pending' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ocultar respuesta ${index + 1}`}
          onPress={() => void hide(item)}
          style={styles.hideButton}
        >
          <Text style={styles.hideText}>Ocultar</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title}>Resultados</Text>
            <Text numberOfLines={2} style={styles.prompt}>{element?.definition.prompt ?? ''}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar resultados" onPress={onClose} style={styles.close}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
        {page ? (
          <Text style={styles.summary}>
            {page.aggregate.total} participaciones
            {typeof page.aggregate.average === 'number' ? ` · Promedio ${Math.round(page.aggregate.average * 100)} %` : ''}
          </Text>
        ) : null}
        {failed ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Reintentar resultados" onPress={() => void load()} style={styles.retry}>
            <Text style={styles.retryText}>No se pudieron cargar. Reintentar</Text>
          </Pressable>
        ) : null}
        {loading ? <ActivityIndicator color={Colors.primary} style={styles.loader} /> : (
          <FlatList
            data={responses}
            keyExtractor={item => item.respondentId}
            renderItem={renderResponse}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Aún no hay respuestas privadas.</Text>}
            ListFooterComponent={page?.hasMore ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cargar más respuestas"
                disabled={loadingMore}
                onPress={() => void load(page.nextCursor ?? undefined, true)}
                style={styles.more}
              >
                {loadingMore ? <ActivityIndicator color="#fff" /> : <Text style={styles.moreText}>Ver más</Text>}
              </Pressable>
            ) : null}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B10' },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: '#292934' },
  heading: { flex: 1, gap: 3 },
  title: { color: '#fff', fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  prompt: { color: '#B9B6C7', fontSize: FontSize.sm },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full },
  summary: { color: '#DDD9EC', paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, fontWeight: FontWeight.semibold },
  loader: { marginTop: 40 },
  list: { padding: Spacing.lg, gap: Spacing.md, flexGrow: 1 },
  response: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: '#1A1A24', gap: Spacing.sm },
  responseHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  responseNumber: { color: '#fff', fontWeight: FontWeight.semibold },
  responseState: { color: '#AFAABD', fontSize: FontSize.xs },
  responseText: { color: '#F4F2FA', fontSize: FontSize.md, lineHeight: 22 },
  hideButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: Spacing.md },
  hideText: { color: '#FF9CAE', fontWeight: FontWeight.semibold },
  retry: { margin: Spacing.lg, minHeight: 44, justifyContent: 'center' },
  retryText: { color: '#FFB4B4', textAlign: 'center' },
  empty: { color: '#AFAABD', textAlign: 'center', marginTop: 36 },
  more: { minHeight: 48, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.md },
  moreText: { color: '#fff', fontWeight: FontWeight.bold },
});
