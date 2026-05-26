/**
 * components/upload/LiveTitleModal.tsx
 * Modal for entering a live stream title before starting a broadcast.
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

interface Props {
  visible:  boolean;
  onCancel: () => void;
  onStart:  (title: string) => void;
}

export function LiveTitleModal({ visible, onCancel, onStart }: Props) {
  const [title, setTitle] = useState('');
  const insets = useSafeAreaInsets();

  const handleStart = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    onStart(t);
    setTitle('');
  }, [title, onStart]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={s.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.kav}
        >
          <View style={[s.card, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <LinearGradient
              colors={['rgba(255,45,85,0.15)', 'rgba(255,45,85,0.05)']}
              style={s.header}
            >
              <View style={s.liveDot} />
              <Text style={s.headerTitle}>Iniciar Live</Text>
            </LinearGradient>

            <View style={s.body}>
              <Text style={s.label}>Título de tu transmisión *</Text>
              <TextInput
                style={s.input}
                value={title}
                onChangeText={setTitle}
                placeholder="ej: Tutorial BlockDAG en vivo"
                placeholderTextColor={Colors.textSubtle}
                maxLength={100}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleStart}
              />
              <Text style={s.hint}>
                Un buen título atrae más espectadores y aumenta tus ganancias en $DAG
              </Text>

              <View style={s.btns}>
                <Pressable style={s.cancelBtn} onPress={onCancel}>
                  <Text style={s.cancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={[s.startBtn, !title.trim() && s.startBtnDisabled]}
                  onPress={handleStart}
                  disabled={!title.trim()}
                >
                  <LinearGradient
                    colors={['#FF2D55', '#FF6B35']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={s.startBtnGrad}
                  >
                    <View style={s.startDot} />
                    <Text style={s.startText}>Abrir Cámara</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  kav:          { width: '100%' },
  card:         { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: 'rgba(255,45,85,0.2)', overflow: 'hidden' },
  header:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(255,45,85,0.15)' },
  liveDot:      { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.secondary },
  headerTitle:  { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  body:         { padding: Spacing.lg, gap: Spacing.md },
  label:        { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  input:        { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, color: Colors.textPrimary, fontSize: FontSize.md },
  hint:         { color: Colors.textSubtle, fontSize: FontSize.xs, lineHeight: 18 },
  btns:         { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  cancelBtn:    { flex: 1, paddingVertical: 13, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText:   { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  startBtn:     { flex: 2, borderRadius: Radius.md, overflow: 'hidden' },
  startBtnDisabled: { opacity: 0.4 },
  startBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, gap: 8 },
  startDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  startText:    { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold, letterSpacing: 0.5 },
});
