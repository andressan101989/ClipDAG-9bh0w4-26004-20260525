/**
 * app/creator-monetization.tsx
 *
 * Full creator monetization settings screen:
 * • Premium DM — enable/disable, set price, welcome message
 * • Subscription Plans — create / edit / view plans
 * • Earnings overview
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet,
  ActivityIndicator, Switch, Modal, KeyboardAvoidingView,
  Platform, Alert,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { getSupabaseClient } from '@/template';
import { useAlert } from '@/template';
import { configurePremiumDm } from '@/services/economyService';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const PREMIUM_COLOR  = '#FF9D00';
const PREMIUM_COLOR2 = '#FF5A00';
const SUB_COLOR      = '#A855F7';
const SUB_COLOR2     = '#7C5CFF';

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price_bdag: number;
  billing_cycle: string;
  perks: string[];
  subscribers_count: number;
  status: string;
}

interface PremiumDMStats {
  enabled: boolean;
  price_bdag: number;
  welcome_message: string;
  total_earned: number;
  messages_count: number;
}

// ── Perk row ─────────────────────────────────────────────────────────────────
function PerkRow({ perk, onRemove }: { perk: string; onRemove: () => void }) {
  return (
    <View style={pk.row}>
      <MaterialIcons name="check-circle" size={14} color={SUB_COLOR} />
      <Text style={pk.text}>{perk}</Text>
      <Pressable onPress={onRemove} hitSlop={8}>
        <MaterialIcons name="close" size={14} color={Colors.textSubtle} />
      </Pressable>
    </View>
  );
}
const pk = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(168,85,247,0.08)', borderRadius: Radius.md, padding: 10 },
  text: { color: Colors.textSecondary, fontSize: FontSize.sm, flex: 1 },
});

export default function CreatorMonetizationScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const walletData = useWallet();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  // ── Premium DM state ──────────────────────────────────────────────────────
  const [dmStats,       setDmStats]       = useState<PremiumDMStats | null>(null);
  const [dmEnabled,     setDmEnabled]     = useState(false);
  const [dmPrice,       setDmPrice]       = useState('50');
  const [dmWelcome,     setDmWelcome]     = useState('');
  const [dmSaving,      setDmSaving]      = useState(false);
  const [dmLoading,     setDmLoading]     = useState(true);

  // ── Subscription plans state ──────────────────────────────────────────────
  const [plans,         setPlans]         = useState<SubscriptionPlan[]>([]);
  const [plansLoading,  setPlansLoading]  = useState(true);
  const [planModal,     setPlanModal]     = useState(false);
  const [editingPlan,   setEditingPlan]   = useState<SubscriptionPlan | null>(null);
  const [planSaving,    setPlanSaving]    = useState(false);

  // Plan form
  const [planName,      setPlanName]      = useState('');
  const [planDesc,      setPlanDesc]      = useState('');
  const [planPrice,     setPlanPrice]     = useState('2000');
  const [planCycle,     setPlanCycle]     = useState('monthly');
  const [planPerks,     setPlanPerks]     = useState<string[]>([]);
  const [newPerk,       setNewPerk]       = useState('');

  // Tab
  const [activeTab, setActiveTab] = useState<'dm' | 'subscriptions'>('dm');

  // ── Load premium DM config ────────────────────────────────────────────────
  const loadDMConfig = useCallback(async () => {
    if (!user?.id) return;
    setDmLoading(true);
    const { data } = await supabase
      .from('premium_dm_config')
      .select('*')
      .eq('user_id', user.id)
      .single();
    if (data) {
      setDmStats(data);
      setDmEnabled(data.enabled);
      setDmPrice(String(data.price_bdag ?? 50));
      setDmWelcome(data.welcome_message ?? '');
    }
    setDmLoading(false);
  }, [user?.id, supabase]);

  // ── Load subscription plans ───────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    if (!user?.id) return;
    setPlansLoading(true);
    const { data } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('creator_id', user.id)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });
    setPlans((data as SubscriptionPlan[]) ?? []);
    setPlansLoading(false);
  }, [user?.id, supabase]);

  useEffect(() => { loadDMConfig(); loadPlans(); }, [loadDMConfig, loadPlans]);

  // ── Save premium DM config ────────────────────────────────────────────────
  const handleSaveDM = useCallback(async () => {
    const price = parseFloat(dmPrice);
    if (isNaN(price) || price < 1) { showAlert('Error', 'Precio mínimo: 1 BDAG'); return; }
    setDmSaving(true);
    const result = await configurePremiumDm({ enabled: dmEnabled, priceBdag: price, welcomeMessage: dmWelcome });
    setDmSaving(false);
    if (!result.success) { showAlert('Error', result.error ?? 'No se pudo guardar'); return; }
    showAlert(
      dmEnabled ? 'Premium DM activado' : 'Premium DM desactivado',
      dmEnabled
        ? `Los usuarios deberán pagar ${price} BDAG para enviarte un DM prioritario`
        : 'Los usuarios pueden enviarte mensajes gratis'
    );
    loadDMConfig();
  }, [dmEnabled, dmPrice, dmWelcome, configurePremiumDm, showAlert, loadDMConfig]);

  // ── Open plan form ────────────────────────────────────────────────────────
  const openPlanForm = useCallback((plan?: SubscriptionPlan) => {
    if (plan) {
      setEditingPlan(plan);
      setPlanName(plan.name);
      setPlanDesc(plan.description);
      setPlanPrice(String(plan.price_bdag));
      setPlanCycle(plan.billing_cycle);
      setPlanPerks([...(plan.perks ?? [])]);
    } else {
      setEditingPlan(null);
      setPlanName('');
      setPlanDesc('');
      setPlanPrice('2000');
      setPlanCycle('monthly');
      setPlanPerks([
        'Acceso a todo el contenido exclusivo',
        '10 DMs Premium gratis por mes',
        'Insignia de suscriptor VIP',
      ]);
    }
    setPlanModal(true);
  }, []);

  const closePlanForm = useCallback(() => {
    setPlanModal(false);
    setEditingPlan(null);
    setNewPerk('');
  }, []);

  // ── Save plan ─────────────────────────────────────────────────────────────
  const handleSavePlan = useCallback(async () => {
    if (!planName.trim()) { showAlert('Error', 'Nombre requerido'); return; }
    const price = parseFloat(planPrice);
    if (isNaN(price) || price < 100) { showAlert('Error', 'Precio mínimo: 100 BDAG/mes'); return; }
    if (!user?.id) return;

    setPlanSaving(true);
    const { data, error } = await supabase.rpc('upsert_subscription_plan', {
      p_creator_id:    user.id,
      p_name:          planName.trim(),
      p_description:   planDesc.trim(),
      p_price_bdag:    price,
      p_billing_cycle: planCycle,
      p_perks:         planPerks,
      p_plan_id:       editingPlan?.id ?? null,
    });
    setPlanSaving(false);

    if (error || !data?.success) {
      showAlert('Error', data?.error ?? error?.message ?? 'No se pudo guardar el plan');
      return;
    }
    closePlanForm();
    loadPlans();
    showAlert(
      editingPlan ? 'Plan actualizado' : 'Plan creado',
      `"${planName}" ya está disponible para tus seguidores`
    );
  }, [planName, planDesc, planPrice, planCycle, planPerks, editingPlan, user?.id, supabase, closePlanForm, loadPlans, showAlert]);

  // ── Toggle plan status ────────────────────────────────────────────────────
  const handleTogglePlan = useCallback(async (plan: SubscriptionPlan) => {
    const newStatus = plan.status === 'active' ? 'inactive' : 'active';
    await supabase.from('subscription_plans')
      .update({ status: newStatus })
      .eq('id', plan.id)
      .eq('creator_id', user?.id ?? '');
    loadPlans();
  }, [supabase, user?.id, loadPlans]);

  // ── Add perk ──────────────────────────────────────────────────────────────
  const handleAddPerk = useCallback(() => {
    if (!newPerk.trim()) return;
    setPlanPerks(prev => [...prev, newPerk.trim()]);
    setNewPerk('');
  }, [newPerk]);

  const totalEarnings = (dmStats?.total_earned ?? 0) + plans.reduce((s, p) => s + Number(p.price_bdag) * Number(p.subscribers_count) * 0.9, 0);

  const TABS = [
    { key: 'dm' as const,            label: 'Premium DM',     icon: 'mark-email-read', color: PREMIUM_COLOR },
    { key: 'subscriptions' as const, label: 'Suscripciones',  icon: 'star',            color: SUB_COLOR },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Monetización</Text>
          <Text style={styles.headerSub}>Premium DM · Suscripciones</Text>
        </View>
        <LinearGradient colors={['#FF9D00', '#A855F7']} style={styles.headerBadge}>
          <MaterialCommunityIcons name="hexagon-multiple" size={16} color="#fff" />
          <Text style={styles.headerBadgeText}>
            {(walletData?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} BDAG
          </Text>
        </LinearGradient>
      </View>

      {/* Earnings overview */}
      <LinearGradient colors={['rgba(168,85,247,0.18)', 'rgba(255,157,0,0.1)']} style={styles.earningsCard}>
        <View style={styles.earningsRow}>
          {[
            { label: 'Ganancias totales', val: `${totalEarnings.toFixed(0)} BDAG`, color: '#FFD700', icon: 'trending-up' },
            { label: 'DMs Premium',       val: String(dmStats?.messages_count ?? 0),   color: PREMIUM_COLOR, icon: 'message' },
            { label: 'Suscriptores',      val: String(plans.reduce((s, p) => s + p.subscribers_count, 0)), color: SUB_COLOR, icon: 'star' },
          ].map((stat, i) => (
            <React.Fragment key={stat.label}>
              {i > 0 ? <View style={styles.earningsDivider} /> : null}
              <View style={styles.earningsStat}>
                <MaterialIcons name={stat.icon as any} size={14} color={stat.color} />
                <Text style={[styles.earningsVal, { color: stat.color }]}>{stat.val}</Text>
                <Text style={styles.earningsLabel}>{stat.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </LinearGradient>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tabBtn, activeTab === t.key && { borderBottomColor: t.color, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(t.key)}
          >
            <MaterialIcons name={t.icon as any} size={16}
              color={activeTab === t.key ? t.color : Colors.textSubtle} />
            <Text style={[styles.tabText, activeTab === t.key && { color: t.color }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}
      >
        {/* ════ PREMIUM DM TAB ════════════════════════════════════════════ */}
        {activeTab === 'dm' && (
          <>
            {dmLoading ? (
              <View style={styles.centered}><ActivityIndicator color={PREMIUM_COLOR} /></View>
            ) : (
              <>
                {/* Enable toggle */}
                <View style={styles.card}>
                  <LinearGradient colors={dmEnabled
                    ? ['rgba(255,157,0,0.15)', 'rgba(255,90,0,0.07)']
                    : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.01)']}
                    style={styles.cardInner}>
                    <View style={styles.toggleRow}>
                      <View style={styles.toggleLeft}>
                        <LinearGradient colors={dmEnabled ? [PREMIUM_COLOR, PREMIUM_COLOR2] : [Colors.border, Colors.border]} style={styles.toggleIcon}>
                          <MaterialIcons name="mark-email-read" size={20} color="#fff" />
                        </LinearGradient>
                        <View>
                          <Text style={[styles.toggleLabel, dmEnabled && { color: PREMIUM_COLOR }]}>
                            Premium DM
                          </Text>
                          <Text style={styles.toggleSub}>
                            {dmEnabled ? 'Activo — los usuarios te pagan para enviarte DMs' : 'Inactivo — los mensajes son gratuitos'}
                          </Text>
                        </View>
                      </View>
                      <Switch
                        value={dmEnabled}
                        onValueChange={setDmEnabled}
                        trackColor={{ false: Colors.border, true: PREMIUM_COLOR + '55' }}
                        thumbColor={dmEnabled ? PREMIUM_COLOR : Colors.textSubtle}
                        ios_backgroundColor={Colors.border}
                      />
                    </View>
                  </LinearGradient>
                </View>

                {/* Price */}
                <View style={styles.formSection}>
                  <Text style={styles.fieldLabel}>Precio por DM (BDAG)</Text>
                  <View style={styles.priceRow}>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={dmPrice}
                      onChangeText={setDmPrice}
                      placeholder="50"
                      placeholderTextColor={Colors.textSubtle}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.bdagUnit}>BDAG</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
                    {['25', '50', '100', '250', '500'].map(v => (
                      <Pressable key={v}
                        style={[styles.quickChip, dmPrice === v && styles.quickChipActive]}
                        onPress={() => setDmPrice(v)}>
                        <Text style={[styles.quickChipText, dmPrice === v && styles.quickChipTextActive]}>{v}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  {parseFloat(dmPrice) > 0 ? (
                    <Text style={styles.feeNote}>
                      Tú recibes {(parseFloat(dmPrice) * 0.9).toFixed(0)} BDAG · Plataforma {(parseFloat(dmPrice) * 0.1).toFixed(0)} BDAG (10%)
                    </Text>
                  ) : null}
                </View>

                {/* Welcome message */}
                <View style={styles.formSection}>
                  <Text style={styles.fieldLabel}>Mensaje de bienvenida (opcional)</Text>
                  <TextInput
                    style={[styles.input, { minHeight: 80, textAlignVertical: 'top', paddingTop: 12 }]}
                    value={dmWelcome}
                    onChangeText={setDmWelcome}
                    placeholder="Ej: Respondo en 24h a todos los mensajes premium..."
                    placeholderTextColor={Colors.textSubtle}
                    multiline
                    maxLength={200}
                  />
                  <Text style={styles.charCount}>{dmWelcome.length}/200</Text>
                </View>

                {/* How premium DM works */}
                <View style={styles.infoBox}>
                  <View style={styles.infoBoxHeader}>
                    <MaterialIcons name="info-outline" size={14} color={PREMIUM_COLOR} />
                    <Text style={styles.infoBoxTitle}>¿Cómo funciona?</Text>
                  </View>
                  {[
                    '1. El usuario paga BDAG para enviarte un DM prioritario',
                    '2. El BDAG queda retenido en escrow automáticamente',
                    '3. Cuando respondes, el BDAG se libera a tu wallet',
                    '4. Si no respondes en 72h, el usuario recibe un reembolso automático',
                    '5. Tus suscriptores activos reciben 10 DMs Premium gratis/mes',
                  ].map(line => (
                    <View key={line} style={styles.infoLine}>
                      <MaterialIcons name="chevron-right" size={13} color={PREMIUM_COLOR} />
                      <Text style={styles.infoText}>{line}</Text>
                    </View>
                  ))}
                </View>

                {/* DM stats */}
                {dmStats && dmStats.messages_count > 0 ? (
                  <View style={styles.statsCard}>
                    <Text style={styles.statsTitle}>Estadísticas</Text>
                    <View style={styles.statsRow2}>
                      <View style={styles.statBlock}>
                        <Text style={styles.statVal}>{dmStats.messages_count}</Text>
                        <Text style={styles.statLbl}>DMs respondidos</Text>
                      </View>
                      <View style={styles.statBlock}>
                        <Text style={[styles.statVal, { color: PREMIUM_COLOR }]}>
                          {Number(dmStats.total_earned).toFixed(0)} BDAG
                        </Text>
                        <Text style={styles.statLbl}>Ganado total</Text>
                      </View>
                    </View>
                  </View>
                ) : null}

                {/* Save button */}
                <Pressable style={styles.saveBtn} onPress={handleSaveDM} disabled={dmSaving}>
                  <LinearGradient colors={[PREMIUM_COLOR, PREMIUM_COLOR2]} style={styles.saveBtnGrad}>
                    {dmSaving
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <MaterialIcons name="save" size={18} color="#fff" />}
                    <Text style={styles.saveBtnText}>
                      {dmSaving ? 'Guardando...' : 'Guardar configuración'}
                    </Text>
                  </LinearGradient>
                </Pressable>
              </>
            )}
          </>
        )}

        {/* ════ SUBSCRIPTIONS TAB ═════════════════════════════════════════ */}
        {activeTab === 'subscriptions' && (
          <>
            {/* Create plan CTA */}
            <Pressable style={styles.createPlanBtn} onPress={() => openPlanForm()}>
              <LinearGradient colors={[SUB_COLOR, SUB_COLOR2]} style={styles.createPlanBtnGrad}>
                <MaterialIcons name="add" size={20} color="#fff" />
                <Text style={styles.createPlanBtnText}>Crear plan de suscripción</Text>
              </LinearGradient>
            </Pressable>

            {/* How subscriptions work */}
            <View style={[styles.infoBox, { borderColor: 'rgba(168,85,247,0.3)' }]}>
              <View style={styles.infoBoxHeader}>
                <MaterialIcons name="info-outline" size={14} color={SUB_COLOR} />
                <Text style={[styles.infoBoxTitle, { color: SUB_COLOR }]}>Beneficios del suscriptor</Text>
              </View>
              {[
                'Acceso automático a TODO tu contenido exclusivo',
                '10 DMs Premium gratis por mes (sin pagar BDAG)',
                'Insignia de suscriptor VIP en chats y perfil',
                'Acceso a tu club privado de creador',
                'Renovación automática mensual',
              ].map(b => (
                <View key={b} style={styles.infoLine}>
                  <MaterialIcons name="check-circle" size={13} color={SUB_COLOR} />
                  <Text style={styles.infoText}>{b}</Text>
                </View>
              ))}
            </View>

            {plansLoading ? (
              <View style={styles.centered}><ActivityIndicator color={SUB_COLOR} /></View>
            ) : plans.length === 0 ? (
              <View style={styles.emptyPlans}>
                <MaterialCommunityIcons name="star-outline" size={52} color={Colors.border} />
                <Text style={styles.emptyPlansTitle}>Sin planes de suscripción</Text>
                <Text style={styles.emptyPlansSub}>Crea tu primer plan para empezar a monetizar</Text>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {plans.map(plan => (
                  <View key={plan.id} style={styles.planCard}>
                    <LinearGradient
                      colors={plan.status === 'active'
                        ? ['rgba(168,85,247,0.15)', 'rgba(124,92,255,0.07)']
                        : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.01)']}
                      style={styles.planCardInner}
                    >
                      {/* Plan header */}
                      <View style={styles.planHeader}>
                        <LinearGradient colors={[SUB_COLOR, SUB_COLOR2]} style={styles.planIcon}>
                          <MaterialIcons name="star" size={16} color="#fff" />
                        </LinearGradient>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.planName}>{plan.name}</Text>
                          <Text style={styles.planPrice}>
                            {Number(plan.price_bdag).toLocaleString(undefined, { maximumFractionDigits: 0 })} BDAG/{plan.billing_cycle === 'monthly' ? 'mes' : plan.billing_cycle}
                          </Text>
                        </View>
                        <Switch
                          value={plan.status === 'active'}
                          onValueChange={() => handleTogglePlan(plan)}
                          trackColor={{ false: Colors.border, true: SUB_COLOR + '55' }}
                          thumbColor={plan.status === 'active' ? SUB_COLOR : Colors.textSubtle}
                          ios_backgroundColor={Colors.border}
                        />
                      </View>

                      {/* Subscriber count */}
                      <View style={styles.planStats}>
                        <View style={styles.planStat}>
                          <MaterialIcons name="people" size={13} color={SUB_COLOR} />
                          <Text style={styles.planStatVal}>{plan.subscribers_count}</Text>
                          <Text style={styles.planStatLabel}>suscriptores</Text>
                        </View>
                        <View style={styles.planStat}>
                          <MaterialIcons name="trending-up" size={13} color={Colors.accent} />
                          <Text style={[styles.planStatVal, { color: Colors.accent }]}>
                            {(plan.subscribers_count * Number(plan.price_bdag) * 0.9).toFixed(0)}
                          </Text>
                          <Text style={styles.planStatLabel}>BDAG/mes</Text>
                        </View>
                      </View>

                      {/* Perks */}
                      {plan.perks?.length > 0 ? (
                        <View style={styles.planPerks}>
                          {plan.perks.slice(0, 3).map(perk => (
                            <View key={perk} style={styles.planPerkRow}>
                              <MaterialIcons name="check" size={11} color={SUB_COLOR} />
                              <Text style={styles.planPerkText} numberOfLines={1}>{perk}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}

                      {/* Edit button */}
                      <Pressable style={styles.editPlanBtn} onPress={() => openPlanForm(plan)}>
                        <MaterialIcons name="edit" size={14} color={SUB_COLOR} />
                        <Text style={styles.editPlanBtnText}>Editar plan</Text>
                      </Pressable>
                    </LinearGradient>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ════ CREATE/EDIT PLAN MODAL ════════════════════════════════════════ */}
      <Modal visible={planModal} transparent animationType="slide"
        presentationStyle="overFullScreen" onRequestClose={closePlanForm}>
        <Pressable style={styles.modalBackdrop} onPress={closePlanForm} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            style={styles.modalSheet}
            contentContainerStyle={{ gap: 16, padding: Spacing.lg, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>{editingPlan ? 'Editar plan' : 'Nuevo plan de suscripción'}</Text>

            <Text style={styles.fieldLabel}>Nombre del plan *</Text>
            <TextInput
              style={styles.input}
              value={planName}
              onChangeText={setPlanName}
              placeholder="Ej: VIP, Premium, Gold..."
              placeholderTextColor={Colors.textSubtle}
            />

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top', paddingTop: 12 }]}
              value={planDesc}
              onChangeText={setPlanDesc}
              placeholder="¿Qué ofrece este plan?"
              placeholderTextColor={Colors.textSubtle}
              multiline maxLength={250}
            />

            <Text style={styles.fieldLabel}>Precio mensual (BDAG) *</Text>
            <TextInput
              style={styles.input}
              value={planPrice}
              onChangeText={setPlanPrice}
              placeholder="Mín. 100 BDAG"
              placeholderTextColor={Colors.textSubtle}
              keyboardType="decimal-pad"
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
              {['500', '1000', '2000', '5000', '10000'].map(v => (
                <Pressable key={v}
                  style={[styles.quickChip, planPrice === v && { ...styles.quickChipActive, backgroundColor: SUB_COLOR, borderColor: SUB_COLOR }]}
                  onPress={() => setPlanPrice(v)}>
                  <Text style={[styles.quickChipText, planPrice === v && styles.quickChipTextActive]}>{v}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {parseFloat(planPrice) > 0 ? (
              <Text style={styles.feeNote}>
                Tú recibes {(parseFloat(planPrice) * 0.9).toFixed(0)} BDAG · Plataforma {(parseFloat(planPrice) * 0.1).toFixed(0)} BDAG
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Ciclo de facturación</Text>
            <View style={styles.cycleRow}>
              {[{ k: 'monthly', l: 'Mensual' }, { k: 'quarterly', l: 'Trimestral' }, { k: 'yearly', l: 'Anual' }].map(c => (
                <Pressable key={c.k}
                  style={[styles.cycleChip, planCycle === c.k && styles.cycleChipActive]}
                  onPress={() => setPlanCycle(c.k)}>
                  <Text style={[styles.cycleChipText, planCycle === c.k && styles.cycleChipTextActive]}>{c.l}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Beneficios del plan</Text>
            {planPerks.map((perk, i) => (
              <PerkRow key={i} perk={perk} onRemove={() => setPlanPerks(prev => prev.filter((_, j) => j !== i))} />
            ))}
            <View style={styles.addPerkRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={newPerk}
                onChangeText={setNewPerk}
                placeholder="Agregar beneficio..."
                placeholderTextColor={Colors.textSubtle}
                onSubmitEditing={handleAddPerk}
                returnKeyType="done"
              />
              <Pressable style={styles.addPerkBtn} onPress={handleAddPerk}>
                <LinearGradient colors={[SUB_COLOR, SUB_COLOR2]} style={styles.addPerkBtnGrad}>
                  <MaterialIcons name="add" size={18} color="#fff" />
                </LinearGradient>
              </Pressable>
            </View>

            {/* Default perks hint */}
            <View style={[styles.infoBox, { borderColor: 'rgba(168,85,247,0.2)' }]}>
              <Text style={[styles.infoBoxTitle, { color: SUB_COLOR, fontSize: FontSize.xs }]}>
                Beneficios automáticos incluidos en TODOS los planes:
              </Text>
              {['Acceso a contenido exclusivo sin pago individual', '10 DMs Premium gratis por mes', 'Insignia de suscriptor'].map(b => (
                <View key={b} style={styles.infoLine}>
                  <MaterialIcons name="check-circle" size={11} color={SUB_COLOR} />
                  <Text style={[styles.infoText, { fontSize: 11 }]}>{b}</Text>
                </View>
              ))}
            </View>

            <Pressable
              style={[styles.saveBtn, (!planName.trim() || parseFloat(planPrice) < 100) && { opacity: 0.4 }]}
              onPress={handleSavePlan} disabled={planSaving}>
              <LinearGradient colors={[SUB_COLOR, SUB_COLOR2]} style={styles.saveBtnGrad}>
                {planSaving ? <ActivityIndicator color="#fff" size="small" />
                  : <MaterialIcons name="save" size={18} color="#fff" />}
                <Text style={styles.saveBtnText}>
                  {planSaving ? 'Guardando...' : editingPlan ? 'Actualizar plan' : 'Crear plan'}
                </Text>
              </LinearGradient>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={closePlanForm}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.md, gap: Spacing.lg },
  centered: { paddingVertical: 40, alignItems: 'center' },

  header:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:      { padding: 4 },
  headerTitle:  { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  headerSub:    { fontSize: FontSize.xs, color: Colors.textSubtle, marginTop: 1 },
  headerBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 6 },
  headerBadgeText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  earningsCard: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, borderRadius: Radius.lg, padding: 14, borderWidth: 1, borderColor: 'rgba(168,85,247,0.2)' },
  earningsRow:  { flexDirection: 'row', alignItems: 'center' },
  earningsDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  earningsStat: { flex: 1, alignItems: 'center', gap: 3 },
  earningsVal:  { fontSize: 15, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  earningsLabel:{ color: Colors.textSubtle, fontSize: 10, textAlign: 'center' },

  tabBar:   { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 2 },
  tabBtn:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText:  { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  card:       { marginHorizontal: Spacing.md, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  cardInner:  { padding: Spacing.md },
  toggleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  toggleLabel:{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  toggleSub:  { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },

  formSection: { marginHorizontal: Spacing.md, gap: Spacing.sm },
  fieldLabel:  { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  priceRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bdagUnit:    { color: PREMIUM_COLOR, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  input:       { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 13, color: Colors.textPrimary, fontSize: FontSize.md },
  charCount:   { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  quickRow:    { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  quickChip:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  quickChipActive: { backgroundColor: PREMIUM_COLOR, borderColor: PREMIUM_COLOR },
  quickChipText: { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  quickChipTextActive: { color: '#fff' },
  feeNote:     { color: Colors.textSubtle, fontSize: 11 },

  infoBox:     { marginHorizontal: Spacing.md, backgroundColor: 'rgba(255,157,0,0.07)', borderRadius: Radius.md, padding: 12, gap: 7, borderWidth: 1, borderColor: 'rgba(255,157,0,0.2)' },
  infoBoxHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  infoBoxTitle: { color: PREMIUM_COLOR, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  infoLine:    { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  infoText:    { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1, lineHeight: 17 },

  statsCard:   { marginHorizontal: Spacing.md, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: 14, borderWidth: 1, borderColor: Colors.border },
  statsTitle:  { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 8 },
  statsRow2:   { flexDirection: 'row', gap: Spacing.md },
  statBlock:   { flex: 1, alignItems: 'center', gap: 3 },
  statVal:     { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  statLbl:     { color: Colors.textSubtle, fontSize: FontSize.xs },

  saveBtn:     { marginHorizontal: Spacing.md, borderRadius: Radius.md, overflow: 'hidden' },
  saveBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 },
  saveBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },

  // Subscription plan list
  createPlanBtn:    { marginHorizontal: Spacing.md, borderRadius: Radius.md, overflow: 'hidden' },
  createPlanBtnGrad:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  createPlanBtnText:{ color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  emptyPlans:       { alignItems: 'center', paddingVertical: 44, gap: 12 },
  emptyPlansTitle:  { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptyPlansSub:    { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },

  planCard:     { marginHorizontal: Spacing.md, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  planCardInner:{ padding: Spacing.md, gap: Spacing.sm },
  planHeader:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  planIcon:     { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  planName:     { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  planPrice:    { color: SUB_COLOR, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginTop: 1 },
  planStats:    { flexDirection: 'row', gap: Spacing.lg },
  planStat:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  planStatVal:  { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  planStatLabel:{ color: Colors.textSubtle, fontSize: FontSize.xs },
  planPerks:    { gap: 4 },
  planPerkRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planPerkText: { color: Colors.textSubtle, fontSize: FontSize.xs, flex: 1 },
  editPlanBtn:  { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(168,85,247,0.1)', borderRadius: Radius.sm, borderWidth: 1, borderColor: 'rgba(168,85,247,0.25)' },
  editPlanBtnText: { color: SUB_COLOR, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Create plan modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  modalSheet:    { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%' },
  handle:        { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  modalTitle:    { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  cycleRow:      { flexDirection: 'row', gap: 8 },
  cycleChip:     { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  cycleChipActive: { backgroundColor: SUB_COLOR, borderColor: SUB_COLOR },
  cycleChipText: { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  cycleChipTextActive: { color: '#fff' },
  addPerkRow:    { flexDirection: 'row', gap: 8 },
  addPerkBtn:    { borderRadius: Radius.md, overflow: 'hidden' },
  addPerkBtnGrad: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelBtn:     { alignItems: 'center', paddingVertical: 12, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  cancelText:    { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
