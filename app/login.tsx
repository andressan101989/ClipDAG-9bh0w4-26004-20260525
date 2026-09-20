import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { NelyonLogo } from '@/components/ui/NelyonLogo';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { formatLocalCalendarDate, validateSignupDob } from '@/utils/signupDob';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LoginScreen() {
  const { login, register } = useAuth();
  const { showAlert } = useAlert();
  const router = useRouter();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ─── Login ────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!email.trim() || !password) {
      showAlert('Campos requeridos', 'Ingresa tu correo y contraseña');
      return;
    }
    setIsLoading(true);
    const result = await login(email.trim().toLowerCase(), password);
    setIsLoading(false);
    if (!result.success) {
      showAlert('Error al iniciar sesión', result.error ?? 'Verifica tus credenciales');
    } else {
      router.replace('/(tabs)');
    }
  };

  // ─── Register ─────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!email.trim() || !password || !username.trim() || !dateOfBirth.trim()) {
      showAlert('Campos requeridos', 'Completa todos los campos');
      return;
    }
    if (validateSignupDob(dateOfBirth)) {
      showAlert('Fecha inválida', 'Ingresa una fecha de nacimiento válida en formato AAAA-MM-DD.');
      return;
    }
    if (password.length < 6) {
      showAlert('Contraseña corta', 'Minimo 6 caracteres');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Contraseñas no coinciden', 'Verifica que ambas contraseñas sean iguales');
      return;
    }

    setIsLoading(true);
    const result = await register(email.trim().toLowerCase(), password, username.trim(), dateOfBirth);
    setIsLoading(false);

    if (!result.success) {
      showAlert('Error', result.error ?? 'No se pudo crear la cuenta');
      return;
    }

    router.replace('/(tabs)');
  };

  // ─── Login / Register form ─────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Image
        source={require('@/assets/images/onboarding-hero.png')}
        style={styles.bgImage}
        contentFit="cover"
        transition={300}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.3)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.95)']}
        locations={[0, 0.4, 0.75]}
        style={StyleSheet.absoluteFillObject}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoArea}>
            <NelyonLogo onDark style={styles.brandLogo} />
            <Text style={styles.tagline}>Crea. Comparte. Gana $DAG.</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Mode toggle */}
            <View style={styles.modeToggle}>
              <Pressable
                style={[styles.modeTab, mode === 'login' ? styles.modeTabActive : null]}
                onPress={() => setMode('login')}
              >
                <Text style={[styles.modeTabText, mode === 'login' ? styles.modeTabTextActive : null]}>
                  Iniciar Sesión
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeTab, mode === 'register' ? styles.modeTabActive : null]}
                onPress={() => setMode('register')}
              >
                <Text style={[styles.modeTabText, mode === 'register' ? styles.modeTabTextActive : null]}>
                  Registrarse
                </Text>
              </Pressable>
            </View>

            {mode === 'register' ? (
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Nombre de usuario único"
                placeholderTextColor={Colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}

            {mode === 'register' ? (
              <View>
                <Text style={styles.dobLabel}>Fecha de nacimiento</Text>
                {Platform.OS === 'web' ? (
                  <TextInput
                    style={styles.input}
                    value={dateOfBirth}
                    onChangeText={setDateOfBirth}
                    placeholder="AAAA-MM-DD"
                    placeholderTextColor={Colors.textSubtle}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                ) : (
                  <Pressable style={styles.input} onPress={() => setShowDatePicker(true)} accessibilityRole="button">
                    <Text style={dateOfBirth ? styles.dobValue : styles.dobPlaceholder}>
                      {dateOfBirth || 'Selecciona tu fecha de nacimiento'}
                    </Text>
                  </Pressable>
                )}
                {showDatePicker && Platform.OS !== 'web' ? (
                  <View>
                    <DateTimePicker
                      value={dateOfBirth
                        ? new Date(Number(dateOfBirth.slice(0, 4)), Number(dateOfBirth.slice(5, 7)) - 1, Number(dateOfBirth.slice(8, 10)))
                        : new Date(2000, 0, 1)}
                      mode="date"
                      maximumDate={new Date()}
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(event, selectedDate) => {
                        if (Platform.OS !== 'ios') setShowDatePicker(false);
                        if (event.type === 'set' && selectedDate) setDateOfBirth(formatLocalCalendarDate(selectedDate));
                      }}
                    />
                    {Platform.OS === 'ios' ? (
                      <Pressable onPress={() => setShowDatePicker(false)} accessibilityRole="button">
                        <Text style={styles.dobDone}>Listo</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                <Text style={styles.dobNotice}>Debes tener 18 años o más para crear una cuenta en Nelyon.</Text>
              </View>
            ) : null}

            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Correo electrónico"
              placeholderTextColor={Colors.textSubtle}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Contraseña (mín. 6 caracteres)"
              placeholderTextColor={Colors.textSubtle}
              secureTextEntry
            />

            {mode === 'register' ? (
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirmar contraseña"
                placeholderTextColor={Colors.textSubtle}
                secureTextEntry
              />
            ) : null}

            <CyberButton
              label={
                isLoading
                  ? (mode === 'login' ? 'Entrando...' : 'Creando cuenta...')
                  : (mode === 'login' ? 'Iniciar Sesión' : 'Registrarse')
              }
              onPress={mode === 'login' ? handleLogin : handleRegister}
              loading={isLoading}
              size="lg"
              fullWidth
            />

            {/* Web3 note */}
            <View style={styles.web3Note}>
              <Text style={styles.web3NoteIcon}>◈</Text>
              <Text style={styles.web3NoteText}>
                {mode === 'register'
                  ? 'Al crear cuenta, se genera automáticamente tu billetera $DAG interna para acumular recompensas'
                  : 'Gana $DAG por cada like que reciben tus videos en Nelyon'}
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  bgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT * 0.75,
  },
  keyboardView: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
    gap: Spacing.xs,
  },
  brandLogo: { width: 286, height: 76 },
  tagline: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  form: { gap: Spacing.md },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modeTab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: Radius.md,
  },
  modeTabActive: { backgroundColor: Colors.primary },
  modeTabText: {
    color: Colors.textSubtle,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  modeTabTextActive: { color: '#FFFFFF' },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    height: 52,
  },
  dobLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, marginBottom: Spacing.xs },
  dobValue: { color: Colors.textPrimary, fontSize: FontSize.md },
  dobPlaceholder: { color: Colors.textSubtle, fontSize: FontSize.md },
  dobDone: { color: Colors.primary, fontSize: FontSize.md, textAlign: 'right', padding: Spacing.sm },
  dobNotice: { color: Colors.textSecondary, fontSize: FontSize.xs, marginTop: Spacing.xs },
  web3Note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  web3NoteIcon: { color: Colors.primary, fontSize: FontSize.sm, marginTop: 2 },
  web3NoteText: {
    flex: 1,
    color: Colors.textSubtle,
    fontSize: FontSize.xs,
    lineHeight: 16,
  },
});
