import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { StoryQuestionReplySource } from '@/services/storyQuestionHandoff';
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
  onDismiss?: () => void;
  onReply?: (kind: 'story' | 'chat', source: StoryQuestionReplySource, isCurrent: () => boolean) => Promise<void>;
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
  onDismiss,
  onReply,
  onLoad,
  onModerate,
}: StoryInteractiveResultsSheetProps) {
  const [responses, setResponses] = useState<StoryInteractiveResultResponse[]>([]);
  const [page, setPage] = useState<StoryInteractiveResultsPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const generationRef = useRef(0);
  const sessionRef = useRef(0);
  const rowsRef = useRef(responses);
  const currentRef = useRef({ visible, storyId, elementId: element?.elementId, question: element?.definition.type === 'question' });
  currentRef.current = { visible, storyId, elementId: element?.elementId, question: element?.definition.type === 'question' };
  const callbacksRef = useRef({ onLoad, onModerate, onReply, onDismiss });
  callbacksRef.current = { onLoad, onModerate, onReply, onDismiss };
  const locksRef = useRef(new Set<string>());
  const mutationsRef = useRef(new Map<string, 'hidden' | 'blocked'>());
  const loadedPagesRef = useRef(1);
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, boolean>>({});
  const elementId = element?.elementId;
  const wasVisibleRef = useRef(false);

  const load = useCallback(async (cursor?: StoryInteractiveResultsCursor, append = false) => {
    if (!elementId || !currentRef.current.visible) return;
    const generation = ++generationRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setFailed(false);
    try {
      let next = await callbacksRef.current.onLoad(storyId, elementId, cursor, 50);
      const incoming = [...next.responses];
      // Refresh the loaded cursor chain, keeping current rows visible until it is complete.
      let fetched = 1;
      while (!append && fetched < loadedPagesRef.current && next.hasMore && next.nextCursor) {
        if (generationRef.current !== generation) return;
        next = await callbacksRef.current.onLoad(storyId, elementId, next.nextCursor, 50);
        incoming.push(...next.responses);
        fetched += 1;
      }
      if (generationRef.current !== generation) return;
      setPage(next);
      loadedPagesRef.current = append ? loadedPagesRef.current + 1 : fetched;
      const merged = new Map((append ? rowsRef.current : []).map(item => [item.respondentId, item]));
      for (const item of incoming) merged.set(item.respondentId, { ...item, moderationState: mutationsRef.current.get(item.respondentId) ?? item.moderationState });
      rowsRef.current = Array.from(merged.values());
      setResponses(rowsRef.current);
    } catch {
      if (generationRef.current === generation) setFailed(true);
    } finally {
      if (generationRef.current === generation) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [elementId, storyId]);

  useEffect(() => {
    sessionRef.current += 1;
    generationRef.current += 1;
    rowsRef.current = [];
    locksRef.current.clear();
    mutationsRef.current.clear();
    loadedPagesRef.current = 1;
    setRowBusy(new Set());
    setRowErrors({});
    setResponses([]);
    setPage(null);
    setFailed(false);
    return () => { sessionRef.current += 1; generationRef.current += 1; };
  }, [elementId, storyId, visible]);
  useEffect(() => { if (visible && elementId) void load(); }, [elementId, load, revision, visible]);
  useEffect(() => {
    if (wasVisibleRef.current && !visible && Platform.OS === 'android') callbacksRef.current.onDismiss?.();
    wasVisibleRef.current = visible;
  }, [visible]);

  const act = useCallback(async (response: StoryInteractiveResultResponse, kind: 'hide' | 'story' | 'chat', renderedStoryId: string, renderedElementId: string | undefined, renderedSession: number) => {
    const identity = currentRef.current;
    const session = sessionRef.current;
    const isCurrent = () => sessionRef.current === session && currentRef.current.visible
      && currentRef.current.storyId === identity.storyId && currentRef.current.elementId === identity.elementId
      && currentRef.current.question && rowsRef.current.some(item => item.respondentId === response.respondentId && item.moderationState === 'pending');
    if (!identity.elementId || identity.storyId !== renderedStoryId || identity.elementId !== renderedElementId
      || session !== renderedSession || !isCurrent() || locksRef.current.has(response.respondentId)) return;
    locksRef.current.add(response.respondentId);
    setRowBusy(new Set(locksRef.current));
    setRowErrors(current => ({ ...current, [response.respondentId]: false }));
    try {
      if (kind === 'hide') {
        const moderationState = await callbacksRef.current.onModerate(identity.storyId, identity.elementId, response.respondentId, 'hide');
        if (session !== sessionRef.current) return;
        mutationsRef.current.set(response.respondentId, moderationState);
        rowsRef.current = rowsRef.current.map(item => item.respondentId === response.respondentId ? { ...item, moderationState } : item);
        setResponses(rowsRef.current);
      } else {
        if (!callbacksRef.current.onReply) throw new Error('STORY_QUESTION_REPLY_UNAVAILABLE');
        await callbacksRef.current.onReply(kind, { storyId: identity.storyId, elementId: identity.elementId, respondentId: response.respondentId }, isCurrent);
      }
    } catch {
      if (session === sessionRef.current) setRowErrors(current => ({ ...current, [response.respondentId]: true }));
    } finally {
      if (session === sessionRef.current) {
        locksRef.current.delete(response.respondentId);
        setRowBusy(new Set(locksRef.current));
      }
    }
  }, []);

  const renderedSession = sessionRef.current;
  const renderResponse = ({ item, index }: { item: StoryInteractiveResultResponse; index: number }) => (
    <View style={styles.response}>
      <View style={styles.responseHeader}>
        <Text style={styles.responseNumber}>Respuesta {index + 1}</Text>
        <Text style={styles.responseState}>{item.moderationState}</Text>
      </View>
      <Text style={styles.responseText}>{String(item.payload.text ?? '')}</Text>
      {element?.definition.type === 'question' && item.moderationState === 'pending' ? (
        <>
          {onReply ? (['story', 'chat'] as const).map(kind => (
            <Pressable key={kind} accessibilityRole="button" accessibilityLabel={kind === 'story' ? 'Responder en historia' : 'Responder por privado'}
              accessibilityState={{ disabled: rowBusy.has(item.respondentId), busy: rowBusy.has(item.respondentId) }} disabled={rowBusy.has(item.respondentId)}
              onPress={() => void act(item, kind, storyId, elementId, renderedSession)} style={styles.hideButton}>
              <Text style={styles.moreText}>{kind === 'story' ? 'Responder en historia' : 'Responder por privado'}</Text>
            </Pressable>
          )) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Ocultar respuesta ${index + 1}`}
          accessibilityState={{ disabled: rowBusy.has(item.respondentId), busy: rowBusy.has(item.respondentId) }}
          disabled={rowBusy.has(item.respondentId)}
          onPress={() => void act(item, 'hide', storyId, elementId, renderedSession)}
          style={styles.hideButton}
        >
          <Text style={styles.hideText}>Ocultar</Text>
        </Pressable>
        </>
      ) : null}
      {rowErrors[item.respondentId] ? <Text accessibilityRole="alert" style={styles.retryText}>No se pudo completar. Actualiza las respuestas e inténtalo de nuevo.</Text> : null}
    </View>
  );

  return (
    <Modal visible={visible} animationType={Platform.OS === 'android' ? 'none' : 'slide'} onRequestClose={onClose} onDismiss={onDismiss}>
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
        {loading && responses.length === 0 ? <ActivityIndicator color={Colors.primary} style={styles.loader} /> : (
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
