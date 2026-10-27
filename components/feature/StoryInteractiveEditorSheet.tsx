import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { STORY_STICKERS } from './storyComposition';
import type {
  StoryInteractiveDefinition,
  StoryInteractiveDraft,
  StoryInteractiveKind,
  StoryInteractiveOption,
} from './storyInteractiveTypes';

const KINDS: readonly { type: StoryInteractiveKind; label: string }[] = [
  { type: 'poll', label: 'Encuesta' },
  { type: 'slider', label: 'Slider' },
  { type: 'quiz', label: 'Quiz' },
  { type: 'question', label: 'Pregunta' },
  { type: 'reaction', label: 'Reacción' },
];

function newOption(label = ''): StoryInteractiveOption {
  return { id: `option-${Crypto.randomUUID()}`, label };
}

function changeKind(draft: StoryInteractiveDraft, type: StoryInteractiveKind): StoryInteractiveDraft {
  const base = { version: 1 as const, element_id: draft.definition.element_id, prompt: draft.definition.prompt };
  if (type === 'poll' || type === 'quiz') {
    const options = draft.definition.type === 'poll' || draft.definition.type === 'quiz'
      ? draft.definition.options
      : [newOption('Opción 1'), newOption('Opción 2')];
    return { definition: { ...base, type, options }, correctOptionId: type === 'quiz' ? draft.correctOptionId : null };
  }
  if (type === 'slider' || type === 'reaction') {
    const emoji = draft.definition.type === 'slider' || draft.definition.type === 'reaction'
      ? draft.definition.emoji
      : '🔥';
    return { definition: { ...base, type, emoji }, correctOptionId: null };
  }
  return { definition: { ...base, type: 'question' }, correctOptionId: null };
}

export function StoryInteractiveEditorSheet({
  visible,
  draft,
  onCancel,
  onSave,
}: {
  visible: boolean;
  draft: StoryInteractiveDraft | null;
  onCancel: () => void;
  onSave: (draft: StoryInteractiveDraft) => void;
}) {
  const insets = useSafeAreaInsets();
  const [working, setWorking] = useState<StoryInteractiveDraft | null>(draft);
  useEffect(() => { if (visible) setWorking(draft); }, [draft, visible]);
  if (!working) return null;
  const definition = working.definition;
  const setDefinition = (next: StoryInteractiveDefinition) => setWorking(current => current ? { ...current, definition: next } : current);
  const valid = definition.prompt.trim().length > 0
    && definition.prompt.trim().length <= 200
    && (definition.type !== 'poll' && definition.type !== 'quiz'
      || (definition.options.length >= 2 && definition.options.length <= 6
        && definition.options.every(option => option.label.trim().length > 0 && option.label.trim().length <= 80)));

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancelar interacción" onPress={onCancel} style={styles.action}><Text style={styles.secondary}>Cancelar</Text></Pressable>
            <Text style={styles.title}>Sticker interactivo</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Guardar interacción" disabled={!valid} onPress={() => valid && onSave(working)} style={styles.action}><Text style={[styles.primary, !valid && styles.disabled]}>Guardar</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={styles.label}>Tipo</Text>
            <View style={styles.kindRow}>
              {KINDS.map(item => (
                <Pressable key={item.type} accessibilityRole="button" accessibilityState={{ selected: definition.type === item.type }} accessibilityLabel={`Tipo ${item.label}`} onPress={() => setWorking(changeKind(working, item.type))} style={[styles.kind, definition.type === item.type && styles.kindSelected]}>
                  <Text style={styles.kindText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Pregunta o indicación</Text>
            <TextInput accessibilityLabel="Pregunta interactiva" maxLength={200} multiline value={definition.prompt} onChangeText={prompt => setDefinition({ ...definition, prompt })} style={styles.input} />
            {definition.type === 'poll' || definition.type === 'quiz' ? (
              <View>
                <Text style={styles.label}>Opciones</Text>
                {definition.options.map((option, index) => (
                  <View key={option.id} style={styles.optionRow}>
                    {definition.type === 'quiz' ? (
                      <Pressable accessibilityRole="radio" accessibilityState={{ checked: working.correctOptionId === option.id }} accessibilityLabel={`Marcar opción ${index + 1} como correcta`} onPress={() => setWorking({ ...working, correctOptionId: working.correctOptionId === option.id ? null : option.id })} style={styles.radio}>
                        <Text style={styles.radioText}>{working.correctOptionId === option.id ? '✓' : '○'}</Text>
                      </Pressable>
                    ) : null}
                    <TextInput accessibilityLabel={`Opción ${index + 1}`} maxLength={80} value={option.label} onChangeText={label => setDefinition({ ...definition, options: definition.options.map(item => item.id === option.id ? { ...item, label } : item) })} style={[styles.input, styles.optionInput]} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Eliminar opción ${index + 1}`}
                      disabled={definition.options.length <= 2}
                      onPress={() => setWorking(current => current ? {
                        ...current,
                        correctOptionId: current.correctOptionId === option.id ? null : current.correctOptionId,
                        definition: {
                          ...definition,
                          options: definition.options.filter(item => item.id !== option.id),
                        },
                      } : current)}
                      style={styles.iconAction}
                    ><Text style={styles.remove}>−</Text></Pressable>
                  </View>
                ))}
                <Pressable accessibilityRole="button" accessibilityLabel="Añadir opción" disabled={definition.options.length >= 6} onPress={() => setDefinition({ ...definition, options: [...definition.options, newOption(`Opción ${definition.options.length + 1}`)] })} style={styles.addOption}><Text style={styles.primary}>Añadir opción</Text></Pressable>
              </View>
            ) : null}
            {definition.type === 'slider' || definition.type === 'reaction' ? (
              <View><Text style={styles.label}>Emoji</Text><View style={styles.emojiRow}>{STORY_STICKERS.slice(0, 8).map(emoji => (
                <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`Emoji ${emoji}`} accessibilityState={{ selected: definition.emoji === emoji }} onPress={() => setDefinition({ ...definition, emoji })} style={[styles.emoji, definition.emoji === emoji && styles.kindSelected]}><Text style={styles.emojiText}>{emoji}</Text></Pressable>
              ))}</View></View>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: { maxHeight: '86%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#111118' },
  header: { minHeight: 64, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: Colors.border },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  action: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  primary: { color: Colors.primaryLight, fontWeight: '800' },
  secondary: { color: '#B7B5C2', fontWeight: '700' },
  disabled: { opacity: 0.42 },
  content: { padding: Spacing.md, paddingBottom: 36 },
  label: { color: '#D9D7E2', fontSize: 13, fontWeight: '800', marginTop: 15, marginBottom: 7 },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kind: { minHeight: 44, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#252530', borderWidth: 1, borderColor: 'transparent' },
  kindSelected: { borderColor: Colors.primaryLight, backgroundColor: '#312A52' },
  kindText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  input: { minHeight: 48, borderRadius: Radius.lg, backgroundColor: '#24242D', color: '#fff', paddingHorizontal: 13, paddingVertical: 11, fontSize: 15 },
  optionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  optionInput: { flex: 1 },
  radio: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  radioText: { color: '#fff', fontSize: 23 },
  iconAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  remove: { color: '#FF7B91', fontSize: 28 },
  addOption: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emoji: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent', backgroundColor: '#24242D' },
  emojiText: { fontSize: 24 },
});
