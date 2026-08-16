import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { fetchSellerFoundation } from "@/services/marketplaceService";
import {
  fetchMyMarketplaceShippingProfiles,
  upsertMyMarketplaceShippingProfile,
  type MarketplaceShippingProfile,
  type MarketplaceShippingRegion,
} from "@/services/marketplaceShippingService";
import {
  MARKETPLACE_SHIPPING_COUNTRIES,
  shippingRegionsForCountry,
  shippingSetupError,
  validateShippingSetup,
} from "@/services/marketplaceShippingSetup";
import { SearchableSelectField } from "@/components/marketplace/SearchableSelectField";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";

type DraftRule = Omit<
  MarketplaceShippingRegion,
  | "shippingPrice"
  | "transitDaysMin"
  | "transitDaysMax"
  | "freeShippingThreshold"
> & {
  shippingPrice: string;
  transitDaysMin: string;
  transitDaysMax: string;
  freeShippingThreshold: string;
};
const blankRule = (): DraftRule => ({
  id: null,
  status: "active",
  countryCode: "US",
  regionCode: null,
  shippingPrice: "5",
  freeShippingThreshold: "",
  transitDaysMin: "3",
  transitDaysMax: "7",
});
const devLog = (operation: string, data: Record<string, unknown>) => {
  if (__DEV__)
    console.info("[MarketplaceShippingSetup]", { operation, ...data });
};

export default function SellerShippingProfileScreen() {
  const router = useRouter(),
    insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    storeId?: string;
    profileId?: string;
    productId?: string;
  }>();
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [loadError, setLoadError] = useState(false),
    [storeMissing, setStoreMissing] = useState(false);
  const [name, setName] = useState("Envío principal"),
    [shipsFrom, setShipsFrom] = useState("US");
  const [processingMin, setProcessingMin] = useState("1"),
    [processingMax, setProcessingMax] = useState("3");
  const [returns, setReturns] = useState("Devoluciones dentro de 14 días."),
    [productsUsing, setProductsUsing] = useState(0);
  const [rules, setRules] = useState<DraftRule[]>([blankRule()]),
    [profiles, setProfiles] = useState<MarketplaceShippingProfile[]>([]);
  const routeStoreId = typeof params.storeId === "string" ? params.storeId : "";
  const [storeId, setStoreId] = useState(routeStoreId);
  // Keep profile routing explicit: const profileId = typeof params.profileId.
  const routedProfileId =
    typeof params.profileId === "string" && params.profileId
      ? params.profileId
      : null;
  const [profileId, setProfileId] = useState<string | null>(routedProfileId);
  const errors = useMemo(
    () =>
      validateShippingSetup({
        name,
        shipsFromCountry: shipsFrom,
        processingDaysMin: processingMin,
        processingDaysMax: processingMax,
        returnPolicy: returns,
        rules,
        allowEmptyRules: Boolean(profileId),
      }),
    [name, shipsFrom, processingMin, processingMax, returns, rules, profileId],
  );
  const formValid = errors.length === 0;

  const applyProfile = useCallback((profile: MarketplaceShippingProfile) => {
    setProfileId(profile.id);
    setName(profile.name);
    setShipsFrom(profile.shipsFromCountry);
    setProcessingMin(String(profile.processingDaysMin));
    setProcessingMax(String(profile.processingDaysMax));
    setReturns(profile.returnPolicySummary);
    setProductsUsing(profile.productsUsing);
    setRules(
      profile.regions.map((rule) => ({
        ...rule,
        shippingPrice: String(rule.shippingPrice),
        freeShippingThreshold:
          rule.freeShippingThreshold == null
            ? ""
            : String(rule.freeShippingThreshold),
        transitDaysMin: String(rule.transitDaysMin),
        transitDaysMax: String(rule.transitDaysMax),
      })),
    );
  }, []);

  const startNewProfile = () => {
    setProfileId(null);
    setName("Envío principal");
    setShipsFrom("US");
    setProcessingMin("1");
    setProcessingMax("3");
    setReturns("Devoluciones dentro de 14 días.");
    setProductsUsing(0);
    setRules([blankRule()]);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setStoreMissing(false);
    try {
      let effectiveStoreId = routeStoreId;
      if (!effectiveStoreId) {
        const foundation = await fetchSellerFoundation();
        effectiveStoreId = foundation.store?.id ?? "";
      }
      if (!effectiveStoreId) {
        setStoreId("");
        setStoreMissing(true);
        return;
      }
      setStoreId(effectiveStoreId);
      devLog("load", {
        profileIdPresent: Boolean(routedProfileId),
        storeIdPresent: true,
      });
      const loadedProfiles =
        await fetchMyMarketplaceShippingProfiles(effectiveStoreId);
      setProfiles(loadedProfiles);
      const profile = loadedProfiles.find(
        (item) => item.id === routedProfileId,
      );
      if (profile) applyProfile(profile);
    } catch (error) {
      const safe = shippingSetupError(error);
      devLog("load_failed", safe);
      setLoadError(true);
      Alert.alert("No pudimos cargar el perfil", safe.message);
    } finally {
      setLoading(false);
    }
  }, [applyProfile, routeStoreId, routedProfileId]);
  useEffect(() => {
    void load();
  }, [load]);

  const updateRule = (index: number, patch: Partial<DraftRule>) =>
    setRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  const removeRule = (index: number) => {
    const remove = () =>
      setRules((current) => current.filter((_, i) => i !== index));
    if (rules.length === 1)
      Alert.alert(
        "¿Eliminar el último destino?",
        "Este perfil dejará de aceptar compras hasta que configures un nuevo destino.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Eliminar destino", style: "destructive", onPress: remove },
        ],
      );
    else remove();
  };
  const save = async () => {
    devLog("save_start", {
      profileIdPresent: Boolean(profileId),
      storeIdPresent: Boolean(storeId),
      ruleCount: rules.length,
      countryCode: shipsFrom,
      regionCodes: rules.map((x) => x.regionCode),
      formValid,
    });
    if (!formValid || !storeId) return;
    const keys = new Set<string>();
    for (const rule of rules) {
      const key = `${rule.countryCode}:${rule.regionCode ?? "*"}`;
      if (keys.has(key)) {
        Alert.alert(
          "Destino duplicado",
          "Cada país o región solo puede aparecer una vez.",
        );
        return;
      }
      keys.add(key);
    }
    setSaving(true);
    try {
      const savedId = await upsertMyMarketplaceShippingProfile({
        profileId,
        storeId,
        name: name.trim(),
        processingDaysMin: Number(processingMin),
        processingDaysMax: Number(processingMax),
        shipsFromCountry: shipsFrom,
        returnPolicySummary: returns.trim(),
        regions: rules.map((r) => ({
          ...r,
          shippingPrice: Number(r.shippingPrice),
          freeShippingThreshold: r.freeShippingThreshold.trim()
            ? Number(r.freeShippingThreshold)
            : null,
          transitDaysMin: Number(r.transitDaysMin),
          transitDaysMax: Number(r.transitDaysMax),
        })),
      });
      setProfileId(savedId);
      devLog("save_success", {
        profileIdPresent: true,
        storeIdPresent: true,
        ruleCount: rules.length,
      });
      void savedId;
      Alert.alert("Envío guardado", "La configuración quedó lista para usar.", [
        { text: "Continuar", onPress: () => router.back() },
      ]);
    } catch (error) {
      const safe = shippingSetupError(error);
      devLog("save_failed", {
        code: safe.token,
        postgresCode: safe.postgresCode,
        operation: "upsert",
      });
      Alert.alert("No pudimos guardar", safe.message);
    } finally {
      setSaving(false);
    }
  };
  if (loading)
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SellerScreenHeader
          title="Configurar envío"
          fallbackRoute="/seller"
          accessibilityLabel="Volver"
        />
        <View style={[styles.content, styles.center]}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  if (loadError)
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SellerScreenHeader
          title="Configurar envío"
          fallbackRoute="/seller"
          accessibilityLabel="Volver"
        />
        <View style={[styles.content, styles.emptyState]}>
          <Text style={styles.heading}>No pudimos cargar tus métodos</Text>
          <Text style={styles.text}>Revisa tu conexión e inténtalo nuevamente.</Text>
          <Pressable style={styles.primary} onPress={() => void load()}>
            <Text style={styles.primaryText}>Reintentar</Text>
          </Pressable>
        </View>
      </View>
    );
  if (storeMissing)
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <SellerScreenHeader
          title="Configurar envío"
          fallbackRoute="/seller"
          accessibilityLabel="Volver"
        />
        <View style={[styles.content, styles.emptyState]}>
          <Text style={styles.heading}>
            Configura tu tienda antes de crear métodos de envío
          </Text>
          <Text style={styles.text}>
            Necesitamos una tienda canónica para asociar tus métodos de envío.
          </Text>
          <Pressable
            style={styles.primary}
            onPress={() => router.push("/seller/store" as never)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>Configurar tienda</Text>
          </Pressable>
        </View>
      </View>
    );
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <SellerScreenHeader
        title="Configurar envío"
        fallbackRoute="/seller"
        accessibilityLabel="Volver"
      />
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={{
            padding: Spacing.md,
            gap: Spacing.md,
          }}
          keyboardShouldPersistTaps="handled"
        >
        {profiles.length ? (
          <View style={styles.profileList}>
            <View style={styles.profileListHeader}>
              <Text style={styles.heading}>Tus métodos de envío</Text>
              <Pressable onPress={startNewProfile} accessibilityRole="button">
                <Text style={styles.link}>+ Nuevo</Text>
              </Pressable>
            </View>
            {profiles.map((profile) => (
              <Pressable
                key={profile.id}
                onPress={() => applyProfile(profile)}
                accessibilityRole="button"
                accessibilityState={{ selected: profile.id === profileId }}
                style={[
                  styles.profileOption,
                  profile.id === profileId && styles.profileOptionSelected,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{profile.name}</Text>
                  <Text style={styles.helper}>
                    {profile.regions.length} destinos · {profile.productsUsing} productos
                  </Text>
                </View>
                <Text style={styles.link}>
                  {profile.id === profileId ? "Editando" : "Editar"}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.info}>
          <Text style={styles.infoTitle}>
            {rules.length ? "Destinos configurados" : "Configuración requerida"}
          </Text>
          <Text style={styles.text}>
            {productsUsing ? `${productsUsing} productos vinculados. ` : ""}Los
            productos necesitan al menos un destino para aceptar compras.
          </Text>
        </View>
        <Field label="Nombre del método" value={name} onChange={setName} />
        <SearchableSelectField
          label="País desde donde envías"
          value={shipsFrom}
          options={MARKETPLACE_SHIPPING_COUNTRIES.map((item) => ({
            value: item.code,
            label: item.label,
          }))}
          onChange={setShipsFrom}
          searchLabel="Buscar país"
        />
        <Text style={styles.heading}>Tiempo para preparar el pedido</Text>
        <Text style={styles.helper}>
          Días que necesitas antes de entregar el paquete al transportista.
        </Text>
        <View style={styles.row}>
          <Field
            label="Desde"
            value={processingMin}
            onChange={setProcessingMin}
            numeric
          />
          <Field
            label="Hasta"
            value={processingMax}
            onChange={setProcessingMax}
            numeric
          />
        </View>
        <Field
          label="Política de devoluciones"
          value={returns}
          onChange={setReturns}
        />
        <Text style={styles.heading}>¿A dónde haces envíos?</Text>
        {rules.map((rule, index) => (
          <DestinationCard
            key={rule.id ?? `new-${index}`}
            rule={rule}
            index={index}
            update={updateRule}
            remove={removeRule}
          />
        ))}
        <Pressable
          style={styles.secondary}
          onPress={() => setRules((x) => [...x, blankRule()])}
        >
          <Text style={styles.link}>+ Agregar otro destino</Text>
        </Pressable>
        {!formValid ? (
          <View style={styles.errors}>
            <Text style={styles.errorTitle}>Falta completar:</Text>
            {errors.map((error) => (
              <Text key={error} style={styles.errorText}>
                • {error}
              </Text>
            ))}
          </View>
        ) : null}
        <Pressable
          disabled={!formValid || !storeId || saving}
          style={[
            styles.primary,
            (!formValid || !storeId || saving) && styles.disabled,
          ]}
          onPress={() => void save()}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Guardar envío</Text>
          )}
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function DestinationCard({
  rule,
  index,
  update,
  remove,
}: {
  rule: DraftRule;
  index: number;
  update: (index: number, patch: Partial<DraftRule>) => void;
  remove: (index: number) => void;
}) {
  const regions = shippingRegionsForCountry(rule.countryCode);
  const countryOptions = MARKETPLACE_SHIPPING_COUNTRIES.map((item) => ({
    value: item.code,
    label: item.label,
  }));
  const regionOptions = [
    {
      value: "",
      label: rule.countryCode === "US" ? "Todo Estados Unidos" : "Todo Canadá",
    },
    ...regions.map(([value, label]) => ({ value, label })),
  ];
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Destino {index + 1}</Text>
      <SearchableSelectField
        label="Enviar a"
        value={rule.countryCode}
        options={countryOptions}
        onChange={(countryCode) =>
          update(index, { countryCode, regionCode: null })
        }
        searchLabel="Buscar país"
      />
      {regions.length ? (
        <SearchableSelectField
          label={rule.countryCode === "US" ? "Estado" : "Provincia"}
          value={rule.regionCode ?? ""}
          options={regionOptions}
          onChange={(regionCode) =>
            update(index, { regionCode: regionCode || null })
          }
          searchLabel={
            rule.countryCode === "US" ? "Buscar estado" : "Buscar provincia"
          }
        />
      ) : (
        <Text style={styles.helper}>El envío se aplicará a todo el país.</Text>
      )}
      <Field
        label="Costo de envío (BDAG)"
        value={rule.shippingPrice}
        onChange={(shippingPrice) => update(index, { shippingPrice })}
        numeric
      />
      <Field
        label="Envío gratis desde (BDAG, opcional)"
        value={rule.freeShippingThreshold}
        onChange={(freeShippingThreshold) =>
          update(index, { freeShippingThreshold })
        }
        numeric
      />
      <Text style={styles.label}>Tiempo de entrega</Text>
      <View style={styles.row}>
        <Field
          label="Desde"
          value={rule.transitDaysMin}
          onChange={(transitDaysMin) => update(index, { transitDaysMin })}
          numeric
        />
        <Field
          label="Hasta"
          value={rule.transitDaysMax}
          onChange={(transitDaysMax) => update(index, { transitDaysMax })}
          numeric
        />
      </View>
      <Pressable onPress={() => remove(index)}>
        <Text style={styles.remove}>Eliminar destino</Text>
      </Pressable>
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        style={styles.input}
        keyboardType={numeric ? "decimal-pad" : "default"}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  heading: { fontSize: 17, fontWeight: "700", color: Colors.textPrimary },
  helper: { color: Colors.textSecondary, fontSize: 13 },
  info: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.warningDim,
    gap: 6,
  },
  infoTitle: { color: Colors.warning, fontWeight: "700" },
  text: { color: Colors.textSecondary },
  profileList: { gap: Spacing.sm },
  profileListHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileOption: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  profileOptionSelected: { borderColor: Colors.primary },
  row: { flexDirection: "row", gap: Spacing.sm },
  field: { flex: 1, gap: 5 },
  label: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  card: {
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  cardTitle: { color: Colors.textPrimary, fontWeight: "800" },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + "22",
  },
  chipText: { color: Colors.textPrimary, fontSize: 13 },
  remove: { color: Colors.error, fontWeight: "700" },
  secondary: { padding: 14, alignItems: "center" },
  link: { color: Colors.primaryLight, fontWeight: "700" },
  errors: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.error,
    gap: 4,
  },
  errorTitle: { color: Colors.error, fontWeight: "800" },
  errorText: { color: Colors.textSecondary },
  primary: {
    minHeight: 52,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.45 },
});
