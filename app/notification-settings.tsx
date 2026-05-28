import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Switch,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

interface NotifCategory {
  key: string;
  icon: string;
  gradient: string[];
  label: string;
  sublabel: string;
  section: string;
}

const CATEGORIES: NotifCategory[] = [
  // Social
  { key: 'likes', icon: 'heart-outline', gradient: ['#FF2D78', '#FF6FA8'], label: 'Me gustas', sublabel: 'Cuando alguien le da like a tu contenido', section: 'Social' },
  { key: 'comments', icon: 'comment-outline', gradient: ['#7C5CFF', '#B44FFF'], label: 'Comentarios', sublabel: 'Nuevos comentarios en tus publicaciones', section: 'Social' },
  { key: 'follows', icon: 'account-plus-outline', gradient: ['#00E5A0', '#2D9EFF'], label: 'Nuevos seguidores', sublabel: 'Cuando alguien empieza a seguirte', section: 'Social' },
  { key: 'mentions', icon: 'at', gradient: ['#2D9EFF', '#7C5CFF'], label: 'Menciones', sublabel: 'Cuando te mencionan en comentarios o posts', section: 'Social' },
  { key: 'follow_requests', icon: 'account-clock-outline', gradient: ['#FFB800', '#FF6B00'], label: 'Solicitudes de seguimiento', sublabel: 'Para cuentas privadas', section: 'Social' },
  // Monetization
  { key: 'gifts', icon: 'gift-outline', gradient: ['#FFB800', '#FF8800'], label: 'Regalos y donaciones', sublabel: 'Gifts y propinas de tus fans', section: 'Monetizacion' },
  { key: 'dag_earned', icon: 'currency-usd', gradient: ['#00E5A0', '#2D9EFF'], label: 'DAG ganados', sublabel: 'Recompensas por likes y engagement', section: 'Monetizacion' },
  { key: 'sales', icon: 'shopping-outline', gradient: ['#7C5CFF', '#2D9EFF'], label: 'Ventas en Tienda', sublabel: 'Cuando alguien compra un producto tuyo', section: 'Monetizacion' },
  { key: 'wallet', icon: 'wallet-outline', gradient: ['#B44FFF', '#7C5CFF'], label: 'Movimientos de billetera', sublabel: 'Transacciones en tu billetera DAG', section: 'Monetizacion' },
  // Content
  { key: 'messages', icon: 'message-text-outline', gradient: ['#2D9EFF', '#7C5CFF'], label: 'Mensajes directos', sublabel: 'Nuevos mensajes en tu bandeja', section: 'Contenido' },
  { key: 'lives', icon: 'broadcast', gradient: ['#FF2D78', '#FF6FA8'], label: 'Lives en vivo', sublabel: 'Cuando los creadores que sigues entran en vivo', section: 'Contenido' },
  { key: 'reposts', icon: 'share-variant-outline', gradient: ['#00E5A0', '#2D9EFF'], label: 'Compartidos', sublabel: 'Cuando comparten tu contenido', section: 'Contenido' },
  // Security
  { key: 'security', icon: 'shield-lock-outline', gradient: ['#FF3B5C', '#FF6FA8'], label: 'Alertas de seguridad', sublabel: 'Inicio de sesion en nuevos dispositivos', section: 'Seguridad' },
  { key: 'updates', icon: 'information-outline', gradient: ['#5A5A72', '#3D3D52'], label: 'Actualizaciones de la app', sublabel: 'Nuevas funciones y mejoras', section: 'Seguridad' },
  // Marketing
  { key: 'promotions', icon: 'bullhorn-outline', gradient: ['#FFB800', '#FF6B00'], label: 'Promociones y ofertas', sublabel: 'Campanas y oportunidades especiales', section: 'Marketing' },
  { key: 'creator_tips', icon: 'lightbulb-outline', gradient: ['#00E5A0', '#7C5CFF'], label: 'Tips de creador', sublabel: 'Consejos para crecer en ClipDAG', section: 'Marketing' },
];

interface ChannelConfig {
  push: boolean;
  email: boolean;
}

const DEFAULT_CHANNELS: ChannelConfig = { push: true, email: false };

export default function NotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [masterPush, setMasterPush] = useState(true);
  const [masterEmail, setMasterEmail] = useState(false);

  // Per-category toggles: key -> { push, email }
  const [catSettings, setCatSettings] = useState<Record<string, ChannelConfig>>(
    Object.fromEntries(CATEGORIES.map(c => [c.key, { ...DEFAULT_CHANNELS }]))
  );

  const toggle = useCallback((key: string, channel: keyof ChannelConfig) => {
    setCatSettings(prev => ({
      ...prev,
      [key]: { ...prev[key], [channel]: !prev[key][channel] },
    }));
  }, []);

  const handleMasterPush = useCallback((v: boolean) => {
    setMasterPush(v);
    if (!v) {
      setCatSettings(prev =>
        Object.fromEntries(Object.entries(prev).map(([k, val]) => [k, { ...val, push: false }]))
      );
    }
  }, []);

  const handleMasterEmail = useCallback((v: boolean) => {
    setMasterEmail(v);
    if (!v) {
      setCatSettings(prev =>
        Object.fromEntries(Object.entries(prev).map(([k, val]) => [k, { ...val, email: false }]))
      );
    }
  }, []);

  // Group by section
  const sections = Array.from(new Set(CATEGORIES.map(c => c.section)));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Notificaciones</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}
      >
        {/* Master channels */}
        <View style={styles.masterCard}>
          <LinearGradient
            colors={['rgba(124,92,255,0.12)', 'rgba(0,229,160,0.08)']}
            style={styles.masterCardInner}
          >
            <Text style={styles.masterTitle}>Canales de notificacion</Text>
            <Text style={styles.masterSub}>Controla como recibes tus notificaciones</Text>

            <View style={styles.masterRow}>
              <View style={styles.masterRowLeft}>
                <LinearGradient colors={['#7C5CFF', '#B44FFF']} style={styles.masterIcon}>
                  <MaterialCommunityIcons name="bell-outline" size={16} color="#fff" />
                </LinearGradient>
                <View>
                  <Text style={styles.masterRowLabel}>Notificaciones push</Text>
                  <Text style={styles.masterRowSub}>En tu dispositivo movil</Text>
                </View>
              </View>
              <Switch
                value={masterPush}
                onValueChange={handleMasterPush}
                trackColor={{ false: Colors.border, true: Colors.primary + '88' }}
                thumbColor={masterPush ? Colors.primary : Colors.textSubtle}
              />
            </View>

            <View style={[styles.masterRow, { borderTopWidth: 0 }]}>
              <View style={styles.masterRowLeft}>
                <LinearGradient colors={['#2D9EFF', '#7C5CFF']} style={styles.masterIcon}>
                  <MaterialCommunityIcons name="email-outline" size={16} color="#fff" />
                </LinearGradient>
                <View>
                  <Text style={styles.masterRowLabel}>Notificaciones por email</Text>
                  <Text style={styles.masterRowSub}>En tu correo electronico</Text>
                </View>
              </View>
              <Switch
                value={masterEmail}
                onValueChange={handleMasterEmail}
                trackColor={{ false: Colors.border, true: Colors.primary + '88' }}
                thumbColor={masterEmail ? Colors.primary : Colors.textSubtle}
              />
            </View>
          </LinearGradient>
        </View>

        {/* Category toggles grouped by section */}
        {sections.map(section => (
          <View key={section} style={styles.section}>
            <Text style={styles.sectionTitle}>{section}</Text>
            <View style={styles.card}>
              {CATEGORIES.filter(c => c.section === section).map((cat, idx, arr) => {
                const cfg = catSettings[cat.key] || DEFAULT_CHANNELS;
                return (
                  <View key={cat.key} style={[styles.catRow, idx === arr.length - 1 && styles.catRowLast]}>
                    <LinearGradient colors={cat.gradient as [string, string, ...string[]]} style={styles.catIcon}>
                      <MaterialCommunityIcons name={cat.icon as any} size={16} color="#fff" />
                    </LinearGradient>
                    <View style={styles.catMeta}>
                      <Text style={styles.catLabel}>{cat.label}</Text>
                      <Text style={styles.catSub}>{cat.sublabel}</Text>
                    </View>
                    <View style={styles.catToggles}>
                      {/* Push */}
                      <Pressable
                        style={[styles.channelDot, cfg.push && masterPush && styles.channelDotActive]}
                        onPress={() => toggle(cat.key, 'push')}
                        hitSlop={8}
                      >
                        <MaterialCommunityIcons
                          name="bell-outline"
                          size={13}
                          color={cfg.push && masterPush ? '#fff' : Colors.textSubtle}
                        />
                      </Pressable>
                      {/* Email */}
                      <Pressable
                        style={[styles.channelDot, cfg.email && masterEmail && styles.channelDotEmailActive]}
                        onPress={() => toggle(cat.key, 'email')}
                        hitSlop={8}
                      >
                        <MaterialCommunityIcons
                          name="email-outline"
                          size={13}
                          color={cfg.email && masterEmail ? '#fff' : Colors.textSubtle}
                        />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <View style={[styles.channelDot, styles.channelDotActive]}>
              <MaterialCommunityIcons name="bell-outline" size={12} color="#fff" />
            </View>
            <Text style={styles.legendText}>Push activo</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.channelDot, styles.channelDotEmailActive]}>
              <MaterialCommunityIcons name="email-outline" size={12} color="#fff" />
            </View>
            <Text style={styles.legendText}>Email activo</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={styles.channelDot}>
              <MaterialCommunityIcons name="bell-outline" size={12} color={Colors.textSubtle} />
            </View>
            <Text style={styles.legendText}>Desactivado</Text>
          </View>
        </View>
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
  scroll: { paddingHorizontal: Spacing.md, paddingTop: 4, gap: Spacing.md },

  masterCard: { borderRadius: Radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)' },
  masterCardInner: { padding: Spacing.md, gap: Spacing.sm },
  masterTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  masterSub: { color: Colors.textSubtle, fontSize: FontSize.xs, marginBottom: 4 },
  masterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.borderSubtle,
  },
  masterRowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  masterIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  masterRowLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  masterRowSub: { color: Colors.textSubtle, fontSize: FontSize.xs },

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
  catRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  catRowLast: { borderBottomWidth: 0 },
  catIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  catMeta: { flex: 1, gap: 1 },
  catLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  catSub: { color: Colors.textSubtle, fontSize: 10, lineHeight: 14 },
  catToggles: { flexDirection: 'row', gap: 6 },
  channelDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  channelDotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  channelDotEmailActive: { backgroundColor: Colors.blue, borderColor: Colors.blue },

  legend: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Spacing.lg, paddingVertical: Spacing.sm,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: Colors.textSubtle, fontSize: FontSize.xs },
});
