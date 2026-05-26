/**
 * components/creator/SubscribeSheet.tsx
 * Bottom sheet for subscribing to a creator's plan.
 */
import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { SubscriptionPlan } from '@/services/subscriptionService';

function fmt(n: number, d = 0) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface Props {
  visible:         boolean;
  plans:           SubscriptionPlan[];
  balance:         number;
  isSubscribed:    boolean;
  currentPlanName: string;
  freeDmsLeft:     number;
  onClose:         () => void;
  onSubscribe:     (plan: SubscriptionPlan) => Promise<void>;
}

export function SubscribeSheet({
  visible, plans, balance, isSubscribed, currentPlanName, freeDmsLeft,
  onClose, onSubscribe,
}: Props) {
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  const handleSub = async (plan: SubscriptionPlan) => {
    setLoading(true);
    try {
      await onSubscribe(plan);
      onClose();
    } catch (e: any) {
      console.warn('[SubscribeSheet] subscribe error:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={s.handle} />

        {isSubscribed ? (
          <>
            <LinearGradient colors={['#A855F7', '#7C5CFF']} style={s.activeHeader}>
              <MaterialIcons name="star" size={24} color="#fff" />
              <Text style={s.activeTitle}>Suscrito — {currentPlanName}</Text>
            </LinearGradient>
            <View style={s.benefitsList}>
              {[
                'Acceso a todo el contenido exclusivo',
                `${freeDmsLeft} DMs Premium gratis este mes`,
                'Insignia de suscriptor VIP',
                'Acceso al club privado del creador',
              ].map(b => (
                <View key={b} style={s.benefitRow}>
                  <MaterialIcons name="check-circle" size={14} color="#A855F7" />
                  <Text style={s.benefitText}>{b}</Text>
                </View>
              ))}
            </View>
            <Pressable style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeBtnText}>Cerrar</Text>
            </Pressable>
          </>
        ) : plans.length === 0 ? (
          <>
            <Text style={s.noPlansTitle}>Sin planes disponibles</Text>
            <Text style={s.noPlansText}>Este creador aún no configuró planes de suscripción.</Text>
            <Pressable style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeBtnText}>Cerrar</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={s.header}>
              <LinearGradient colors={['#A855F7', '#7C5CFF']} style={s.headerIcon}>
                <MaterialIcons name="star" size={18} color="#fff" />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Suscribirte al creador</Text>
                <Text style={s.subtitle}>Elige un plan y accede a todos los beneficios VIP</Text>
              </View>
            </View>

            <View style={s.autoBenefits}>
              {[
                'Todo el contenido exclusivo sin pago individual',
                '10 DMs Premium gratis por mes',
                'Insignia de suscriptor VIP + club privado',
              ].map(b => (
                <View key={b} style={s.benefitRow}>
                  <MaterialIcons name="check-circle" size={12} color="#A855F7" />
                  <Text style={[s.benefitText, { fontSize: 11 }]}>{b}</Text>
                </View>
              ))}
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 280 }}>
              {plans.map(plan => {
                const canAfford = balance >= plan.price_bdag;
                return (
                  <Pressable
                    key={plan.id}
                    style={s.planCard}
                    onPress={() => canAfford ? handleSub(plan) : null}
                  >
                    <LinearGradient
                      colors={['rgba(168,85,247,0.15)', 'rgba(124,92,255,0.07)']}
                      style={s.planCardInner}
                    >
                      <View style={s.planHeader}>
                        <LinearGradient colors={['#A855F7', '#7C5CFF']} style={s.planIcon}>
                          <MaterialIcons name="star" size={14} color="#fff" />
                        </LinearGradient>
                        <View style={{ flex: 1 }}>
                          <Text style={s.planName}>{plan.name}</Text>
                          {plan.description ? (
                            <Text style={s.planDesc} numberOfLines={1}>{plan.description}</Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.planPrice}>{fmt(plan.price_bdag)} BDAG</Text>
                          <Text style={s.planCycle}>
                            /{plan.billing_cycle === 'monthly' ? 'mes' : plan.billing_cycle}
                          </Text>
                        </View>
                      </View>

                      {plan.perks?.slice(0, 3).map(perk => (
                        <View key={perk} style={s.perkRow}>
                          <MaterialIcons name="check" size={10} color="#A855F7" />
                          <Text style={s.perkText} numberOfLines={1}>{perk}</Text>
                        </View>
                      ))}

                      <Pressable
                        style={[s.subBtn, !canAfford && { opacity: 0.4 }]}
                        onPress={() => canAfford && handleSub(plan)}
                        disabled={loading}
                      >
                        <LinearGradient colors={['#A855F7', '#7C5CFF']} style={s.subBtnGrad}>
                          {loading
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <MaterialIcons name="star" size={14} color="#fff" />}
                          <Text style={s.subBtnText}>
                            {loading
                              ? 'Procesando...'
                              : canAfford
                                ? `Suscribirse · ${fmt(plan.price_bdag)} BDAG`
                                : 'Saldo insuficiente'}
                          </Text>
                        </LinearGradient>
                      </Pressable>
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={s.balRow}>
              <MaterialCommunityIcons name="hexagon-multiple" size={13} color={Colors.textSubtle} />
              <Text style={s.balText}>Tu saldo: {fmt(balance)} BDAG</Text>
            </View>
            <Pressable style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeBtnText}>Cancelar</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet:        { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, gap: Spacing.md, borderTopWidth: 1, borderColor: Colors.border },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  activeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.lg, padding: 14 },
  activeTitle:  { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  benefitsList: { gap: 8 },
  benefitRow:   { flexDirection: 'row', alignItems: 'center', gap: 7 },
  benefitText:  { color: Colors.textSecondary, fontSize: FontSize.xs, flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon:   { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title:        { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  subtitle:     { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  autoBenefits: { backgroundColor: 'rgba(168,85,247,0.08)', borderRadius: Radius.md, padding: 10, gap: 5, borderWidth: 1, borderColor: 'rgba(168,85,247,0.2)' },
  planCard:     { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)', marginBottom: 10 },
  planCardInner:{ padding: Spacing.md, gap: 6 },
  planHeader:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planIcon:     { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  planName:     { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  planDesc:     { color: Colors.textSubtle, fontSize: FontSize.xs },
  planPrice:    { color: '#A855F7', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  planCycle:    { color: Colors.textSubtle, fontSize: 10 },
  perkRow:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
  perkText:     { color: Colors.textSubtle, fontSize: 11, flex: 1 },
  subBtn:       { borderRadius: Radius.md, overflow: 'hidden', marginTop: 4 },
  subBtnGrad:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11 },
  subBtnText:   { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  balRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center' },
  balText:      { color: Colors.textSubtle, fontSize: FontSize.xs },
  closeBtn:     { alignItems: 'center', paddingVertical: 12, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  closeBtnText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  noPlansTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  noPlansText:  { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
});
