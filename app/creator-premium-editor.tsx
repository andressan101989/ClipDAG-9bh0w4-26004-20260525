import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import {
  collectCreatorPremiumPlanPages,
  creatorPremiumLifecycleActions,
  creatorPremiumLifecyclePresentation,
  prepareCreatorPremiumVideoPickerAsset,
  selectCreatorPremiumVideoFromPhotos,
} from '@/services/creatorPremiumPresentation.mjs';
import {
  cancelMyCreatorPremiumSubmission,
  createMyCreatorPremiumDraft,
  deleteMyCreatorPremiumDraft,
  fetchMyCreatorPremiumContent,
  fetchMyCreatorPremiumPlans,
  normalizeCreatorPremiumPriceBdag,
  publishMyCreatorPremiumContent,
  publishMyCreatorPremiumContentWithPlans,
  reopenMyCreatorPremiumRejected,
  retireMyCreatorPremiumContent,
  setMyCreatorPremiumOffer,
  updateMyCreatorPremiumDraft,
  type CreatorPremiumAccessMode,
  type CreatorPremiumContentKind,
  type CreatorPremiumOwnerItem,
  type CreatorPremiumPlanItem,
} from '@/services/creatorPremiumService';
import { uploadCreatorPremiumImagePair } from '@/services/creatorPremiumMediaService';
import { uploadCreatorPremiumVideoMedia } from '@/services/creatorPremiumStreamService';
import {
  creatorPremiumErrorMessage as messageFor,
  creatorPremiumSubmissionBlockerMessage,
  creatorPremiumSubmissionMediaBlocker,
  creatorPremiumSubmissionNotice,
} from '@/services/creatorPremiumIntegrationState';

type LocalFile = {
  uri: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
};

const PREMIUM = Colors.purple;
const purchaseModes = new Set<CreatorPremiumAccessMode>(['purchase', 'purchase_or_subscription']);
const subscriptionModes = new Set<CreatorPremiumAccessMode>(['subscription', 'purchase_or_subscription']);

const kindOptions: { value: CreatorPremiumContentKind; label: string; icon: 'image-outline' | 'video-outline' }[] = [
  { value: 'image', label: 'Imagen', icon: 'image-outline' },
  { value: 'video', label: 'Video', icon: 'video-outline' },
];

const accessOptions: { value: CreatorPremiumAccessMode; label: string }[] = [
  { value: 'purchase', label: 'Compra' },
  { value: 'subscription', label: 'Suscripción' },
  { value: 'purchase_or_subscription', label: 'Compra o suscripción' },
];

async function imageFile(asset: ImagePicker.ImagePickerAsset): Promise<LocalFile> {
  let size = asset.fileSize ?? 0;
  if (!size) {
    const response = await fetch(asset.uri);
    size = (await response.blob()).size;
  }
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? `premium-${randomUUID()}.jpg`,
    sizeBytes: size,
  };
}

async function videoFile(asset: {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  durationMs?: number | null;
}): Promise<LocalFile> {
  const normalized = prepareCreatorPremiumVideoPickerAsset({
    ...asset,
    fileName: asset.fileName ?? `premium-${randomUUID()}.mp4`,
  }, { sizeForUri: uri => new File(uri).size });
  if (!normalized) throw new Error('creator_premium_video_asset_invalid');
  return normalized;
}

function videoPickerError(reason: unknown): string {
  const code = reason instanceof Error ? reason.message : '';
  if (code === 'creator_premium_video_mime_invalid') return 'Usa MP4, QuickTime o WebM.';
  if (code === 'creator_premium_video_size_invalid') return 'El video debe pesar menos de 200 MB.';
  if (code === 'creator_premium_video_duration_invalid') return 'El video debe durar como máximo 180 segundos.';
  if (code === 'creator_premium_video_asset_unreadable') return 'Descarga el video por completo en Photos y vuelve a intentarlo.';
  return messageFor(reason);
}

function Choice<T extends string>({ selected, label, icon, onPress, disabled }: {
  selected: boolean;
  label: string;
  icon?: 'image-outline' | 'video-outline';
  onPress: (value?: T) => void;
  disabled: boolean;
}) {
  return (
    <Pressable style={[styles.choice, selected && styles.choiceSelected, disabled && styles.disabled]} onPress={() => onPress()} disabled={disabled}>
      {icon ? <MaterialCommunityIcons name={icon} size={20} color={selected ? PREMIUM : Colors.textSecondary} /> : null}
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function CreatorPremiumEditor() {
  const params = useLocalSearchParams<{ contentId?: string | string[] }>();
  const routeContentId = Array.isArray(params.contentId) ? params.contentId[0] : params.contentId;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const requestId = useRef(randomUUID());
  const offerAttempt = useRef<{ signature: string; key: string } | null>(null);
  const submissionAttempt = useRef<{ signature: string; key: string } | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const [contentId, setContentId] = useState(routeContentId ?? '');
  const [item, setItem] = useState<CreatorPremiumOwnerItem | null>(null);
  const [plans, setPlans] = useState<CreatorPremiumPlanItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<CreatorPremiumContentKind>('image');
  const [accessMode, setAccessMode] = useState<CreatorPremiumAccessMode>('purchase');
  const [price, setPrice] = useState('');
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [teaser, setTeaser] = useState<LocalFile | null>(null);
  const [privateFile, setPrivateFile] = useState<LocalFile | null>(null);
  const [loading, setLoading] = useState(Boolean(routeContentId));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [processing, setProcessing] = useState('');
  const [error, setError] = useState<string | null>(null);

  const lifecyclePresentation = creatorPremiumLifecyclePresentation(item ?? {});
  const lifecycleActions = creatorPremiumLifecycleActions(item ?? {});
  const verificationRetryable = lifecycleActions.canRetry;
  const readOnly = Boolean(item && !lifecycleActions.editable);
  const busy = saving || uploading || submitting || deleting || cancelling || reopening || retiring;
  const mediaLocked = Boolean(item?.teaser_attached || item?.original_attached || item?.video_attached);
  const eligiblePlans = useMemo(() => plans.filter(plan => plan.status === 'active'), [plans]);

  const load = useCallback(async (targetId: string, silent = false, throwOnError = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [found, planPage] = await Promise.all([
        targetId ? fetchMyCreatorPremiumContent(targetId) : Promise.resolve(null),
        collectCreatorPremiumPlanPages(fetchMyCreatorPremiumPlans),
      ]);
      setPlans(planPage);
      if (!targetId) return null;
      if (!found) throw new Error('creator_premium_content_not_found');
      setItem(found);
      setTitle(found.title);
      setDescription(found.description);
      setKind(found.content_kind);
      setAccessMode(found.access_mode);
      setPrice(found.price_bdag === null ? '' : String(found.price_bdag));
      setSelectedPlanIds(planPage
        .filter(plan => plan.status === 'active' && plan.mapped_content_ids.includes(found.id))
        .map(plan => plan.id));
      return found;
    } catch (reason) {
      if (throwOnError) throw reason;
      setError(messageFor(reason));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(routeContentId ?? '');
    return () => uploadAbort.current?.abort();
  }, [load, routeContentId]);

  useEffect(() => {
    if (!contentId || !lifecyclePresentation.polling) return;
    const timer = setInterval(() => { void load(contentId, true); }, 4000);
    return () => clearInterval(timer);
  }, [contentId, lifecyclePresentation.polling, load]);

  const saveDraft = useCallback(async (): Promise<string> => {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('Escribe un título para el contenido.');
    let targetId = contentId;
    if (!targetId) {
      const created = await createMyCreatorPremiumDraft({
        title: cleanTitle,
        description: description.trim(),
        contentKind: kind,
        accessMode,
        clientRequestId: requestId.current,
      });
      if (!created?.id) throw new Error('creator_premium_draft_create_failed');
      targetId = created.id;
      setContentId(targetId);
    } else {
      await updateMyCreatorPremiumDraft({
        contentId: targetId,
        title: cleanTitle,
        description: description.trim(),
        contentKind: kind,
        accessMode,
      });
    }

    if (purchaseModes.has(accessMode) && price.trim()) {
      const amount = normalizeCreatorPremiumPriceBdag(price);
      const signature = `${targetId}:${amount}`;
      if (offerAttempt.current?.signature !== signature) offerAttempt.current = { signature, key: randomUUID() };
      await setMyCreatorPremiumOffer({
        contentId: targetId,
        priceBdag: amount,
        clientRequestId: offerAttempt.current.key,
      });
    }
    return targetId;
  }, [accessMode, contentId, description, kind, price, title]);

  const handleSave = useCallback(async () => {
    if (busy || readOnly) return;
    setSaving(true);
    setError(null);
    try {
      const id = await saveDraft();
      await load(id);
      Alert.alert('Borrador guardado', 'Tus cambios quedaron guardados.');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSaving(false);
    }
  }, [busy, load, readOnly, saveDraft]);

  const pickImage = useCallback(async (role: 'teaser' | 'private') => {
    if (busy || readOnly) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permiso requerido', 'Permite el acceso a tus fotos para seleccionar esta imagen.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: role === 'teaser',
        aspect: role === 'teaser' ? [4, 5] : undefined,
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      const file = await imageFile(result.assets[0]);
      if (role === 'teaser') setTeaser(file);
      else setPrivateFile(file);
    } catch (reason) {
      Alert.alert('No se pudo leer la imagen', messageFor(reason));
    }
  }, [busy, readOnly]);

  const pickVideoFromPhotos = useCallback(async () => {
    if (busy || readOnly) return;
    const selection = await selectCreatorPremiumVideoFromPhotos({
      requestPermission: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
      launchPicker: () => ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 1,
        videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      }),
      prepareAsset: (asset: ImagePicker.ImagePickerAsset) => videoFile({
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        sizeBytes: asset.fileSize,
        durationMs: asset.duration,
      }),
    });
    if (selection.status === 'permission_required') {
      Alert.alert('Permiso requerido', 'Permite el acceso a tus fotos para seleccionar este video.');
      return;
    }
    if (selection.status === 'failed') {
      Alert.alert('No se pudo seleccionar el video', selection.message);
      return;
    }
    if (selection.status === 'selected') setPrivateFile(selection.file);
  }, [busy, readOnly]);

  const pickVideoFromFiles = useCallback(async () => {
    if (busy || readOnly) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: ['video/mp4', 'video/quicktime', 'video/webm'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      setPrivateFile(await videoFile({
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileName: asset.name,
        sizeBytes: asset.size,
        durationMs: null,
      }));
    } catch (reason) {
      Alert.alert('Video no compatible', videoPickerError(reason));
    }
  }, [busy, readOnly]);

  const uploadMedia = useCallback(async () => {
    if (busy || readOnly) return;
    if (!teaser) {
      Alert.alert('Falta la vista previa', 'Selecciona una imagen pública distinta del contenido privado.');
      return;
    }
    if (!privateFile) {
      Alert.alert('Falta el contenido privado', `Selecciona ${kind === 'image' ? 'la imagen' : 'el video'} privado.`);
      return;
    }
    setUploading(true);
    setError(null);
    setProcessing(kind === 'video' ? 'uploading' : 'Subiendo imágenes…');
    const controller = new AbortController();
    uploadAbort.current = controller;
    try {
      const id = await saveDraft();
      if (kind === 'image') {
        await uploadCreatorPremiumImagePair({
          contentId: id,
          teaser: { ...teaser, signal: controller.signal },
          original: { ...privateFile, signal: controller.signal },
        });
      } else {
        await uploadCreatorPremiumVideoMedia({
          contentId: id,
          teaser: { ...teaser, signal: controller.signal },
          video: {
            ...privateFile,
            signal: controller.signal,
            onUploadProgress: progress => setProcessing(`uploading · ${Math.round(progress)}%`),
            onProgress: state => setProcessing(state.status === 'ready' ? 'ready' : `${state.status}${state.progress === null ? '' : ` · ${Math.round(state.progress)}%`}`),
          },
        });
      }
      setProcessing('ready');
      setTeaser(null);
      setPrivateFile(null);
      await load(id);
      Alert.alert('Medios listos', 'La vista previa pública y el contenido privado quedaron vinculados.');
    } catch (reason) {
      if (!controller.signal.aborted) setError(messageFor(reason));
      setProcessing('failed');
    } finally {
      if (uploadAbort.current === controller) uploadAbort.current = null;
      setUploading(false);
    }
  }, [busy, kind, load, privateFile, readOnly, saveDraft, teaser]);

  const submit = useCallback(async () => {
    if (busy || (!lifecycleActions.canSubmit && !lifecycleActions.canRetry)) return;
    const mediaBlocker = creatorPremiumSubmissionMediaBlocker({
      contentKind: kind,
      mediaReady: Boolean(item && (kind === 'image' ? item.image_media_ready : item.video_media_ready)),
      hasPendingTeaser: Boolean(teaser),
      hasPendingPrivate: Boolean(privateFile),
      verificationRetryable,
    });
    if (mediaBlocker) {
      setError(mediaBlocker);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const id = verificationRetryable && contentId ? contentId : await saveDraft();
      const planIds = subscriptionModes.has(accessMode)
        ? [...new Set(selectedPlanIds)].sort()
        : [];
      if (!verificationRetryable && subscriptionModes.has(accessMode) && planIds.length === 0) {
        setError('Selecciona por lo menos un plan activo para publicar este contenido.');
        return;
      }
      if (!verificationRetryable) {
        const preflight = await load(id, true, true);
        if (!preflight) throw new Error('creator_premium_submission_not_confirmed');
        if (preflight.submission_blocker
            && !(preflight.submission_blocker === 'creator_premium_plan_mapping_required'
              && planIds.length > 0)) {
          setError(creatorPremiumSubmissionBlockerMessage(preflight.submission_blocker, preflight));
          return;
        }
      }
      const signature = `${id}:${planIds.join(',')}`;
      if (submissionAttempt.current?.signature !== signature) {
        submissionAttempt.current = { signature, key: randomUUID() };
      }
      const rpcResult = verificationRetryable
        ? await publishMyCreatorPremiumContent(id)
        : await publishMyCreatorPremiumContentWithPlans(
          id,
          planIds,
          submissionAttempt.current.key,
        );
      const refreshed = await load(id, true, true);
      const notice = creatorPremiumSubmissionNotice({ contentId: id, rpcResult, refreshed });
      if (!notice) throw new Error('creator_premium_submission_not_confirmed');
      Alert.alert(notice.title, notice.message);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setSubmitting(false);
    }
  }, [accessMode, busy, contentId, item, kind, lifecycleActions.canRetry, lifecycleActions.canSubmit, load, privateFile, saveDraft, selectedPlanIds, teaser, verificationRetryable]);

  const confirmDelete = useCallback(() => {
    if (!contentId || busy || !lifecycleActions.canDelete) return;
    Alert.alert(
      'Eliminar borrador',
      'Se desvincularán los medios y se programará su eliminación segura. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive', onPress: () => {
            setDeleting(true);
            void deleteMyCreatorPremiumDraft(contentId)
              .then(() => router.replace('/creator-monetization'))
              .catch(reason => setError(messageFor(reason)))
              .finally(() => setDeleting(false));
          },
        },
      ],
    );
  }, [busy, contentId, lifecycleActions.canDelete, router]);

  const confirmCancelSubmission = useCallback(() => {
    if (!contentId || busy || !lifecycleActions.canCancel) return;
    Alert.alert(
      'Cancelar solicitud',
      'El contenido volverá a borrador privado. Se conservarán los medios, el precio y los planes para que puedas corregirlo.',
      [
        { text: 'Mantener solicitud', style: 'cancel' },
        {
          text: 'Volver a borrador', style: 'destructive', onPress: () => {
            setCancelling(true);
            setError(null);
            void cancelMyCreatorPremiumSubmission(contentId)
              .then(() => load(contentId, false, true))
              .then(() => Alert.alert('Solicitud cancelada', 'Ya puedes editar el borrador o eliminarlo.'))
              .catch(reason => setError(messageFor(reason)))
              .finally(() => setCancelling(false));
          },
        },
      ],
    );
  }, [busy, contentId, lifecycleActions.canCancel, load]);

  const reopenRejected = useCallback(async () => {
    if (!contentId || busy || !lifecycleActions.canReopen) return;
    setReopening(true);
    setError(null);
    try {
      await reopenMyCreatorPremiumRejected(contentId);
      await load(contentId, false, true);
      Alert.alert('Borrador reabierto', 'Corrige el contenido antes de volver a solicitar la publicación.');
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setReopening(false);
    }
  }, [busy, contentId, lifecycleActions.canReopen, load]);

  const confirmRetire = useCallback(() => {
    if (!contentId || busy || !lifecycleActions.canRetire) return;
    Alert.alert(
      'Retirar publicación',
      'Dejará de mostrarse y no admitirá accesos nuevos. Los medios y el historial se conservarán. Si existen compras o suscripciones, el servidor bloqueará la operación.',
      [
        { text: 'Mantener publicada', style: 'cancel' },
        {
          text: 'Retirar', style: 'destructive', onPress: () => {
            setRetiring(true);
            setError(null);
            void retireMyCreatorPremiumContent(contentId)
              .then(() => router.replace('/creator-monetization'))
              .catch(reason => setError(messageFor(reason)))
              .finally(() => setRetiring(false));
          },
        },
      ],
    );
  }, [busy, contentId, lifecycleActions.canRetire, router]);

  const togglePlan = useCallback((planId: string) => {
    if (busy || readOnly) return;
    setSelectedPlanIds(current => current.includes(planId)
      ? current.filter(id => id !== planId)
      : [...current, planId]);
  }, [busy, readOnly]);

  if (loading) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={PREMIUM} />
        <Text style={styles.helper}>Cargando editor…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} hitSlop={10} disabled={busy}>
          <MaterialCommunityIcons name="arrow-left" size={23} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>{contentId ? 'Editar contenido Premium' : 'Nuevo contenido Premium'}</Text>
          <Text style={styles.headerSub}>{item ? lifecyclePresentation.label : 'Borrador privado'}</Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={PREMIUM} /> : null}
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 36 }]} keyboardShouldPersistTaps="handled">
        {readOnly ? (
          <View style={styles.reviewNotice}>
            <MaterialCommunityIcons name="clock-check-outline" size={21} color={Colors.warning} />
            <View style={styles.headerCopy}>
              <Text style={styles.reviewTitle}>{lifecyclePresentation.label}</Text>
              <Text style={styles.helper}>{lifecyclePresentation.copy}</Text>
            </View>
          </View>
        ) : null}
        {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}

        <Section title="Detalles">
          <Text style={styles.label}>Título</Text>
          <TextInput value={title} onChangeText={setTitle} maxLength={120} editable={!busy && !readOnly} style={styles.input} placeholder="Título del contenido" placeholderTextColor={Colors.textSubtle} />
          <Text style={styles.label}>Descripción</Text>
          <TextInput value={description} onChangeText={setDescription} maxLength={2000} editable={!busy && !readOnly} multiline style={[styles.input, styles.multiline]} placeholder="Cuéntale a tu audiencia qué encontrará" placeholderTextColor={Colors.textSubtle} />
        </Section>

        <Section title="Tipo">
          <View style={styles.choiceRow}>
            {kindOptions.map(option => (
              <Choice key={option.value} selected={kind === option.value} label={option.label} icon={option.icon} disabled={busy || readOnly || mediaLocked} onPress={() => setKind(option.value)} />
            ))}
          </View>
          {mediaLocked ? <Text style={styles.helper}>El tipo queda bloqueado después de vincular medios.</Text> : null}
        </Section>

        <Section title="Acceso">
          <View style={styles.choiceWrap}>
            {accessOptions.map(option => (
              <Choice key={option.value} selected={accessMode === option.value} label={option.label} disabled={busy || readOnly} onPress={() => setAccessMode(option.value)} />
            ))}
          </View>
        </Section>

        <Section title="Vista previa pública">
          <Text style={styles.helper}>Esta imagen será visible antes de desbloquear el contenido.</Text>
          <Pressable style={styles.picker} onPress={() => void pickImage('teaser')} disabled={busy || readOnly}>
            {teaser ? <Image source={teaser.uri} style={styles.previewImage} contentFit="cover" /> : item?.teaser_url ? <Image source={item.teaser_url} style={styles.previewImage} contentFit="cover" /> : <MaterialCommunityIcons name="image-plus-outline" size={34} color={PREMIUM} />}
            <View style={styles.pickerCopy}>
              <Text style={styles.pickerTitle}>{teaser ? teaser.fileName : item?.teaser_attached ? 'Vista previa vinculada' : 'Seleccionar imagen'}</Text>
              <Text style={styles.helper}>Debe elegirse por separado del original privado.</Text>
            </View>
          </Pressable>
        </Section>

        <Section title="Contenido privado">
          <Pressable style={styles.picker} onPress={() => kind === 'image' ? void pickImage('private') : void pickVideoFromPhotos()} disabled={busy || readOnly}>
            <MaterialCommunityIcons name={kind === 'image' ? 'image-lock-outline' : 'file-lock-outline'} size={34} color={PREMIUM} />
            <View style={styles.pickerCopy}>
              <Text style={styles.pickerTitle}>{privateFile ? privateFile.fileName : item && (item.original_attached || item.video_attached) ? 'Original privado vinculado' : `Seleccionar ${kind === 'image' ? 'imagen' : 'video'}`}</Text>
              <Text style={styles.helper}>{kind === 'video' ? 'MP4, QuickTime o WebM · máximo 200 MB y 180 segundos.' : 'El original nunca se usa como vista previa pública.'}</Text>
            </View>
          </Pressable>
          {kind === 'video' && !readOnly ? (
            <Pressable style={styles.filesButton} onPress={() => void pickVideoFromFiles()} disabled={busy}>
              <MaterialCommunityIcons name="folder-outline" size={18} color={PREMIUM} />
              <Text style={styles.secondaryText}>Elegir desde Files</Text>
            </Pressable>
          ) : null}
          {processing ? <Text style={[styles.processing, processing === 'failed' && { color: Colors.error }]}>Estado: {processing}</Text> : null}
        </Section>

        {purchaseModes.has(accessMode) ? (
          <Section title="Precio">
            <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" editable={!busy && !readOnly} style={styles.input} placeholder="BDAG" placeholderTextColor={Colors.textSubtle} />
            <Text style={styles.helper}>El precio crea una versión inmutable de oferta. Las ventas siguen deshabilitadas.</Text>
          </Section>
        ) : null}

        {subscriptionModes.has(accessMode) ? (
          <Section title="Planes">
            {eligiblePlans.length === 0 ? (
              <Text style={styles.helper}>Activa un plan desde el Hub para poder asociarlo.</Text>
            ) : eligiblePlans.map(plan => {
              const selected = selectedPlanIds.includes(plan.id);
              return (
                <Pressable key={plan.id} style={[styles.planRow, selected && styles.planRowSelected]} onPress={() => togglePlan(plan.id)} disabled={busy || readOnly}>
                  <MaterialCommunityIcons name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={selected ? PREMIUM : Colors.textSubtle} />
                  <View style={styles.headerCopy}>
                    <Text style={styles.planName}>{plan.name} · v{plan.version}</Text>
                    <Text style={styles.helper}>Cada {plan.billing_period_days} días</Text>
                  </View>
                </Pressable>
              );
            })}
            <Text style={styles.helper}>La selección se aplica de forma atómica al publicar y crea una nueva versión inmutable del plan cuando cambia su contenido.</Text>
          </Section>
        ) : null}

        <Section title="Estado">
          <View style={styles.statusRow}>
            <MaterialCommunityIcons name={item && (kind === 'image' ? item.image_media_ready : item.video_media_ready) ? 'check-circle' : 'clock-outline'} size={19} color={item && (kind === 'image' ? item.image_media_ready : item.video_media_ready) ? Colors.success : Colors.warning} />
            <Text style={styles.statusText}>{item && (kind === 'image' ? item.image_media_ready : item.video_media_ready) ? 'Medios listos' : 'Medios pendientes'}</Text>
          </View>
          <View style={styles.statusRow}>
            <MaterialCommunityIcons name={lifecyclePresentation.tone === 'green' ? 'check-circle' : 'alert-circle-outline'} size={19} color={lifecyclePresentation.tone === 'green' ? Colors.success : Colors.warning} />
            <View style={styles.headerCopy}>
              <Text style={styles.statusText}>{item ? lifecyclePresentation.label : 'Nuevo borrador'}</Text>
              <Text style={styles.helper}>{item
                ? lifecyclePresentation.copy
                : 'Completa los datos comerciales y los medios.'}</Text>
            </View>
          </View>
        </Section>

        {lifecycleActions.editable || lifecycleActions.canRetry || lifecycleActions.canCancel || lifecycleActions.canReopen || lifecycleActions.canRetire ? (
          <View style={styles.actions}>
            {lifecycleActions.editable ? <Pressable style={styles.secondaryButton} onPress={() => void handleSave()} disabled={busy}>
              {saving ? <ActivityIndicator color={PREMIUM} /> : <><MaterialCommunityIcons name="content-save-outline" size={20} color={PREMIUM} /><Text style={styles.secondaryText}>Guardar borrador</Text></>}
            </Pressable> : null}
            {lifecycleActions.editable ? <Pressable style={styles.secondaryButton} onPress={() => void uploadMedia()} disabled={busy}>
              {uploading ? <ActivityIndicator color={PREMIUM} /> : <><MaterialCommunityIcons name="cloud-upload-outline" size={20} color={PREMIUM} /><Text style={styles.secondaryText}>Subir/Reemplazar medios</Text></>}
            </Pressable> : null}
            {lifecycleActions.canSubmit || lifecycleActions.canRetry ? <Pressable style={styles.primaryButton} onPress={() => void submit()} disabled={busy}>
              {submitting ? <ActivityIndicator color={Colors.textOnBrand} /> : <><MaterialCommunityIcons name="send-check-outline" size={20} color={Colors.textOnBrand} /><Text style={styles.primaryText}>{verificationRetryable ? 'Reintentar verificación' : 'Publicar contenido Premium'}</Text></>}
            </Pressable> : null}
            {lifecycleActions.canCancel ? <Pressable style={styles.secondaryButton} onPress={confirmCancelSubmission} disabled={busy}>
              {cancelling ? <ActivityIndicator color={PREMIUM} /> : <><MaterialCommunityIcons name="file-undo-outline" size={20} color={PREMIUM} /><Text style={styles.secondaryText}>Cancelar solicitud y editar</Text></>}
            </Pressable> : null}
            {lifecycleActions.canReopen ? <Pressable style={styles.secondaryButton} onPress={() => void reopenRejected()} disabled={busy}>
              {reopening ? <ActivityIndicator color={PREMIUM} /> : <><MaterialCommunityIcons name="pencil-outline" size={20} color={PREMIUM} /><Text style={styles.secondaryText}>Corregir y reenviar</Text></>}
            </Pressable> : null}
            {contentId && lifecycleActions.canDelete ? (
              <Pressable style={styles.deleteButton} onPress={confirmDelete} disabled={busy}>
                {deleting ? <ActivityIndicator color={Colors.error} /> : <><MaterialCommunityIcons name="trash-can-outline" size={20} color={Colors.error} /><Text style={styles.deleteText}>Eliminar borrador</Text></>}
              </Pressable>
            ) : null}
            {contentId && lifecycleActions.canRetire ? (
              <Pressable style={styles.deleteButton} onPress={confirmRetire} disabled={busy}>
                {retiring ? <ActivityIndicator color={Colors.error} /> : <><MaterialCommunityIcons name="archive-arrow-down-outline" size={20} color={Colors.error} /><Text style={styles.deleteText}>Retirar publicación</Text></>}
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  iconButton: { width: 42, height: 42, borderRadius: Radius.full, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSub: { color: PREMIUM, fontSize: FontSize.xs, marginTop: 2 },
  content: { padding: Spacing.md, gap: Spacing.md },
  reviewNotice: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.warningDim, borderWidth: 1, borderColor: `${Colors.warning}55` },
  reviewTitle: { color: Colors.warning, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  errorCard: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: `${Colors.error}66`, backgroundColor: `${Colors.error}12` },
  errorText: { color: Colors.error, fontSize: FontSize.sm, lineHeight: 20 },
  section: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, marginBottom: 2 },
  label: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  input: { minHeight: 46, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated, color: Colors.textPrimary, fontSize: FontSize.md },
  multiline: { minHeight: 94, paddingTop: 12, textAlignVertical: 'top' },
  helper: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 18 },
  choiceRow: { flexDirection: 'row', gap: Spacing.sm },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: { minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  choiceSelected: { borderColor: `${PREMIUM}88`, backgroundColor: Colors.purpleDim },
  choiceText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  choiceTextSelected: { color: PREMIUM },
  picker: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: `${PREMIUM}77`, backgroundColor: Colors.surfaceElevated },
  previewImage: { width: 66, height: 66, borderRadius: Radius.sm, backgroundColor: Colors.surfaceHighlight },
  pickerCopy: { flex: 1 },
  pickerTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 4 },
  processing: { color: Colors.info, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  planRow: { minHeight: 54, padding: Spacing.sm, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  planRowSelected: { borderColor: `${PREMIUM}88`, backgroundColor: Colors.purpleDim },
  planName: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  statusText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20 },
  actions: { gap: Spacing.sm },
  primaryButton: { minHeight: 50, borderRadius: Radius.md, backgroundColor: PREMIUM, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  primaryText: { color: Colors.textOnBrand, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  secondaryButton: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: `${PREMIUM}77`, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  secondaryText: { color: PREMIUM, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  deleteButton: { minHeight: 48, borderRadius: Radius.md, borderWidth: 1, borderColor: `${Colors.error}66`, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  deleteText: { color: Colors.error, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  filesButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  disabled: { opacity: 0.5 },
});
