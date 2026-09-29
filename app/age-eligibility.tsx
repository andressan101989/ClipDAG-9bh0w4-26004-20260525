import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import {
  getMyAgeEligibilityStatus,
  remediateMyAgeEligibility,
  type AgeEligibilityStatus,
} from '@/services/ageEligibilityService';
import { formatLocalCalendarDate, validateSignupDob } from '@/utils/signupDob';

const defaultPickerDate = () => {
  const value = new Date();
  value.setFullYear(value.getFullYear() - 18);
  return value;
};

const validationMessage = (code: ReturnType<typeof validateSignupDob>) => {
  switch (code) {
    case 'required': return 'Selecciona tu fecha de nacimiento.';
    case 'invalid': return 'La fecha seleccionada no es válida.';
    case 'future': return 'La fecha no puede estar en el futuro.';
    case 'underage': return 'Debes tener al menos 13 años para usar Nelyon.';
    default: return null;
  }
};

export default function AgeEligibilityScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [status, setStatus] = useState<AgeEligibilityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [pickerDate, setPickerDate] = useState(defaultPickerDate);
  const [showPicker, setShowPicker] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dateRef = useRef('');
  const mountedRef = useRef(true);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const next = await getMyAgeEligibilityStatus();
      if (mountedRef.current) setStatus(next);
    } catch {
      if (mountedRef.current) {
        setStatus(null);
        setErrorMessage('No pudimos consultar tu estado de elegibilidad. Inténtalo de nuevo.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadStatus();
    return () => {
      mountedRef.current = false;
      dateRef.current = '';
    };
  }, [loadStatus]);

  const updateDate = useCallback((event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setShowPicker(false);
    if (event.type !== 'set' || !selected) return;
    setPickerDate(selected);
    const formatted = formatLocalCalendarDate(selected);
    dateRef.current = formatted;
    setDateOfBirth(formatted);
    setErrorMessage(null);
  }, []);

  const submit = useCallback(async () => {
    const clientError = validationMessage(validateSignupDob(dateOfBirth));
    if (clientError) {
      setErrorMessage(clientError);
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await remediateMyAgeEligibility(dateOfBirth);
      dateRef.current = '';
      setDateOfBirth('');
      setShowPicker(false);
      const next = await getMyAgeEligibilityStatus();
      if (!mountedRef.current) return;
      setStatus(next);
      if (next.state !== 'complete') {
        setErrorMessage('La verificación no pudo completarse. Revisa la fecha e inténtalo de nuevo.');
      }
    } catch {
      if (mountedRef.current) {
        setErrorMessage('La fecha no coincide con la verificación existente de tu cuenta. No se realizó ningún cambio.');
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }, [dateOfBirth]);

  const remediationRequired = status?.state === 'remediation_required';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Edad y elegibilidad</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.card}>
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.secondaryText}>Consultando tu estado…</Text>
            </View>
          ) : null}

          {!loading && status?.state === 'complete' ? (
            <View style={styles.centered}>
              <MaterialIcons name="verified-user" size={42} color={Colors.success} />
              <Text style={styles.cardTitle}>Verificación de edad completada</Text>
              <Text style={styles.secondaryText}>Tu cuenta ya tiene la autoridad de edad necesaria.</Text>
            </View>
          ) : null}

          {!loading && status?.state === 'ineligible' ? (
            <View style={styles.centered}>
              <MaterialIcons name="info-outline" size={42} color={Colors.warning} />
              <Text style={styles.cardTitle}>Cuenta no elegible</Text>
              <Text style={styles.secondaryText}>Tu cuenta no cumple actualmente la política mínima de edad.</Text>
            </View>
          ) : null}

          {!loading && status?.state === 'unavailable' ? (
            <View style={styles.centered}>
              <MaterialIcons name="error-outline" size={42} color={Colors.warning} />
              <Text style={styles.cardTitle}>Estado no disponible</Text>
              <Text style={styles.secondaryText}>No pudimos encontrar una clasificación de edad para esta cuenta.</Text>
            </View>
          ) : null}

          {!loading && remediationRequired ? (
            <View style={styles.form}>
              <Text style={styles.cardTitle}>Completa tu verificación</Text>
              <Text style={styles.secondaryText}>
                Necesitamos confirmar tu fecha de nacimiento para completar la verificación de edad de tu cuenta.
                La fecha se valida de forma segura.
              </Text>
              <Text style={styles.label}>Fecha de nacimiento</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Seleccionar fecha de nacimiento"
                style={styles.dateButton}
                onPress={() => setShowPicker(true)}
              >
                <MaterialIcons name="calendar-month" size={20} color={Colors.primary} />
                <Text style={dateOfBirth ? styles.dateValue : styles.datePlaceholder}>
                  {dateOfBirth || 'Seleccionar fecha'}
                </Text>
              </Pressable>
              {showPicker ? (
                <DateTimePicker
                  value={pickerDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={new Date()}
                  onChange={updateDate}
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Verificar edad"
                style={[styles.primaryButton, submitting && styles.disabledButton]}
                disabled={submitting}
                onPress={submit}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.primaryButtonText}>Verificar</Text>}
              </Pressable>
            </View>
          ) : null}

          {errorMessage ? <Text accessibilityRole="alert" style={styles.errorText}>{errorMessage}</Text> : null}

          {!loading && !status ? (
            <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void loadStatus()}>
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSpacer: { width: 40 },
  content: { padding: Spacing.md },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  centered: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
  form: { gap: Spacing.md },
  cardTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  secondaryText: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 21, textAlign: 'center' },
  label: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  dateButton: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14,
  },
  dateValue: { color: Colors.textPrimary, fontSize: FontSize.md },
  datePlaceholder: { color: Colors.textSubtle, fontSize: FontSize.md },
  primaryButton: {
    minHeight: 48, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: Radius.md,
  },
  disabledButton: { opacity: 0.6 },
  primaryButtonText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  errorText: { color: Colors.error, fontSize: FontSize.sm, lineHeight: 20, textAlign: 'center' },
  retryButton: { alignSelf: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
