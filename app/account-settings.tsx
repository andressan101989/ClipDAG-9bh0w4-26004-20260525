import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  TextInput, Switch, ActivityIndicator, Modal,
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
import { useI18n, AVAILABLE_LANGUAGES, type Language } from '@/contexts/I18nContext';

// ── Row component ─────────────────────────────────────────────────────────────
function Row({
  icon, iconGradient, label, sublabel, value, onPress, danger, isToggle, toggleVal, onToggle, last,
}: {
  icon: string; iconGradient: string[]; label: string; sublabel?: string;
  value?: string; onPress?: () => void; danger?: boolean;
  isToggle?: boolean; toggleVal?: boolean; onToggle?: (v: boolean) => void; last?: boolean;
}) {
  return (
    <Pressable
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      disabled={isToggle}
    >
      <LinearGradient colors={iconGradient as [string, string, ...string[]]} style={styles.rowIcon}>
        <MaterialCommunityIcons name={icon as any} size={17} color="#fff" />
      </LinearGradient>
      <View style={styles.rowMeta}>
        <Text style={[styles.rowLabel, danger && { color: Colors.error }]}>{label}</Text>
        {sublabel ? <Text style={styles.rowSub}>{sublabel}</Text> : null}
      </View>
      {isToggle ? (
        <Switch
          value={toggleVal}
          onValueChange={onToggle}
          trackColor={{ false: Colors.border, true: Colors.primary + '88' }}
          thumbColor={toggleVal ? Colors.primary : Colors.textSubtle}
        />
      ) : value ? (
        <Text style={styles.rowValue}>{value}</Text>
      ) : (
        <MaterialIcons
          name="chevron-right"
          size={20}
          color={danger ? Colors.error : Colors.textSubtle}
        />
      )}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, updateProfile, logout } = useAuth();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  // Change password modal
  const [pwModal, setPwModal] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // Change username modal
  const [usernameModal, setUsernameModal] = useState(false);
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [usernameLoading, setUsernameLoading] = useState(false);

  // Change email modal
  const [emailModal, setEmailModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  // i18n
  const { language, setLanguage } = useI18n();

  // Preferences
  const [darkMode, setDarkMode] = useState(true);
  const [langModal, setLangModal] = useState(false);

  const handleChangePassword = useCallback(async () => {
    if (newPw.length < 6) { showAlert('Error', 'Minimo 6 caracteres'); return; }
    if (newPw !== confirmPw) { showAlert('Error', 'Las contrasenas no coinciden'); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwLoading(false);
    if (error) { showAlert('Error', error.message); return; }
    setPwModal(false);
    setNewPw('');
    setConfirmPw('');
    showAlert('Contrasena actualizada', 'Tu contrasena ha sido cambiada exitosamente');
  }, [newPw, confirmPw, supabase, showAlert]);

  const handleChangeUsername = useCallback(async () => {
    if (!newUsername.trim() || newUsername.trim().length < 3) {
      showAlert('Error', 'El nombre de usuario debe tener al menos 3 caracteres');
      return;
    }
    setUsernameLoading(true);
    try {
      await updateProfile({ username: newUsername.trim().toLowerCase() });
      setUsernameModal(false);
      showAlert('Usuario actualizado', `Tu nuevo nombre de usuario es @${newUsername.trim().toLowerCase()}`);
    } catch (_) {
      showAlert('Error', 'No se pudo actualizar el usuario. Puede que ya este en uso.');
    }
    setUsernameLoading(false);
  }, [newUsername, updateProfile, showAlert]);

  const handleChangeEmail = useCallback(async () => {
    if (!newEmail.trim() || !newEmail.includes('@')) {
      showAlert('Error', 'Ingresa un correo valido');
      return;
    }
    setEmailLoading(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setEmailLoading(false);
    if (error) { showAlert('Error', error.message); return; }
    setEmailModal(false);
    setNewEmail('');
    showAlert(
      'Correo actualizado',
      'Te enviamos un enlace de confirmacion a tu nuevo correo. Revisalo para completar el cambio.'
    );
  }, [newEmail, supabase, showAlert]);

  const handleLanguage = useCallback(() => {
    setLangModal(true);
  }, []);

  const handleSelectLanguage = useCallback(async (lang: Language) => {
    await setLanguage(lang);
    setLangModal(false);
  }, [setLanguage]);

  const handleLogoutAll = useCallback(() => {
    showAlert('Cerrar todas las sesiones', 'Seras desconectado de todos tus dispositivos.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar todo',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut({ scope: 'global' });
          await logout();
          router.replace('/login');
        },
      },
    ]);
  }, [supabase, logout, router, showAlert]);

  const handleDownloadData = useCallback(() => {
    showAlert(
      'Descargar mis datos',
      'Recibirás un email con todos tus datos en un plazo de 48 horas. Envíanos la solicitud a: data@clipdag.io',
      [{ text: 'Entendido' }]
    );
  }, [showAlert]);

  const handleDeleteAccount = useCallback(() => {
    showAlert(
      'Eliminar cuenta permanentemente',
      'Esta accion eliminara TODOS tus datos: videos, seguidores, balance DAG y perfil. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Continuar',
          style: 'destructive',
          onPress: () => {
            showAlert('Confirmar eliminacion', 'Por seguridad, contacta soporte para eliminar tu cuenta: support@clipdag.io');
          },
        },
      ]
    );
  }, [showAlert]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Configuracion de Cuenta</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}
      >
        {/* Account info */}
        <View style={styles.accountCard}>
          <LinearGradient
            colors={['rgba(124,92,255,0.12)', 'rgba(255,45,120,0.08)']}
            style={styles.accountCardInner}
          >
            <View style={styles.accountCardIcon}>
              <MaterialCommunityIcons name="account-circle" size={28} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountCardName}>@{user?.username || 'usuario'}</Text>
              <Text style={styles.accountCardEmail}>{user?.email}</Text>
            </View>
          </LinearGradient>
        </View>

        <Section title="Credenciales">
          <Row
            icon="account-outline"
            iconGradient={['#7C5CFF', '#B44FFF']}
            label="Nombre de usuario"
            sublabel={`@${user?.username || 'usuario'}`}
            onPress={() => { setNewUsername(user?.username || ''); setUsernameModal(true); }}
          />
          <Row
            icon="email-outline"
            iconGradient={['#2D9EFF', '#7C5CFF']}
            label="Correo electronico"
            sublabel={user?.email || ''}
            onPress={() => setEmailModal(true)}
          />
          <Row
            icon="lock-outline"
            iconGradient={['#FF2D78', '#FF6FA8']}
            label="Cambiar contrasena"
            sublabel="Actualiza tu contrasena de acceso"
            onPress={() => { setNewPw(''); setConfirmPw(''); setPwModal(true); }}
            last
          />
        </Section>

        <Section title="Preferencias">
          <Row
            icon="theme-light-dark"
            iconGradient={['#5A5A72', '#3D3D52']}
            label="Tema oscuro"
            sublabel="Modo oscuro activado"
            isToggle
            toggleVal={darkMode}
            onToggle={setDarkMode}
          />
          <Row
            icon="translate"
            iconGradient={['#00E5A0', '#2D9EFF']}
            label="Idioma / Language"
            value={AVAILABLE_LANGUAGES.find(l => l.key === language)?.label ?? 'Español'}
            onPress={handleLanguage}
            last
          />
        </Section>

        <Section title="Sesiones y Dispositivos">
          <Row
            icon="devices"
            iconGradient={['#FFB800', '#FF6B00']}
            label="Dispositivos activos"
            sublabel="Ver y gestionar sesiones activas"
            onPress={() => showAlert('Dispositivos', 'Solo tienes una sesion activa en este dispositivo.')}
          />
          <Row
            icon="logout-variant"
            iconGradient={['#FF3B5C', '#FF6FA8']}
            label="Cerrar todas las sesiones"
            sublabel="Desconectarte de todos los dispositivos"
            danger
            onPress={handleLogoutAll}
            last
          />
        </Section>

        <Section title="Datos y Privacidad">
          <Row
            icon="download-outline"
            iconGradient={['#00E5A0', '#2D9EFF']}
            label="Descargar mis datos"
            sublabel="Exportar todos tus datos"
            onPress={handleDownloadData}
          />
          <Row
            icon="delete-forever-outline"
            iconGradient={['#FF3B5C', '#FF2D78']}
            label="Eliminar cuenta"
            sublabel="Accion permanente e irreversible"
            danger
            onPress={handleDeleteAccount}
            last
          />
        </Section>
      </ScrollView>

      {/* ── Change Password Modal ─────────────────────────────────────────── */}
      <Modal visible={pwModal} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Cambiar Contrasena</Text>
            <TextInput
              style={styles.modalInput}
              value={newPw}
              onChangeText={setNewPw}
              placeholder="Nueva contrasena (min. 6 caracteres)"
              placeholderTextColor={Colors.textSubtle}
              secureTextEntry
            />
            <TextInput
              style={styles.modalInput}
              value={confirmPw}
              onChangeText={setConfirmPw}
              placeholder="Confirmar nueva contrasena"
              placeholderTextColor={Colors.textSubtle}
              secureTextEntry
            />
            <Pressable
              style={[styles.modalPrimaryBtn, pwLoading && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={pwLoading}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.modalPrimaryBtnGrad}
              >
                {pwLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalPrimaryBtnText}>Actualizar Contrasena</Text>
                }
              </LinearGradient>
            </Pressable>
            <Pressable style={styles.modalCancelBtn} onPress={() => setPwModal(false)}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Change Username Modal ─────────────────────────────────────────── */}
      <Modal visible={usernameModal} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Cambiar Nombre de Usuario</Text>
            <TextInput
              style={styles.modalInput}
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder="Nuevo nombre de usuario"
              placeholderTextColor={Colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[styles.modalPrimaryBtn, usernameLoading && { opacity: 0.6 }]}
              onPress={handleChangeUsername}
              disabled={usernameLoading}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.modalPrimaryBtnGrad}
              >
                {usernameLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalPrimaryBtnText}>Guardar Usuario</Text>
                }
              </LinearGradient>
            </Pressable>
            <Pressable style={styles.modalCancelBtn} onPress={() => setUsernameModal(false)}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Language Modal ───────────────────────────────────────────────── */}
      <Modal visible={langModal} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Idioma / Language</Text>
            <Text style={styles.modalNote}>Selecciona el idioma de la aplicación</Text>
            <View style={styles.langList}>
              {AVAILABLE_LANGUAGES.map(lang => {
                const isSelected = language === lang.key;
                return (
                  <Pressable
                    key={lang.key}
                    style={[styles.langRow, isSelected && styles.langRowSelected]}
                    onPress={() => handleSelectLanguage(lang.key)}
                  >
                    <Text style={styles.langFlag}>{lang.flag}</Text>
                    <Text style={[styles.langLabel, isSelected && styles.langLabelSelected]}>{lang.label}</Text>
                    {isSelected ? (
                      <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.langCheck}>
                        <MaterialCommunityIcons name="check" size={14} color="#fff" />
                      </LinearGradient>
                    ) : (
                      <View style={styles.langCheckEmpty} />
                    )}
                  </Pressable>
                );
              })}
            </View>
            <Pressable style={styles.modalCancelBtn} onPress={() => setLangModal(false)}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Change Email Modal ────────────────────────────────────────────── */}
      <Modal visible={emailModal} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Cambiar Correo Electronico</Text>
            <Text style={styles.modalNote}>
              Se enviara un enlace de confirmacion a tu nuevo correo antes de realizar el cambio.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder="Nuevo correo electronico"
              placeholderTextColor={Colors.textSubtle}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Pressable
              style={[styles.modalPrimaryBtn, emailLoading && { opacity: 0.6 }]}
              onPress={handleChangeEmail}
              disabled={emailLoading}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.modalPrimaryBtnGrad}
              >
                {emailLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.modalPrimaryBtnText}>Enviar Confirmacion</Text>
                }
              </LinearGradient>
            </Pressable>
            <Pressable style={styles.modalCancelBtn} onPress={() => setEmailModal(false)}>
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  scroll: { paddingHorizontal: Spacing.md, paddingTop: 4, gap: Spacing.md },

  accountCard: { borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  accountCardInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  accountCardIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  accountCardName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  accountCardEmail: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },

  section: { gap: 6 },
  sectionTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.textSubtle, textTransform: 'uppercase',
    letterSpacing: 0.8, marginLeft: 4,
  },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowMeta: { flex: 1, gap: 1 },
  rowLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  rowSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  rowValue: { color: Colors.textSubtle, fontSize: FontSize.sm },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg, gap: Spacing.md,
  },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  modalTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  modalNote: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  modalInput: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 14,
    color: Colors.textPrimary, fontSize: FontSize.md,
  },
  modalPrimaryBtn: { borderRadius: Radius.md, overflow: 'hidden' },
  modalPrimaryBtnGrad: { paddingVertical: 14, alignItems: 'center' },
  modalPrimaryBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  modalCancelBtn: {
    alignItems: 'center', paddingVertical: 13,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
  },
  modalCancelText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  // Language picker
  langList: { gap: 8 },
  langRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  langRowSelected: {
    borderColor: '#7C5CFF',
    backgroundColor: 'rgba(124,92,255,0.10)',
  },
  langFlag: { fontSize: 26 },
  langLabel: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  langLabelSelected: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  langCheck: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  langCheckEmpty: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.border },
});
