import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, TextInput,
  Switch, ActivityIndicator, Modal,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

type Step = 'overview' | 'verify_email' | 'success';

function InfoCard({
  icon, gradient, title, desc,
}: { icon: string; gradient: string[]; title: string; desc: string }) {
  return (
    <View style={styles.infoCard}>
      <LinearGradient colors={gradient} style={styles.infoCardIcon}>
        <MaterialCommunityIcons name={icon as any} size={20} color="#fff" />
      </LinearGradient>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.infoCardTitle}>{title}</Text>
        <Text style={styles.infoCardDesc}>{desc}</Text>
      </View>
    </View>
  );
}

export default function TwoFactorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [step, setStep] = useState<Step>('overview');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpDigits, setOtpDigits] = useState(['', '', '', '']);
  const [backupCodes] = useState<string[]>([
    'CLIP-A1B2-C3D4',
    'CLIP-E5F6-G7H8',
    'CLIP-I9J0-K1L2',
    'CLIP-M3N4-O5P6',
    'CLIP-Q7R8-S9T0',
    'CLIP-U1V2-W3X4',
  ]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  const otpRefs = [
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
    useRef<TextInput>(null),
  ];

  const otp = otpDigits.join('');

  const handleOtpChange = useCallback((val: string, idx: number) => {
    const cleaned = val.replace(/[^0-9]/g, '').slice(-1);
    const next = [...otpDigits];
    next[idx] = cleaned;
    setOtpDigits(next);
    if (cleaned && idx < 3) otpRefs[idx + 1].current?.focus();
  }, [otpDigits]);

  const handleOtpKey = useCallback((e: any, idx: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otpDigits[idx] && idx > 0) {
      otpRefs[idx - 1].current?.focus();
    }
  }, [otpDigits]);

  const handleSendOTP = useCallback(async () => {
    if (!user?.email) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({ email: user.email });
    setSending(false);
    if (error) {
      showAlert('Error', error.message);
      return;
    }
    setStep('verify_email');
    setTimeout(() => otpRefs[0].current?.focus(), 400);
  }, [user, supabase, showAlert]);

  const handleVerifyOTP = useCallback(async () => {
    if (otp.length < 4) {
      showAlert('Codigo incompleto', 'Ingresa el codigo de 4 digitos');
      return;
    }
    if (!user?.email) return;
    setVerifying(true);
    const { error } = await supabase.auth.verifyOtp({
      email: user.email,
      token: otp,
      type: 'email',
    });
    setVerifying(false);
    if (error) {
      showAlert('Codigo incorrecto', 'El codigo no es valido o expiro. Intenta de nuevo.');
      return;
    }
    setIs2FAEnabled(true);
    setStep('success');
    setShowBackupCodes(true);
  }, [otp, user, supabase, showAlert]);

  const handleDisable2FA = useCallback(() => {
    showAlert('Desactivar 2FA', 'Al desactivar la verificacion en dos pasos, tu cuenta sera menos segura. Continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desactivar', style: 'destructive',
        onPress: () => {
          setIs2FAEnabled(false);
          setStep('overview');
          showAlert('2FA desactivado', 'La verificacion en dos pasos ha sido desactivada');
        },
      },
    ]);
  }, [showAlert]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Verificacion en 2 Pasos</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}
      >
        {/* Status banner */}
        <LinearGradient
          colors={is2FAEnabled
            ? ['rgba(0,229,160,0.15)', 'rgba(45,158,255,0.1)']
            : ['rgba(255,59,92,0.12)', 'rgba(255,45,120,0.08)']
          }
          style={styles.statusBanner}
        >
          <View style={[styles.statusIconWrap, { backgroundColor: is2FAEnabled ? Colors.accent + '22' : Colors.error + '22' }]}>
            <MaterialCommunityIcons
              name={is2FAEnabled ? 'shield-check' : 'shield-alert-outline'}
              size={32}
              color={is2FAEnabled ? Colors.accent : Colors.error}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.statusTitle}>
              {is2FAEnabled ? '2FA Activado' : '2FA Desactivado'}
            </Text>
            <Text style={styles.statusDesc}>
              {is2FAEnabled
                ? 'Tu cuenta esta protegida con verificacion en dos pasos'
                : 'Activa la verificacion en dos pasos para mayor seguridad'
              }
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: is2FAEnabled ? Colors.accent + '22' : Colors.error + '22' }]}>
            <Text style={[styles.statusBadgeText, { color: is2FAEnabled ? Colors.accent : Colors.error }]}>
              {is2FAEnabled ? 'ACTIVO' : 'INACTIVO'}
            </Text>
          </View>
        </LinearGradient>

        {/* How it works */}
        {!is2FAEnabled ? (
          <>
            <Text style={styles.sectionTitle}>Como funciona</Text>
            <View style={styles.infoCards}>
              <InfoCard
                icon="numeric-1-circle-outline"
                gradient={['#7C5CFF', '#B44FFF']}
                title="Ingresa tu correo y contrasena"
                desc="Inicio de sesion normal con tus credenciales"
              />
              <InfoCard
                icon="numeric-2-circle-outline"
                gradient={['#FF2D78', '#FF6FA8']}
                title="Recibe un codigo por email"
                desc="Te enviamos un codigo de verificacion de 4 digitos"
              />
              <InfoCard
                icon="numeric-3-circle-outline"
                gradient={['#00E5A0', '#2D9EFF']}
                title="Ingresa el codigo"
                desc="Verifica tu identidad con el codigo recibido"
              />
            </View>

            <View style={styles.benefitCard}>
              <LinearGradient colors={['rgba(124,92,255,0.12)', 'rgba(0,229,160,0.08)']} style={styles.benefitCardInner}>
                <Text style={styles.benefitTitle}>Beneficios de 2FA</Text>
                {[
                  'Proteccion contra accesos no autorizados',
                  'Alertas en tiempo real de intentos de inicio de sesion',
                  'Codigos de recuperacion de emergencia',
                  'Compatible con tu correo electronico',
                ].map(b => (
                  <View key={b} style={styles.benefitRow}>
                    <MaterialCommunityIcons name="check-circle-outline" size={16} color={Colors.accent} />
                    <Text style={styles.benefitText}>{b}</Text>
                  </View>
                ))}
              </LinearGradient>
            </View>

            {/* Activation */}
            {step === 'overview' ? (
              <Pressable
                style={[styles.primaryBtn, sending && { opacity: 0.6 }]}
                onPress={handleSendOTP}
                disabled={sending}
              >
                <LinearGradient
                  colors={['#7C5CFF', '#FF2D78']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtnGrad}
                >
                  {sending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <>
                        <MaterialCommunityIcons name="shield-lock-outline" size={18} color="#fff" />
                        <Text style={styles.primaryBtnText}>Activar Verificacion en 2 Pasos</Text>
                      </>
                  }
                </LinearGradient>
              </Pressable>
            ) : step === 'verify_email' ? (
              <View style={styles.otpSection}>
                <View style={styles.otpIconWrap}>
                  <Text style={styles.otpEmoji}>✉️</Text>
                </View>
                <Text style={styles.otpTitle}>Verifica tu correo</Text>
                <Text style={styles.otpSub}>
                  Enviamos un codigo de 4 digitos a{'\n'}
                  <Text style={styles.otpEmail}>{user?.email}</Text>
                </Text>

                <View style={styles.otpBoxRow}>
                  {otpDigits.map((d, i) => (
                    <TextInput
                      key={i}
                      ref={otpRefs[i]}
                      style={[styles.otpBox, d && styles.otpBoxFilled]}
                      value={d}
                      onChangeText={v => handleOtpChange(v, i)}
                      onKeyPress={e => handleOtpKey(e, i)}
                      keyboardType="number-pad"
                      maxLength={1}
                      textAlign="center"
                    />
                  ))}
                </View>

                <Pressable
                  style={[styles.primaryBtn, verifying && { opacity: 0.6 }]}
                  onPress={handleVerifyOTP}
                  disabled={verifying}
                >
                  <LinearGradient
                    colors={['#7C5CFF', '#FF2D78']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtnGrad}
                  >
                    {verifying
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.primaryBtnText}>Verificar y Activar 2FA</Text>
                    }
                  </LinearGradient>
                </Pressable>

                <Pressable onPress={handleSendOTP} hitSlop={8}>
                  <Text style={styles.resendLink}>No recibiste el codigo? Reenviar</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : (
          /* 2FA is enabled */
          <>
            {showBackupCodes ? (
              <View style={styles.backupCodesSection}>
                <LinearGradient colors={['rgba(255,184,0,0.15)', 'rgba(255,107,0,0.1)']} style={styles.backupWarning}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={22} color={Colors.warning} />
                  <Text style={styles.backupWarningText}>
                    Guarda estos codigos en un lugar seguro. Solo se muestran una vez y son necesarios si pierdes acceso a tu correo.
                  </Text>
                </LinearGradient>
                <Text style={styles.sectionTitle}>Codigos de Recuperacion</Text>
                <View style={styles.backupCodesGrid}>
                  {backupCodes.map(code => (
                    <View key={code} style={styles.backupCode}>
                      <Text style={styles.backupCodeText}>{code}</Text>
                    </View>
                  ))}
                </View>
                <Pressable style={styles.secondaryBtn} onPress={() => setShowBackupCodes(false)}>
                  <Text style={styles.secondaryBtnText}>He guardado mis codigos de recuperacion</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.enabledSection}>
                <View style={styles.managementCard}>
                  <Text style={styles.managementTitle}>Gestion de 2FA</Text>
                  <Pressable style={styles.managementRow} onPress={() => setShowBackupCodes(true)}>
                    <MaterialCommunityIcons name="key-outline" size={18} color={Colors.warning} />
                    <Text style={[styles.managementRowText, { color: Colors.warning }]}>Ver codigos de recuperacion</Text>
                    <MaterialIcons name="chevron-right" size={18} color={Colors.textSubtle} />
                  </Pressable>
                  <Pressable style={styles.managementRow} onPress={handleSendOTP}>
                    <MaterialCommunityIcons name="refresh" size={18} color={Colors.blue} />
                    <Text style={[styles.managementRowText, { color: Colors.blue }]}>Enviar codigo de prueba</Text>
                    <MaterialIcons name="chevron-right" size={18} color={Colors.textSubtle} />
                  </Pressable>
                </View>
                <Pressable style={styles.disableBtn} onPress={handleDisable2FA}>
                  <Text style={styles.disableBtnText}>Desactivar verificacion en 2 pasos</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: Spacing.md, paddingTop: 4, gap: Spacing.lg },

  statusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
  },
  statusIconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  statusDesc: { color: Colors.textSubtle, fontSize: FontSize.xs, lineHeight: 16 },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: FontWeight.bold },

  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.textSubtle, textTransform: 'uppercase', letterSpacing: 0.8,
  },

  infoCards: { gap: Spacing.sm },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  infoCardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  infoCardTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  infoCardDesc: { color: Colors.textSubtle, fontSize: FontSize.xs, lineHeight: 16 },

  benefitCard: { borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)' },
  benefitCardInner: { padding: Spacing.md, gap: Spacing.sm },
  benefitTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginBottom: 4 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  primaryBtn: { borderRadius: Radius.lg, overflow: 'hidden' },
  primaryBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.sm, paddingVertical: 14,
  },
  primaryBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },

  otpSection: { alignItems: 'center', gap: Spacing.md },
  otpIconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary,
  },
  otpEmoji: { fontSize: 36 },
  otpTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  otpSub: { color: Colors.textSecondary, fontSize: FontSize.md, textAlign: 'center', lineHeight: 22 },
  otpEmail: { color: Colors.primary, fontWeight: FontWeight.semibold },
  otpBoxRow: { flexDirection: 'row', gap: Spacing.md },
  otpBox: {
    width: 62, height: 68, borderRadius: Radius.md,
    borderWidth: 2, borderColor: Colors.border,
    backgroundColor: Colors.surfaceElevated,
    color: Colors.textPrimary, fontSize: 26, fontWeight: FontWeight.bold,
  },
  otpBoxFilled: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  resendLink: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  backupCodesSection: { gap: Spacing.md },
  backupWarning: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    padding: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.warning + '44',
  },
  backupWarningText: { color: Colors.warning, fontSize: FontSize.sm, flex: 1, lineHeight: 18 },
  backupCodesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  backupCode: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
    width: '48%',
  },
  backupCodeText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.bold, fontVariant: ['tabular-nums'] },
  secondaryBtn: {
    alignItems: 'center', paddingVertical: 13,
    backgroundColor: Colors.accentDim,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.accent + '44',
  },
  secondaryBtnText: { color: Colors.accent, fontSize: FontSize.sm, fontWeight: FontWeight.bold },

  enabledSection: { gap: Spacing.md },
  managementCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm,
  },
  managementTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginBottom: 4 },
  managementRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  managementRowText: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  disableBtn: {
    alignItems: 'center', paddingVertical: 13,
    backgroundColor: Colors.error + '18',
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.error + '44',
  },
  disableBtnText: { color: Colors.error, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
