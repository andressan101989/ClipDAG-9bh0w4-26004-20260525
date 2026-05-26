/**
 * components/creator/BoostProfileSheet.tsx
 * Bottom sheet for sponsoring/boosting a creator's profile.
 */
import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal, ActivityIndicator, Dimensions,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { PROFILE_BOOST_TIERS, type BoostTier } from '@/services/boostService';

const { width: W } = Dimensions.get('window');

function fmt(n: number, d = 0) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface Props {
  visible:      boolean;
  creatorName:  string;
  balance:      number;
  onClose:      () => void;
  onBoost:      (tier: BoostTier) => Promise<void>;
}

export function BoostProfileSheet({ visible, creatorName, balance, onClose, onBoost }: Props) {
  const [selected, setSelected] = useState(0);
  const [loading,  setLoading]  = useState(false);
  const insets = useSafeAreaInsets();

  const tier      = PROFILE_BOOST_TIERS[selected];
  const canAfford = balance >= tier.bdag;

  const handleBoost = async () => {
    setLoading(true);
    try {
      await onBoost(tier);
      onClose();
    } catch (e: any) {
      console.warn('[BoostProfileSheet] boost error:', e?.message);
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

        <View style={s.header}>
          <LinearGradient colors={['#FF9D00', '#FF5A00']} style={s.headerIcon}>
            <MaterialCommunityIcons name="rocket-launch" size={18} color="#fff" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Patrocinar a @{creatorName}</Text>
            <Text style={s.subtitle}>Gasta BDAG para amplificar su visibilidad en el feed</Text>
          </View>
        </View>

        <View style={s.effectsBox}>
          {[
            { icon: 'search',      text: 'Mayor visibilidad en búsqueda y explorar' },
            { icon: 'trending-up', text: 'Posición en sección trending de creadores' },
            { icon: 'people',      text: 'Sugerido a nuevos usuarios potenciales' },
            { icon: 'feed',        text: 'Aparece en feed patrocinado de seguidores' },
          ].map(e => (
            <View key={e.text} style={s.effectRow}>
              <MaterialIcons name={e.icon as any} size={12} color="#FF9D00" />
              <Text style={s.effectText}>{e.text}</Text>
            </View>
          ))}
        </View>

        <View style={s.tierGrid}>
          {PROFILE_BOOST_TIERS.map((t, i) => (
            <Pressable
              key={i}
              style={[s.tierCard, selected === i && { borderColor: t.color, backgroundColor: t.color + '18' }]}
              onPress={() => setSelected(i)}
            >
              <Text style={[s.tierLabel, { color: selected === i ? t.color : Colors.textSubtle }]}>
                {t.label}
              </Text>
              <Text style={[s.tierMult, { color: t.color }]}>{t.multiplier}</Text>
              <Text style={[s.tierBdag, { color: selected === i ? t.color : Colors.textSecondary }]}>
                {t.bdag.toLocaleString()} BDAG
              </Text>
              <Text style={s.tierHrs}>{t.hours}h</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.tierDesc}>{tier.description}</Text>

        <View style={s.balRow}>
          <MaterialCommunityIcons name="hexagon-multiple" size={13} color={Colors.textSubtle} />
          <Text style={s.balText}>Tu saldo: {fmt(balance)} BDAG</Text>
          {!canAfford ? <Text style={s.insufficientText}>· Insuficiente</Text> : null}
        </View>

        <Pressable
          style={[s.boostBtn, !canAfford && { opacity: 0.4 }]}
          onPress={handleBoost}
          disabled={loading || !canAfford}
        >
          <LinearGradient colors={['#FF9D00', '#FF5A00']} style={s.boostBtnGrad}>
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <MaterialCommunityIcons name="rocket-launch" size={16} color="#fff" />}
            <Text style={s.boostBtnText}>
              {loading
                ? 'Activando...'
                : `Patrocinar · ${tier.bdag.toLocaleString()} BDAG · ${tier.hours}h`}
            </Text>
          </LinearGradient>
        </Pressable>

        <Pressable style={s.cancelBtn} onPress={onClose}>
          <Text style={s.cancelText}>Cancelar</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:        { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  sheet:           { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, gap: Spacing.md, borderTopWidth: 1, borderColor: Colors.border },
  handle:          { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 4 },
  header:          { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon:      { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title:           { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  subtitle:        { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  effectsBox:      { backgroundColor: 'rgba(255,157,0,0.08)', borderRadius: Radius.md, padding: 10, gap: 6, borderWidth: 1, borderColor: 'rgba(255,157,0,0.2)' },
  effectRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  effectText:      { color: Colors.textSecondary, fontSize: 11, flex: 1 },
  tierGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tierCard:        { width: (W - Spacing.lg * 2 - 24) / 2, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 12, gap: 2, borderWidth: 1.5, borderColor: Colors.border },
  tierLabel:       { fontSize: 11, fontWeight: FontWeight.semibold },
  tierMult:        { fontSize: 20, fontWeight: FontWeight.extrabold },
  tierBdag:        { fontSize: 11, fontWeight: FontWeight.semibold },
  tierHrs:         { color: Colors.textSubtle, fontSize: 10 },
  tierDesc:        { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center' },
  balRow:          { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'center' },
  balText:         { color: Colors.textSubtle, fontSize: FontSize.xs },
  insufficientText:{ color: Colors.error, fontSize: 11 },
  boostBtn:        { borderRadius: Radius.md, overflow: 'hidden' },
  boostBtnGrad:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  boostBtnText:    { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  cancelBtn:       { alignItems: 'center', paddingVertical: 12, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  cancelText:      { color: Colors.textSubtle, fontSize: FontSize.sm },
});
