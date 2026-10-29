import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StoryQuestionReplySource } from '@/services/storyQuestionHandoff';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { StoryComposition, StoryInteractivePlacement } from './storyInteractiveTypes';
import {
  normalizeStorySliderValue,
  stepStorySliderValue,
  storyInteractionPayloadKey,
  storySliderValueAt,
} from './storyViewerRuntime';
import { StoryInteractiveResultsSheet } from './StoryInteractiveResultsSheet';
import {
  fitStoryElementTransform,
  projectStoryElementTransform,
  type StoryMeasuredElementFrame,
  type StoryStageFrame,
  type StoryStageInsets,
} from './storyStageGeometry';
import type {
  StoryInteractiveElementState,
  StoryInteractivePayload,
  StoryInteractiveResultsCursor,
  StoryInteractiveResultsPage,
  StoryInteractiveState,
} from '@/services/storyInteractiveClient';

interface StoryInteractiveLayerProps {
  actorId?: string;
  visible?: boolean;
  storyId: string;
  composition: StoryComposition;
  width: number;
  height: number;
  safeInsets: StoryStageInsets;
  isOwner: boolean;
  revision: number;
  onInteractionFocus: (focused: boolean) => void;
  onQuestionComposerActiveChange?: (active: boolean) => void;
  onQuestionReply?: (kind: 'story' | 'chat', source: StoryQuestionReplySource, isCurrent: () => boolean, dismissResults: () => Promise<boolean>) => Promise<void>;
  onLoadState: (storyId: string) => Promise<StoryInteractiveState>;
  onRespond: (
    storyId: string,
    elementId: string,
    idempotencyKey: string,
    payload: StoryInteractivePayload,
  ) => Promise<void>;
  onLoadResults: (
    storyId: string,
    elementId: string,
    cursor?: StoryInteractiveResultsCursor,
    limit?: number,
  ) => Promise<StoryInteractiveResultsPage>;
  onModerateQuestion: (
    storyId: string,
    elementId: string,
    respondentId: string,
    action: 'hide',
  ) => Promise<'hidden' | 'blocked'>;
}

const INTERACTIVE_CARD_FALLBACK: StoryMeasuredElementFrame = { width: 260, height: 104 };

interface InteractiveCardProps {
  storyId: string;
  elementState: StoryInteractiveElementState;
  isOwner: boolean;
  onInteractionFocus: (focused: boolean) => void;
  onSubmit: (elementId: string, payload: StoryInteractivePayload) => Promise<void>;
  onOpenResults: (element: StoryInteractiveElementState) => void;
  onOpenQuestion: (elementId: string) => void;
}

function SliderControl({
  prompt,
  emoji,
  value,
  disabled,
  aggregateAverage,
  onChange,
  onCommit,
  onInteractionFocus,
}: {
  prompt: string;
  emoji: string;
  value: number;
  disabled: boolean;
  aggregateAverage?: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onInteractionFocus: (focused: boolean) => void;
}) {
  const widthRef = useRef(1);
  const valueRef = useRef(value);
  valueRef.current = value;

  const updateFromLocation = useCallback((locationX: number) => {
    const next = storySliderValueAt(locationX, widthRef.current);
    valueRef.current = next;
    onChange(next);
    return next;
  }, [onChange]);

  const commitAdjustedValue = useCallback((direction: 'increment' | 'decrement') => {
    if (disabled) return;
    const next = stepStorySliderValue(valueRef.current, direction);
    valueRef.current = next;
    onChange(next);
    onCommit(next);
  }, [disabled, onChange, onCommit]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: event => {
      onInteractionFocus(true);
      updateFromLocation(event.nativeEvent.locationX);
    },
    onPanResponderMove: event => {
      updateFromLocation(event.nativeEvent.locationX);
    },
    onPanResponderRelease: event => {
      const finalValue = updateFromLocation(event.nativeEvent.locationX);
      onCommit(finalValue);
      onInteractionFocus(false);
    },
    onPanResponderTerminate: () => {
      onInteractionFocus(false);
    },
    onPanResponderTerminationRequest: () => false,
  }), [disabled, onCommit, onInteractionFocus, updateFromLocation]);

  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`${prompt}, ${Math.round(value * 100)} por ciento`}
      accessibilityState={{ disabled }}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      accessibilityActions={[
        { name: 'increment', label: 'Aumentar reacción' },
        { name: 'decrement', label: 'Disminuir reacción' },
      ]}
      onAccessibilityAction={event => {
        const action = event.nativeEvent.actionName;
        if (action === 'increment' || action === 'decrement') commitAdjustedValue(action);
      }}
      onLayout={event => {
        widthRef.current = Math.max(1, event.nativeEvent.layout.width);
      }}
      style={styles.slider}
    >
      <View style={styles.sliderTrack} />
      <View style={[styles.sliderFill, { width: `${value * 100}%` }]} />
      <Text style={[styles.sliderEmoji, { left: `${Math.max(2, Math.min(92, value * 100))}%` }]}>{emoji}</Text>
      {aggregateAverage !== undefined ? (
        <Text style={styles.aggregate}>Promedio {Math.round(aggregateAverage * 100)}%</Text>
      ) : null}
    </View>
  );
}

function InteractiveCard({
  storyId: _storyId,
  elementState,
  isOwner,
  onInteractionFocus,
  onSubmit,
  onOpenResults,
  onOpenQuestion,
}: InteractiveCardProps) {
  const { definition } = elementState;
  const [sliderValue, setSliderValue] = useState(() => {
    const payload = elementState.response?.payload;
    const value = payload && 'value' in payload ? payload.value : undefined;
    return typeof value === 'number' ? normalizeStorySliderValue(value) : 0.5;
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const responsePayload = elementState.response?.payload;
  const selectedOption = responsePayload && 'option_id' in responsePayload
    && typeof responsePayload.option_id === 'string'
    ? responsePayload.option_id
    : null;
  const aggregate = elementState.aggregate;

  const submit = useCallback(async (payload: StoryInteractivePayload) => {
    if (pending || isOwner) return;
    setPending(true);
    setFailed(false);
    try {
      await onSubmit(elementState.elementId, payload);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }, [elementState.elementId, isOwner, onSubmit, pending]);

  const optionPercent = (optionId: string) => {
    const count = aggregate?.options?.[optionId] ?? 0;
    return aggregate && aggregate.total > 0 ? Math.round((count / aggregate.total) * 100) : 0;
  };
  const commitSlider = useCallback((sliderValue: number) => {
    void submit({ value: sliderValue });
  }, [submit]);

  return (
    <View
      style={styles.card}
      onStartShouldSetResponder={() => true}
      onTouchStart={() => onInteractionFocus(true)}
      onTouchEnd={() => onInteractionFocus(false)}
      onTouchCancel={() => onInteractionFocus(false)}
    >
      <Text style={styles.prompt}>{definition.prompt}</Text>
      {definition.type === 'poll' || definition.type === 'quiz' ? (
        <View style={styles.options}>
          {definition.options.map(option => {
            const selected = selectedOption === option.id;
            const correct = elementState.correctOptionId === option.id;
            const reveal = Boolean(elementState.correctOptionId && selectedOption);
            return (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={`${option.label}${aggregate ? `, ${optionPercent(option.id)} por ciento` : ''}`}
                accessibilityState={{ selected, disabled: pending || isOwner || Boolean(selectedOption) }}
                disabled={pending || isOwner || Boolean(selectedOption)}
                onPress={() => void submit({ option_id: option.id })}
                style={[styles.option, selected && styles.optionSelected, reveal && correct && styles.optionCorrect]}
              >
                <Text numberOfLines={2} style={styles.optionText}>{option.label}</Text>
                {aggregate ? <Text style={styles.optionPercent}>{optionPercent(option.id)}%</Text> : null}
              </Pressable>
            );
          })}
          {definition.type === 'quiz' && selectedOption && elementState.correctOptionId ? (
            <Text style={selectedOption === elementState.correctOptionId ? styles.success : styles.error}>
              {selectedOption === elementState.correctOptionId ? 'Respuesta correcta' : 'Respuesta incorrecta'}
            </Text>
          ) : null}
        </View>
      ) : definition.type === 'slider' ? (
        <SliderControl
          prompt={definition.prompt}
          emoji={definition.emoji}
          value={sliderValue}
          disabled={pending || isOwner}
          aggregateAverage={elementState.aggregate?.average ?? undefined}
          onChange={setSliderValue}
          onCommit={commitSlider}
          onInteractionFocus={onInteractionFocus}
        />
      ) : definition.type === 'question' ? (
        isOwner ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Ver respuestas privadas" onPress={() => onOpenResults(elementState)} style={styles.resultsButton}>
            <Text style={styles.resultsText}>Ver respuestas privadas</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Responder pregunta"
            accessibilityHint="Abre el formulario de respuesta privada"
            accessibilityState={{ disabled: Boolean(elementState.response) }}
            disabled={Boolean(elementState.response)}
            onPress={() => onOpenQuestion(elementState.elementId)}
            style={styles.resultsButton}
          >
            <Text style={styles.resultsText}>{elementState.response ? 'Respuesta enviada' : 'Escribe tu respuesta…'}</Text>
          </Pressable>
        )
      ) : definition.type === 'reaction' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Reaccionar con ${definition.emoji}`}
          accessibilityState={{ selected: Boolean(elementState.response), disabled: pending || isOwner || Boolean(elementState.response) }}
          disabled={pending || isOwner || Boolean(elementState.response)}
          onPress={() => void submit({ emoji: definition.emoji })}
          style={[styles.reaction, elementState.response && styles.reactionSelected]}
        >
          <Text style={styles.reactionEmoji}>{definition.emoji}</Text>
          {aggregate ? <Text style={styles.aggregate}>{aggregate.total}</Text> : null}
        </Pressable>
      ) : null}
      {pending ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
      {failed ? <Text style={styles.error}>No se pudo guardar. Inténtalo de nuevo.</Text> : null}
      {isOwner && definition.type !== 'question' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Ver resultados" onPress={() => onOpenResults(elementState)} style={styles.ownerResults}>
          <Text style={styles.ownerResultsText}>Resultados · {aggregate?.total ?? 0}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PositionedInteractiveCard({
  placement,
  stage,
  elementState,
  storyId,
  isOwner,
  onInteractionFocus,
  onSubmit,
  onOpenResults,
  onOpenQuestion,
}: {
  placement: StoryInteractivePlacement;
  stage: StoryStageFrame;
  elementState: StoryInteractiveElementState;
  storyId: string;
  isOwner: boolean;
  onInteractionFocus: (focused: boolean) => void;
  onSubmit: (elementId: string, payload: StoryInteractivePayload) => Promise<void>;
  onOpenResults: (element: StoryInteractiveElementState) => void;
  onOpenQuestion: (elementId: string) => void;
}) {
  const [measuredFrame, setMeasuredFrame] = useState(INTERACTIVE_CARD_FALLBACK);
  const fitted = useMemo(
    () => fitStoryElementTransform(placement, measuredFrame, stage),
    [measuredFrame, placement, stage],
  );
  const projected = useMemo(
    () => projectStoryElementTransform(fitted, stage),
    [fitted, stage],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    if (!(next.width > 0) || !(next.height > 0)) return;
    setMeasuredFrame(current => current.width === next.width && current.height === next.height
      ? current
      : { width: next.width, height: next.height });
  }, []);
  return (
    <View
      pointerEvents="box-none"
      onLayout={onLayout}
      style={[
        styles.positioned,
        {
          left: projected.x - measuredFrame.width / 2,
          top: projected.y - measuredFrame.height / 2,
          transform: [{ scale: projected.scale }, { rotate: `${projected.rotation}deg` }],
        },
      ]}
    >
      <InteractiveCard
        storyId={storyId}
        elementState={elementState}
        isOwner={isOwner}
        onInteractionFocus={onInteractionFocus}
        onSubmit={onSubmit}
        onOpenResults={onOpenResults}
        onOpenQuestion={onOpenQuestion}
      />
    </View>
  );
}

export function StoryInteractiveLayer({
  actorId,
  visible = true,
  storyId,
  composition,
  width,
  height,
  safeInsets,
  isOwner,
  revision,
  onInteractionFocus,
  onQuestionComposerActiveChange,
  onQuestionReply,
  onLoadState,
  onRespond,
  onLoadResults,
  onModerateQuestion,
}: StoryInteractiveLayerProps) {
  const deviceInsets = useSafeAreaInsets();
  const placements = useMemo(() => {
    const elements: StoryComposition['elements'][number][] = composition.elements;
    return elements.filter(
      (element): element is StoryInteractivePlacement => element.type === 'interactive',
    );
  }, [composition]);
  const stage = useMemo<StoryStageFrame>(() => ({ width, height, safeInsets }), [height, safeInsets, width]);
  const [state, setState] = useState<StoryInteractiveState | null>(null);
  const [resultsElementId, setResultsElementId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ elementId: string; draft: string; pending: boolean; failed: boolean } | null>(null);
  const composerRef = useRef(composer);
  const inputRef = useRef<TextInput>(null);
  const composerSessionRef = useRef(0);
  const lifecycleRef = useRef(0);
  const generationRef = useRef(0);
  const responseAttemptsRef = useRef(new Map<string, { idempotencyKey: string }>());
  const callbacksRef = useRef({ onLoadState, onRespond, onInteractionFocus, onQuestionComposerActiveChange });
  callbacksRef.current = { onLoadState, onRespond, onInteractionFocus, onQuestionComposerActiveChange };
  const authorityRef = useRef({ visible, actorId, storyId, isOwner, placements, state });
  authorityRef.current = { visible, actorId, storyId, isOwner, placements, state };
  const dismissalRef = useRef<((dismissed: boolean) => void) | null>(null);
  const resultsDismissingRef = useRef(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const retireComposer = useCallback(() => {
    composerSessionRef.current += 1;
    if (composerRef.current) Keyboard.dismiss();
    composerRef.current = null;
    setComposer(null);
    callbacksRef.current.onQuestionComposerActiveChange?.(false);
  }, []);

  const load = useCallback(async () => {
    if (!authorityRef.current.visible || authorityRef.current.placements.length === 0) return;
    const generation = ++generationRef.current;
    try {
      const next = await callbacksRef.current.onLoadState(storyId);
      if (generationRef.current === generation && next.storyId === storyId) {
        setState(next);
        setRefreshFailed(false);
      }
    } catch {
      if (generationRef.current === generation) setRefreshFailed(true);
    }
  }, [storyId]);

  useEffect(() => {
    lifecycleRef.current += 1;
    generationRef.current += 1;
    setState(null);
    setResultsElementId(null);
    resultsDismissingRef.current = false;
    retireComposer();
    responseAttemptsRef.current.clear();
    return () => {
      lifecycleRef.current += 1;
      generationRef.current += 1;
      retireComposer();
      dismissalRef.current?.(false);
      dismissalRef.current = null;
      callbacksRef.current.onInteractionFocus(false);
    };
  }, [actorId, isOwner, retireComposer, storyId, visible]);

  useEffect(() => { void load(); }, [actorId, isOwner, load, revision, visible]);

  const stateById = useMemo(() => new Map(
    (state?.elements ?? []).map(element => [element.elementId, element]),
  ), [state]);
  const resultsElement = resultsElementId ? stateById.get(resultsElementId) ?? null : null;
  const activeElement = composer ? stateById.get(composer.elementId) : null;
  useEffect(() => {
    const placed = (id: string) => placements.some(item => item.element_id === id);
    const active = composerRef.current;
    if (active && (!visible || isOwner || !placed(active.elementId)
      || (state && (!stateById.get(active.elementId) || stateById.get(active.elementId)?.definition.type !== 'question' || stateById.get(active.elementId)?.response)))) retireComposer();
    if (resultsElementId && (!visible || !isOwner || !placed(resultsElementId) || (state && !stateById.has(resultsElementId)))) {
      setResultsElementId(null);
      callbacksRef.current.onInteractionFocus(false);
    }
  }, [isOwner, placements, resultsElementId, retireComposer, state, stateById, visible]);

  const respond = useCallback(async (elementId: string, payload: StoryInteractivePayload) => {
    const identity = storyInteractionPayloadKey(storyId, elementId, payload);
    const lifecycle = lifecycleRef.current;
    const attempt = { idempotencyKey: responseAttemptsRef.current.get(identity)?.idempotencyKey ?? randomUUID() };
    responseAttemptsRef.current.set(identity, attempt);
    await callbacksRef.current.onRespond(storyId, elementId, attempt.idempotencyKey, payload);
    if (lifecycle !== lifecycleRef.current) return;
    if (responseAttemptsRef.current.get(identity) === attempt) responseAttemptsRef.current.delete(identity);
    void load();
  }, [load, storyId]);

  const openQuestion = useCallback((elementId: string) => {
    const current = authorityRef.current;
    const element = current.state?.elements.find(item => item.elementId === elementId);
    if (composerRef.current || resultsElementId || !current.visible || current.isOwner
      || !element || element.definition.type !== 'question' || element.response
      || !current.placements.some(item => item.element_id === elementId)) return;
    Keyboard.dismiss();
    composerSessionRef.current += 1;
    const next = { elementId, draft: '', pending: false, failed: false };
    composerRef.current = next;
    callbacksRef.current.onQuestionComposerActiveChange?.(true);
    setComposer(next);
  }, [resultsElementId]);

  const submitQuestion = useCallback(async () => {
    const current = composerRef.current;
    if (!current || current.pending || !current.draft.trim()) return;
    const session = composerSessionRef.current;
    const next = { ...current, pending: true, failed: false };
    composerRef.current = next;
    setComposer(next);
    try {
      await respond(current.elementId, { text: current.draft.trim() });
      if (session === composerSessionRef.current) retireComposer();
    } catch {
      if (session === composerSessionRef.current) {
        const failed = { ...next, pending: false, failed: true };
        composerRef.current = failed;
        setComposer(failed);
      }
    }
  }, [respond, retireComposer]);

  const openResults = useCallback((element: StoryInteractiveElementState) => {
    if (!authorityRef.current.visible || !authorityRef.current.isOwner || composerRef.current || resultsDismissingRef.current) return;
    onInteractionFocus(true);
    setResultsElementId(element.elementId);
  }, [onInteractionFocus]);

  const closeResults = useCallback(() => {
    setResultsElementId(null);
    onInteractionFocus(false);
  }, [onInteractionFocus]);
  const dismissResults = useCallback(() => new Promise<boolean>(resolve => {
    if (resultsDismissingRef.current) { resolve(false); return; }
    resultsDismissingRef.current = true;
    dismissalRef.current = resolve;
    closeResults();
  }), [closeResults]);
  const finishResultsDismissal = useCallback(() => {
    const resolve = dismissalRef.current;
    dismissalRef.current = null;
    resolve?.(true);
  }, []);

  if (!visible || placements.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      {placements.map(placement => {
        const elementState = stateById.get(placement.element_id);
        if (!elementState) return null;
        return (
          <PositionedInteractiveCard
            key={placement.id}
            placement={placement}
            stage={stage}
            storyId={storyId}
            elementState={elementState}
            isOwner={isOwner}
            onInteractionFocus={onInteractionFocus}
            onSubmit={respond}
            onOpenResults={openResults}
            onOpenQuestion={openQuestion}
          />
        );
      })}
      {refreshFailed ? <Text accessibilityRole="alert" style={styles.error}>No se pudo actualizar. Inténtalo de nuevo.</Text> : null}
      {composer ? (
        <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={retireComposer} onShow={() => inputRef.current?.focus()}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.composerRoot}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.composerContent, { paddingTop: deviceInsets.top + 16, paddingBottom: deviceInsets.bottom + 16, paddingLeft: deviceInsets.left + 16, paddingRight: deviceInsets.right + 16 }]}>
              <Text accessibilityRole="header" style={styles.prompt}>{activeElement?.definition.prompt ?? ''}</Text>
              <TextInput ref={inputRef} accessibilityLabel="Tu respuesta privada" accessibilityHint="Solo el creador puede ver tu respuesta" autoFocus multiline maxLength={500} value={composer.draft} editable={!composer.pending}
                onChangeText={draft => {
                  const current = composerRef.current;
                  if (!current || current.pending) return;
                  const next = { ...current, draft, failed: false };
                  composerRef.current = next;
                  setComposer(next);
                }} style={[styles.questionInput, styles.composerInput]} />
              {composer.failed ? <Text accessibilityRole="alert" style={styles.error}>No se pudo guardar. Inténtalo de nuevo.</Text> : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Cancelar respuesta privada" onPress={retireComposer} style={styles.send}><Text style={styles.sendText}>Cancelar</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Enviar respuesta privada" accessibilityState={{ disabled: composer.pending || !composer.draft.trim(), busy: composer.pending }} disabled={composer.pending || !composer.draft.trim()} onPress={() => void submitQuestion()} style={styles.send}>
                {composer.pending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Enviar</Text>}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </Modal>
      ) : null}
      <StoryInteractiveResultsSheet
        visible={Boolean(resultsElement)}
        storyId={storyId}
        element={resultsElement}
        revision={revision}
        onClose={closeResults}
        onLoad={onLoadResults}
        onModerate={onModerateQuestion}
        onDismiss={finishResultsDismissal}
        onReply={onQuestionReply ? (kind, source, isCurrent) => onQuestionReply(kind, source, isCurrent, dismissResults) : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 9 },
  composerRoot: { flex: 1, backgroundColor: '#fff' },
  composerContent: { flexGrow: 1, gap: 16 },
  composerInput: { minHeight: 120, textAlignVertical: 'top' },
  positioned: { position: 'absolute', width: 260, minHeight: 104 },
  card: { width: 260, minHeight: 104, padding: Spacing.sm, borderRadius: Radius.xl, backgroundColor: 'rgba(255,255,255,0.97)', gap: 7, shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  prompt: { color: '#111119', textAlign: 'center', fontWeight: FontWeight.bold, fontSize: 15, lineHeight: 19 },
  options: { gap: 6 },
  option: { minHeight: 42, borderRadius: Radius.md, backgroundColor: '#ECEAFB', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionSelected: { borderWidth: 2, borderColor: Colors.primary },
  optionCorrect: { backgroundColor: '#DDF8E7' },
  optionText: { flex: 1, color: '#242231', textAlign: 'center', fontSize: 13, fontWeight: FontWeight.semibold },
  optionPercent: { color: '#5B5768', fontSize: 11, fontWeight: FontWeight.bold },
  slider: { minHeight: 64, justifyContent: 'center', paddingHorizontal: 4 },
  sliderTrack: { height: 6, borderRadius: 3, backgroundColor: '#D7D3E7' },
  sliderFill: { position: 'absolute', left: 4, height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  sliderEmoji: { position: 'absolute', marginLeft: -13, top: 3, fontSize: 28 },
  aggregate: { color: '#595466', fontSize: 11, fontWeight: FontWeight.semibold, textAlign: 'center', marginTop: 7 },
  questionRow: { gap: 7 },
  questionInput: { minHeight: 44, borderRadius: Radius.lg, borderWidth: 1, borderColor: '#C7C3DB', color: '#1A1820', paddingHorizontal: 12, backgroundColor: '#fff' },
  send: { minHeight: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontWeight: FontWeight.bold },
  reaction: { minHeight: 64, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg },
  reactionSelected: { backgroundColor: '#ECEAFB' },
  reactionEmoji: { fontSize: 42 },
  resultsButton: { minHeight: 44, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  resultsText: { color: '#fff', fontWeight: FontWeight.bold },
  ownerResults: { minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  ownerResultsText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  success: { color: '#14783E', textAlign: 'center', fontWeight: FontWeight.bold },
  error: { color: '#B3243B', textAlign: 'center', fontSize: FontSize.xs },
});
