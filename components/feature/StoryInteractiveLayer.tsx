import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
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
  storyId: string;
  composition: StoryComposition;
  width: number;
  height: number;
  safeInsets: StoryStageInsets;
  isOwner: boolean;
  revision: number;
  onInteractionFocus: (focused: boolean) => void;
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
}: InteractiveCardProps) {
  const { definition } = elementState;
  const [questionDraft, setQuestionDraft] = useState('');
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
      if (definition.type === 'question') setQuestionDraft('');
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }, [definition.type, elementState.elementId, isOwner, onSubmit, pending]);

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
          <View style={styles.questionRow}>
            <TextInput
              accessibilityLabel="Tu respuesta privada"
              value={questionDraft}
              onChangeText={setQuestionDraft}
              onFocus={() => onInteractionFocus(true)}
              onBlur={() => onInteractionFocus(false)}
              editable={!pending && !elementState.response}
              maxLength={500}
              placeholder={elementState.response ? 'Respuesta enviada' : 'Escribe tu respuesta…'}
              placeholderTextColor="#787486"
              style={styles.questionInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar respuesta privada"
              accessibilityState={{ disabled: pending || !questionDraft.trim() || Boolean(elementState.response) }}
              disabled={pending || !questionDraft.trim() || Boolean(elementState.response)}
              onPress={() => void submit({ text: questionDraft.trim() })}
              style={styles.send}
            >
              <Text style={styles.sendText}>Enviar</Text>
            </Pressable>
          </View>
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
}: {
  placement: StoryInteractivePlacement;
  stage: StoryStageFrame;
  elementState: StoryInteractiveElementState;
  storyId: string;
  isOwner: boolean;
  onInteractionFocus: (focused: boolean) => void;
  onSubmit: (elementId: string, payload: StoryInteractivePayload) => Promise<void>;
  onOpenResults: (element: StoryInteractiveElementState) => void;
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
      />
    </View>
  );
}

export function StoryInteractiveLayer({
  storyId,
  composition,
  width,
  height,
  safeInsets,
  isOwner,
  revision,
  onInteractionFocus,
  onLoadState,
  onRespond,
  onLoadResults,
  onModerateQuestion,
}: StoryInteractiveLayerProps) {
  const placements = useMemo(() => {
    const elements: StoryComposition['elements'][number][] = composition.elements;
    return elements.filter(
      (element): element is StoryInteractivePlacement => element.type === 'interactive',
    );
  }, [composition]);
  const stage = useMemo<StoryStageFrame>(() => ({ width, height, safeInsets }), [height, safeInsets, width]);
  const [state, setState] = useState<StoryInteractiveState | null>(null);
  const [resultsElement, setResultsElement] = useState<StoryInteractiveElementState | null>(null);
  const generationRef = useRef(0);
  const responseAttemptsRef = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (placements.length === 0) return;
    const generation = ++generationRef.current;
    try {
      const next = await onLoadState(storyId);
      if (generationRef.current === generation && next.storyId === storyId) setState(next);
    } catch {
      if (generationRef.current === generation) setState(null);
    }
  }, [onLoadState, placements.length, storyId]);

  useEffect(() => {
    setState(null);
    setResultsElement(null);
    responseAttemptsRef.current.clear();
    void load();
    return () => {
      generationRef.current += 1;
      onInteractionFocus(false);
    };
  }, [load, onInteractionFocus, revision, storyId]);

  const stateById = useMemo(() => new Map(
    (state?.elements ?? []).map(element => [element.elementId, element]),
  ), [state]);

  const respond = useCallback(async (elementId: string, payload: StoryInteractivePayload) => {
    const identity = storyInteractionPayloadKey(storyId, elementId, payload);
    const idempotencyKey = responseAttemptsRef.current.get(identity) ?? randomUUID();
    responseAttemptsRef.current.set(identity, idempotencyKey);
    await onRespond(storyId, elementId, idempotencyKey, payload);
    responseAttemptsRef.current.delete(identity);
    await load();
  }, [load, onRespond, storyId]);

  const openResults = useCallback((element: StoryInteractiveElementState) => {
    onInteractionFocus(true);
    setResultsElement(element);
  }, [onInteractionFocus]);

  const closeResults = useCallback(() => {
    setResultsElement(null);
    onInteractionFocus(false);
  }, [onInteractionFocus]);

  if (placements.length === 0) return null;
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
          />
        );
      })}
      <StoryInteractiveResultsSheet
        visible={Boolean(resultsElement)}
        storyId={storyId}
        element={resultsElement}
        revision={revision}
        onClose={closeResults}
        onLoad={onLoadResults}
        onModerate={onModerateQuestion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 9 },
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
