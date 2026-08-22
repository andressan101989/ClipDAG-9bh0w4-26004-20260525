import React, { useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { Image } from "@/components/ui/SafeImage";
import {
  deleteMediaAsset,
  uploadMediaFromUri,
} from "@/services/mediaService";
import {
  materializeMarketplacePhotoAsset,
  requestMarketplacePhotosAccess,
} from "@/services/marketplaceMediaPickerService";
import {
  MarketplaceSettlementError,
  reportMarketplaceOrderProblem,
} from "@/services/marketplaceSettlementService";
import type {
  MarketplaceDisputeOutcome,
  MarketplaceDisputeStatus,
} from "@/services/marketplaceFulfillmentService";

type Reason =
  | "not_received"
  | "damaged"
  | "incorrect_item"
  | "missing_items"
  | "other";
type PurchasedItem = {
  id: string;
  productTitle: string;
  variantTitle: string | null;
  options: { name?: string; value: string }[];
  imageUrl: string | null;
  quantity: number;
};
type LocalEvidence = {
  key: string;
  uri: string;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  uploadedAssetId?: string;
};

const MAX_EVIDENCE_IMAGES = 6;
const reasons: { code: Reason; label: string }[] = [
  { code: "not_received", label: "No recibí el pedido" },
  { code: "damaged", label: "Producto dañado" },
  { code: "incorrect_item", label: "Producto incorrecto" },
  { code: "missing_items", label: "Faltan artículos" },
  { code: "other", label: "Otro problema" },
];
const evidenceRequired = new Set<Reason>([
  "damaged",
  "incorrect_item",
  "missing_items",
]);
const statusLabels: Record<MarketplaceDisputeStatus, string> = {
  open: "Abierta",
  under_review: "En revisión",
  resolved: "Resuelta",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};
const outcomeLabels: Record<MarketplaceDisputeOutcome, string> = {
  refund_buyer: "Reembolso completado",
  release_seller: "Fondos liberados al vendedor",
  reject_claim: "Reclamo rechazado",
};

export function MarketplaceDisputePanel({
  orderId,
  items,
  current,
  onSubmitted,
}: {
  orderId: string;
  items: PurchasedItem[];
  current: {
    status: MarketplaceDisputeStatus;
    reasonCode: string;
    outcome?: MarketplaceDisputeOutcome | null;
  } | null;
  onSubmitted: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState<Reason>("not_received");
  const [note, setNote] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [photos, setPhotos] = useState<LocalEvidence[]>([]);
  const [busy, setBusy] = useState(false);
  const key = useRef(randomUUID());

  const toggleItem = (id: string) =>
    setSelectedItemIds((currentIds) =>
      currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id],
    );

  const addPickedAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const available = MAX_EVIDENCE_IMAGES - photos.length;
    const next = await Promise.all(
      assets.slice(0, available).map(async (asset) => ({
        key: randomUUID(),
        uri: await materializeMarketplacePhotoAsset(asset.assetId, asset.uri),
        mimeType: asset.mimeType ?? "application/octet-stream",
        fileName: asset.fileName ?? undefined,
        sizeBytes: asset.fileSize,
      })),
    );
    setPhotos((currentPhotos) => [
      ...currentPhotos,
      ...next.slice(0, MAX_EVIDENCE_IMAGES - currentPhotos.length),
    ]);
  };

  const pickFromGallery = async () => {
    const { access } = await requestMarketplacePhotosAccess();
    if (access === "none") {
      Alert.alert("Permiso necesario", "Permite acceso a tus fotos para adjuntar evidencia.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: MAX_EVIDENCE_IMAGES - photos.length,
      quality: 0.9,
    });
    if (!result.canceled) await addPickedAssets(result.assets);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso necesario", "Permite acceso a la cámara para tomar la foto.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (!result.canceled) await addPickedAssets(result.assets);
  };

  const addPhoto = () => {
    if (photos.length >= MAX_EVIDENCE_IMAGES) return;
    Alert.alert("Agregar foto", "Elige cómo adjuntar la evidencia.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Cámara", onPress: () => void takePhoto() },
      { text: "Galería", onPress: () => void pickFromGallery() },
    ]);
  };

  const uploadEvidence = async () => {
    const assetIds: string[] = [];
    const uploadedNow: string[] = [];
    try {
      for (const photo of photos) {
        if (photo.uploadedAssetId) {
          assetIds.push(photo.uploadedAssetId);
          continue;
        }
        const uploaded = await uploadMediaFromUri({
          uri: photo.uri,
          purpose: "dispute_evidence",
          mimeType: photo.mimeType,
          fileName: photo.fileName,
          sizeBytes: photo.sizeBytes,
          visibility: "private",
        });
        assetIds.push(uploaded.assetId);
        uploadedNow.push(uploaded.assetId);
        setPhotos((currentPhotos) =>
          currentPhotos.map((currentPhoto) =>
            currentPhoto.key === photo.key
              ? { ...currentPhoto, uploadedAssetId: uploaded.assetId }
              : currentPhoto,
          ),
        );
      }
      return assetIds;
    } catch (error) {
      await Promise.allSettled(uploadedNow.map((assetId) => deleteMediaAsset(assetId)));
      setPhotos((currentPhotos) =>
        currentPhotos.map((photo) =>
          photo.uploadedAssetId && uploadedNow.includes(photo.uploadedAssetId)
            ? { ...photo, uploadedAssetId: undefined }
            : photo,
        ),
      );
      throw error;
    }
  };

  const submit = () => {
    if (selectedItemIds.length === 0) {
      Alert.alert("Selecciona un producto", "Indica qué producto del pedido está afectado.");
      return;
    }
    if (evidenceRequired.has(reason) && photos.length === 0) {
      Alert.alert("Agrega una foto", "Este motivo requiere al menos una foto como evidencia.");
      return;
    }
    if (reason === "other" && note.trim().length < 3) {
      Alert.alert("Describe el problema", "Agrega una breve explicación para continuar.");
      return;
    }
    Alert.alert(
      "Reportar problema",
      "El pago permanecerá retenido mientras soporte revisa el caso.",
      [
        { text: "Volver", style: "cancel" },
        {
          text: "Enviar reporte",
          onPress: async () => {
            if (busy) return;
            setBusy(true);
            let evidenceAssetIds: string[] = [];
            try {
              evidenceAssetIds = await uploadEvidence();
              await reportMarketplaceOrderProblem(
                orderId,
                reason,
                note,
                key.current,
                selectedItemIds,
                evidenceAssetIds,
              );
              await onSubmitted();
              setExpanded(false);
              setPhotos([]);
              key.current = randomUUID();
            } catch (error) {
              const code =
                error instanceof MarketplaceSettlementError
                  ? error.code
                  : "marketplace_settlement_unknown";
              if (
                error instanceof MarketplaceSettlementError &&
                code !== "marketplace_settlement_unknown" &&
                evidenceAssetIds.length > 0
              ) {
                await Promise.allSettled(
                  evidenceAssetIds.map((assetId) => deleteMediaAsset(assetId)),
                );
                setPhotos((currentPhotos) =>
                  currentPhotos.map((photo) => ({
                    ...photo,
                    uploadedAssetId: undefined,
                  })),
                );
              }
              const message =
                code === "marketplace_dispute_settlement_completed"
                  ? "Este pedido ya fue liquidado. Contacta a soporte para revisar el caso."
                  : code === "marketplace_dispute_order_state_conflict"
                    ? "Este pedido todavía no admite reportes."
                    : "No pudimos enviar el reporte. No se realizaron movimientos de fondos.";
              Alert.alert("No se pudo reportar", message);
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (current)
    return (
      <View style={styles.card}>
        <Text style={styles.title}>
          Problema reportado · {current.outcome ? outcomeLabels[current.outcome] : statusLabels[current.status]}
        </Text>
        <Text style={styles.help}>
          {current.status === "open" || current.status === "under_review"
            ? "Los fondos permanecen pausados mientras soporte revisa el caso."
            : current.outcome === "release_seller"
              ? "Soporte resolvió el caso y liberó los fondos al vendedor."
              : "Soporte completó la revisión del caso."}
        </Text>
      </View>
    );
  if (!expanded)
    return (
      <Pressable style={styles.outline} onPress={() => setExpanded(true)} accessibilityRole="button">
        <Text style={styles.buttonText}>Reportar problema</Text>
      </Pressable>
    );

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Reportar problema</Text>
      <Text style={styles.section}>PRODUCTO AFECTADO</Text>
      {items.map((item) => {
        const checked = selectedItemIds.includes(item.id);
        const detail = [
          item.variantTitle,
          item.options.map((option) => option.value).filter(Boolean).join(" · "),
          `Cantidad ${item.quantity}`,
        ].filter(Boolean).join(" · ");
        return (
          <Pressable
            key={item.id}
            style={[styles.itemRow, checked && styles.selected]}
            onPress={() => toggleItem(item.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
          >
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.itemImage} contentFit="cover" /> : <View style={styles.itemImage} />}
            <View style={styles.flex}>
              <Text style={styles.text}>{item.productTitle}</Text>
              <Text style={styles.help}>{detail}</Text>
            </View>
            <Text style={styles.check}>{checked ? "✓" : "○"}</Text>
          </Pressable>
        );
      })}

      <Text style={styles.section}>MOTIVO</Text>
      {reasons.map((item) => (
        <Pressable
          key={item.code}
          style={[styles.reason, reason === item.code && styles.selected]}
          onPress={() => setReason(item.code)}
          accessibilityRole="radio"
          accessibilityState={{ checked: reason === item.code }}
        >
          <Text style={styles.text}>{item.label}</Text>
        </Pressable>
      ))}

      <Text style={styles.section}>EXPLICACIÓN</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={1000}
        placeholder="Describe lo ocurrido"
        placeholderTextColor={Colors.textSubtle}
        accessibilityLabel="Descripción del problema"
      />

      <View style={styles.evidenceHeading}>
        <Text style={styles.section}>EVIDENCIA</Text>
        <Text style={styles.help}>{photos.length} / {MAX_EVIDENCE_IMAGES} fotos</Text>
      </View>
      {evidenceRequired.has(reason) ? <Text style={styles.help}>Agrega al menos una foto.</Text> : null}
      {photos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
          {photos.map((photo) => (
            <View key={photo.key}>
              <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />
              <Pressable
                style={styles.removePhoto}
                disabled={busy}
                onPress={() => setPhotos((currentPhotos) => currentPhotos.filter((item) => item.key !== photo.key))}
                accessibilityLabel="Quitar foto"
              >
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <Pressable style={styles.outline} disabled={busy || photos.length >= MAX_EVIDENCE_IMAGES} onPress={addPhoto} accessibilityRole="button">
        <Text style={styles.buttonText}>+ Agregar foto</Text>
      </Pressable>
      <Pressable style={styles.button} disabled={busy} onPress={submit} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
        <Text style={styles.buttonText}>{busy ? "Enviando…" : "Revisar y enviar"}</Text>
      </Pressable>
      <Pressable style={styles.outline} disabled={busy} onPress={() => setExpanded(false)}>
        <Text style={styles.buttonText}>Cancelar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: Spacing.md, gap: 10 },
  title: { color: Colors.textPrimary, fontWeight: "800" },
  section: { color: Colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 4 },
  text: { color: Colors.textPrimary },
  help: { color: Colors.textSecondary },
  flex: { flex: 1 },
  itemRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: 8 },
  itemImage: { width: 48, height: 48, borderRadius: Radius.sm, backgroundColor: Colors.surface },
  check: { color: Colors.primaryLight, fontSize: 20, fontWeight: "800" },
  reason: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 12 },
  selected: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  input: { minHeight: 96, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, color: Colors.textPrimary, padding: 12, textAlignVertical: "top" },
  evidenceHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photos: { gap: 10, paddingVertical: 2 },
  photo: { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surface },
  removePhoto: { position: "absolute", right: -5, top: -5, width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.error, alignItems: "center", justifyContent: "center" },
  removeText: { color: Colors.textPrimary, fontSize: 18, lineHeight: 20, fontWeight: "800" },
  button: { minHeight: 48, backgroundColor: Colors.primary, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
  outline: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
  buttonText: { color: Colors.textPrimary, fontWeight: "800" },
});
