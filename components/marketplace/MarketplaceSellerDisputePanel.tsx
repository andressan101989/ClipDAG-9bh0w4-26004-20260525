import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
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
  getMediaUrl,
  uploadMediaFromUri,
} from "@/services/mediaService";
import {
  materializeMarketplacePhotoAsset,
  requestMarketplacePhotosAccess,
} from "@/services/marketplaceMediaPickerService";
import {
  MarketplaceFulfillmentError,
  respondToMarketplaceDispute,
  type MarketplaceOrderDetail,
} from "@/services/marketplaceFulfillmentService";
import { marketplaceDisputeReasonLabel } from "@/services/marketplaceOrderPresentation";

type LocalEvidence = {
  key: string;
  uri: string;
  mimeType: string;
  fileName?: string;
  sizeBytes?: number;
  uploadedAssetId?: string;
};
type EvidenceState = Record<string, { url?: string; failed?: boolean }>;

const MAX_EVIDENCE_IMAGES = 6;
const statusLabels = {
  open: "Abierta",
  under_review: "En revisión",
  resolved: "Resuelta",
  rejected: "Rechazada",
  cancelled: "Cancelada",
} as const;

function EvidenceGallery({ assetIds }: { assetIds: string[] }) {
  const [evidence, setEvidence] = useState<EvidenceState>({});
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setEvidence({});
    assetIds.forEach((assetId) => {
      void getMediaUrl(assetId)
        .then((url) => {
          if (active) setEvidence((current) => ({ ...current, [assetId]: { url } }));
        })
        .catch(() => {
          if (active) setEvidence((current) => ({ ...current, [assetId]: { failed: true } }));
        });
    });
    return () => {
      active = false;
    };
  }, [assetIds]);
  if (assetIds.length === 0) return <Text style={styles.help}>No se adjuntaron fotos.</Text>;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
        {assetIds.map((assetId) => {
          const item = evidence[assetId];
          return item?.url ? (
            <Pressable key={assetId} onPress={() => setPreview(item.url!)} accessibilityRole="imagebutton" accessibilityLabel="Abrir evidencia fotográfica">
              <Image source={{ uri: item.url }} style={styles.evidenceImage} contentFit="cover" />
            </Pressable>
          ) : (
            <View key={assetId} style={[styles.evidenceImage, styles.evidencePlaceholder]}>
              <Text style={styles.help}>{item?.failed ? "No disponible" : "Cargando…"}</Text>
            </View>
          );
        })}
      </ScrollView>
      <Modal visible={Boolean(preview)} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.modal}>
          {preview ? <Image source={{ uri: preview }} style={styles.preview} contentFit="contain" /> : null}
          <Pressable style={styles.close} onPress={() => setPreview(null)} accessibilityRole="button" accessibilityLabel="Cerrar evidencia">
            <Text style={styles.buttonText}>Cerrar</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

export function MarketplaceSellerDisputePanel({
  order,
  onSubmitted,
}: {
  order: MarketplaceOrderDetail;
  onSubmitted: (updated: MarketplaceOrderDetail) => void;
}) {
  const dispute = order.dispute;
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<LocalEvidence[]>([]);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(randomUUID());
  if (!dispute) return null;
  const affectedItems = order.items.filter((item) => dispute.affectedItemIds.includes(item.id));
  const responseAllowed = dispute.status === "open" || dispute.status === "under_review";

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
    setPhotos((current) => [...current, ...next.slice(0, MAX_EVIDENCE_IMAGES - current.length)]);
  };
  const gallery = async () => {
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
  const camera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permiso necesario", "Permite acceso a la cámara para tomar la foto.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!result.canceled) await addPickedAssets(result.assets);
  };
  const addPhoto = () => Alert.alert("Agregar foto", "Elige cómo adjuntar la evidencia.", [
    { text: "Cancelar", style: "cancel" },
    { text: "Cámara", onPress: () => void camera() },
    { text: "Galería", onPress: () => void gallery() },
  ]);

  const send = () => {
    const noteLength = note.trim().length;
    if ((noteLength > 0 && noteLength < 3) || (noteLength === 0 && photos.length === 0)) {
      Alert.alert("Agrega tu respuesta", "Escribe una explicación o adjunta al menos una foto.");
      return;
    }
    Alert.alert("Enviar respuesta", "Tu respuesta y las evidencias quedarán asociadas al caso para su revisión.", [
      { text: "Volver", style: "cancel" },
      { text: "Enviar", onPress: () => void submit() },
    ]);
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const uploadedNow: string[] = [];
    try {
      const assetIds: string[] = [];
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
        uploadedNow.push(uploaded.assetId);
        assetIds.push(uploaded.assetId);
        setPhotos((current) => current.map((item) => item.key === photo.key ? { ...item, uploadedAssetId: uploaded.assetId } : item));
      }
      const updated = await respondToMarketplaceDispute(
        order.order.id,
        dispute.id,
        note,
        assetIds,
        idempotencyKey.current,
      );
      onSubmitted(updated);
      setPhotos([]);
    } catch (error) {
      const code = error instanceof MarketplaceFulfillmentError ? error.code : "marketplace_fulfillment_unknown";
      const outcomeUnknown = code === "marketplace_fulfillment_transport" || code === "marketplace_fulfillment_outcome_unknown";
      if (!outcomeUnknown && uploadedNow.length > 0) {
        await Promise.allSettled(uploadedNow.map((assetId) => deleteMediaAsset(assetId)));
        setPhotos((current) => current.map((item) => item.uploadedAssetId && uploadedNow.includes(item.uploadedAssetId) ? { ...item, uploadedAssetId: undefined } : item));
      }
      Alert.alert(
        outcomeUnknown ? "Respuesta por confirmar" : "No pudimos enviar la respuesta",
        code === "marketplace_dispute_settlement_completed"
          ? "Este pedido ya fue liquidado y no admite una respuesta protegida."
          : outcomeUnknown
            ? "No pudimos confirmar el resultado. Vuelve a abrir el pedido antes de reintentar; no eliminamos la evidencia que podría estar vinculada."
            : "Tu respuesta sigue en pantalla. Revisa los datos e inténtalo nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>RECLAMACIÓN DEL COMPRADOR</Text>
      <Text style={styles.title}>{statusLabels[dispute.status]} · {marketplaceDisputeReasonLabel(dispute.reasonCode)}</Text>
      <Text style={styles.section}>PRODUCTO(S) RECLAMADO(S)</Text>
      {affectedItems.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.itemImage} contentFit="cover" /> : <View style={styles.itemImage} />}
          <View style={styles.flex}>
            <Text style={styles.text}>{item.productTitle}</Text>
            <Text style={styles.help}>{[item.variantTitle, item.options.map((option) => option.value).join(" · "), `Cantidad ${item.quantity}`].filter(Boolean).join(" · ")}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.section}>EXPLICACIÓN DEL COMPRADOR</Text>
      <Text style={styles.text}>{dispute.buyerNote ?? "El comprador no agregó una explicación."}</Text>
      <Text style={styles.section}>EVIDENCIA DEL COMPRADOR</Text>
      <EvidenceGallery assetIds={dispute.buyerEvidenceAssetIds} />

      {dispute.sellerResponse ? (
        <View style={styles.response}>
          <Text style={styles.eyebrow}>RESPUESTA ENVIADA</Text>
          {dispute.sellerResponse.note ? <Text style={styles.text}>{dispute.sellerResponse.note}</Text> : null}
          <Text style={styles.help}>{new Date(dispute.sellerResponse.createdAt).toLocaleString()}</Text>
          <EvidenceGallery assetIds={dispute.sellerResponse.evidenceAssetIds} />
        </View>
      ) : responseAllowed ? (
        <View style={styles.response}>
          <Text style={styles.eyebrow}>TU RESPUESTA</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={1000}
            placeholder="Explica tu versión de lo ocurrido"
            placeholderTextColor={Colors.textSubtle}
            accessibilityLabel="Respuesta del vendedor"
          />
          <View style={styles.heading}><Text style={styles.section}>EVIDENCIA</Text><Text style={styles.help}>{photos.length} / {MAX_EVIDENCE_IMAGES} fotos</Text></View>
          {photos.length ? <ScrollView horizontal contentContainerStyle={styles.photos} showsHorizontalScrollIndicator={false}>{photos.map((photo) => <View key={photo.key}><Image source={{ uri: photo.uri }} style={styles.evidenceImage} contentFit="cover" /><Pressable style={styles.remove} disabled={busy} onPress={() => setPhotos((current) => current.filter((item) => item.key !== photo.key))} accessibilityLabel="Quitar foto"><Text style={styles.removeText}>×</Text></Pressable></View>)}</ScrollView> : null}
          <Pressable style={styles.outline} disabled={busy || photos.length >= MAX_EVIDENCE_IMAGES} onPress={addPhoto} accessibilityRole="button"><Text style={styles.buttonText}>+ Agregar foto</Text></Pressable>
          <Pressable style={styles.button} disabled={busy} onPress={send} accessibilityRole="button" accessibilityState={{ disabled: busy }}><Text style={styles.buttonText}>{busy ? "Enviando…" : "Enviar respuesta"}</Text></Pressable>
        </View>
      ) : (
        <Text style={styles.help}>Este caso ya no admite una respuesta del vendedor.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: Spacing.md, gap: 10, borderWidth: 1, borderColor: Colors.borderSubtle },
  eyebrow: { color: Colors.textSubtle, fontSize: 12, fontWeight: "800", letterSpacing: 0.7 },
  title: { color: Colors.textPrimary, fontWeight: "800" },
  section: { color: Colors.textSecondary, fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginTop: 4 },
  text: { color: Colors.textPrimary }, help: { color: Colors.textSecondary, fontSize: 13 }, flex: { flex: 1 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 60 },
  itemImage: { width: 52, height: 52, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight },
  photos: { gap: 10, paddingVertical: 2 }, evidenceImage: { width: 82, height: 82, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  evidencePlaceholder: { alignItems: "center", justifyContent: "center", padding: 4 },
  response: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.md, marginTop: 4, gap: 10 },
  input: { minHeight: 104, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, color: Colors.textPrimary, padding: 12, textAlignVertical: "top" },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  outline: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
  button: { minHeight: 48, backgroundColor: Colors.primary, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
  buttonText: { color: Colors.textOnBrand, fontWeight: "800" },
  remove: { position: "absolute", right: -5, top: -5, width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.error, alignItems: "center", justifyContent: "center" },
  removeText: { color: Colors.textPrimary, fontSize: 18, lineHeight: 20, fontWeight: "800" },
  modal: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: Spacing.lg },
  preview: { width: "100%", height: "80%" }, close: { minHeight: 48, minWidth: 120, backgroundColor: Colors.primary, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
});
