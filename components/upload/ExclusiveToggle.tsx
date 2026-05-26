/**
 * components/upload/ExclusiveToggle.tsx
 * Toggle card for marking uploaded content as exclusive (paid/subscription).
 */
import React from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, Switch, ScrollView,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const QUICK_PRICES = ['50', '100', '500', '1000', '2500'];

interface Props {
  enabled:       boolean;
  price:         string;
  onToggle:      (v: boolean) => void;
  onPriceChange: (v: string) => void;
}

export function ExclusiveToggle({ enabled, price, onToggle, onPriceChange }: Props) {
  return (
    <View style={s.wrap}>
      <LinearGradient
        colors={
          enabled
            ? ['rgba(168,85,247,0.18)', 'rgba(124,92,255,0.10)']
            : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.02)']
        }
        style={s.card}
      >
        <View style={s.row}>
          <View style={s.left}>
            <LinearGradient
              colors={enabled ? ['#A855F7', '#7C5CFF'] : ['#2A2A42', '#1C1C32']}
              style={s.iconBg}
            >
              <MaterialIcons
                name={enabled ? 'lock' : 'lock-open'}
                size={18}
                color={enabled ? '#fff' : Colors.textSubtle}
              />
            </LinearGradient>
            <View>
              <Text style={[s.label, enabled && { color: '#A855F7' }]}>Contenido Exclusivo</Text>
              <Text style={s.sub}>
                {enabled
                  ? 'Solo accesible con pago o suscripción'
                  : 'Toca para bloquear este contenido'}
              </Text>
            </View>
          </View>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            trackColor={{ false: Colors.border, true: '#A855F733' }}
            thumbColor={enabled ? '#A855F7' : Colors.textSubtle}
            ios_backgroundColor={Colors.border}
          />
        </View>

        {enabled ? (
          <View style={s.priceSection}>
            <View style={s.divider} />
            <Text style={s.priceLabel}>Precio de desbloqueo</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.quickRow}
            >
              {QUICK_PRICES.map(v => (
                <Pressable
                  key={v}
                  style={[s.quickChip, price === v && s.quickChipActive]}
                  onPress={() => onPriceChange(v)}
                >
                  <Text style={[s.quickChipText, price === v && s.quickChipTextActive]}>
                    {v} BDAG
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={s.priceInputRow}>
              <MaterialCommunityIcons name="hexagon-multiple" size={16} color="#A855F7" />
              <TextInput
                style={s.priceInput}
                value={price}
                onChangeText={onPriceChange}
                placeholder="Precio personalizado"
                placeholderTextColor={Colors.textSubtle}
                keyboardType="decimal-pad"
              />
              <Text style={s.unit}>BDAG</Text>
            </View>

            {parseFloat(price) > 0 ? (
              <View style={s.feeRow}>
                <MaterialCommunityIcons name="information-outline" size={11} color={Colors.textSubtle} />
                <Text style={s.feeText}>
                  Tú recibes {(parseFloat(price) * 0.9).toFixed(0)} BDAG · Plataforma{' '}
                  {(parseFloat(price) * 0.1).toFixed(0)} BDAG (10%)
                </Text>
              </View>
            ) : null}

            <View style={s.benefits}>
              {[
                { icon: 'lock',          text: 'Preview borroso para no suscriptores' },
                { icon: 'star',          text: 'Acceso automático para tus suscriptores' },
                { icon: 'bolt',          text: 'Desbloqueo instantáneo con BDAG' },
                { icon: 'library-books', text: 'Biblioteca de contenido comprado' },
              ].map(b => (
                <View key={b.text} style={s.benefitRow}>
                  <MaterialIcons name={b.icon as any} size={12} color="#A855F7" />
                  <Text style={s.benefitText}>{b.text}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </LinearGradient>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:           { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  card:           { padding: Spacing.md, gap: Spacing.sm },
  row:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  left:           { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBg:         { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  label:          { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  sub:            { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  priceSection:   { gap: Spacing.sm },
  divider:        { height: 1, backgroundColor: 'rgba(168,85,247,0.2)' },
  priceLabel:     { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  quickRow:       { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  quickChip:      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: Colors.border },
  quickChipActive:{ backgroundColor: '#A855F7', borderColor: '#A855F7' },
  quickChipText:  { color: Colors.textSubtle, fontSize: 11, fontWeight: FontWeight.semibold },
  quickChipTextActive: { color: '#fff' },
  priceInputRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(168,85,247,0.1)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)', paddingHorizontal: 12, paddingVertical: 10 },
  priceInput:     { flex: 1, color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  unit:           { color: '#A855F7', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  feeRow:         { flexDirection: 'row', alignItems: 'center', gap: 5 },
  feeText:        { color: Colors.textSubtle, fontSize: 10 },
  benefits:       { backgroundColor: 'rgba(168,85,247,0.08)', borderRadius: Radius.md, padding: 10, gap: 6 },
  benefitRow:     { flexDirection: 'row', alignItems: 'center', gap: 7 },
  benefitText:    { color: Colors.textSecondary, fontSize: 11 },
});
