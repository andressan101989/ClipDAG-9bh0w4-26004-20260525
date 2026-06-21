import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, Modal, TextInput, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAlert } from '@/template';
import { submitReport, type ReportReason } from '@/services/reportService';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const REASONS: Array<{ key: ReportReason; label: string }> = [
  { key: 'spam',           label: 'Spam' },
  { key: 'inappropriate',  label: 'Contenido inapropiado' },
  { key: 'harassment',     label: 'Acoso o bullying' },
  { key: 'violence',       label: 'Violencia' },
  { key: 'hate_speech',    label: 'Discurso de odio' },
  { key: 'misinformation', label: 'Información falsa' },
  { key: 'other',          label: 'Otro' },
];

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  reporterId: string;
  contentId: string;
  contentType: 'video' | 'comment' | 'user';
}

export function ReportModal({ visible, onClose, reporterId, contentId, contentType }: ReportModalProps) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const [selected, setSelected] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!selected) {
      showAlert('Selecciona una razón', 'Por favor elige el motivo del reporte');
      return;
    }
    setLoading(true);
    const result = await submitReport(
      reporterId, contentId, contentType, selected,
      details.trim() || undefined,
    );
    setLoading(false);
    if (result.success) {
      setSelected(null);
      setDetails('');
      onClose();
      showAlert('Gracias', 'Revisaremos tu reporte en los próximos días');
    } else {
      showAlert('Error', result.error || 'No se pudo enviar el reporte');
    }
  }, [selected, details, reporterId, contentId, contentType, onClose, showAlert]);

  const handleClose = useCallback(() => {
    setSelected(null);
    setDetails('');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>Reportar contenido</Text>
            <Pressable onPress={handleClose} hitSlop={10} style={styles.closeBtn}>
              <MaterialIcons name="close" size={22} color={Colors.textSubtle} />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>¿Por qué quieres reportar esto?</Text>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
            {REASONS.map(r => (
              <Pressable
                key={r.key}
                style={[styles.reasonRow, selected === r.key && styles.reasonRowSelected]}
                onPress={() => setSelected(r.key)}
              >
                <View style={[styles.radio, selected === r.key && styles.radioSelected]}>
                  {selected === r.key ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={[styles.reasonLabel, selected === r.key && styles.reasonLabelSelected]}>
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {selected === 'other' ? (
            <TextInput
              style={styles.textInput}
              value={details}
              onChangeText={setDetails}
              placeholder="Describe el problema (opcional)"
              placeholderTextColor={Colors.textSubtle}
              multiline
              numberOfLines={3}
              maxLength={300}
            />
          ) : null}

          <Pressable
            style={[styles.submitBtn, (!selected || loading) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!selected || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Enviar reporte</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  closeBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  subtitle: {
    color: Colors.textSubtle,
    fontSize: FontSize.sm,
    marginBottom: 4,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  reasonRowSelected: {
    backgroundColor: Colors.primary + '14',
    borderColor: Colors.primary + '44',
  },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: {
    borderColor: Colors.primary,
  },
  radioDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  reasonLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
  reasonLabelSelected: {
    color: Colors.textPrimary,
    fontWeight: FontWeight.semibold,
  },
  textInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    color: Colors.textPrimary,
    fontSize: FontSize.sm,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: {
    opacity: 0.45,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
});
