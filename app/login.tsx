import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type Step = 'form' | 'otp';

export default function LoginScreen() {
  const { login, register } = useAuth();
  const { showAlert } = useAlert();
  const router = useRouter();
  const supabase = getSupabaseClient();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // OTP refs for 4-digit input
  const otpRefs = [
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
  ];
  const [otpDigits, setOtpDigits] = useState(['', '', '', '']);

  const handleOtpChange = (val: string, idx: number) => {
    const cleaned = val.replace(/[^0-9]/g, '').slice(-1);
    const next = [...otpDigits];
    next[idx] = cleaned;
    setOtpDigits(next);
    setOtp(next.join(''));
    if (cleaned && idx < 3) {
      otpRefs[idx + 1].current?.focus();
    }
  };

  const handleOtpKeyPress = (e: any, idx: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otpDigits[idx] && idx > 0) {
      otpRefs[idx - 1].current?.focus();
    }
  };

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

  // ─── Register step 1: send OTP ────────────────────────────────────────────
  const handleRegister = async () => {
    if (!email.trim() || !password || !username.trim()) {
      showAlert('Campos requeridos', 'Completa todos los campos');
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
    // Send OTP via Supabase Auth directly
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
    });
    setIsLoading(false);

    if (error) {
      showAlert('Error', error.message);
      return;
    }

    setStep('otp');
    setOtpDigits(['', '', '', '']);
    setOtp('');
    setTimeout(() => otpRefs[0].current?.focus(), 300);
  };

  // ─── Register step 2: verify OTP + create account ─────────────────────────
  const handleVerifyOTP = async () => {
    if (otp.length < 4) {
      showAlert('Codigo incompleto', 'Ingresa el codigo de 4 digitos enviado a tu correo');
      return;
    }

    setIsLoading(true);
    // Verify OTP token
    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp,
      type: 'email',
    });
    setIsLoading(false);

    if (verifyError || !verifyData?.user) {
      showAlert('Codigo incorrecto', verifyError?.message ?? 'Codigo invalido o expirado');
      return;
    }

    const userId = verifyData.user.id;

    // If registering: set password + username on the profile
    if (mode === 'register') {
      // Update password (user is now authenticated via OTP session)
      const { error: pwErr } = await supabase.auth.updateUser({ password });
      if (pwErr) {
        console.warn('[login] password update error:', pwErr.message);
      }

      // Save username to profile
      await supabase
        .from('user_profiles')
        .update({ username: username.trim(), dag_balance: 0 })
        .eq('id', userId);
    }

    showAlert(
      'Cuenta verificada!',
      'Bienvenido a ClipDAG! Tu billetera $DAG fue creada automaticamente.',
      [{ text: 'Empezar', onPress: () => router.replace('/(tabs)') }]
    );
  };

  // ─── Resend OTP ───────────────────────────────────────────────────────────
  const handleResendOTP = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
    });
    if (error) {
      showAlert('Error', error.message);
    } else {
      showAlert('Codigo reenviado', 'Revisa tu bandeja de entrada y spam');
      setOtpDigits(['', '', '', '']);
      setOtp('');
      setTimeout(() => otpRefs[0].current?.focus(), 300);
    }
  };

  // ─── OTP screen ───────────────────────────────────────────────────────────
  if (step === 'otp') {
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
          colors={['rgba(0,0,0,0.4)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.97)']}
          locations={[0, 0.4, 0.75]}
          style={StyleSheet.absoluteFillObject}
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.otpScrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.otpContainer}>
              {/* Back */}
              <Pressable onPress={() => setStep('form')} style={styles.backBtn} hitSlop={10}>
                <Text style={styles.backBtnText}>← Volver</Text>
              </Pressable>

              {/* Icon */}
              <View style={styles.otpIconWrap}>
                <Text style={styles.otpIcon}>✉️</Text>
              </View>

              <Text style={styles.otpTitle}>Verifica tu correo</Text>
              <Text style={styles.otpSubtitle}>
                Enviamos un codigo de 4 digitos a{'\n'}
                <Text style={styles.otpEmail}>{email}</Text>
              </Text>

              {/* 4-box OTP input */}
              <View style={styles.otpBoxRow}>
                {otpDigits.map((digit, idx) => (
                  <TextInput
                    key={idx}
                    ref={otpRefs[idx]}
                    style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
                    value={digit}
                    onChangeText={val => handleOtpChange(val, idx)}
                    onKeyPress={e => handleOtpKeyPress(e, idx)}
                    keyboardType="number-pad"
                    maxLength={1}
                    textAlign="center"
                    selectionColor={Colors.primary}
                  />
                ))}
              </View>

              <CyberButton
                label={isLoading ? 'Verificando...' : 'Verificar y Crear Cuenta'}
                onPress={handleVerifyOTP}
                loading={isLoading}
                size="lg"
                fullWidth
              />

              <Pressable onPress={handleResendOTP} hitSlop={10} style={styles.resendBtn}>
                <Text style={styles.resendText}>No recibiste el codigo? <Text style={styles.resendLink}>Reenviar</Text></Text>
              </Pressable>

              <View style={styles.spamNote}>
                <Text style={styles.spamNoteText}>Revisa tambien tu carpeta de spam</Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

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
            <Text style={styles.logoIcon}>◈</Text>
            <Text style={styles.logoText}>ClipDAG</Text>
            <Text style={styles.tagline}>Crea. Comparte. Gana $DAG.</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Mode toggle */}
            <View style={styles.modeToggle}>
              <Pressable
                style={[styles.modeTab, mode === 'login' ? styles.modeTabActive : null]}
                onPress={() => { setMode('login'); setStep('form'); }}
              >
                <Text style={[styles.modeTabText, mode === 'login' ? styles.modeTabTextActive : null]}>
                  Iniciar Sesión
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeTab, mode === 'register' ? styles.modeTabActive : null]}
                onPress={() => { setMode('register'); setStep('form'); }}
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
                  ? (mode === 'login' ? 'Entrando...' : 'Enviando código...')
                  : (mode === 'login' ? 'Iniciar Sesión' : 'Siguiente → Verificar email')
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
                  : 'Gana $DAG por cada like que reciben tus videos en ClipDAG'}
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
  logoIcon: { fontSize: 48, color: Colors.primary },
  logoText: {
    fontSize: 40,
    fontWeight: FontWeight.extrabold,
    color: Colors.textPrimary,
    letterSpacing: -1,
  },
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
  // ── OTP screen ───────────────────────────────
  otpScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  otpContainer: {
    alignItems: 'center',
    gap: Spacing.lg,
  },
  backBtn: { alignSelf: 'flex-start' },
  backBtnText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  otpIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary,
  },
  ottIcon: { fontSize: 38 },
  otpIcon: { fontSize: 38 },
  otpTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
  },
  otpSubtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  otpEmail: { color: Colors.primary, fontWeight: FontWeight.semibold },
  otpBoxRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginVertical: Spacing.md,
  },
  otpBox: {
    width: 64,
    height: 70,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceElevated,
    color: Colors.textPrimary,
    fontSize: 28,
    fontWeight: FontWeight.bold,
  },
  otpBoxFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryDim,
  },
  resendBtn: { marginTop: Spacing.sm },
  resendText: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
  resendLink: { color: Colors.primary, fontWeight: FontWeight.semibold },
  spamNote: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  spamNoteText: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center' },
});
