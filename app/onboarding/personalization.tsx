import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { NelyonLogo } from '@/components/ui/NelyonLogo';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAlert } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import {
  completePersonalizationOnboarding,
  ContentLanguage,
  getOnboardingCreatorRecommendations,
  getPersonalizationCatalog,
  getPersonalizationOnboarding,
  OnboardingCreatorRecommendation,
  PersonalizationCatalog,
  savePersonalizationPreferences,
} from '@/services/personalizationService';

const LANGUAGE_LABELS: Record<ContentLanguage, string> = {
  es: 'Español', en: 'English', pt: 'Português', fr: 'Français',
};
const SUGGESTED_REGIONS = ['GLOBAL', 'US', 'MX', 'DO', 'PR', 'CO', 'AR', 'BR', 'ES', 'FR', 'PT', 'CA'];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function PersonalizationOnboardingScreen() {
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEditing = edit === '1';
  const { showAlert } = useAlert();
  const { toggleFollow, isFollowing } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [catalog, setCatalog] = useState<PersonalizationCatalog | null>(null);
  const [primaryLanguage, setPrimaryLanguage] = useState<ContentLanguage>('es');
  const [additionalLanguages, setAdditionalLanguages] = useState<ContentLanguage[]>([]);
  const [contentRegion, setContentRegion] = useState('GLOBAL');
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set());
  const [selectedCreators, setSelectedCreators] = useState<Set<string>>(new Set());
  const [creators, setCreators] = useState<OnboardingCreatorRecommendation[]>([]);
  const [personalizationEnabled, setPersonalizationEnabled] = useState(true);
  const [adsConsent, setAdsConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextCatalog, status] = await Promise.all([
        getPersonalizationCatalog(), getPersonalizationOnboarding(),
      ]);
      setCatalog(nextCatalog);
      if (status.primaryLanguageTag) setPrimaryLanguage(status.primaryLanguageTag);
      setAdditionalLanguages(status.additionalLanguageTags);
      setContentRegion(status.contentRegionCode ?? 'GLOBAL');
      setSelectedInterests(new Set(status.interestSlugs));
      setPersonalizationEnabled(status.personalizationEnabled);
      setAdsConsent(status.adsPersonalizationConsent);
    } catch (cause: any) {
      setError(cause?.message ?? 'No se pudo cargar la personalización.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const parents = useMemo(
    () => catalog?.topics.filter(topic => topic.level === 1) ?? [], [catalog],
  );
  const selectedParents = useMemo(
    () => parents.filter(topic => selectedInterests.has(topic.slug)), [parents, selectedInterests],
  );
  const childrenByParent = useMemo(() => {
    const result = new Map<string, typeof parents>();
    for (const parent of selectedParents) {
      result.set(parent.slug, catalog?.topics.filter(topic => topic.parentSlug === parent.slug) ?? []);
    }
    return result;
  }, [catalog, selectedParents]);

  const toggleParent = (slug: string) => {
    setSelectedInterests(previous => {
      const next = new Set(previous);
      if (next.has(slug)) {
        next.delete(slug);
        for (const child of catalog?.topics.filter(topic => topic.parentSlug === slug) ?? []) next.delete(child.slug);
      } else if (selectedParents.length < (catalog?.maximumParentInterests ?? 8)) next.add(slug);
      return next;
    });
  };
  const toggleChild = (slug: string) => setSelectedInterests(previous => {
    const next = new Set(previous);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    return next;
  });

  const validateStep = (): string | null => {
    if (currentStep === 0) {
      if (!primaryLanguage || !contentRegion.trim()) return 'Selecciona un idioma principal y una región o Global.';
      if (additionalLanguages.length > 3) return 'Puedes elegir hasta tres idiomas adicionales.';
    }
    if (currentStep === 1 && selectedParents.length < (catalog?.minimumParentInterests ?? 3)) {
      return 'Elige al menos tres intereses.';
    }
    if (currentStep === 2) {
      const missing = selectedParents.find(parent =>
        !(childrenByParent.get(parent.slug) ?? []).some(child => selectedInterests.has(child.slug)));
      if (missing) return `Elige un tema o “General” para ${missing.labels.es}.`;
    }
    return null;
  };

  const preferenceInput = () => ({
    primaryLanguageTag: primaryLanguage,
    additionalLanguageTags: additionalLanguages,
    contentRegionCode: contentRegion.trim().toUpperCase(),
    interestSlugs: [...selectedInterests],
    personalizationEnabled,
    adsPersonalizationConsent: adsConsent,
  });

  const next = async () => {
    const validation = validateStep();
    if (validation) { showAlert('Revisa este paso', validation); return; }
    if (currentStep === 2) {
      setSaving(true);
      try {
        await savePersonalizationPreferences(preferenceInput());
        const recommendations = await getOnboardingCreatorRecommendations(12);
        setCreators(recommendations);
        setSelectedCreators(new Set(recommendations.filter(item => item.alreadyFollowing).map(item => item.creatorId)));
        setCurrentStep(3);
      } catch (cause: any) {
        showAlert('No se pudo guardar', cause?.message ?? 'Inténtalo de nuevo.');
      } finally { setSaving(false); }
      return;
    }
    setCurrentStep(step => Math.min(3, step + 1));
  };

  const toggleCreator = async (creator: OnboardingCreatorRecommendation) => {
    if (!isFollowing(creator.creatorId) && selectedCreators.size >= (catalog?.maximumCreatorFollows ?? 5)) {
      showAlert('Máximo alcanzado', 'Puedes elegir hasta cinco creadores durante el onboarding.');
      return;
    }
    await toggleFollow(creator.creatorId);
    setSelectedCreators(previous => {
      const next = new Set(previous);
      if (next.has(creator.creatorId)) next.delete(creator.creatorId);
      else next.add(creator.creatorId);
      return next;
    });
  };

  const finish = async () => {
    setSaving(true);
    try {
      await savePersonalizationPreferences(preferenceInput());
      const completion = await completePersonalizationOnboarding();
      if (!completion.completed) throw new Error('personalization_completion_incomplete');
      router.replace(isEditing ? '/settings' : '/(tabs)');
    } catch (cause: any) {
      showAlert('Falta completar', cause?.message === 'personalization_creator_follows_required'
        ? 'Sigue los creadores recomendados requeridos para continuar.'
        : cause?.message ?? 'No se pudo completar la personalización.');
    } finally { setSaving(false); }
  };

  if (loading) return (
    <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View></SafeAreaView>
  );
  if (error || !catalog) return (
    <SafeAreaView style={styles.safe}><View style={styles.center}>
      <Text style={styles.errorText}>{error ?? 'Catálogo no disponible.'}</Text>
      <Pressable style={styles.primaryButton} onPress={load}><Text style={styles.primaryButtonText}>Reintentar</Text></Pressable>
    </View></SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <NelyonLogo style={styles.logo} />
        <Text style={styles.progressLabel}>{isEditing ? 'Editar personalización' : `Paso ${currentStep + 1} de 4`}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(currentStep + 1) * 25}%` }]} /></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {currentStep === 0 ? <>
          <Text style={styles.title}>Tu idioma y contenido</Text>
          <Text style={styles.subtitle}>Elige cómo quieres descubrir videos. No usamos GPS ni inferimos tu nacionalidad.</Text>
          <Text style={styles.sectionLabel}>Idioma principal</Text>
          <View style={styles.wrap}>{catalog.languages.map(language => (
            <Chip key={language} label={LANGUAGE_LABELS[language]} selected={primaryLanguage === language}
              onPress={() => { setPrimaryLanguage(language); setAdditionalLanguages(values => values.filter(value => value !== language)); }} />
          ))}</View>
          <Text style={styles.sectionLabel}>Idiomas adicionales (hasta 3)</Text>
          <View style={styles.wrap}>{catalog.languages.filter(language => language !== primaryLanguage).map(language => (
            <Chip key={language} label={LANGUAGE_LABELS[language]} selected={additionalLanguages.includes(language)} onPress={() => {
              setAdditionalLanguages(values => values.includes(language)
                ? values.filter(value => value !== language)
                : values.length < 3 ? [...values, language] : values);
            }} />
          ))}</View>
          <Text style={styles.sectionLabel}>País o región del contenido que quieres ver</Text>
          <View style={styles.wrap}>{SUGGESTED_REGIONS.map(region => (
            <Chip key={region} label={region === 'GLOBAL' ? 'Global' : region} selected={contentRegion === region} onPress={() => setContentRegion(region)} />
          ))}</View>
          <TextInput value={contentRegion} onChangeText={value => setContentRegion(value.toUpperCase())}
            autoCapitalize="characters" maxLength={6} placeholder="GLOBAL o código de país" placeholderTextColor={Colors.textSubtle} style={styles.input} />
          <View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>Personalización del feed</Text><Text style={styles.toggleSubtitle}>Usa estas preferencias y tu comportamiento real.</Text></View><Switch value={personalizationEnabled} onValueChange={setPersonalizationEnabled} /></View>
          <View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>Anuncios personalizados</Text><Text style={styles.toggleSubtitle}>Solo intereses seguros, con tu consentimiento y según tu edad.</Text></View><Switch value={adsConsent} onValueChange={setAdsConsent} /></View>
        </> : null}
        {currentStep === 1 ? <>
          <Text style={styles.title}>¿Qué te interesa?</Text>
          <Text style={styles.subtitle}>Elige entre {catalog.minimumParentInterests} y {catalog.maximumParentInterests}. Siempre preservaremos exploración y diversidad.</Text>
          <View style={styles.grid}>{parents.map(topic => (
            <Chip key={topic.slug} label={topic.labels.es} selected={selectedInterests.has(topic.slug)} onPress={() => toggleParent(topic.slug)} />
          ))}</View>
          <Text style={styles.counter}>{selectedParents.length}/{catalog.maximumParentInterests} seleccionados</Text>
        </> : null}
        {currentStep === 2 ? <>
          <Text style={styles.title}>Afinemos tus temas</Text>
          <Text style={styles.subtitle}>Elige al menos uno por categoría. Puedes elegir “General”.</Text>
          {selectedParents.map(parent => <View key={parent.slug} style={styles.topicGroup}>
            <Text style={styles.sectionLabel}>{parent.labels.es}</Text>
            <View style={styles.wrap}>{(childrenByParent.get(parent.slug) ?? []).map(child => (
              <Chip key={child.slug} label={child.labels.es} selected={selectedInterests.has(child.slug)} onPress={() => toggleChild(child.slug)} />
            ))}</View>
          </View>)}
        </> : null}
        {currentStep === 3 ? <>
          <Text style={styles.title}>Creadores para comenzar</Text>
          <Text style={styles.subtitle}>{creators.length >= 2 ? 'Sigue al menos 2 creadores.' : creators.length === 1 ? 'Sigue este creador para comenzar.' : 'Todavía no hay creadores elegibles; puedes continuar.'}</Text>
          {creators.map(creator => {
            const followed = isFollowing(creator.creatorId) || selectedCreators.has(creator.creatorId);
            return <View key={creator.creatorId} style={styles.creatorCard}>
              <Avatar uri={creator.avatarUrl} username={creator.username} size={52} />
              <View style={styles.creatorCopy}><Text style={styles.creatorName}>{creator.displayName}</Text><Text style={styles.creatorHandle}>@{creator.username}</Text><Text style={styles.creatorReason}>Afinidad + calidad + diversidad</Text></View>
              <Pressable onPress={() => toggleCreator(creator)} style={[styles.followButton, followed && styles.followButtonActive]}>
                <Text style={[styles.followButtonText, followed && styles.followButtonTextActive]}>{followed ? 'Siguiendo' : 'Seguir'}</Text>
              </Pressable>
            </View>;
          })}
          {creators.length === 0 ? <View style={styles.empty}><MaterialCommunityIcons name="account-search-outline" size={48} color={Colors.textSubtle} /><Text style={styles.subtitle}>Tu feed seguirá usando intereses, idioma y exploración.</Text></View> : null}
        </> : null}
      </ScrollView>
      <View style={styles.footer}>
        {currentStep > 0 ? <Pressable style={styles.secondaryButton} disabled={saving} onPress={() => setCurrentStep(step => step - 1)}><Text style={styles.secondaryButtonText}>Atrás</Text></Pressable> : null}
        <Pressable style={[styles.primaryButton, saving && styles.disabled]} disabled={saving} onPress={currentStep === 3 ? finish : next}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{currentStep === 3 ? (isEditing ? 'Guardar cambios' : 'Ir al Feed') : 'Continuar'}</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm }, logo: { width: 170, height: 42, alignSelf: 'center' },
  progressLabel: { color: Colors.textSubtle, textAlign: 'center', fontSize: FontSize.sm }, progressTrack: { height: 5, borderRadius: 3, backgroundColor: Colors.surfaceElevated, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 }, content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: 28, fontWeight: FontWeight.bold }, subtitle: { color: Colors.textSubtle, fontSize: FontSize.md, lineHeight: 22 },
  sectionLabel: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold, marginTop: Spacing.md }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface }, chipSelected: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}22` }, chipText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.medium }, chipTextSelected: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  counter: { color: Colors.primary, fontWeight: FontWeight.semibold }, topicGroup: { gap: Spacing.sm }, input: { minHeight: 48, color: Colors.textPrimary, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border }, toggleCopy: { flex: 1 }, toggleTitle: { color: Colors.textPrimary, fontWeight: FontWeight.semibold }, toggleSubtitle: { color: Colors.textSubtle, fontSize: FontSize.sm, marginTop: 3 },
  creatorCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border }, creatorCopy: { flex: 1 }, creatorName: { color: Colors.textPrimary, fontWeight: FontWeight.bold }, creatorHandle: { color: Colors.textSubtle, fontSize: FontSize.sm }, creatorReason: { color: Colors.primary, fontSize: 11, marginTop: 3 },
  followButton: { paddingHorizontal: Spacing.md, minHeight: 40, justifyContent: 'center', borderRadius: 20, backgroundColor: Colors.primary }, followButtonActive: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.primary }, followButtonText: { color: '#fff', fontWeight: FontWeight.bold }, followButtonTextActive: { color: Colors.primary },
  empty: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xl }, footer: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg, borderTopWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg },
  primaryButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg, backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg }, primaryButtonText: { color: '#fff', fontWeight: FontWeight.bold, fontSize: FontSize.md }, secondaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.lg }, secondaryButtonText: { color: Colors.textPrimary, fontWeight: FontWeight.semibold }, disabled: { opacity: 0.6 }, errorText: { color: Colors.error, textAlign: 'center' },
});
