import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable,
  StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { Image } from '@/components/ui/SafeImage';
import { Avatar } from '@/components/ui/Avatar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  EMPTY_STORY_COMPOSITION, STORY_STICKERS, STORY_TEXT_COLORS,
  type StoryComposition, type StoryCompositionElement, type StoryTextElement,
} from './storyComposition';
import { StoryEditorVideoPreview } from './StoryEditorVideoPreview';

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

function distance(touches: readonly { pageX: number; pageY: number }[]) {
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

function EditableElement({
  element, selected, onSelect, onChange, canvasWidth, canvasHeight,
}: {
  element: StoryCompositionElement;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: StoryCompositionElement) => void;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const CANVAS_W = canvasWidth;
  const CANVAS_H = canvasHeight;
  const start = useRef({ x: element.x, y: element.y, scale: element.scale, pinch: 0 });
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      onSelect();
      start.current = {
        x: element.x, y: element.y, scale: element.scale,
        pinch: distance(event.nativeEvent.touches),
      };
    },
    onPanResponderMove: (event, gesture) => {
      const pinch = distance(event.nativeEvent.touches);
      if (pinch > 0 && start.current.pinch > 0) {
        onChange({ ...element, scale: Math.max(0.5, Math.min(4, start.current.scale * pinch / start.current.pinch)) });
        return;
      }
      onChange({
        ...element,
        x: Math.max(0, Math.min(1, start.current.x + gesture.dx / CANVAS_W)),
        y: Math.max(0, Math.min(1, start.current.y + gesture.dy / CANVAS_H)),
      });
    },
  }), [CANVAS_H, CANVAS_W, element, onChange, onSelect]);
  const fontSize = element.type === 'text'
    ? ({ small: 22, medium: 32, large: 44 } as const)[element.size]
    : 48;
  return (
    <View
      {...responder.panHandlers}
      style={[
        styles.editable,
        selected && styles.selected,
        {
          left: element.x * CANVAS_W - 65,
          top: element.y * CANVAS_H - 35,
          transform: [{ scale: element.scale }, { rotate: `${element.rotation}deg` }],
        },
      ]}
    >
      <Text style={element.type === 'text' ? {
        color: element.color, fontSize, fontWeight: '800', textAlign: element.align,
        textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 4,
      } : { fontSize }}>
        {element.type === 'text' ? element.text : element.value}
      </Text>
    </View>
  );
}

export function StoryEditor({
  visible, source, onCancel, onPublish,
}: {
  visible: boolean;
  source: StoryEditorSource | null;
  onCancel: (clientStoryId?: string) => void;
  onPublish: (source: StoryEditorSource, composition: StoryComposition, clientStoryId: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const { width: CANVAS_W, height: screenHeight } = useWindowDimensions();
  const headerHeight = Math.max(92, insets.top + 56);
  const toolbarHeight = Math.max(122, insets.bottom + 88);
  const CANVAS_H = Math.max(360, screenHeight - headerHeight - toolbarHeight);
  const [composition, setComposition] = useState<StoryComposition>(EMPTY_STORY_COMPOSITION);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(false);
  const clientStoryIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || !source) return;
    setComposition({ version: 1, elements: [] });
    setSelectedId(null);
    setEditingTextId(null);
    setShowStickerPicker(false);
    setError(false);
    clientStoryIdRef.current = Crypto.randomUUID();
  }, [source, visible]);

  const updateElement = (next: StoryCompositionElement) => {
    setComposition(current => ({
      ...current,
      elements: current.elements.map(item => item.id === next.id ? next : item),
    }));
  };
  const addText = () => {
    if (composition.elements.length >= STORY_MAX_ELEMENTS
      || composition.elements.filter(item => item.type === 'text').length >= STORY_MAX_TEXT_ELEMENTS) return;
    const element: StoryTextElement = {
      id: Crypto.randomUUID(), type: 'text', text: 'Texto', x: 0.5, y: 0.35,
      scale: 1, rotation: 0, color: '#FFFFFF', align: 'center', size: 'medium',
    };
    setComposition(current => ({ ...current, elements: [...current.elements, element] }));
    setSelectedId(element.id);
    setShowStickerPicker(false);
    setEditingTextId(element.id);
  };
  const addSticker = (value: typeof STORY_STICKERS[number]) => {
    if (composition.elements.length >= STORY_MAX_ELEMENTS
      || composition.elements.filter(item => item.type === 'sticker').length >= STORY_MAX_STICKER_ELEMENTS) return;
    const element = { id: Crypto.randomUUID(), type: 'sticker' as const, value, x: 0.5, y: 0.5, scale: 1, rotation: 0 };
    setComposition(current => ({ ...current, elements: [...current.elements, element] }));
    setSelectedId(element.id);
  };
  const selected = composition.elements.find(item => item.id === selectedId) ?? null;
  const finishTextEditing = () => {
    if (editingTextId && selected?.type === 'text' && selected.id === editingTextId
      && selected.text.trim().length === 0) {
      setComposition(current => ({
        ...current,
        elements: current.elements.filter(item => item.id !== editingTextId),
      }));
      setSelectedId(null);
    }
    setEditingTextId(null);
  };
  const cancel = () => { if (!publishing) onCancel(clientStoryIdRef.current ?? undefined); };
  const submit = async () => {
    if (!source || publishing) return;
    if (!clientStoryIdRef.current) clientStoryIdRef.current = Crypto.randomUUID();
    const publishableComposition: StoryComposition = {
      ...composition,
      elements: composition.elements.filter(element => element.type !== 'text' || element.text.trim().length > 0),
    };
    if (publishableComposition.elements.length !== composition.elements.length) {
      setComposition(publishableComposition);
      setEditingTextId(null);
      setSelectedId(null);
    }
    setPublishing(true);
    setError(false);
    try {
      await onPublish(source, publishableComposition, clientStoryIdRef.current);
    } catch {
      setError(true);
    } finally {
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
          style={[styles.canvas, { height: CANVAS_H }]}
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
          {composition.elements.map(element => (
            <EditableElement
              key={element.id}
              element={element}
              selected={selectedId === element.id}
              onSelect={() => setSelectedId(element.id)}
              onChange={updateElement}
              canvasWidth={CANVAS_W}
              canvasHeight={CANVAS_H}
            />
          ))}
        </Pressable>

        {editingTextId && selected?.type === 'text' ? (
          <TextInput
            autoFocus
            accessibilityLabel="Texto superpuesto"
            maxLength={200}
            value={selected.text}
            onChangeText={text => updateElement({ ...selected, text: text.replace(/[<>]/g, '') })}
            onBlur={finishTextEditing}
            style={[styles.textInput, { bottom: toolbarHeight + 12 }]}
          />
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
            style={[styles.tool, editingTextId && styles.toolSelected]}
          ><Text style={styles.toolText}>Aa</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Elegir sticker" onPress={() => setShowStickerPicker(value => !value)} style={[styles.tool, showStickerPicker && styles.toolSelected]}><Text style={styles.stickerToolIcon}>☺</Text></Pressable>
          <Pressable disabled={selected?.type !== 'text'} accessibilityRole="button" accessibilityLabel="Cambiar color" onPress={() => selected?.type === 'text' && updateElement({ ...selected, color: STORY_TEXT_COLORS[(STORY_TEXT_COLORS.indexOf(selected.color) + 1) % STORY_TEXT_COLORS.length] })} style={[styles.tool, selected?.type !== 'text' && styles.toolDisabled]}><View style={[styles.color, { backgroundColor: selected?.type === 'text' ? selected.color : '#FFFFFF' }]} /></Pressable>
          <Pressable disabled={selected?.type !== 'text'} accessibilityRole="button" accessibilityLabel="Cambiar tamaño" style={[styles.tool, selected?.type !== 'text' && styles.toolDisabled]} onPress={() => selected?.type === 'text' && updateElement({ ...selected, size: selected.size === 'small' ? 'medium' : selected.size === 'medium' ? 'large' : 'small' })}><MaterialIcons name="format-size" color="#fff" size={20} /></Pressable>
          <Pressable disabled={!selected} accessibilityRole="button" accessibilityLabel="Eliminar elemento" style={[styles.tool, !selected && styles.toolDisabled, selected && styles.deleteTool]} onPress={() => { if (!selected) return; setComposition(current => ({ ...current, elements: current.elements.filter(item => item.id !== selected.id) })); setSelectedId(null); }}><MaterialIcons name="backspace" color="#fff" size={20} /></Pressable>
          <Text pointerEvents="none" style={styles.toolbarHint}>Arrastra · pellizca · edita</Text>
        </View>
        {error ? <Text style={styles.error}>No se pudo publicar. Tu edición sigue aquí.</Text> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050507' },
  header: { paddingHorizontal: 17, paddingBottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(8,8,13,0.72)' },
  headerButton: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', zIndex: 2 },
  title: { position: 'absolute', left: 0, right: 0, color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  publish: { height: 38, backgroundColor: '#7C5CFF', borderRadius: 19, paddingHorizontal: 16, justifyContent: 'center', width: 88, alignItems: 'center', zIndex: 2 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.58 },
  publishText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  canvas: { overflow: 'hidden', backgroundColor: Colors.surface, position: 'relative' },
  editable: { position: 'absolute', width: 130, minHeight: 70, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  selected: { borderWidth: 2, borderColor: Colors.primaryLight, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.28)' },
  sharedPreview: { width: '84%', maxWidth: 430, alignSelf: 'center', marginTop: '18%', borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.borderHighlight },
  sharedImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: Colors.surfaceHighlight },
  sharedCopy: { padding: 16 },
  sharedType: { color: Colors.primary, fontWeight: '900', fontSize: 12 },
  sharedCreator: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 },
  sharedUser: { color: '#fff', fontWeight: '800' },
  sharedCaption: { color: '#ddd', marginTop: 5 },
  toolbar: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 19, paddingTop: 28, backgroundColor: 'rgba(11,11,16,0.94)' },
  tool: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: 'transparent', backgroundColor: '#23232D', alignItems: 'center', justifyContent: 'center' },
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
  textInput: { position: 'absolute', left: Spacing.md, right: Spacing.md, minHeight: 48, backgroundColor: Colors.textPrimary, color: Colors.textInverse, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, zIndex: 20 },
  error: { color: '#ff7b91', textAlign: 'center', paddingBottom: 8 },
});
