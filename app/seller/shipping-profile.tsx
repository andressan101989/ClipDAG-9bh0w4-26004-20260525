import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { fetchMyMarketplaceShippingProfiles, upsertMyMarketplaceShippingProfile, type MarketplaceShippingRegion } from "@/services/marketplaceShippingService";
import { MARKETPLACE_SHIPPING_COUNTRIES, shippingRegionsForCountry, shippingSetupError, validateShippingSetup } from "@/services/marketplaceShippingSetup";

type DraftRule = Omit<MarketplaceShippingRegion, "shippingPrice" | "transitDaysMin" | "transitDaysMax" | "freeShippingThreshold"> & {
  shippingPrice: string; transitDaysMin: string; transitDaysMax: string; freeShippingThreshold: number | null;
};
const blankRule = (): DraftRule => ({ id: null, status: "active", countryCode: "US", regionCode: null, shippingPrice: "5", freeShippingThreshold: null, transitDaysMin: "3", transitDaysMax: "7" });
const devLog = (operation: string, data: Record<string, unknown>) => { if (__DEV__) console.info("[MarketplaceShippingSetup]", { operation, ...data }); };

export default function SellerShippingProfileScreen() {
  const router = useRouter(), insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ storeId?: string; profileId?: string; productId?: string }>();
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [name, setName] = useState("Envío principal"), [shipsFrom, setShipsFrom] = useState("US");
  const [processingMin, setProcessingMin] = useState("1"), [processingMax, setProcessingMax] = useState("3");
  const [returns, setReturns] = useState("Devoluciones dentro de 14 días."), [productsUsing, setProductsUsing] = useState(0);
  const [rules, setRules] = useState<DraftRule[]>([blankRule()]);
  const storeId = typeof params.storeId === "string" ? params.storeId : "";
  const profileId = typeof params.profileId === "string" && params.profileId ? params.profileId : null;
  const errors = useMemo(() => validateShippingSetup({ name, shipsFromCountry: shipsFrom, processingDaysMin: processingMin, processingDaysMax: processingMax, returnPolicy: returns, rules, allowEmptyRules: Boolean(profileId) }), [name, shipsFrom, processingMin, processingMax, returns, rules, profileId]);
  const formValid = errors.length === 0;

  const load = useCallback(async () => {
    if (!storeId) { setLoading(false); return; }
    setLoading(true); devLog("load", { profileIdPresent: Boolean(profileId), storeIdPresent: true });
    try {
      const profiles = await fetchMyMarketplaceShippingProfiles(storeId), profile = profiles.find((item) => item.id === profileId);
      if (profile) {
        setName(profile.name); setShipsFrom(profile.shipsFromCountry); setProcessingMin(String(profile.processingDaysMin));
        setProcessingMax(String(profile.processingDaysMax)); setReturns(profile.returnPolicySummary); setProductsUsing(profile.productsUsing);
        setRules(profile.regions.map((r) => ({ ...r, shippingPrice: String(r.shippingPrice), transitDaysMin: String(r.transitDaysMin), transitDaysMax: String(r.transitDaysMax) })));
      }
    } catch (error) { const safe = shippingSetupError(error); devLog("load_failed", safe); Alert.alert("No pudimos cargar el perfil", safe.message); }
    finally { setLoading(false); }
  }, [profileId, storeId]);
  useEffect(() => { void load(); }, [load]);

  const updateRule = (index: number, patch: Partial<DraftRule>) => setRules((current) => current.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  const removeRule = (index: number) => {
    const remove = () => setRules((current) => current.filter((_, i) => i !== index));
    if (rules.length === 1) Alert.alert("¿Eliminar el último destino?", "Este perfil dejará de aceptar compras hasta que configures un nuevo destino.", [{ text: "Cancelar", style: "cancel" }, { text: "Eliminar destino", style: "destructive", onPress: remove }]);
    else remove();
  };
  const save = async () => {
    devLog("save_start", { profileIdPresent: Boolean(profileId), storeIdPresent: Boolean(storeId), ruleCount: rules.length, countryCode: shipsFrom, regionCodes: rules.map((x) => x.regionCode), formValid });
    if (!formValid || !storeId) return;
    const keys = new Set<string>();
    for (const rule of rules) { const key = `${rule.countryCode}:${rule.regionCode ?? "*"}`; if (keys.has(key)) { Alert.alert("Destino duplicado", "Cada país o región solo puede aparecer una vez."); return; } keys.add(key); }
    setSaving(true);
    try {
      const savedId = await upsertMyMarketplaceShippingProfile({ profileId, storeId, name: name.trim(), processingDaysMin: Number(processingMin), processingDaysMax: Number(processingMax), shipsFromCountry: shipsFrom, returnPolicySummary: returns.trim(), regions: rules.map((r) => ({ ...r, shippingPrice: Number(r.shippingPrice), transitDaysMin: Number(r.transitDaysMin), transitDaysMax: Number(r.transitDaysMax) })) });
      devLog("save_success", { profileIdPresent: true, storeIdPresent: true, ruleCount: rules.length });
      void savedId;
      router.back();
    } catch (error) { const safe = shippingSetupError(error); devLog("save_failed", { code: safe.token, postgresCode: safe.postgresCode, operation: "upsert" }); Alert.alert("No pudimos guardar", safe.message); }
    finally { setSaving(false); }
  };
  if (loading) return <View style={[styles.root, styles.center]}><ActivityIndicator color={Colors.primary} /></View>;
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}><ScrollView contentContainerStyle={{ paddingTop: insets.top + Spacing.md, padding: Spacing.md, gap: Spacing.md }} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>Configurar envío</Text>
    <View style={styles.info}><Text style={styles.infoTitle}>{rules.length ? "Destinos configurados" : "Configuración requerida"}</Text><Text style={styles.text}>{productsUsing ? `${productsUsing} productos vinculados. ` : ""}Los productos necesitan al menos un destino para aceptar compras.</Text></View>
    <Field label="Nombre de la configuración" value={name} onChange={setName} />
    <Text style={styles.heading}>País desde donde envías</Text><Choices values={MARKETPLACE_SHIPPING_COUNTRIES} selected={shipsFrom} onSelect={setShipsFrom} />
    <Text style={styles.heading}>Tiempo para preparar el pedido</Text><Text style={styles.helper}>Días que necesitas antes de entregar el paquete al transportista.</Text><View style={styles.row}><Field label="Desde" value={processingMin} onChange={setProcessingMin} numeric /><Field label="Hasta" value={processingMax} onChange={setProcessingMax} numeric /></View>
    <Field label="Política de devoluciones" value={returns} onChange={setReturns} />
    <Text style={styles.heading}>¿A dónde haces envíos?</Text>
    {rules.map((rule, index) => <DestinationCard key={rule.id ?? `new-${index}`} rule={rule} index={index} update={updateRule} remove={removeRule} />)}
    <Pressable style={styles.secondary} onPress={() => setRules((x) => [...x, blankRule()])}><Text style={styles.link}>+ Agregar otro destino</Text></Pressable>
    {!formValid ? <View style={styles.errors}><Text style={styles.errorTitle}>Falta completar:</Text>{errors.map((error) => <Text key={error} style={styles.errorText}>• {error}</Text>)}</View> : null}
    <Pressable disabled={!formValid || saving} style={[styles.primary, (!formValid || saving) && styles.disabled]} onPress={() => void save()}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Guardar configuración</Text>}</Pressable>
  </ScrollView></KeyboardAvoidingView>;
}

function DestinationCard({ rule, index, update, remove }: { rule: DraftRule; index: number; update: (index: number, patch: Partial<DraftRule>) => void; remove: (index: number) => void }) {
  const regions = shippingRegionsForCountry(rule.countryCode);
  return <View style={styles.card}><Text style={styles.cardTitle}>Enviar a</Text><Choices values={MARKETPLACE_SHIPPING_COUNTRIES} selected={rule.countryCode} onSelect={(countryCode) => update(index, { countryCode, regionCode: null })} />
    {regions.length ? <><Text style={styles.label}>{rule.countryCode === "US" ? "Estado" : "Provincia"}</Text><Pressable style={[styles.chip, rule.regionCode === null && styles.chipSelected]} onPress={() => update(index, { regionCode: null })}><Text style={styles.chipText}>{rule.countryCode === "US" ? "Todo Estados Unidos" : "Todo Canadá"}</Text></Pressable><View style={styles.choiceWrap}>{regions.map(([code, label]) => <Pressable key={code} style={[styles.chip, rule.regionCode === code && styles.chipSelected]} onPress={() => update(index, { regionCode: code })}><Text style={styles.chipText}>{label}</Text></Pressable>)}</View></> : <Text style={styles.helper}>El envío se aplicará a todo el país.</Text>}
    <Field label="Costo de envío (BDAG)" value={rule.shippingPrice} onChange={(shippingPrice) => update(index, { shippingPrice })} numeric />
    <Text style={styles.label}>Tiempo de entrega</Text><View style={styles.row}><Field label="Desde" value={rule.transitDaysMin} onChange={(transitDaysMin) => update(index, { transitDaysMin })} numeric /><Field label="Hasta" value={rule.transitDaysMax} onChange={(transitDaysMax) => update(index, { transitDaysMax })} numeric /></View>
    <Pressable onPress={() => remove(index)}><Text style={styles.remove}>Eliminar destino</Text></Pressable>
  </View>;
}
function Choices({ values, selected, onSelect }: { values: readonly { code: string; label: string }[]; selected: string; onSelect: (code: string) => void }) { return <View style={styles.choiceWrap}>{values.map((item) => <Pressable key={item.code} style={[styles.chip, selected === item.code && styles.chipSelected]} onPress={() => onSelect(item.code)}><Text style={styles.chipText}>{item.label}</Text></Pressable>)}</View>; }
function Field({ label, value, onChange, numeric = false }: { label: string; value: string; onChange: (value: string) => void; numeric?: boolean }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChange} style={styles.input} keyboardType={numeric ? "decimal-pad" : "default"} /></View>; }
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: Colors.bg }, center: { alignItems: "center", justifyContent: "center" }, title: { fontSize: 24, fontWeight: "800", color: Colors.textPrimary }, heading: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary }, helper: { color: Colors.textSecondary, fontSize: 13 }, info: { padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.warningDim, gap: 6 }, infoTitle: { color: Colors.warning, fontWeight: "700" }, text: { color: Colors.textSecondary }, row: { flexDirection: "row", gap: Spacing.sm }, field: { flex: 1, gap: 5 }, label: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" }, input: { minHeight: 46, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, color: Colors.textPrimary, paddingHorizontal: Spacing.sm, backgroundColor: Colors.surface }, card: { padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, backgroundColor: Colors.surface }, cardTitle: { color: Colors.textPrimary, fontWeight: "800" }, choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 9 }, chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + "22" }, chipText: { color: Colors.textPrimary, fontSize: 13 }, remove: { color: Colors.error, fontWeight: "700" }, secondary: { padding: 14, alignItems: "center" }, link: { color: Colors.primaryLight, fontWeight: "700" }, errors: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.error, gap: 4 }, errorTitle: { color: Colors.error, fontWeight: "800" }, errorText: { color: Colors.textSecondary }, primary: { minHeight: 52, backgroundColor: Colors.primary, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" }, primaryText: { color: "#fff", fontWeight: "700" }, disabled: { opacity: 0.45 } });
