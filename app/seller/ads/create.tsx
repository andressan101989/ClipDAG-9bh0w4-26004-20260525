import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";
import { useShop } from "@/hooks/useShop";
import { useWallet } from "@/hooks/useWallet";
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Spacing,
} from "@/constants/theme";
import {
  activateAdCampaign,
  createAdDraft,
  fetchAdConfig,
} from "@/services/marketplaceAdsService";
export default function CreateAd() {
  const { productId } = useLocalSearchParams<{ productId?: string }>(),
    router = useRouter(),
    insets = useSafeAreaInsets(),
    { myProducts } = useShop(),
    wallet = useWallet(),
    [selected, setSelected] = useState(productId ?? ""),
    [budget, setBudget] = useState("10"),
    [days, setDays] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [config, setConfig] = useState<{minimum_budget_bdag:number;maximum_budget_bdag:number;minimum_duration_seconds:number;maximum_duration_seconds:number}|null>(null),
    createKey = useRef(randomUUID()),
    fundKey = useRef(randomUUID());
  useEffect(()=>{void fetchAdConfig().then(value=>{setConfig(value);setBudget(String(value.minimum_budget_bdag))}).catch(()=>{})},[]);
  const product = useMemo(
    () => myProducts.find((x) => x.id === selected),
    [myProducts, selected],
  );
  const submit = async () => {
    if (!product || busy) return;
    setBusy(true);
    setError("");
    try {
      const starts = new Date(),
        ends = new Date(starts.getTime() + days * 86400000),
        draft = await createAdDraft({
          productId: product.id,
          budget: Number(budget),
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
          idempotencyKey: createKey.current,
        });
      await activateAdCampaign(draft.id, fundKey.current);
      router.replace(("/seller/ads/" + draft.id) as never);
    } catch {
      setError(
        "No pudimos activar la campaña. Revisa saldo, presupuesto y elegibilidad.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Crear campaña" fallbackRoute="/seller/ads" />
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.step}>1 · Producto</Text>
        {myProducts
          .filter((x) => x.status === "active" && x.available_quantity > 0)
          .map((x) => (
            <Pressable
              key={x.id}
              style={[s.option, selected === x.id && s.on]}
              onPress={() => setSelected(x.id)}
            >
              <Text style={s.name}>{x.title}</Text>
              <Text style={s.meta}>
                {Number(x.price).toFixed(2)} BDAG · {x.available_quantity}{" "}
                disponibles
              </Text>
            </Pressable>
          ))}
        <Text style={s.step}>2 · Presupuesto</Text>
        <TextInput
          value={budget}
          onChangeText={setBudget}
          keyboardType="decimal-pad"
          style={s.input}
          placeholder="BDAG"
          placeholderTextColor={Colors.textSubtle}
        />
        <Text style={s.meta}>
          Saldo BDAG disponible: {Number(wallet?.balance ?? 0).toFixed(2)}
        </Text>
        {config?<Text style={s.meta}>Permitido: {config.minimum_budget_bdag}–{config.maximum_budget_bdag} BDAG</Text>:null}
        <Text style={s.step}>3 · Duración</Text>
        <View style={s.row}>
          {[1, 3, 7, 14].filter(x=>!config||(x*86400>=config.minimum_duration_seconds&&x*86400<=config.maximum_duration_seconds)).map((x) => (
            <Pressable
              key={x}
              style={[s.day, days === x && s.on]}
              onPress={() => setDays(x)}
            >
              <Text style={s.name}>
                {x} día{x > 1 ? "s" : ""}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.step}>4 · Vista previa</Text>
        <View style={s.preview}>
          <Text style={s.ad}>Patrocinado</Text>
          <Text style={s.name}>
            {product?.title ?? "Selecciona un producto"}
          </Text>
          <Text style={s.meta}>
            {budget || "0"} BDAG · {days} días
          </Text>
        </View>
        <Text style={s.copy}>
          Tu producto podrá aparecer como patrocinado en Marketplace mientras la
          campaña esté activa, sea elegible y tenga presupuesto disponible.
        </Text>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable
          disabled={!product || busy}
          style={[s.submit, (!product || busy) && s.disabled]}
          onPress={() => void submit()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.submitText}>5 · Activar campaña</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  body: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 50 },
  step: {
    color: Colors.primaryLight,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
  },
  option: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  on: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  name: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  meta: { color: Colors.textSecondary, marginTop: 4 },
  input: {
    height: 50,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    color: Colors.textPrimary,
    padding: 12,
  },
  row: { flexDirection: "row", gap: 8 },
  day: {
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
  },
  preview: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
  },
  ad: { color: Colors.warning, fontWeight: FontWeight.bold, fontSize: 10 },
  copy: { color: Colors.textSecondary, lineHeight: 20 },
  error: { color: Colors.error },
  submit: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
  },
  disabled: { opacity: 0.5 },
  submitText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
});
