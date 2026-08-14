/**
 * app/(tabs)/upload.tsx — Create content screen
 *
 * Modes: Video | Photo | Carousel | Camera | Live
 *
 * Live mode is now fully wired to useLiveStream + LiveCameraPreview.
 * When the user taps "Abrir Cámara y Transmitir", a title modal is shown,
 * then LiveCameraPreview opens directly with the session lifecycle managed
 * by useLiveStream (SessionOrchestrator, ResourceManager, GPUManager, etc.).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput,
  ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { useLiveStream } from '@/hooks/streaming/useLiveStream';
import { LiveCameraPreview } from '@/components/feature/LiveCameraPreview';
import { MusicPicker } from '@/components/feature/MusicPicker';
import { IosVideoGalleryPicker } from '@/components/feature/IosVideoGalleryPicker';
import { CreatorContentProductSelector } from '@/components/marketplace/CreatorContentProductSelector';
import { LiveTitleModal } from '@/components/upload/LiveTitleModal';
import { getSupabaseClient, useAlert } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { uploadFileFromUri, detectMimeType } from '@/contexts/FeedContext';
import { type MusicTrack } from '@/services/musicLibrary';
import { createExclusiveContent } from '@/services/economyService';
import {
  createMediaOperationId,
  deleteMediaAsset,
  findCommonLinkedEntityForAssets,
  getSafeMediaError,
  uploadMediaFromUri,
} from '@/services/mediaService';
import {
  getSafeStreamError,
  uploadAndPublishStreamVideo,
  validateStreamVideoDuration,
  validateStreamVideoMime,
  validateStreamVideoSize,
  type StreamUploadStage,
} from '@/services/streamService';
import {
  deleteOwnedIosVideoCache,
  type IosVideoResolutionCode,
  type ResolvedIosVideo,
} from '@/services/iosVideoGalleryService';
import { setMyMarketplaceContentProductTags } from '@/services/marketplaceCreatorContentTagService';
import type { MarketplaceCreatorShowcaseProduct } from '@/services/marketplaceCreatorShowcaseService';
import {
  attemptCreatorContentTagAuthoritativeDiscard,
  attemptCreatorContentTagSave,
  canStartCreatorContentPublication,
  createPendingCreatorContentTagSave,
  type CreatorContentTagOperation,
  type PendingCreatorContentTagSave,
} from '@/services/marketplaceCreatorContentTagPublishRetry';

// ── Hashtag suggestions ────────────────────────────────────────────────────
const HASHTAG_SUGGESTIONS = [
  '#BlockDAG', '#Web3', '#ClipDAG', '#NFT', '#DeFi', '#CryptoCreator',
  '#EarnCrypto', '#DAG', '#BlockchainLife', '#Crypto',
];

const { width: SCREEN_W } = Dimensions.get('window');

type Mode = 'video' | 'photo' | 'carousel' | 'camera' | 'live';

interface SelectedMedia {
  uri: string;
  base64?: string | null;
  type: 'image' | 'video';
  mimeType?: string;
  fileName?: string | null;
  fileSize?: number | null;
  durationMs?: number | null;
  width?: number;
  height?: number;
  filterId?: string;
  ownedCacheUri?: string;
}

interface UploadedMedia {
  url: string;
  assetId?: string;
}
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export type PickerFailureKind='icloud_asset_unavailable'|'permission_denied'|'picker_failed';
type PickerOperation='video_library'|'photo_library'|'camera'|'carousel';

function imagePickerErrorText(error:unknown):string {
  if(!error||typeof error!=='object') return typeof error==='string'?error:'';
  const source=error as Record<string,unknown>;
  const fields=[source.name,source.code,source.domain,source.message,source.localizedDescription];
  if(source.cause&&typeof source.cause==='object') {
    const cause=source.cause as Record<string,unknown>;
    fields.push(cause.name,cause.code,cause.domain,cause.message,cause.localizedDescription);
  }
  return fields.filter(value=>typeof value==='string'||typeof value==='number').join(' ');
}

export function classifyImagePickerError(error:unknown):PickerFailureKind {
  const text=imagePickerErrorText(error).toLowerCase();
  if(text.includes('phphotoserrordomain')||/\b3164\b/.test(text)
    ||text.includes('photos could not complete')||text.includes('photos no pudo completar')) {
    return 'icloud_asset_unavailable';
  }
  if(/permission|not authorized|denied|access.*photo|acceso.*foto/.test(text)) return 'permission_denied';
  return 'picker_failed';
}

export function getSafeImagePickerErrorCode(error:unknown):string {
  const kind=classifyImagePickerError(error);
  return kind==='icloud_asset_unavailable'?'phphotos_3164':kind;
}

export async function registerExclusiveContent(opts: {
  title: string;
  contentType: string;
  previewUrl: string;
  contentUrl: string;
  priceBdag: number;
}): Promise<string> {
  const result = await createExclusiveContent({
    title: opts.title,
    description: opts.title,
    contentType: opts.contentType,
    previewText: opts.title.slice(0, 80),
    previewUrl: opts.previewUrl,
    contentUrl: opts.contentUrl,
    priceBdag: opts.priceBdag,
  });
  if (result.success !== true || !result.content_id) {
    throw new Error('EXCLUSIVE_CONTENT_REGISTRATION_FAILED');
  }
  return result.content_id;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        firstError ??= error;
      }
    }
  }));
  if (firstError) throw firstError;
  return results;
}



// ── Main Screen ───────────────────────────────────────────────────────────────
export default function UploadScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { addVideo, refreshFeed } = useFeed();
  const { showAlert } = useAlert();
  const router = useRouter();
  const supabase = getSupabaseClient();

  const [mode, setMode] = useState<Mode>('video');
  const [caption, setCaption] = useState('');
  const [selectedMusic, setSelectedMusic] = useState<MusicTrack | null>(null);
  const [musicPickerVisible, setMusicPickerVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const activeUploadControllerRef = useRef<AbortController | null>(null);
  const uploadInFlightRef = useRef(false);

  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);
  const [iosVideoGalleryVisible, setIosVideoGalleryVisible] = useState(false);
  const [carouselMedias, setCarouselMedias] = useState<SelectedMedia[]>([]);
  const [productSelectorVisible, setProductSelectorVisible] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<MarketplaceCreatorShowcaseProduct[]>([]);
  const [pendingProductTagSave, setPendingProductTagSave] = useState<PendingCreatorContentTagSave | null>(null);
  const pendingProductTagSaveRef = useRef<PendingCreatorContentTagSave | null>(null);
  const [productTagOperation, setProductTagOperation] = useState<CreatorContentTagOperation>('idle');
  const productTagOperationRef = useRef<CreatorContentTagOperation>('idle');

  const updatePendingProductTagSave = useCallback((pending: PendingCreatorContentTagSave | null) => {
    pendingProductTagSaveRef.current = pending;
    setPendingProductTagSave(pending);
  }, []);

  const updateProductTagOperation = useCallback((operation: CreatorContentTagOperation) => {
    productTagOperationRef.current = operation;
    setProductTagOperation(operation);
  }, []);

  const showPendingProductsResolutionAlert = useCallback(() => {
    showAlert(
      'Productos pendientes',
      'Resuelve primero los productos del contenido anterior antes de crear otra publicación.',
    );
  }, [showAlert]);

  const guardNewCreatorContentPublication = useCallback(() => {
    if (!canStartCreatorContentPublication(pendingProductTagSaveRef.current, productTagOperationRef.current)) {
      showPendingProductsResolutionAlert();
      return false;
    }
    return !uploadInFlightRef.current;
  }, [showPendingProductsResolutionAlert]);

  const openCreatorStudio = useCallback(() => {
    if (guardNewCreatorContentPublication()) router.push('/creator-studio');
  }, [guardNewCreatorContentPublication, router]);

  const executeProductTagSave = useCallback(async (command: PendingCreatorContentTagSave) => (
    attemptCreatorContentTagSave(command, (stableCommand) => setMyMarketplaceContentProductTags({
      contentType: stableCommand.contentType,
      contentId: stableCommand.contentId,
      productIds: stableCommand.productIds,
      idempotencyKey: stableCommand.idempotencyKey,
    }))
  ), []);

  const saveSelectedProductTags = useCallback(async (contentId: string, contentType: 'feed' | 'reel') => {
    if (pendingProductTagSaveRef.current) {
      showPendingProductsResolutionAlert();
      return false;
    }
    if (!selectedProducts.length) return true;
    const command = createPendingCreatorContentTagSave({
      contentId,
      contentType,
      productIds: selectedProducts.map((product) => product.productId),
      selectedProducts,
      idempotencyKey: randomUUID(),
      clearIdempotencyKey: randomUUID(),
    });
    const result = await executeProductTagSave(command);
    updatePendingProductTagSave(result.pending);
    if (!result.ok) {
      showAlert(
        'Contenido publicado, productos pendientes',
        'El contenido ya está en el Feed. Usa Reintentar productos para agregar la selección sin volver a publicarlo.',
      );
    }
    return result.ok;
  }, [executeProductTagSave, selectedProducts, showAlert, showPendingProductsResolutionAlert, updatePendingProductTagSave]);

  const retryPendingProductTags = useCallback(async () => {
    if (!pendingProductTagSave || productTagOperationRef.current !== 'idle') return;
    updateProductTagOperation('saving');
    const result = await executeProductTagSave(pendingProductTagSave);
    updateProductTagOperation('idle');
    updatePendingProductTagSave(result.pending);
    if (result.ok) {
      setSelectedProducts([]);
      showAlert('Productos agregados', 'Los productos ya están disponibles en el contenido publicado.');
    } else {
      showAlert('Productos pendientes', 'No pudimos guardarlos todavía. Puedes volver a intentarlo.');
    }
  }, [executeProductTagSave, pendingProductTagSave, showAlert, updatePendingProductTagSave, updateProductTagOperation]);

  const continueWithoutPendingProducts = useCallback(async () => {
    if (!pendingProductTagSave || productTagOperationRef.current !== 'idle') return;
    updateProductTagOperation('clearing');
    const result = await attemptCreatorContentTagAuthoritativeDiscard(pendingProductTagSave, (command) => (
      setMyMarketplaceContentProductTags({
        contentType: command.contentType,
        contentId: command.contentId,
        productIds: command.productIds,
        idempotencyKey: command.idempotencyKey,
      })
    ));
    updateProductTagOperation('idle');
    updatePendingProductTagSave(result.pending);
    if (result.ok) {
      setSelectedProducts([]);
      showAlert('Contenido publicado', 'El contenido continuará sin productos.');
    } else if (result.stage === 'save_fence') {
      showAlert('Productos pendientes', 'No pudimos confirmar el estado de los productos. Intenta nuevamente.');
    } else {
      showAlert('Productos pendientes', 'No pudimos confirmar que los productos se eliminaron. Intenta nuevamente.');
    }
  }, [pendingProductTagSave, showAlert, updatePendingProductTagSave, updateProductTagOperation]);

  // ── Live ────────────────────────────────────────────────────────────────────
  const [showLiveTitleModal, setShowLiveTitleModal] = useState(false);
  const [liveCameraVisible, setLiveCameraVisible] = useState(false);
  const [liveTitleForCamera, setLiveTitleForCamera] = useState('');

  const { startStream, endStream, isStreaming, isStarting, error: streamError } = useLiveStream(
    user?.id ?? '',
  );

  const hostUser = user
    ? { id: user.id, username: user.username || user.email?.split('@')[0] || 'user', avatar: user.avatar }
    : null;

  // ── Live: user taps "Abrir Cámara y Transmitir" ───────────────────────────
  const handleGoLive = useCallback(() => {
    if (!guardNewCreatorContentPublication()) return;
    if (!user) { showAlert('No autenticado', 'Inicia sesión para transmitir'); return; }
    setShowLiveTitleModal(true);
  }, [guardNewCreatorContentPublication, user, showAlert]);

  // ── Live: title confirmed → open camera ──────────────────────────────────
  const handleLiveTitleConfirmed = useCallback(async (title: string) => {
    if (!guardNewCreatorContentPublication()) {
      setShowLiveTitleModal(false);
      return;
    }
    setShowLiveTitleModal(false);
    setLiveTitleForCamera(title);

    // Start the Supabase session + resource acquisition via useLiveStream
    await startStream(title);
    setLiveCameraVisible(true);
  }, [guardNewCreatorContentPublication, startStream]);

  // ── Live: camera closed ───────────────────────────────────────────────────
  const handleLiveCameraClose = useCallback(async () => {
    setLiveCameraVisible(false);
    if (isStreaming) {
      await endStream();
    }
    setLiveTitleForCamera('');
  }, [isStreaming, endStream]);

  // ── Camera capture ────────────────────────────────────────────────────────
  useEffect(()=>()=>activeUploadControllerRef.current?.abort(),[]);

  const replaceSelectedMedia=useCallback((next:SelectedMedia|null)=>{
    setSelectedMedia(previous=>{
      if(previous?.ownedCacheUri&&previous.ownedCacheUri!==next?.ownedCacheUri&&!uploadInFlightRef.current) {
        deleteOwnedIosVideoCache(previous.ownedCacheUri);
      }
      return next;
    });
  },[]);

  const handleCameraCapture = useCallback((
    uri: string,
    type: 'photo' | 'video',
    filterId: string,
    metadata:Partial<SelectedMedia>={},
  ) => {
    if (!guardNewCreatorContentPublication()) return;
    const mimeType = type === 'video' ? 'video/mp4' : 'image/jpeg';
    if (mode === 'carousel' && type === 'photo') {
      setCarouselMedias(prev => [...prev, { uri, type: 'image', mimeType, filterId }]);
    } else {
      replaceSelectedMedia({ ...metadata, uri, type: type === 'photo' ? 'image' : 'video',
        mimeType:metadata.mimeType||mimeType, filterId });
      if (type === 'video') setMode('video');
      else setMode('photo');
    }
  }, [guardNewCreatorContentPublication, mode, replaceSelectedMedia]);

  const handleImagePickerFailure=useCallback((
    error:unknown,operation:PickerOperation,mediaKind:'photo'|'video',
    actions?:{onFiles?:()=>void;onRetry?:()=>void},
  )=>{
    const kind=classifyImagePickerError(error);
    console.warn('[Upload] Image picker failed',{operation,code:getSafeImagePickerErrorCode(error)});
    if(kind==='icloud_asset_unavailable') {
      if(mediaKind==='video'&&operation==='video_library'&&actions?.onFiles&&actions.onRetry) {
        showAlert(
          'Video no disponible en Fotos',
          'Fotos no pudo entregar este video.\nPuedes esperar que termine de descargarse desde iCloud o seleccionarlo desde Archivos.',
          [
            {text:'Seleccionar desde Archivos',onPress:actions?.onFiles},
            {text:'Intentar nuevamente',onPress:actions?.onRetry},
            {text:'Cancelar',style:'cancel'},
          ],
        );
        return;
      }
      showAlert(
        mediaKind==='video'?'Video no disponible':'Foto no disponible',
        mediaKind==='video'
          ?'Este video no está descargado completamente en el iPhone.\nÁbrelo en Fotos, espera que termine de descargarse de iCloud y vuelve a intentarlo.'
          :'Esta foto no está descargada completamente en el iPhone.\nÁbrela en Fotos, espera que termine de descargarse de iCloud y vuelve a intentarlo.',
      );
      return;
    }
    if(kind==='permission_denied') {
      showAlert('Permiso requerido','Habilita el acceso en los ajustes del dispositivo.');
      return;
    }
    showAlert('No se pudo abrir el contenido.','Intenta nuevamente.');
  },[showAlert]);

  const openCamera = useCallback(async (captureMode: 'photo' | 'video') => {
    if (!guardNewCreatorContentPublication()) return;
    try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert('Permiso requerido', 'Habilita la cámara en los ajustes del dispositivo');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: captureMode === 'photo' ? ['images'] : ['videos'],
      allowsEditing: captureMode === 'photo',
      quality: 0.85,
      videoMaxDuration: 60,
      base64: captureMode === 'photo',
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      handleCameraCapture(asset.uri, captureMode, 'normal',{
        base64:captureMode==='photo'?asset.base64:null,fileName:asset.fileName,fileSize:asset.fileSize,
        durationMs:asset.duration,width:asset.width,height:asset.height,mimeType:asset.mimeType||undefined,
      });
    }
    } catch(error) {
      handleImagePickerFailure(error,'camera',captureMode);
    }
  }, [guardNewCreatorContentPublication, showAlert, handleCameraCapture, handleImagePickerFailure]);

  const pickVideoFromFiles=useCallback(async ()=>{
    if (!guardNewCreatorContentPublication()) return;
    try {
      const result=await DocumentPicker.getDocumentAsync({
        type:['video/mp4','video/quicktime','video/webm'],
        multiple:false,
        copyToCacheDirectory:true,
      });
      if(result.canceled) return;
      if(result.assets.length!==1) throw new Error('invalid_document_picker_result');
      const asset=result.assets[0];
      if(!asset.uri?.trim()) throw new Error('invalid_document_picker_uri');
      const mimeType=asset.mimeType?.trim().toLowerCase()??'';
      if(!validateStreamVideoMime(mimeType)) {
        showAlert('Formato no compatible','Selecciona un video MP4, MOV o WebM.');
        return;
      }
      const file=new File(asset.uri);
      if(!file.exists||!validateStreamVideoSize(file.size)) {
        showAlert(
          file.size>200_000_000?'Video demasiado grande':'No se pudo abrir el video',
          file.size>200_000_000?'El video no puede superar 200 MB.':'Intenta nuevamente o selecciona otro archivo.',
        );
        return;
      }
      replaceSelectedMedia({
        uri:file.uri,type:'video',mimeType,fileName:asset.name,fileSize:file.size,
        durationMs:null,width:undefined,height:undefined,
      });
    } catch(error) {
      console.warn('[Upload] Video file picker failed',{code:getSafeImagePickerErrorCode(error)});
      showAlert('No se pudo abrir el video','Intenta nuevamente o selecciona otro archivo.');
    }
  },[guardNewCreatorContentPublication,showAlert,replaceSelectedMedia]);

  const handleIosVideoSelected=useCallback((video:ResolvedIosVideo)=>{
    if (!guardNewCreatorContentPublication()) return;
    replaceSelectedMedia({
      uri:video.uri,
      type:'video',
      mimeType:video.mimeType,
      fileName:video.fileName,
      fileSize:video.fileSize,
      durationMs:video.durationMs,
      width:video.width,
      height:video.height,
      ownedCacheUri:video.ownedCacheUri,
    });
    setIosVideoGalleryVisible(false);
  },[guardNewCreatorContentPublication,replaceSelectedMedia]);

  const handleIosVideoGalleryError=useCallback((code:IosVideoResolutionCode|'permission_denied'|'query_failed')=>{
    if(code==='permission_denied') {
      showAlert(
        'Acceso a videos requerido',
        'Permite el acceso a tus videos para seleccionarlos desde la galería.',
      );
      return;
    }
    if(code==='download_failed') {
      showAlert(
        'No se pudo descargar el video',
        'Comprueba tu conexión y vuelve a intentarlo, o selecciona el video desde Archivos.',
        [
          {text:'Seleccionar desde Archivos',onPress:()=>{setIosVideoGalleryVisible(false);void pickVideoFromFiles();}},
          {text:'Intentar nuevamente',onPress:()=>setIosVideoGalleryVisible(true)},
          {text:'Cancelar',style:'cancel'},
        ],
      );
      return;
    }
    if(code==='video_too_long') {
      showAlert('Video demasiado largo','El video no puede superar 60 segundos.');
      return;
    }
    if(code==='video_too_large') {
      showAlert('Video demasiado grande','El video no puede superar 200 MB.');
      return;
    }
    if(code==='unsupported_format') {
      showAlert('Formato no compatible','Selecciona un video MP4, MOV o WebM.');
      return;
    }
    if(code==='file_unavailable') {
      showAlert('Video no disponible','Fotos no pudo preparar este video. Selecciona otro o usa Archivos.');
    }
  },[pickVideoFromFiles,showAlert]);

  const pickSingleMedia: (fromCamera:boolean)=>Promise<void> = useCallback(async (fromCamera: boolean) => {
    if (!guardNewCreatorContentPublication()) return;
    const isPhoto = mode === 'photo';
    const operation:PickerOperation=fromCamera?'camera':isPhoto?'photo_library':'video_library';
    if(!fromCamera&&!isPhoto&&Platform.OS==='ios') {
      setIosVideoGalleryVisible(true);
      return;
    }
    try {
    const permFn = fromCamera
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
    const { status } = await permFn();
    if (status !== 'granted') {
      showAlert('Permiso requerido', 'Habilita el acceso en los ajustes del dispositivo');
      return;
    }
    const launchFn = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launchFn({
      mediaTypes: isPhoto ? ['images'] : ['videos'],
      allowsEditing: isPhoto,
      quality: 0.85,
      videoMaxDuration: 60,
      base64: isPhoto,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const mimeType = asset.mimeType || detectMimeType(asset.uri, asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
      replaceSelectedMedia({
        uri:asset.uri,base64:isPhoto?asset.base64:null,type:asset.type==='video'?'video':'image',mimeType,
        fileName:asset.fileName,fileSize:asset.fileSize,durationMs:asset.duration,width:asset.width,height:asset.height,
      });
    }
    } catch(error) {
      handleImagePickerFailure(
        error,operation,isPhoto?'photo':'video',
        !fromCamera&&!isPhoto?{
          onFiles:()=>{void pickVideoFromFiles();},
          onRetry:()=>{void pickSingleMedia(false);},
        }:undefined,
      );
    }
  }, [guardNewCreatorContentPublication, mode, showAlert, handleImagePickerFailure, pickVideoFromFiles, replaceSelectedMedia]);

  const pickCarouselImages = useCallback(async () => {
    if (!guardNewCreatorContentPublication()) return;
    try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permiso requerido', 'Habilita el acceso a la galería en ajustes');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.85,
    });
    if (!result.canceled && result.assets.length > 0) {
      const items: SelectedMedia[] = result.assets.map(a => ({
        uri: a.uri,
        base64: a.base64,
        type: 'image',
        mimeType: a.mimeType || detectMimeType(a.uri, 'image/jpeg'),
      }));
      setCarouselMedias(items);
    }
    } catch(error) {
      handleImagePickerFailure(error,'carousel','photo');
    }
  }, [guardNewCreatorContentPublication, showAlert, handleImagePickerFailure]);

  const removeCarouselItem = useCallback((idx: number) => {
    setCarouselMedias(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleAddHashtag = useCallback((tag: string) => {
    setCaption(prev => (prev.includes(tag) ? prev : prev ? `${prev} ${tag}` : tag));
  }, []);

  const handleMusicSelect = useCallback((track: MusicTrack) => {
    setSelectedMusic(track.isOriginalSound ? null : track);
  }, []);

  // ── Upload ────────────────────────────────────────────────────────────────
  const uploadMediaToStorage = useCallback(async (media: SelectedMedia, index?: number): Promise<UploadedMedia | null> => {
    if (!user) return null;
    const isVideo = media.type === 'video';
    const mimeType = media.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');
    if (isVideo) {
      const bucket = isVideo ? 'videos' : 'images';
      const ext = isVideo ? 'mp4' : 'jpg';
      const suffix = index !== undefined ? `_${index}` : '';
      const fileName = `${user.id}/${Date.now()}${suffix}.${ext}`;
      const legacyUrl = await uploadFileFromUri(supabase, media.uri, bucket, fileName, mimeType, media.base64);
      return legacyUrl ? { url: legacyUrl } : null;
    }
    const uploaded = await uploadMediaFromUri({
      uri: media.uri,
      purpose: mode === 'carousel' ? 'carousel_image' : 'post_image',
      mimeType,
      visibility: 'public',
    });
    if (!uploaded.url?.startsWith('https://')) throw new Error('R2 did not return a public URL');
    return { url: uploaded.url, assetId: uploaded.assetId };
  }, [user, supabase, mode]);

  const handleUploadSingle = useCallback(async () => {
    if (!guardNewCreatorContentPublication()) return;
    if (!selectedMedia) { showAlert('Sin contenido', `Selecciona ${mode === 'photo' ? 'una foto' : 'un video'}`); return; }
    if (!caption.trim()) { showAlert('Sin descripción', 'Agrega una descripción'); return; }
    if (!user) return;
    if(uploadInFlightRef.current) return;
    uploadInFlightRef.current=true;

    setIsUploading(true);
    setUploadProgress(selectedMedia.type==='video'?'Preparando video...':'Subiendo media...');
    let uploadedAssetId: string | undefined;
    let postId: string | undefined;
    try {
      if(selectedMedia.type==='video') {
        const mimeType=(selectedMedia.mimeType||detectMimeType(selectedMedia.uri,'video/mp4')).toLowerCase();
        if(!validateStreamVideoMime(mimeType)) {
          showAlert('Formato no compatible','Usa un video MP4, MOV o WebM.');
          return;
        }
        if(selectedMedia.fileSize!=null&&!validateStreamVideoSize(selectedMedia.fileSize)) {
          showAlert('Video demasiado grande','El video no puede superar 200 MB.');
          return;
        }
        if(!validateStreamVideoDuration(selectedMedia.durationMs)) {
          showAlert('Video demasiado largo','El video no puede superar 60 segundos.');
          return;
        }
        const controller=new AbortController();
        activeUploadControllerRef.current=controller;
        const musicName=selectedMusic?`${selectedMusic.title} - ${selectedMusic.artist}`:'Sin musica';
        const stageMessage=(stage:StreamUploadStage,progress?:number|null)=>{
          if(stage==='STREAM_INPUT'||stage==='STREAM_CREATE_UPLOAD') setUploadProgress('Preparando video...');
          else if(stage==='STREAM_DIRECT_POST') setUploadProgress('Subiendo video a Cloudflare...');
          else if(stage==='STREAM_PROCESSING') setUploadProgress(
            typeof progress==='number'?`Procesando video... ${Math.round(progress)}%`:'Procesando video...',
          );
          else if(stage==='STREAM_PUBLISH') setUploadProgress('Publicando en el feed...');
        };
        const published = await uploadAndPublishStreamVideo({
          uri:selectedMedia.uri,mimeType,fileName:selectedMedia.fileName||undefined,
          sizeBytes:selectedMedia.fileSize??undefined,durationMs:selectedMedia.durationMs,
          caption:caption.trim(),music:musicName,signal:controller.signal,onStage:stageMessage,
        });
        const tagsSaved = await saveSelectedProductTags(published.postId, 'reel');
        await refreshFeed();
        deleteOwnedIosVideoCache(selectedMedia.ownedCacheUri);
        setCaption('');setSelectedMedia(null);setSelectedMusic(null);setSelectedProducts([]);setUploadProgress('');
        if (!tagsSaved) return;
        showAlert('Video publicado','Tu video ya está disponible en el feed',[
          {text:'Ver Feed',onPress:()=>router.push('/(tabs)')},{text:'Crear otro'},
        ]);
        return;
      }
      const uploaded = await uploadMediaToStorage(selectedMedia);
      if (!uploaded?.url) throw new Error('Upload failed');
      uploadedAssetId = uploaded.assetId;
      const finalUrl = uploaded.url;
      setUploadProgress('Guardando en el feed...');
      const musicName = selectedMusic ? `${selectedMusic.title} - ${selectedMusic.artist}` : 'Sin musica';

      postId = await addVideo({
        userId: user.id,
        username: user.username || user.email?.split('@')[0] || 'user',
        userAvatar: user.avatar || '',
        videoUrl: finalUrl,
        thumbnailUrl: selectedMedia.type === 'image' ? finalUrl : '',
        caption: caption.trim(),
        music: musicName,
        ...(uploaded.assetId ? { mediaAssetIds: [uploaded.assetId] } : {}),
      });
      if (uploaded.assetId && !postId) throw new Error('entity_create_failed');
      if (postId && uploaded.assetId) uploadedAssetId = undefined;
      const tagsSaved = postId ? await saveSelectedProductTags(postId, 'feed') : true;

      setCaption(''); setSelectedMedia(null); setSelectedMusic(null); setSelectedProducts([]);
      setUploadProgress('');
      if (!tagsSaved) return;
      showAlert(
        mode === 'photo' ? 'Foto publicada!' : 'Video publicado!',
        'Tu contenido ya está en el feed',
        [{ text: 'Ver Feed', onPress: () => router.push('/(tabs)') }, { text: 'Crear otro' }],
      );
    } catch (error) {
      if(selectedMedia.type==='video') {
        const safe=getSafeStreamError(error);
        console.warn('[Upload] Stream video publish failed',{
          operationId:safe.operationId,stage:safe.stage,code:safe.code,
        });
        if(safe.code==='stream_publish_confirmation_pending') {
          await refreshFeed().catch(()=>{});
          showAlert(
            'Publicación pendiente de confirmación',
            'No pudimos confirmar el resultado de la publicación.\nRevisa el feed antes de volver a publicar el video.',
          );
          return;
        }
        showAlert('No se pudo publicar el video.',`Código: ${safe.stage}/${safe.code}`);
        return;
      }
      if (postId && uploadedAssetId) {
        await supabase.from('videos').delete().eq('id', postId).eq('user_id', user.id);
      }
      if (uploadedAssetId) await deleteMediaAsset(uploadedAssetId).catch(() => {});
      showAlert('Error', 'No se pudo publicar. Intenta de nuevo.');
    } finally {
      activeUploadControllerRef.current=null;
      uploadInFlightRef.current=false;
      setIsUploading(false);setUploadProgress('');
    }
  }, [guardNewCreatorContentPublication, selectedMedia, caption, mode, selectedMusic, user, uploadMediaToStorage, addVideo, refreshFeed, router, showAlert, supabase, saveSelectedProductTags]);

  const handleUploadCarousel = useCallback(async () => {
    if (!guardNewCreatorContentPublication()) return;
    if (carouselMedias.length < 2) { showAlert('Carrusel requerido', 'Selecciona al menos 2 fotos'); return; }
    if (!caption.trim()) { showAlert('Sin descripción', 'Agrega una descripción'); return; }
    if (!user) return;
    if(uploadInFlightRef.current) return;
    uploadInFlightRef.current=true;

    setIsUploading(true);
    setUploadProgress(`Subiendo ${carouselMedias.length} fotos...`);
    const completedUploads: ((UploadedMedia & { index: number }) | undefined)[] =
      new Array(carouselMedias.length);
    let failureStage = 'CAROUSEL_UPLOAD_FAILED';
    try {
      const uploads = await mapWithConcurrency(carouselMedias, 3, async (media, index) => {
        const uploaded = await uploadMediaToStorage(media, index);
        if (!uploaded?.url || !uploaded.assetId) throw new Error('CAROUSEL_UPLOAD_FAILED');
        const completed = { ...uploaded, index };
        completedUploads[index] = completed;
        return completed;
      });
      const orderedUploads = uploads
        .filter((item): item is UploadedMedia & { index: number } => Boolean(item?.url && item.assetId))
        .sort((a, b) => a.index - b.index);
      const validUrls = orderedUploads.map(item => item.url);
      if (validUrls.length !== carouselMedias.length) throw new Error('No se pudieron subir todas las imágenes');
      setUploadProgress('Guardando carrusel...');
      failureStage = 'CAROUSEL_CREATE_POST_FAILED';
      const postId = await addVideo({
        userId: user.id,
        username: user.username || user.email?.split('@')[0] || 'user',
        userAvatar: user.avatar || '',
        videoUrl: validUrls[0], thumbnailUrl: validUrls[0],
        caption: caption.trim(), music: 'Sin musica',
        mediaUrls: validUrls,
        mediaAssetIds: orderedUploads.map(item => item.assetId!),
      });
      if (!postId) throw new Error('CAROUSEL_CREATE_POST_FAILED');
      const tagsSaved = await saveSelectedProductTags(postId, 'feed');
      completedUploads.fill(undefined);
      setCaption(''); setCarouselMedias([]); setSelectedMusic(null); setSelectedProducts([]);
      if (!tagsSaved) {
        uploadInFlightRef.current=false;
        setIsUploading(false);setUploadProgress('');
        return;
      }
      showAlert(
        'Carrusel publicado!',
        `${validUrls.length} fotos publicadas`,
        [{ text: 'Ver Feed', onPress: () => router.push('/(tabs)') }, { text: 'Crear otro' }],
      );
    } catch (error) {
      const uploadedAssetIds = completedUploads
        .flatMap(item => item?.assetId ? [item.assetId] : []);
      const safe=getSafeMediaError(error,failureStage,{
        operationId:createMediaOperationId('carousel'),
      });
      let reconciledPostId:string|null=null;
      if(uploadedAssetIds.length===carouselMedias.length) {
        for(const delayMs of [250,750,1500]) {
          await wait(delayMs);
          reconciledPostId=await findCommonLinkedEntityForAssets(uploadedAssetIds,'video_post').catch(()=>null);
          if(reconciledPostId) break;
        }
      }
      if(reconciledPostId) {
        completedUploads.fill(undefined);
        setCaption('');setCarouselMedias([]);setSelectedMusic(null);
        console.warn('[Upload] carousel publish reconciled',{
          operationId:safe.operationId,
          stage:'CAROUSEL_RECONCILED_AFTER_AMBIGUOUS_RESPONSE',
          code:safe.code,reconciled:true,
          uploadedCount:uploadedAssetIds.length,selectedCount:carouselMedias.length,
        });
        showAlert(
          'Carrusel publicado!',
          `${carouselMedias.length} fotos publicadas`,
          [{text:'Ver Feed',onPress:()=>router.push('/(tabs)')},{text:'Crear otro'}],
        );
        setIsUploading(false);setUploadProgress('');
        uploadInFlightRef.current=false;
        return;
      }
      console.warn('[Upload] carousel publish failed', {
        operationId:safe.operationId,stage:safe.stage,code:safe.code,
        message:safe.message,details:safe.details,hint:safe.hint,
        reconciled:false,uploadedCount:uploadedAssetIds.length,
        selectedCount:carouselMedias.length,
      });
      await Promise.all(uploadedAssetIds.map(assetId => deleteMediaAsset(assetId).catch(() => {})));
      showAlert('Error',`No se pudo publicar el carrusel.\nCódigo: ${safe.stage}/${safe.code}`);
    }
    uploadInFlightRef.current=false;
    setIsUploading(false); setUploadProgress('');
  }, [guardNewCreatorContentPublication, carouselMedias, caption, user, uploadMediaToStorage, addVideo, router, showAlert, saveSelectedProductTags]);

  const MODES: { key: Mode; icon: string; label: string; color?: string }[] = [
    { key: 'video',    icon: 'videocam',      label: 'Video' },
    { key: 'photo',    icon: 'photo-camera',  label: 'Foto' },
    { key: 'carousel', icon: 'view-carousel', label: 'Carrusel' },
    { key: 'camera',   icon: 'auto-awesome',  label: 'Cámara',  color: '#B44FFF' },
    { key: 'live',     icon: 'live-tv',       label: 'En Vivo' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Live Title Modal ─────────────────────────────────────────────── */}
      <LiveTitleModal
        visible={showLiveTitleModal}
        onCancel={() => setShowLiveTitleModal(false)}
        onStart={handleLiveTitleConfirmed}
      />
      <CreatorContentProductSelector
        visible={productSelectorVisible}
        selected={selectedProducts}
        onChange={setSelectedProducts}
        onClose={() => setProductSelectorVisible(false)}
      />

      {pendingProductTagSave ? (
        <View style={styles.pendingProductTagsCard} accessibilityLabel="Productos pendientes del contenido publicado">
          <View style={styles.pendingProductTagsCopy}>
            <Text style={styles.pendingProductTagsTitle}>Contenido publicado, productos pendientes</Text>
            <Text style={styles.pendingProductTagsText}>
              {pendingProductTagSave.productIds.length} producto{pendingProductTagSave.productIds.length === 1 ? '' : 's'} por agregar
            </Text>
          </View>
          <Pressable
            style={styles.pendingProductTagsPrimary}
            onPress={() => void retryPendingProductTags()}
            disabled={productTagOperation !== 'idle'}
            accessibilityLabel="Reintentar productos"
          >
            {productTagOperation === 'saving'
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.pendingProductTagsPrimaryText}>Reintentar productos</Text>}
          </Pressable>
          <Pressable
            style={styles.pendingProductTagsSecondary}
            onPress={() => void continueWithoutPendingProducts()}
            disabled={productTagOperation !== 'idle'}
            accessibilityLabel="Continuar sin productos"
          >
            {productTagOperation === 'clearing'
              ? <ActivityIndicator size="small" color={Colors.textSecondary} />
              : <Text style={styles.pendingProductTagsSecondaryText}>Continuar sin productos</Text>}
          </Pressable>
        </View>
      ) : null}

      {/* ── Live Camera (full-screen) ────────────────────────────────────── */}
      <LiveCameraPreview
        visible={liveCameraVisible}
        title={liveTitleForCamera}
        hostUser={hostUser}
        onClose={handleLiveCameraClose}
        onStreamStarted={() => {
          // Camera preview active — session managed by useLiveStream.startStream();
        }}
      />

      <MusicPicker
        visible={musicPickerVisible}
        selectedTrackId={selectedMusic?.id}
        onClose={() => setMusicPickerVisible(false)}
        onSelect={handleMusicSelect}
      />

      <IosVideoGalleryPicker
        visible={iosVideoGalleryVisible}
        onClose={()=>setIosVideoGalleryVisible(false)}
        onFiles={()=>{setIosVideoGalleryVisible(false);void pickVideoFromFiles();}}
        onSelected={handleIosVideoSelected}
        onError={handleIosVideoGalleryError}
      />

      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Crear Contenido</Text>
          <Text style={styles.headerSub}>◈ Gana $DAG con cada like</Text>
        </View>
      </View>

      {/* Mode selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.modeSelectorContent}
        style={styles.modeSelector}
      >
        {MODES.map(m => {
          const isActive = mode === m.key;
          const bgColor = m.key === 'live' ? Colors.secondary
            : m.key === 'carousel' ? Colors.blue
            : m.key === 'camera' ? '#B44FFF'
            : Colors.primary;
          return (
            <Pressable
              key={m.key}
              style={[styles.modeBtn, isActive && { backgroundColor: bgColor, borderColor: bgColor }]}
              onPress={() => {
                if(isUploading) return;
                if(!guardNewCreatorContentPublication()) return;
                if (m.key === 'camera') {
                  showAlert('Cámara con Filtros AR', '¿Qué quieres capturar?', [
                    { text: 'Abrir Creator Studio', onPress: openCreatorStudio },
                    { text: 'Foto estándar', onPress: () => openCamera('photo') },
                    { text: 'Video estándar', onPress: () => openCamera('video') },
                    { text: 'Cancelar', style: 'cancel' },
                  ]);
                } else {
                  setMode(m.key);
                  replaceSelectedMedia(null);
                  setCarouselMedias([]);
                  setUploadProgress('');
                }
              }}
            >
              {m.key === 'live' && isActive ? <View style={styles.livePulse} /> : null}
              <MaterialIcons name={m.icon as any} size={16} color={isActive ? '#fff' : Colors.textSubtle} />
              <Text style={[styles.modeBtnText, isActive && styles.modeBtnTextActive]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── LIVE MODE ─────────────────────────────────────────────────── */}
          {mode === 'live' ? (
            <>
              <LinearGradient
                colors={['rgba(255,45,85,0.14)', 'rgba(255,45,85,0.05)']}
                style={styles.livePreview}
              >
                <View style={styles.liveIconWrap}>
                  <View style={styles.liveRedDot} />
                  <MaterialIcons name="live-tv" size={46} color={Colors.secondary} />
                </View>
                <Text style={styles.livePreviewTitle}>Transmisión en Vivo</Text>
                <Text style={styles.livePreviewSub}>Gana $DAG por tips de tus fans en tiempo real</Text>

                {/* Live stats if currently streaming */}
                {isStreaming ? (
                  <View style={styles.liveActiveBadge}>
                    <View style={styles.liveActiveDot} />
                    <Text style={styles.liveActiveText}>TRANSMITIENDO AHORA</Text>
                  </View>
                ) : null}
              </LinearGradient>

              {streamError ? (
                <View style={styles.streamErrorCard}>
                  <MaterialIcons name="error-outline" size={16} color={Colors.secondary} />
                  <Text style={styles.streamErrorText}>{streamError}</Text>
                </View>
              ) : null}

              {isStreaming ? (
                <CyberButton
                  label="Volver a la cámara"
                  onPress={() => setLiveCameraVisible(true)}
                  variant="secondary"
                  size="lg"
                  fullWidth
                />
              ) : (
                <CyberButton
                  label={isStarting ? 'Iniciando...' : 'Abrir Cámara y Transmitir'}
                  onPress={handleGoLive}
                  loading={isStarting}
                  variant="secondary"
                  size="lg"
                  fullWidth
                />
              )}

              {/* Tips */}
              <View style={styles.liveTipsCard}>
                {[
                  '💡 Los mejores lives duran al menos 20 minutos',
                  '🎯 Interactúa con el chat para retener espectadores',
                  '💎 Activa el modo exclusivo para cobrar por ingreso',
                ].map(tip => (
                  <Text key={tip} style={styles.liveTip}>{tip}</Text>
                ))}
              </View>
            </>

          /* ── CAROUSEL MODE ──────────────────────────────────────────── */
          ) : mode === 'carousel' ? (
            <>
              <View style={styles.carouselHeader}>
                <LinearGradient colors={['rgba(45,158,255,0.15)', 'rgba(45,158,255,0.05)']} style={styles.carouselInfo}>
                  <MaterialCommunityIcons name="image-multiple-outline" size={28} color={Colors.blue} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.infoCardTitle, { color: Colors.blue }]}>Carrusel Instagram</Text>
                    <Text style={styles.infoCardText}>Sube 2–10 fotos. Deslizables horizontalmente.</Text>
                  </View>
                </LinearGradient>
              </View>

              {carouselMedias.length === 0 ? (
                <View style={styles.pickerBtnsRow}>
                  <Pressable onPress={pickCarouselImages} style={[styles.pickerHalf, { flex: 1 }]}>
                    <LinearGradient colors={['rgba(45,158,255,0.12)', 'rgba(45,158,255,0.05)']} style={styles.pickerHalfInner}>
                      <MaterialCommunityIcons name="image-multiple-outline" size={36} color={Colors.blue} />
                      <Text style={[styles.pickerHalfTitle, { color: Colors.blue }]}>Galería</Text>
                      <Text style={styles.pickerHalfSub}>Selecciona 2–10 fotos</Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable onPress={() => openCamera('photo')} style={[styles.pickerHalf, { flex: 1 }]}>
                    <LinearGradient colors={['rgba(180,79,255,0.12)', 'rgba(180,79,255,0.05)']} style={styles.pickerHalfInner}>
                      <MaterialCommunityIcons name="camera-plus-outline" size={36} color="#B44FFF" />
                      <Text style={[styles.pickerHalfTitle, { color: '#B44FFF' }]}>Con Filtro</Text>
                      <Text style={styles.pickerHalfSub}>Foto con efectos</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.carouselGrid}>
                  {carouselMedias.map((m, i) => (
                    <View key={i} style={styles.carouselThumbWrap}>
                      <Image source={{ uri: m.uri }} style={styles.carouselThumb} contentFit="cover" transition={150} />
                      {m.filterId && m.filterId !== 'normal' ? (
                        <View style={styles.filterIndicator}>
                          <MaterialCommunityIcons name={'auto-awesome' as any} size={10} color="#fff" />
                        </View>
                      ) : null}
                      <Pressable onPress={() => removeCarouselItem(i)} style={styles.carouselRemoveBtn} hitSlop={4}>
                        <MaterialIcons name="close" size={14} color="#fff" />
                      </Pressable>
                      <View style={styles.carouselIndexBadge}>
                        <Text style={styles.carouselIndexText}>{i + 1}</Text>
                      </View>
                    </View>
                  ))}
                  {carouselMedias.length < 10 ? (
                    <Pressable onPress={pickCarouselImages} style={[styles.carouselThumbWrap, styles.carouselAddMoreBtn]}>
                      <MaterialCommunityIcons name="plus" size={28} color={Colors.blue} />
                      <Text style={styles.carouselAddMoreText}>Agregar</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Descripción *</Text>
                <TextInput style={styles.captionInput} value={caption} onChangeText={setCaption} placeholder="Describe tu carrusel..." placeholderTextColor={Colors.textSubtle} multiline maxLength={300} />
                <Text style={styles.charCount}>{caption.length}/300</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hashtagRow}>
                  {HASHTAG_SUGGESTIONS.map(tag => (
                    <Pressable key={tag} style={styles.hashtagChip} onPress={() => handleAddHashtag(tag)}>
                      <Text style={styles.hashtagText}>{tag}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <Pressable style={styles.productTagButton} onPress={() => {
                if (guardNewCreatorContentPublication()) setProductSelectorVisible(true);
              }} accessibilityLabel="Seleccionar productos para el carrusel">
                <MaterialCommunityIcons name="shopping-outline" size={21} color={Colors.blue} />
                <View style={styles.productTagCopy}><Text style={styles.productTagTitle}>Productos</Text><Text style={styles.productTagSubtitle}>{selectedProducts.length ? `${selectedProducts.length} seleccionados` : 'Agrega hasta 5 productos'}</Text></View>
                <MaterialIcons name="chevron-right" size={22} color={Colors.textSubtle} />
              </Pressable>

              <View style={styles.infoCard}>
                <MaterialIcons name="lock-clock" size={20} color={Colors.textSubtle} />
                <Text style={styles.infoCardTitle}>Contenido exclusivo próximamente</Text>
              </View>

              {isUploading && uploadProgress ? (
                <View style={styles.progressRow}>
                  <ActivityIndicator color={Colors.blue} size="small" />
                  <Text style={[styles.progressText, { color: Colors.blue }]}>{uploadProgress}</Text>
                </View>
              ) : null}

              <CyberButton
                label={isUploading ? (uploadProgress || 'Publicando...') : `Publicar Carrusel (${carouselMedias.length} fotos)`}
                onPress={handleUploadCarousel}
                loading={isUploading}
                size="lg"
                fullWidth
              />
            </>

          /* ── VIDEO / PHOTO MODE ──────────────────────────────────────── */
          ) : (
            <>
              {selectedMedia === null ? (
                <View style={styles.pickerArea}>
                  <View style={styles.pickerBtnsRow}>
                    <Pressable onPress={() => pickSingleMedia(false)} style={({ pressed }) => [styles.pickerHalf, pressed && { opacity: 0.8 }]}>
                      <LinearGradient colors={['rgba(0,212,255,0.12)', 'rgba(0,102,255,0.07)']} style={styles.pickerHalfInner}>
                        <MaterialIcons name={mode === 'photo' ? 'photo-library' : 'video-library'} size={36} color={Colors.primary} />
                        <Text style={styles.pickerHalfTitle}>Galería</Text>
                        <Text style={styles.pickerHalfSub}>{mode === 'photo' ? 'Fotos del dispositivo' : 'Videos del dispositivo'}</Text>
                      </LinearGradient>
                    </Pressable>
                    <Pressable onPress={() => openCamera(mode === 'photo' ? 'photo' : 'video')} style={({ pressed }) => [styles.pickerHalf, pressed && { opacity: 0.8 }]}>
                      <LinearGradient colors={['rgba(180,79,255,0.12)', 'rgba(180,79,255,0.06)']} style={styles.pickerHalfInner}>
                        <MaterialCommunityIcons name={'auto-awesome' as any} size={36} color="#B44FFF" />
                        <Text style={[styles.pickerHalfTitle, { color: '#B44FFF' }]}>Con Filtros</Text>
                        <Text style={styles.pickerHalfSub}>Cámara con efectos AR</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                  <Pressable onPress={() => pickSingleMedia(true)} style={styles.standardCameraBtn}>
                    <MaterialIcons name={mode === 'photo' ? 'photo-camera' : 'videocam'} size={18} color={Colors.textSecondary} />
                    <Text style={styles.standardCameraBtnText}>Cámara estándar</Text>
                  </Pressable>
                  {mode==='video'?(
                    <Pressable onPress={()=>{void pickVideoFromFiles();}} style={styles.standardCameraBtn}>
                      <MaterialIcons name="folder-open" size={18} color={Colors.textSecondary} />
                      <Text style={styles.standardCameraBtnText}>Seleccionar desde Archivos</Text>
                    </Pressable>
                  ):null}
                  <Text style={styles.pickerHint}>{mode === 'photo' ? 'JPG, PNG, WEBP · Max 10MB' : 'MP4, MOV · Max 60 seg'}</Text>
                </View>
              ) : (
                <View style={styles.selectedCard}>
                  <Image source={{ uri: selectedMedia.uri }} style={styles.selectedThumbImg} contentFit="cover" transition={200} />
                  <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']} style={styles.selectedOverlay}>
                    <View style={styles.selectedRow}>
                      <MaterialIcons name="check-circle" size={22} color={Colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedTitle}>{selectedMedia.type === 'image' ? 'Foto lista' : 'Video listo'}</Text>
                        {selectedMedia.filterId && selectedMedia.filterId !== 'normal' ? (
                          <Text style={styles.selectedFilter}>✨ Filtro: {selectedMedia.filterId}</Text>
                        ) : null}
                      </View>
                      <Pressable onPress={() => replaceSelectedMedia(null)} hitSlop={8} style={styles.removeBtn}>
                        <MaterialIcons name="close" size={18} color="#fff" />
                      </Pressable>
                    </View>
                  </LinearGradient>
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Descripción *</Text>
                <TextInput style={styles.captionInput} value={caption} onChangeText={setCaption} placeholder="De qué trata tu contenido..." placeholderTextColor={Colors.textSubtle} multiline maxLength={300} />
                <Text style={styles.charCount}>{caption.length}/300</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hashtagRow}>
                  {HASHTAG_SUGGESTIONS.map(tag => (
                    <Pressable key={tag} style={styles.hashtagChip} onPress={() => handleAddHashtag(tag)}>
                      <Text style={styles.hashtagText}>{tag}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <Pressable style={styles.productTagButton} onPress={() => {
                if (guardNewCreatorContentPublication()) setProductSelectorVisible(true);
              }} accessibilityLabel="Seleccionar productos para el contenido">
                <MaterialCommunityIcons name="shopping-outline" size={21} color={Colors.primaryLight} />
                <View style={styles.productTagCopy}><Text style={styles.productTagTitle}>Productos</Text><Text style={styles.productTagSubtitle}>{selectedProducts.length ? `${selectedProducts.length} seleccionados` : 'Agrega hasta 5 productos'}</Text></View>
                <MaterialIcons name="chevron-right" size={22} color={Colors.textSubtle} />
              </Pressable>

              <Pressable style={styles.musicPickerBtn} onPress={() => {
                if (guardNewCreatorContentPublication()) setMusicPickerVisible(true);
              }}>
                <LinearGradient
                  colors={selectedMusic ? ['rgba(124,92,255,0.15)', 'rgba(255,45,120,0.1)'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.02)']}
                  style={styles.musicPickerInner}
                >
                  <LinearGradient
                    colors={selectedMusic ? ['#7C5CFF', '#FF2D78'] : [Colors.surfaceHighlight, Colors.surfaceHighlight]}
                    style={styles.musicPickerIconWrap}
                  >
                    <MaterialCommunityIcons name="music-note" size={18} color={selectedMusic ? '#fff' : Colors.textSubtle} />
                  </LinearGradient>
                  <View style={styles.musicPickerMeta}>
                    <Text style={[styles.musicPickerLabel, selectedMusic && { color: Colors.primary }]}>
                      {selectedMusic ? selectedMusic.title : 'Agregar Música'}
                    </Text>
                    <Text style={styles.musicPickerArtist}>
                      {selectedMusic ? selectedMusic.artist : 'Toca para explorar la biblioteca'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={selectedMusic ? 'close-circle' : 'chevron-right'}
                    size={20}
                    color={Colors.textSubtle}
                    onPress={selectedMusic ? (e) => { e.stopPropagation?.(); setSelectedMusic(null); } : undefined}
                  />
                </LinearGradient>
              </Pressable>

              <View style={styles.infoCard}>
                <MaterialIcons name="lock-clock" size={20} color={Colors.textSubtle} />
                <Text style={styles.infoCardTitle}>Contenido exclusivo próximamente</Text>
              </View>

              {isUploading && uploadProgress ? (
                <View style={styles.progressRow}>
                  <ActivityIndicator color={Colors.primary} size="small" />
                  <Text style={styles.progressText}>{uploadProgress}</Text>
                </View>
              ) : null}

              <LinearGradient colors={['rgba(0,212,255,0.08)', 'rgba(0,102,255,0.04)']} style={styles.infoCard}>
                <Text style={styles.dagInfoIcon}>◈</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoCardTitle}>Gana $DAG con este contenido</Text>
                  <Text style={styles.infoCardText}>Cada like genera 0.01 $DAG automáticamente.</Text>
                </View>
              </LinearGradient>

              <CyberButton
                label={isUploading
                  ? (uploadProgress || 'Publicando...')
                  : mode === 'photo' ? 'Publicar Foto' : 'Publicar Video'}
                onPress={handleUploadSingle}
                loading={isUploading}
                size="lg"
                fullWidth
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const THUMB_SIZE = (SCREEN_W - Spacing.md * 2 - Spacing.sm * 2) / 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xs },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  headerSub: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.medium, marginTop: 1 },

  modeSelector: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, maxHeight: 48 },
  modeSelectorContent: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 2 },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated,
    borderWidth: 1, borderColor: Colors.border,
  },
  modeBtnText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  modeBtnTextActive: { color: '#fff' },
  livePulse: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff' },

  scrollContent: { padding: Spacing.md, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary },

  pickerArea: { gap: Spacing.md },
  pickerBtnsRow: { flexDirection: 'row', gap: Spacing.md },
  pickerHalf: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  pickerHalfInner: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  pickerHalfTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  pickerHalfSub: { color: Colors.textSubtle, fontSize: 11, textAlign: 'center' },
  standardCameraBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  standardCameraBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  pickerHint: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center' },

  selectedCard: { height: 220, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.accentDim },
  selectedThumbImg: { width: '100%', height: '100%' },
  selectedOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', padding: Spacing.md },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  selectedTitle: { color: Colors.accent, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  selectedFilter: { color: '#B44FFF', fontSize: FontSize.xs },
  removeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  carouselHeader: { gap: Spacing.sm },
  carouselInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(45,158,255,0.25)' },
  carouselGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  carouselThumbWrap: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, position: 'relative' },
  carouselThumb: { width: '100%', height: '100%' },
  filterIndicator: { position: 'absolute', top: 4, left: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(124,92,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  carouselRemoveBtn: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  carouselIndexBadge: { position: 'absolute', bottom: 4, left: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  carouselIndexText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  carouselAddMoreBtn: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: (Colors as any).blue + '88', backgroundColor: (Colors as any).blueDim },
  carouselAddMoreText: { color: (Colors as any).blue, fontSize: 10, fontWeight: FontWeight.semibold, marginTop: 2 },

  captionInput: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 100, textAlignVertical: 'top' },
  charCount: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  hashtagRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 2 },
  hashtagChip: { backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: 'rgba(0,212,255,0.3)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  hashtagText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  productTagButton:{minHeight:58,backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.lg,paddingHorizontal:Spacing.md,flexDirection:'row',alignItems:'center',gap:Spacing.md},
  productTagCopy:{flex:1},productTagTitle:{color:Colors.textPrimary,fontSize:FontSize.sm,fontWeight:FontWeight.bold},productTagSubtitle:{color:Colors.textSubtle,fontSize:FontSize.xs,marginTop:2},
  pendingProductTagsCard:{marginHorizontal:Spacing.md,marginBottom:Spacing.sm,padding:Spacing.md,gap:Spacing.sm,backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.accentDim,borderRadius:Radius.lg},
  pendingProductTagsCopy:{gap:2},pendingProductTagsTitle:{color:Colors.textPrimary,fontSize:FontSize.sm,fontWeight:FontWeight.bold},pendingProductTagsText:{color:Colors.textSecondary,fontSize:FontSize.xs},
  pendingProductTagsPrimary:{minHeight:40,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,backgroundColor:Colors.primary,paddingHorizontal:Spacing.md},
  pendingProductTagsPrimaryText:{color:'#fff',fontSize:FontSize.sm,fontWeight:FontWeight.bold},
  pendingProductTagsSecondary:{minHeight:36,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,paddingHorizontal:Spacing.md},
  pendingProductTagsSecondaryText:{color:Colors.textSecondary,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},

  musicPickerBtn: { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  musicPickerInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  musicPickerIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  musicPickerMeta: { flex: 1 },
  musicPickerLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  musicPickerArtist: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primaryDim },
  progressText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(0,212,255,0.2)' },
  dagInfoIcon: { fontSize: 22, color: Colors.primary },
  infoCardTitle: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 3 },
  infoCardText: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 16 },

  // Live mode
  livePreview: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,45,85,0.3)' },
  liveIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  liveRedDot: { position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.secondary },
  livePreviewTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  livePreviewSub: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', paddingHorizontal: Spacing.lg },
  liveActiveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,45,85,0.2)', borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,45,85,0.5)',
  },
  liveActiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.secondary },
  liveActiveText: { color: Colors.secondary, fontSize: 11, fontWeight: FontWeight.bold, letterSpacing: 0.8 },
  streamErrorCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(255,45,85,0.1)', borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(255,45,85,0.3)',
  },
  streamErrorText: { color: Colors.secondary, fontSize: FontSize.sm, flex: 1 },
  liveTipsCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, gap: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  liveTip: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 18 },
});
