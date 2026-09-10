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
  const CANVAS_H = Math.max(360, screenHeight - insets.top - insets.bottom - 142);
  const [composition, setComposition] = useState<StoryComposition>(EMPTY_STORY_COMPOSITION);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(false);
  const clientStoryIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || !source) return;
    setComposition({ version: 1, elements: [] });
    setSelectedId(null);
    setEditingTextId(null);
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
        <View style={[styles.header, { paddingTop: Math.max(insets.top, Spacing.sm) }]}>
          <Pressable
            accessibilityRole="button"
            onPress={cancel}
            disabled={publishing}
            accessibilityLabel="Cancelar editor"
            hitSlop={8}
            style={styles.headerButton}
          >
            <MaterialIcons name="close" color="#fff" size={28} />
          </Pressable>
          <Text style={styles.title}>Tu historia</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Publicar historia"
            onPress={() => void submit()}
            disabled={publishing}
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
            style={[styles.textInput, { bottom: 72 + Math.max(insets.bottom, Spacing.sm) }]}
          />
        ) : null}

        <View style={[styles.toolbar, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Añadir texto" onPress={addText} style={styles.tool}><Text style={styles.toolText}>Aa</Text></Pressable>
          <View style={styles.stickers}>{STORY_STICKERS.slice(0, 6).map(item => <Pressable accessibilityRole="button" accessibilityLabel={`Añadir ${item}`} style={styles.stickerTool} key={item} onPress={() => addSticker(item)}><Text style={styles.stickerButton}>{item}</Text></Pressable>)}</View>
          {selected?.type === 'text' ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Cambiar color" onPress={() => updateElement({ ...selected, color: STORY_TEXT_COLORS[(STORY_TEXT_COLORS.indexOf(selected.color) + 1) % STORY_TEXT_COLORS.length] })} style={[styles.tool, styles.colorTool]}><View style={[styles.color, { backgroundColor: selected.color }]} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cambiar tamaño" style={styles.tool} onPress={() => updateElement({ ...selected, size: selected.size === 'small' ? 'medium' : selected.size === 'medium' ? 'large' : 'small' })}><MaterialIcons name="format-size" color="#fff" size={24} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Editar texto" style={styles.tool} onPress={() => setEditingTextId(selected.id)}><MaterialIcons name="edit" color="#fff" size={24} /></Pressable>
          </> : null}
          {selected ? <Pressable accessibilityRole="button" accessibilityLabel="Eliminar elemento" style={[styles.tool, styles.deleteTool]} onPress={() => { setComposition(current => ({ ...current, elements: current.elements.filter(item => item.id !== selected.id) })); setSelectedId(null); }}><MaterialIcons name="delete-outline" color="#fff" size={26} /></Pressable> : null}
        </View>
        {error ? <Text style={styles.error}>No se pudo publicar. Tu edición sigue aquí.</Text> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050507' },
  header: { minHeight: 68, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  publish: { minHeight: 44, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 18, justifyContent: 'center', minWidth: 92, alignItems: 'center' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.58 },
  publishText: { color: '#fff', fontWeight: '800' },
  canvas: { overflow: 'hidden', backgroundColor: Colors.surface, position: 'relative' },
  editable: { position: 'absolute', width: 130, minHeight: 70, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  selected: { borderWidth: 1.5, borderColor: Colors.primaryLight, borderRadius: Radius.md, backgroundColor: 'rgba(124,92,255,0.08)' },
  sharedPreview: { width: '84%', maxWidth: 430, alignSelf: 'center', marginTop: '18%', borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.borderHighlight },
  sharedImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: Colors.surfaceHighlight },
  sharedCopy: { padding: 16 },
  sharedType: { color: Colors.primary, fontWeight: '900', fontSize: 12 },
  sharedCreator: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 },
  sharedUser: { color: '#fff', fontWeight: '800' },
  sharedCaption: { color: '#ddd', marginTop: 5 },
  toolbar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm, backgroundColor: Colors.bg },
  tool: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  toolText: { color: '#fff', fontSize: 19, fontWeight: '900' },
  stickers: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  stickerTool: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  stickerButton: { fontSize: 25 },
  color: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#fff' },
  colorTool: { padding: 0 },
  deleteTool: { backgroundColor: 'rgba(255,59,92,0.18)' },
  textInput: { position: 'absolute', left: Spacing.md, right: Spacing.md, minHeight: 48, backgroundColor: Colors.textPrimary, color: Colors.textInverse, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, zIndex: 20 },
  error: { color: '#ff7b91', textAlign: 'center', paddingBottom: 8 },
});
