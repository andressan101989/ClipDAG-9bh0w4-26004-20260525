import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, LayoutChangeEvent, Modal, PanResponder, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { StoryQuestionEditorSession } from '@/services/storyQuestionIntegrationRuntime';
import type { StoryQuestionAnswerCard } from '@/services/storyQuestionHandoff';
import { Image } from '@/components/ui/SafeImage';
import { Avatar } from '@/components/ui/Avatar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  EMPTY_STORY_COMPOSITION,
  STORY_STICKERS, STORY_TEXT_COLORS, StoryCompositionElementContent, storyElementFrame,
} from './storyComposition';
import { StoryEditorVideoPreview } from './StoryEditorVideoPreview';
import { StoryInteractiveElement } from './StoryInteractiveElement';
import { StoryInteractiveEditorSheet } from './StoryInteractiveEditorSheet';
import {
  buildStoryInteractivePublication,
  normalizeStoryCompositionVersion,
  type StoryComposition,
  type StoryCompositionElement,
  type StoryEditorPublication,
  type StoryInteractiveDefinition,
  type StoryInteractiveDraft,
  type StoryTextElement,
} from './storyInteractiveTypes';
import {
  clampStoryElementTransform,
  createStoryStageSafeInsets,
  deriveStoryGestureTransform,
  projectStoryElementTransform,
  reorderStoryLayer,
  type StoryMeasuredElementFrame,
  type StoryStageFrame,
  type StoryStagePoint,
} from './storyStageGeometry';

const STORY_MAX_ELEMENTS = 32;
const STORY_MAX_TEXT_ELEMENTS = 10;
const STORY_MAX_STICKER_ELEMENTS = 24;
// Figma visual authority: ClipDAG Stories V2 Final, node 2:105.

export type StoryEditorSource =
  | { kind: 'media'; uri: string; mediaType: 'photo' | 'video'; asset: unknown }
  | {
      kind: 'shared'; videoId: string; contentType: 'feed' | 'reel';
      previewUrl?: string; username: string; avatarUrl?: string; caption?: string;
    };

function EditableElement({
  element, definition, selected, onSelect, onChange, onEdit, onDelete, onReorder, stage,
}: {
  element: StoryCompositionElement;
  definition: StoryInteractiveDefinition | null;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: StoryCompositionElement) => void;
  onEdit: () => void;
  onDelete: () => void;
  onReorder: (destination: 'front' | 'back') => void;
  stage: StoryStageFrame;
}) {
  const elementRef = useRef(element);
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  elementRef.current = element;
  onChangeRef.current = onChange;
  onSelectRef.current = onSelect;
  const fallback = element.type === 'interactive'
    ? { width: 260, height: 104 }
    : (() => { const frame = storyElementFrame(element, stage.width); return { width: frame.width, height: frame.minHeight }; })();
  const [measuredFrame, setMeasuredFrame] = useState<StoryMeasuredElementFrame>(fallback);
  const start = useRef<{ transform: StoryCompositionElement; touches: StoryStagePoint[] }>({
    transform: element,
    touches: [],
  });
  const points = (touches: readonly { pageX: number; pageY: number }[]): StoryStagePoint[] => (
    [...touches].slice(0, 2).map(touch => ({ x: touch.pageX, y: touch.pageY }))
  );
  const applyTransform = useCallback((candidate: StoryCompositionElement) => {
    const clamped = clampStoryElementTransform(candidate, measuredFrame, stage);
    const next = { ...candidate, ...clamped } as StoryCompositionElement;
    elementRef.current = next;
    onChangeRef.current(next);
  }, [measuredFrame, stage]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const current = elementRef.current;
      onSelectRef.current();
      start.current = { transform: current, touches: points(event.nativeEvent.touches) };
    },
    onPanResponderMove: (event, gesture) => {
      const currentTouches = points(event.nativeEvent.touches);
      if (currentTouches.length >= 2 && start.current.touches.length < 2) {
        start.current = { transform: elementRef.current, touches: currentTouches };
        return;
      }
      if (currentTouches.length === 1 && start.current.touches.length >= 2) {
        start.current = { transform: elementRef.current, touches: currentTouches };
        return;
      }
      const initialTouches = start.current.touches.length > 0
        ? start.current.touches
        : [{ x: 0, y: 0 }];
      const gestureTouches = currentTouches.length > 0
        ? currentTouches
        : [{ x: gesture.dx, y: gesture.dy }];
      applyTransform({
        ...start.current.transform,
        ...deriveStoryGestureTransform(start.current.transform, initialTouches, gestureTouches, stage),
      } as StoryCompositionElement);
    },
    onPanResponderTerminationRequest: () => false,
  }), [applyTransform, stage]);
  useEffect(() => {
    if (stage.width <= 0 || stage.height <= 0) return;
    const current = elementRef.current;
    const clamped = clampStoryElementTransform(current, measuredFrame, stage);
    if (Math.abs(current.x - clamped.x) > 0.000001 || Math.abs(current.y - clamped.y) > 0.000001
      || current.scale !== clamped.scale || current.rotation !== clamped.rotation) {
      onChangeRef.current({ ...current, ...clamped } as StoryCompositionElement);
    }
  }, [measuredFrame, stage]);
  const projected = projectStoryElementTransform(element, stage);
  const accessibilityActions = [
    { name: 'moveUp', label: 'Mover arriba' }, { name: 'moveDown', label: 'Mover abajo' },
    { name: 'moveLeft', label: 'Mover a la izquierda' }, { name: 'moveRight', label: 'Mover a la derecha' },
    { name: 'increase', label: 'Aumentar' }, { name: 'decrease', label: 'Reducir' },
    { name: 'rotate', label: 'Girar' }, { name: 'front', label: 'Traer al frente' },
    { name: 'back', label: 'Enviar al fondo' }, { name: 'edit', label: 'Editar' },
    { name: 'delete', label: 'Eliminar' },
  ];
  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={element.type === 'interactive' ? `Sticker interactivo ${definition?.prompt ?? ''}`
        : element.type === 'question_answer' ? `Pregunta: ${element.question}. Respuesta: ${element.answer}` : 'Elemento de historia'}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={event => {
        switch (event.nativeEvent.actionName) {
          case 'moveUp': applyTransform({ ...elementRef.current, y: elementRef.current.y - 0.03 }); break;
          case 'moveDown': applyTransform({ ...elementRef.current, y: elementRef.current.y + 0.03 }); break;
          case 'moveLeft': applyTransform({ ...elementRef.current, x: elementRef.current.x - 0.03 }); break;
          case 'moveRight': applyTransform({ ...elementRef.current, x: elementRef.current.x + 0.03 }); break;
          case 'increase': applyTransform({ ...elementRef.current, scale: elementRef.current.scale + 0.1 }); break;
          case 'decrease': applyTransform({ ...elementRef.current, scale: elementRef.current.scale - 0.1 }); break;
          case 'rotate': applyTransform({ ...elementRef.current, rotation: elementRef.current.rotation + 15 }); break;
          case 'front': onReorder('front'); break;
          case 'back': onReorder('back'); break;
          case 'edit': onEdit(); break;
          case 'delete': onDelete(); break;
        }
      }}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) setMeasuredFrame({ width, height });
      }}
      style={[
        styles.editable,
        selected && styles.selected,
        {
          left: projected.x - measuredFrame.width / 2,
          top: projected.y - measuredFrame.height / 2,
          transform: [{ scale: projected.scale }, { rotate: `${projected.rotation}deg` }],
        },
      ]}
    >
      {element.type === 'interactive' && definition
        ? <StoryInteractiveElement definition={definition} />
        : element.type !== 'interactive'
          ? <StoryCompositionElementContent element={element} canvasWidth={stage.width} />
          : null}
    </View>
  );
}

export function StoryEditor({
  visible, source, questionAnswerSeed = null, onCancel, onPublish,
}: {
  visible: boolean;
  source: StoryEditorSource | null;
  questionAnswerSeed?: StoryQuestionAnswerCard | null;
  onCancel: (clientStoryId?: string) => void;
  onPublish: (source: StoryEditorSource, publication: StoryEditorPublication, clientStoryId: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const headerHeight = Math.max(92, insets.top + 56);
  const toolbarHeight = Math.max(122, insets.bottom + 88);
  const [stageFrame, setStageFrame] = useState({ width: 0, height: 0 });
  const stage = useMemo<StoryStageFrame>(() => ({
    ...stageFrame,
    safeInsets: createStoryStageSafeInsets(insets, {
      top: headerHeight,
      bottom: toolbarHeight,
    }),
  }), [headerHeight, insets, stageFrame, toolbarHeight]);
  const [composition, setComposition] = useState<StoryComposition>(EMPTY_STORY_COMPOSITION);
  const [interactiveDrafts, setInteractiveDrafts] = useState<StoryInteractiveDraft[]>([]);
  const [interactiveSheetDraft, setInteractiveSheetDraft] = useState<StoryInteractiveDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const [error, setError] = useState(false);
  const clientStoryIdRef = useRef<string | null>(null);
  const questionSessionRef = useRef<StoryQuestionEditorSession | null>(null);
  if (!questionSessionRef.current) questionSessionRef.current = new StoryQuestionEditorSession(Crypto.randomUUID);
  const toolSizeStyle = stage.width > 0 && stage.width < 360 ? styles.toolCompact : undefined;

  useEffect(() => {
    const initial = questionSessionRef.current!.initialize(visible, source, questionAnswerSeed);
    if (!initial) return;
    setComposition(initial.composition);
    setInteractiveDrafts([]);
    setInteractiveSheetDraft(null);
    setSelectedId(initial.selectedId);
    setEditingTextId(initial.selectedId);
    setShowStickerPicker(false);
    setError(false);
    clientStoryIdRef.current = initial.clientStoryId;
  }, [source, visible, questionAnswerSeed]);

  const updateElement = (next: StoryCompositionElement) => {
    setComposition(current => normalizeStoryCompositionVersion({
      version: current.version,
      elements: current.elements.map(item => item.id === next.id
        ? item.type === 'question_answer' && next.type === 'question_answer'
          ? questionSessionRef.current!.updateCard(item, next) : next
        : item),
    }));
  };
  const setElements = (elements: StoryCompositionElement[]) => {
    setComposition(current => normalizeStoryCompositionVersion({ version: current.version, elements }));
  };
  const addText = () => {
    if (composition.elements.length >= STORY_MAX_ELEMENTS
      || composition.elements.filter(item => item.type === 'text').length >= STORY_MAX_TEXT_ELEMENTS) return;
    const element: StoryTextElement = {
      id: Crypto.randomUUID(), type: 'text', text: 'Texto', x: 0.5, y: 0.35,
      scale: 1, rotation: 0, color: '#FFFFFF', align: 'center', size: 'medium',
    };
    setComposition(current => normalizeStoryCompositionVersion({ version: current.version, elements: [...current.elements, element] }));
    setSelectedId(element.id);
    setShowStickerPicker(false);
    setEditingTextId(element.id);
  };
  const addSticker = (value: typeof STORY_STICKERS[number]) => {
    if (composition.elements.length >= STORY_MAX_ELEMENTS
      || composition.elements.filter(item => item.type === 'sticker').length >= STORY_MAX_STICKER_ELEMENTS) return;
    const element = { id: Crypto.randomUUID(), type: 'sticker' as const, value, x: 0.5, y: 0.5, scale: 1, rotation: 0 };
    setComposition(current => normalizeStoryCompositionVersion({ version: current.version, elements: [...current.elements, element] }));
    setSelectedId(element.id);
  };
  const openNewInteractive = () => {
    if (composition.elements.length >= STORY_MAX_ELEMENTS) return;
    const elementId = Crypto.randomUUID();
    setInteractiveSheetDraft({
      definition: {
        version: 1,
        element_id: elementId,
        type: 'poll',
        prompt: 'Haz una pregunta',
        options: [
          { id: `option-${Crypto.randomUUID()}`, label: 'Opción 1' },
          { id: `option-${Crypto.randomUUID()}`, label: 'Opción 2' },
        ],
      },
      correctOptionId: null,
    });
    setShowStickerPicker(false);
  };
  const saveInteractiveDraft = (draft: StoryInteractiveDraft) => {
    const existing = interactiveDrafts.some(item => item.definition.element_id === draft.definition.element_id);
    setInteractiveDrafts(current => existing
      ? current.map(item => item.definition.element_id === draft.definition.element_id ? draft : item)
      : [...current, draft]);
    if (!existing) {
      const placement = {
        id: Crypto.randomUUID(),
        type: 'interactive' as const,
        element_id: draft.definition.element_id,
        x: 0.5,
        y: 0.5,
        scale: 1,
        rotation: 0,
      };
      setComposition(current => normalizeStoryCompositionVersion({
        version: current.version,
        elements: [...current.elements, placement],
      }));
      setSelectedId(placement.id);
    }
    setInteractiveSheetDraft(null);
  };
  const removeElement = (element: StoryCompositionElement) => {
    if (element.id === questionAnswerSeed?.id) { setError(true); return; }
    setElements(composition.elements.filter(item => item.id !== element.id));
    if (element.type === 'interactive') {
      setInteractiveDrafts(current => current.filter(item => item.definition.element_id !== element.element_id));
    }
    setSelectedId(null);
    setEditingTextId(null);
  };
  const selected = composition.elements.find(item => item.id === selectedId) ?? null;
  const finishTextEditing = () => {
    if (editingTextId && selected?.type === 'text' && selected.id === editingTextId
      && selected.text.trim().length === 0) {
      setComposition(current => ({
        ...normalizeStoryCompositionVersion({
          version: current.version,
          elements: current.elements.filter(item => item.id !== editingTextId),
        }),
      }));
      setSelectedId(null);
    }
    setEditingTextId(null);
  };
  const cancel = () => { if (!publishing) onCancel(clientStoryIdRef.current ?? undefined); };
  const handleStageLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setStageFrame(current => (
      current.width === width && current.height === height ? current : { width, height }
    ));
  };
  const submit = async () => {
    if (!source || publishing) return;
    if (publishingRef.current) return;
    publishingRef.current = true;
    if (!clientStoryIdRef.current) clientStoryIdRef.current = Crypto.randomUUID();
    const publishableComposition = normalizeStoryCompositionVersion({
      version: composition.version,
      elements: composition.elements.filter(element => element.type !== 'text' || element.text.trim().length > 0),
    });
    if (publishableComposition.elements.length !== composition.elements.length) {
      setComposition(publishableComposition);
      setEditingTextId(null);
      setSelectedId(null);
    }
    setPublishing(true);
    setError(false);
    try {
      const publication = buildStoryInteractivePublication(publishableComposition, interactiveDrafts);
      if (!publication || !questionSessionRef.current!.validate(publication.composition)) throw new Error('invalid_story_interactive_publication');
      await onPublish(source, publication, clientStoryIdRef.current);
    } catch {
      setError(true);
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  if (!source) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={cancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.root}
      >
        <View style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
          <Pressable
            accessibilityRole="button"
            onPress={cancel}
            disabled={publishing}
            accessibilityLabel="Cancelar editor"
            hitSlop={8}
            style={styles.headerButton}
          >
            <MaterialIcons name="close" color="#fff" size={26} />
          </Pressable>
          <Text style={styles.title}>Tu historia</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Publicar historia"
            onPress={() => void submit()}
            disabled={publishing}
            hitSlop={3}
            style={({ pressed }) => [styles.publish, pressed && styles.pressed, publishing && styles.disabled]}
          >
            {publishing ? <ActivityIndicator color="#fff" /> : <Text style={styles.publishText}>Publicar</Text>}
          </Pressable>
        </View>

        <Pressable
          accessibilityLabel="Lienzo de historia"
          style={[styles.canvas, StyleSheet.absoluteFill]}
          onLayout={handleStageLayout}
          onPress={() => { finishTextEditing(); setSelectedId(null); }}
        >
          {source.kind === 'media' && source.mediaType === 'photo' ? (
            <Image source={{ uri: source.uri }} style={StyleSheet.absoluteFillObject} contentFit="contain" />
          ) : source.kind === 'media' ? (
            <StoryEditorVideoPreview uri={source.uri} />
          ) : (
            <View style={styles.sharedPreview}>
              {source.previewUrl ? <Image source={{ uri: source.previewUrl }} style={styles.sharedImage} contentFit="cover" /> : <View style={styles.sharedImage} />}
              <View style={styles.sharedCopy}>
                <Text style={styles.sharedType}>{source.contentType === 'reel' ? 'REEL' : 'POST'}</Text>
                <View style={styles.sharedCreator}>
                  <Avatar uri={source.avatarUrl || ''} username={source.username} size={28} />
                  <Text style={styles.sharedUser}>@{source.username}</Text>
                </View>
                {source.caption ? <Text numberOfLines={2} style={styles.sharedCaption}>{source.caption}</Text> : null}
              </View>
            </View>
          )}
          {stage.width > 0 && stage.height > 0 ? composition.elements.map(element => {
            const interactiveDraft = element.type === 'interactive'
              ? interactiveDrafts.find(item => item.definition.element_id === element.element_id) ?? null
              : null;
            return (
              <EditableElement
                key={element.id}
                element={element}
                definition={interactiveDraft?.definition ?? null}
                selected={selectedId === element.id}
                onSelect={() => setSelectedId(element.id)}
                onChange={updateElement}
                onEdit={() => {
                  if (element.type === 'text' || element.type === 'question_answer') setEditingTextId(element.id);
                  if (interactiveDraft) setInteractiveSheetDraft(interactiveDraft);
                }}
                onDelete={() => removeElement(element)}
                onReorder={destination => setElements(reorderStoryLayer(composition.elements, element.id, destination))}
                stage={stage}
              />
            );
          }) : null}
        </Pressable>

        {editingTextId && selected?.type === 'text' ? (
          <TextInput
            autoFocus
            accessibilityLabel="Texto superpuesto"
            multiline
            maxLength={200}
            value={selected.text}
            onChangeText={text => updateElement({ ...selected, text: text.replace(/[<>]/g, '') })}
            onBlur={finishTextEditing}
            textAlignVertical="top"
            style={[styles.textInput, { bottom: toolbarHeight + 12, textAlign: selected.align }]}
          />
        ) : null}

        {editingTextId && selected?.type === 'question_answer' ? (
          <TextInput autoFocus accessibilityLabel="Tu respuesta" multiline
            value={selected.answer} placeholder="Escribe tu respuesta (máximo 500 caracteres)"
            onChangeText={answer => updateElement({ ...selected, answer: [...answer].slice(0, 500).join('') })}
            onBlur={finishTextEditing} textAlignVertical="top"
            style={[styles.textInput, { bottom: toolbarHeight + 64 }]} />
        ) : null}

        {selected ? (
          <View style={[styles.layerControls, { bottom: toolbarHeight + 12 }]}>
            {selected.type === 'question_answer' ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Editar respuesta"
                onPress={() => setEditingTextId(selected.id)} style={styles.layerAction}>
                <Text style={styles.layerActionText}>Respuesta</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar elemento al fondo"
              onPress={() => setElements(reorderStoryLayer(composition.elements, selected.id, 'back'))}
              style={styles.layerAction}
            >
              <MaterialIcons name="vertical-align-bottom" color="#fff" size={19} />
              <Text style={styles.layerActionText}>Fondo</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Traer elemento al frente"
              onPress={() => setElements(reorderStoryLayer(composition.elements, selected.id, 'front'))}
              style={styles.layerAction}
            >
              <MaterialIcons name="vertical-align-top" color="#fff" size={19} />
              <Text style={styles.layerActionText}>Frente</Text>
            </Pressable>
          </View>
        ) : null}

        {showStickerPicker ? (
          <View style={[styles.stickerPicker, { bottom: toolbarHeight + 10 }]}>
            {STORY_STICKERS.slice(0, 6).map(item => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Añadir ${item}`} style={styles.stickerChoice} key={item} onPress={() => addSticker(item)}>
                <Text style={styles.stickerButton}>{item}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={[styles.toolbar, { minHeight: toolbarHeight, paddingBottom: Math.max(insets.bottom, 24) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Añadir texto"
            accessibilityHint={selected?.type === 'text' ? 'Edita el texto seleccionado' : 'Añade texto a la historia'}
            onPress={() => selected?.type === 'text' ? setEditingTextId(selected.id) : addText()}
            style={[styles.tool, toolSizeStyle, editingTextId && styles.toolSelected]}
          ><Text style={styles.toolText}>Aa</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Elegir sticker" onPress={() => setShowStickerPicker(value => !value)} style={[styles.tool, toolSizeStyle, showStickerPicker && styles.toolSelected]}><Text style={styles.stickerToolIcon}>☺</Text></Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={selected?.type === 'interactive' ? 'Editar interacción' : 'Añadir interacción'}
            onPress={() => {
              if (selected?.type === 'interactive') {
                const draft = interactiveDrafts.find(item => item.definition.element_id === selected.element_id);
                if (draft) setInteractiveSheetDraft(draft);
              } else openNewInteractive();
            }}
            style={[styles.tool, toolSizeStyle]}
          ><MaterialIcons name="poll" color="#fff" size={21} /></Pressable>
          <Pressable disabled={selected?.type !== 'text'} accessibilityRole="button" accessibilityLabel="Cambiar color" onPress={() => selected?.type === 'text' && updateElement({ ...selected, color: STORY_TEXT_COLORS[(STORY_TEXT_COLORS.indexOf(selected.color) + 1) % STORY_TEXT_COLORS.length] })} style={[styles.tool, toolSizeStyle, selected?.type !== 'text' && styles.toolDisabled]}><View style={[styles.color, { backgroundColor: selected?.type === 'text' ? selected.color : '#FFFFFF' }]} /></Pressable>
          <Pressable disabled={selected?.type !== 'text'} accessibilityRole="button" accessibilityLabel="Cambiar tamaño" style={[styles.tool, toolSizeStyle, selected?.type !== 'text' && styles.toolDisabled]} onPress={() => selected?.type === 'text' && updateElement({ ...selected, size: selected.size === 'small' ? 'medium' : selected.size === 'medium' ? 'large' : 'small' })}><MaterialIcons name="format-size" color="#fff" size={20} /></Pressable>
          <Pressable disabled={!selected} accessibilityRole="button" accessibilityLabel="Eliminar elemento" style={[styles.tool, toolSizeStyle, !selected && styles.toolDisabled, selected && styles.deleteTool]} onPress={() => selected && removeElement(selected)}><MaterialIcons name="backspace" color="#fff" size={20} /></Pressable>
          <Text pointerEvents="none" style={styles.toolbarHint}>Arrastra · pellizca · gira · edita</Text>
        </View>
        {error ? <Text style={styles.error}>{questionAnswerSeed
          ? 'Conserva la pregunta y escribe una respuesta válida de 1 a 500 caracteres. Tu edición sigue aquí; puedes reintentar.'
          : 'No se pudo publicar. Tu edición sigue aquí.'}</Text> : null}
        <StoryInteractiveEditorSheet
          visible={interactiveSheetDraft !== null}
          draft={interactiveSheetDraft}
          onCancel={() => setInteractiveSheetDraft(null)}
          onSave={saveInteractiveDraft}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050507' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, paddingHorizontal: 17, paddingBottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(8,8,13,0.72)' },
  headerButton: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', zIndex: 2 },
  title: { position: 'absolute', left: 0, right: 0, color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  publish: { height: 38, backgroundColor: '#7C5CFF', borderRadius: 19, paddingHorizontal: 16, justifyContent: 'center', width: 88, alignItems: 'center', zIndex: 2 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.58 },
  publishText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  canvas: { overflow: 'hidden', backgroundColor: Colors.surface },
  editable: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  selected: { borderWidth: 2, borderColor: Colors.primaryLight, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)' },
  sharedPreview: { width: '84%', maxWidth: 430, alignSelf: 'center', marginTop: '18%', borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.borderHighlight },
  sharedImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: Colors.surfaceHighlight },
  sharedCopy: { padding: 16 },
  sharedType: { color: Colors.primary, fontWeight: '900', fontSize: 12 },
  sharedCreator: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 },
  sharedUser: { color: '#fff', fontWeight: '800' },
  sharedCaption: { color: '#ddd', marginTop: 5 },
  toolbar: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 19, paddingTop: 28, backgroundColor: 'rgba(11,11,16,0.94)' },
  tool: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: 'transparent', backgroundColor: '#23232D', alignItems: 'center', justifyContent: 'center' },
  toolCompact: { width: 44, height: 44, borderRadius: 22 },
  toolSelected: { borderWidth: 2, borderColor: '#7C5CFF', backgroundColor: '#181820' },
  toolDisabled: { opacity: 0.42 },
  toolText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  stickerToolIcon: { color: '#fff', fontSize: 19, fontWeight: '500' },
  stickerPicker: { position: 'absolute', left: 19, right: 19, zIndex: 30, minHeight: 58, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, backgroundColor: 'rgba(17,17,24,0.96)' },
  stickerChoice: { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  stickerButton: { fontSize: 25 },
  color: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: '#fff' },
  deleteTool: { backgroundColor: '#23232D' },
  toolbarHint: { position: 'absolute', left: 0, right: 0, bottom: 8, color: '#6F7080', fontSize: 11, fontWeight: '500', textAlign: 'center' },
  layerControls: { position: 'absolute', right: 12, zIndex: 30, flexDirection: 'row', gap: 8 },
  layerAction: { minWidth: 44, height: 44, paddingHorizontal: 8, borderRadius: 22, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,17,24,0.9)', borderWidth: 1, borderColor: Colors.borderHighlight },
  layerActionText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  textInput: { position: 'absolute', left: Spacing.md, right: Spacing.md, minHeight: 96, maxHeight: 180, backgroundColor: Colors.textPrimary, color: Colors.textInverse, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: 20, lineHeight: 26, zIndex: 20 },
  error: { position: 'absolute', left: 16, right: 16, bottom: 4, zIndex: 40, color: '#ff7b91', textAlign: 'center', paddingBottom: 8 },
});
