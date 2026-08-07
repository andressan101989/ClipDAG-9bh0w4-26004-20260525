import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme';
import { detectMimeType } from '@/contexts/FeedContext';
import type { ProductCategory } from '@/contexts/ShopContext';
import { deleteMediaAsset, getSafeMediaError, uploadMediaFromUri } from '@/services/mediaService';
import {
  configureProductVariants, createProductDraft, fetchCategories, fetchSellerFoundation,
  evaluateMarketplaceProductPublication, fetchSellerProductVariants, marketplacePublicationMessage, marketplaceSellerConfigurationMessage, MarketplacePublicationError, MarketplaceSellerConfigurationError, setProductPublished, setVariantLowStockThreshold,
  softDeleteProduct, updateVariant, type MarketplaceCategoryRecord, type MarketplaceStore,
  type VariantConfiguration,
} from '@/services/marketplaceService';
import {
  estimateVariantCount, generateCreationVariants, generateVariantSku, parseVariantOptions,
  validateCreationVariants, VariantDraftValidationError, type CreationVariantDraft,
  type VariantDraftOption,
} from '@/services/marketplaceVariantDraft';
import {
  upsertMyLiveAffiliateOffer,
} from '@/services/liveCommerceService';
import { creatorCommissionPercentToBps } from '@/services/affiliateCommissionState';
import {
  fetchMyMarketplaceShippingProfiles,
  setMyMarketplaceProductShippingProfile,
  upsertMyMarketplaceShippingProfile,
  type MarketplaceShippingProfile,
} from '@/services/marketplaceShippingService';
import {
  MarketplaceBulkEditSheet, MarketplaceChoiceCard, MarketplaceCreationProgress,
  MarketplaceSectionCard, MarketplaceStickyFooter, MarketplaceVariantListItem,
} from '@/components/marketplace/MarketplaceCreationUI';

type PublicationStage = 'validation'|'draft_create'|'variant_configuration'|'shipping_assignment'|'publication'|'affiliate_configuration';
type ShippingState = 'loading'|'ready'|'empty'|'error';
type OptionBuilder = { id: string; name: string; values: string[]; draftValue: string };
type FieldErrors = Partial<Record<'title' | 'description' | 'category' | 'price' | 'stock' | 'sku' | 'options' | 'variants', string>>;
type PhotoUploadProgress = { current: number; total: number } | null;
const OPTION_SUGGESTIONS = ['Color', 'Talla', 'Material', 'Capacidad', 'Estilo'];
const MONEY_PATTERN = /^\d{1,12}(?:\.\d{1,8})?$/;
const MAX_PRODUCT_IMAGES = 5;

export default function CreateProductScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { showAlert } = useAlert();

  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [tags, setTags] = useState('');
  const [category, setCategory] = useState<ProductCategory>('physical');
  const [categories, setCategories] = useState<MarketplaceCategoryRecord[]>([]);
  const [store, setStore] = useState<MarketplaceStore | null>(null);
  const [accessReady, setAccessReady] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [imageAssetIds, setImageAssetIds] = useState<string[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState<PhotoUploadProgress>(null);
  const [hasVariants, setHasVariants] = useState(false);
  const [price, setPrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [simpleThreshold, setSimpleThreshold] = useState('0');
  const [simpleSku, setSimpleSku] = useState('');
  const [optionBuilders, setOptionBuilders] = useState<OptionBuilder[]>([]);
  const [variantDrafts, setVariantDrafts] = useState<CreationVariantDraft[]>([]);
  const [variantsNeedRegeneration, setVariantsNeedRegeneration] = useState(false);
  const [expandedVariantKey, setExpandedVariantKey] = useState<string | null>(null);
  const [bulkVisible, setBulkVisible] = useState(false);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [draftProductId, setDraftProductId] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [submissionStage, setSubmissionStage] = useState('');
  const [affiliateEnabled, setAffiliateEnabled] = useState(false);
  const [affiliatePercent, setAffiliatePercent] = useState('10');
  const [shippingProfiles, setShippingProfiles] = useState<MarketplaceShippingProfile[]>([]);
  const [shippingProfileId, setShippingProfileId] = useState('');
  const [shippingState, setShippingState] = useState<ShippingState>('loading');
  useFocusEffect(useCallback(()=>{if(!store?.id)return;let active=true;void fetchMyMarketplaceShippingProfiles(store.id).then(profiles=>{if(!active)return;setShippingProfiles(profiles);const selected=profiles.find(profile=>profile.id===shippingProfileId&&profile.configurationStatus==='explicit_ready')??profiles.find(profile=>profile.configurationStatus==='explicit_ready');if(selected)setShippingProfileId(selected.id);setShippingState(selected?'ready':'empty');}).catch(()=>{if(active)setShippingState('error');});return()=>{active=false;};},[shippingProfileId,store?.id]));
  const [shippingCountry, setShippingCountry] = useState('US');
  const [shippingPrice, setShippingPrice] = useState('0');
  const [returnPolicy, setReturnPolicy] = useState('Devoluciones aceptadas dentro de 14 días.');
  const configurationKeyRef = useRef(randomUUID());
  const affiliateKeyRef = useRef(randomUUID());
  const skuSeedRef = useRef(randomUUID().slice(0, 8).toUpperCase());
  const draftAssetIdsRef = useRef<string[]>([]);
  const publishLockRef = useRef(false);
  const uploadBatchLockRef = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchSellerFoundation(), fetchCategories()]).then(([foundation, activeCategories]) => {
      if (!active) return;
      if (foundation.seller?.status!=='approved' || !foundation.store || foundation.store.status!=='active') {
        router.replace('/seller' as never);
        return;
      }
      setStore(foundation.store);
      void fetchMyMarketplaceShippingProfiles(foundation.store.id).then(profiles => {
        if (!active) return;
        setShippingProfiles(profiles);
        setShippingProfileId(profiles.find(profile => profile.status === 'active' && profile.configurationStatus === 'explicit_ready')?.id ?? '');
        setShippingState(profiles.some(profile=>profile.status==='active'&&profile.configurationStatus==='explicit_ready')?'ready':'empty');
      }).catch(() => { if (active) {setShippingProfiles([]);setShippingState('error');} });
      setCategories(activeCategories);
      setCategory(current => activeCategories.some(item => item.slug === current)
        ? current
        : activeCategories[0]?.slug ?? current);
      setAccessReady(true);
    }).catch(() => { if (active) router.replace('/seller' as never); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => () => {
    const abandoned = [...draftAssetIdsRef.current];
    draftAssetIdsRef.current = [];
    for (const assetId of abandoned) void deleteMediaAsset(assetId).catch(() => {});
  }, []);

  const variantOptions = useMemo<VariantDraftOption[]>(
    () => optionBuilders.map(option => ({ name: option.name, valuesText: option.values.join(',') })),
    [optionBuilders],
  );
  const combinationEstimate = estimateVariantCount(variantOptions);
  const activeVariantCount = variantDrafts.filter(item => item.active).length;
  const totalInventory = variantDrafts.reduce((sum, item) => sum + (Number.parseInt(item.onHand, 10) || 0), 0);
  const variantPrices = variantDrafts.filter(item => item.active && Number(item.price) > 0).map(item => Number(item.price));
  const minVariantPrice = variantPrices.length ? Math.min(...variantPrices) : 0;
  const maxVariantPrice = variantPrices.length ? Math.max(...variantPrices) : 0;
  const hasUnsavedData = Boolean(
    title || description || brand || tags || images.length || price || optionBuilders.length || variantDrafts.length || draftProductId,
  );

  const clearError = (key: keyof FieldErrors) => setErrors(current => ({ ...current, [key]: undefined }));
  const autoSimpleSku = useCallback(() => {
    setSimpleSku(generateVariantSku(`${title || 'PRODUCTO'}-${skuSeedRef.current}`, ['SIMPLE'], 0));
    clearError('sku');
  }, [title]);

  const removeImage = useCallback((index: number) => {
    const assetId = imageAssetIds[index];
    Alert.alert('Quitar foto', '¿Quieres quitar esta foto del producto?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar', style: 'destructive', onPress: () => {
          setImages(current => current.filter((_, itemIndex) => itemIndex !== index));
          setImageAssetIds(current => current.filter((_, itemIndex) => itemIndex !== index));
          draftAssetIdsRef.current = draftAssetIdsRef.current.filter(id => id !== assetId);
          if (assetId) void deleteMediaAsset(assetId).catch(() => {});
        },
      },
    ]);
  }, [imageAssetIds]);

  const handlePickImage = useCallback(async () => {
    if (uploadBatchLockRef.current || isUploadingImage) return;
    const remainingSlots = MAX_PRODUCT_IMAGES - images.length;
    if (remainingSlots <= 0) {
      showAlert('Máximo 5 fotos', 'Quita una foto antes de agregar otra.');
      return;
    }
    uploadBatchLockRef.current = true;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert('Permiso necesario', 'Habilita el acceso a tus fotos para continuar.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
        orderedSelection: true,
      });
      if (result.canceled || !user) return;
      const selectedAssets = result.assets.slice(0, remainingSlots);
      if (!selectedAssets.length) return;

      setIsUploadingImage(true);
      let successfulUploads = 0;
      for (const [selectedAssetIndex, asset] of selectedAssets.entries()) {
        const mimeType = asset.mimeType || detectMimeType(asset.uri, 'image/jpeg');
        setPhotoUploadProgress({ current: selectedAssetIndex + 1, total: selectedAssets.length });
        try {
          const uploaded = await uploadMediaFromUri({
            uri: asset.uri, purpose: 'product_image', mimeType,
            fileName: asset.fileName || undefined, sizeBytes: asset.fileSize, visibility: 'public',
          });
          if (!uploaded.url?.startsWith('https://')) throw new Error('invalid_ready_media_url');
          setImages(current => [...current, uploaded.url!]);
          setImageAssetIds(current => [...current, uploaded.assetId]);
          draftAssetIdsRef.current = [...draftAssetIdsRef.current, uploaded.assetId];
          successfulUploads += 1;
        } catch (error) {
          const safe = getSafeMediaError(error, 'MEDIA_UNKNOWN', { mimeType });
          console.warn('[CreateProduct] product image upload failed', {
            operationId: safe.operationId,
            stage: safe.stage,
            code: safe.code,
            mimeType: safe.mimeType,
            httpStatus: safe.httpStatus,
            selectedAssetIndex,
          });
        }
      }
      const failedUploads = selectedAssets.length - successfulUploads;
      if (failedUploads > 0) {
        const title = failedUploads === 1 ? 'Una foto no pudo subirse' : `${failedUploads} fotos no pudieron subirse`;
        const remainingLabel = failedUploads === 1 ? 'la foto restante' : 'las fotos restantes';
        showAlert(
          title,
          `Se agregaron ${successfulUploads} de ${selectedAssets.length} fotos. Puedes intentar agregar ${remainingLabel} nuevamente.`,
        );
      }
    } finally {
      setIsUploadingImage(false);
      setPhotoUploadProgress(null);
      uploadBatchLockRef.current = false;
    }
  }, [images.length, isUploadingImage, showAlert, user]);

  const markOptionsChanged = () => {
    if (variantDrafts.length) setVariantsNeedRegeneration(true);
    clearError('options');
  };
  const chooseVariantMode = (next: boolean) => {
    if (draftProductId) {
      showAlert('Tu producto permanece privado', 'Reintenta o elimina el borrador antes de cambiar el tipo.');
      return;
    }
    if (!next && variantDrafts.length) {
      Alert.alert('Cambiar a producto simple', 'Se descartarán las variantes que todavía no has publicado.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cambiar', style: 'destructive', onPress: () => {
            setHasVariants(false); setVariantDrafts([]); setOptionBuilders([]); setVariantsNeedRegeneration(false);
          },
        },
      ]);
      return;
    }
    setHasVariants(next);
    if (next && !optionBuilders.length) {
      setOptionBuilders([{ id: randomUUID(), name: '', values: [], draftValue: '' }]);
    }
    if (!next && !simpleSku) autoSimpleSku();
  };
  const updateOptionName = (id: string, name: string) => {
    markOptionsChanged();
    setOptionBuilders(current => current.map(option => option.id === id ? { ...option, name } : option));
  };
  const updateOptionDraft = (id: string, draftValue: string) => {
    setOptionBuilders(current => current.map(option => option.id === id ? { ...option, draftValue } : option));
  };
  const addOptionValue = (id: string) => {
    const option = optionBuilders.find(item => item.id === id);
    const value = option?.draftValue.trim() ?? '';
    if (!value) {
      setErrors(current => ({ ...current, options: 'Escribe un valor antes de agregarlo.' }));
      return;
    }
    if (option!.values.some(item => item.toLocaleLowerCase('es') === value.toLocaleLowerCase('es'))) {
      setErrors(current => ({ ...current, options: `“${value}” ya existe en esta opción.` }));
      return;
    }
    if (option!.values.length >= 20) {
      setErrors(current => ({ ...current, options: 'Cada opción admite hasta 20 valores.' }));
      return;
    }
    markOptionsChanged();
    setOptionBuilders(current => current.map(item => item.id === id
      ? { ...item, values: [...item.values, value], draftValue: '' } : item));
  };
  const removeOptionValue = (id: string, value: string) => {
    markOptionsChanged();
    setOptionBuilders(current => current.map(option => option.id === id
      ? { ...option, values: option.values.filter(item => item !== value) } : option));
  };
  const removeOption = (id: string) => {
    markOptionsChanged();
    setOptionBuilders(current => current.filter(option => option.id !== id));
  };
  const addOption = () => {
    if (optionBuilders.length >= 3) return;
    markOptionsChanged();
    setOptionBuilders(current => [...current, { id: randomUUID(), name: '', values: [], draftValue: '' }]);
  };

  const performVariantGeneration = () => {
    try {
      const generated = generateCreationVariants(variantOptions, {
        price: price.trim(), stock: String(Math.max(0, Number.parseInt(stock, 10) || 0)),
        skuPrefix: `${title}-${skuSeedRef.current}`,
      });
      const previous = new Map(variantDrafts.map(item => [item.key, item]));
      setVariantDrafts(generated.map(item => previous.get(item.key) ?? item));
      setExpandedVariantKey(null);
      setVariantsNeedRegeneration(false);
      clearError('options');
      clearError('variants');
    } catch (error) {
      setErrors(current => ({
        ...current,
        options: error instanceof VariantDraftValidationError ? error.message : 'Revisa los nombres y valores.',
      }));
    }
  };
  const regenerateVariants = () => {
    if (combinationEstimate > 100) {
      setErrors(current => ({ ...current, options: 'Reduce los valores. El máximo es 100 variantes.' }));
      return;
    }
    if (variantDrafts.length) {
      Alert.alert(
        'Volver a generar variantes',
        'Volver a generar puede reemplazar cambios sin guardar. Conservaremos los datos de las combinaciones que sigan existiendo.',
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Volver a generar', onPress: performVariantGeneration }],
      );
    } else performVariantGeneration();
  };
  const updateVariantDraft = (index: number, patch: Partial<CreationVariantDraft>) => {
    clearError('variants');
    setVariantDrafts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const validateInformation = () => {
    const next: FieldErrors = {};
    if (!title.trim()) next.title = 'Escribe el nombre del producto.';
    if (!description.trim()) next.description = 'Agrega una descripción para el comprador.';
    if (!category) next.category = 'Selecciona una categoría.';
    setErrors(current => ({ ...current, ...next }));
    return !Object.keys(next).length;
  };
  const validateOptionsStep = () => {
    const next: FieldErrors = {};
    if (!hasVariants) {
      if (!MONEY_PATTERN.test(price.trim()) || Number(price) <= 0) next.price = 'Ingresa un precio BDAG válido.';
      if (!Number.isSafeInteger(Number(stock)) || Number(stock) < 0) next.stock = 'Ingresa un inventario válido.';
      if (!simpleSku.trim()) next.sku = 'Genera o escribe un SKU para tu producto.';
      if (compareAtPrice && (!MONEY_PATTERN.test(compareAtPrice) || Number(compareAtPrice) < Number(price))) {
        next.price = 'El precio anterior debe ser igual o mayor al precio actual, con un máximo de 8 decimales.';
      }
    } else {
      try {
        parseVariantOptions(variantOptions);
        if (combinationEstimate > 100) next.options = 'Reduce los valores. El máximo es 100 variantes.';
        if (!variantDrafts.length || variantsNeedRegeneration) next.options = 'Genera las variantes con las opciones actuales.';
      } catch (error) {
        next.options = error instanceof VariantDraftValidationError ? error.message : 'Revisa las opciones.';
      }
    }
    setErrors(current => ({ ...current, ...next }));
    return !Object.keys(next).length;
  };
  const validateVariantsStep = () => {
    if (!hasVariants) return true;
    try {
      validateCreationVariants(variantDrafts);
      clearError('variants');
      return true;
    } catch (error) {
      setErrors(current => ({
        ...current,
        variants: error instanceof VariantDraftValidationError ? error.message : 'Revisa las variantes.',
      }));
      return false;
    }
  };
  const continueFlow = () => {
    if (step === 0 && !validateInformation()) return;
    if (step === 2 && !validateOptionsStep()) return;
    if (step === 3 && !validateVariantsStep()) return;
    setStep(current => Math.min(4, current + 1));
  };

  const deleteIncompleteDraft = useCallback(async (productId?: string | null) => {
    const targetId = productId ?? draftProductId;
    if (!targetId || publishLockRef.current) return;
    publishLockRef.current = true;
    setIsPublishing(true);
    setSubmissionStage('Eliminando borrador privado…');
    try {
      await softDeleteProduct(targetId);
      setDraftProductId(null);
      configurationKeyRef.current = randomUUID();
      showAlert('Borrador eliminado', 'Tu información sigue en pantalla para que puedas volver a intentarlo.');
    } catch {
      showAlert('No se pudo eliminar', 'El borrador continúa privado. Inténtalo otra vez desde Mis productos.');
    } finally {
      publishLockRef.current = false;
      setIsPublishing(false);
      setSubmissionStage('');
    }
  }, [draftProductId, showAlert]);

  const handlePublish = async () => {
    if (publishLockRef.current || isPublishing) return;
    if (!user || !validateInformation() || !validateOptionsStep() || !validateVariantsStep()) return;
    if (!images.length || !imageAssetIds.length) {
      showAlert('Foto requerida', 'Agrega al menos una foto antes de publicar el producto.');
      setStep(1);
      return;
    }
    const categoryRow = categories.find(item => item.slug === category);
    if (!store || !categoryRow || !accessReady) {
      showAlert('Vendedor no habilitado', 'Completa y activa tu tienda antes de publicar.');
      return;
    }
    if (shippingState === 'loading' || shippingState === 'error') {
      showAlert('Envío no disponible', shippingState === 'loading' ? 'Espera mientras cargamos tus perfiles de envío.' : 'No pudimos cargar tus perfiles de envío. Inténtalo nuevamente.');
      return;
    }
    if (!shippingProfileId) {
      showAlert('Envío incompleto', 'Configura un perfil de envío activo antes de publicar.');
      return;
    }
    let creatorCommissionBps = 0;
    if (affiliateEnabled) {
      try {
        creatorCommissionBps = creatorCommissionPercentToBps(affiliatePercent);
      } catch {
        showAlert('Comisión inválida', 'Ingresa un porcentaje entre 0.01% y 30%, con hasta dos decimales.');
        return;
      }
    }
    let parsedVariantOptions;
    if (hasVariants) parsedVariantOptions = parseVariantOptions(variantOptions);
    const basePrice = hasVariants ? String(minVariantPrice) : price.trim();
    const baseCompareAt = hasVariants ? null : compareAtPrice.trim() || null;
    const tagList = tags.split(',').map(tag => tag.trim()).filter(Boolean);

    publishLockRef.current = true;
    setIsPublishing(true);
    let activeDraftId = draftProductId;
    let publicationStage:PublicationStage='validation';
    const log=(event:string,extra:Record<string,unknown>={})=>{if(__DEV__)console.log(`[CreateProduct] ${event}`,extra);};
    log('publish_started',{productFingerprint:activeDraftId?.slice(0,8)??null,shippingProfilePresent:Boolean(shippingProfileId),variantMode:hasVariants,imageCount:imageAssetIds.length});
    try {
      let productId = activeDraftId;
      let recoveredInventory:Awaited<ReturnType<typeof fetchSellerProductVariants>>|null=null;
      if (!productId) {
        publicationStage='draft_create';log('draft_create_start');
        setSubmissionStage('Creando borrador privado…');
        productId = await createProductDraft({
          storeId: store.id, categoryId: categoryRow.id, title: title.trim(),
          description: description.trim(), price: basePrice, brand: brand.trim() || undefined,
          compareAtPrice: baseCompareAt, assetIds: imageAssetIds,
          stock: hasVariants ? 0 : Math.max(0, Number.parseInt(stock, 10) || 0), tags: tagList,
        });
        activeDraftId = productId;
        setDraftProductId(productId);
        draftAssetIdsRef.current = [];
        log('draft_create_success',{productFingerprint:productId.slice(0,8)});
      }
      if(activeDraftId){log('seller_product_read_start',{operation:'fetch_seller_product_inventory',productFingerprint:productId.slice(0,8),draftPresent:true});try{recoveredInventory=await fetchSellerProductVariants(productId);log('seller_product_read_success',{operation:'fetch_seller_product_inventory',productFingerprint:productId.slice(0,8),draftPresent:true});}catch(error){if(__DEV__)console.warn('[CreateProduct] seller_product_read_failed',{operation:'fetch_seller_product_inventory',code:error instanceof MarketplaceSellerConfigurationError?error.code:'marketplace_private_product_read_denied',postgresCode:error instanceof MarketplaceSellerConfigurationError?error.postgresCode:null,productFingerprint:productId.slice(0,8),draftPresent:true});throw error;}}
      publicationStage='variant_configuration';log('variant_configuration_start',{variantMode:hasVariants});
      setSubmissionStage('Vinculando fotos…');
      if (hasVariants) {
        setSubmissionStage('Configurando variantes…');
        const payload: VariantConfiguration[] = variantDrafts.map(item => ({
          sku: item.sku, price: item.price, compare_at_price: item.compareAtPrice || null,
          status: item.active ? 'active' : 'inactive', is_default: item.isDefault,
          image_asset_id: item.imageAssetId, option_values: item.optionValues,
          on_hand: Number.parseInt(item.onHand, 10), low_stock_threshold: Number.parseInt(item.threshold, 10) || 0,
        }));
        await configureProductVariants(productId, parsedVariantOptions!, payload, configurationKeyRef.current);
      } else {
        setSubmissionStage('Configurando producto…');
        const inventory = recoveredInventory??await fetchSellerProductVariants(productId);
        const defaultVariant = inventory.detail.variants.find(item => item.is_default && item.status !== 'archived');
        if (!defaultVariant) throw new Error('marketplace_default_variant_missing');
        await updateVariant(defaultVariant.id, {
          sku: simpleSku, price: price.trim(), compareAtPrice: compareAtPrice.trim() || null,
          status: 'active', imageAssetId: null,
        });
        await setVariantLowStockThreshold(defaultVariant.id, Math.max(0, Number.parseInt(simpleThreshold, 10) || 0));
      }
      log('variant_configuration_success');publicationStage='shipping_assignment';log('shipping_assignment_start',{shippingProfilePresent:true});
      await setMyMarketplaceProductShippingProfile(productId, shippingProfileId);
      log('shipping_assignment_success');publicationStage='publication';
      const readiness=await evaluateMarketplaceProductPublication(productId);
      if(!readiness.ready)throw new MarketplacePublicationError('not_ready',readiness.reasonCode??'marketplace_publication_failed');
      setSubmissionStage('Publicando producto…');
      log('publication_rpc_start');
      await setProductPublished(productId, true);
      log('publication_rpc_success');
      if (affiliateEnabled) {
        publicationStage='affiliate_configuration';log('affiliate_configuration_start');
        setSubmissionStage('Configurando oferta para creadores...');
        try {
          await upsertMyLiveAffiliateOffer({
            productId,
            offerScope: 'public_creator',
            creatorId: null,
            commissionBps: creatorCommissionBps,
            status: 'active',
            startsAt: null,
            endsAt: null,
            idempotencyKey: affiliateKeyRef.current,
          });
          log('affiliate_configuration_success');
        } catch {
          setDraftProductId(null);
          draftAssetIdsRef.current = [];
          showAlert(
            'Producto publicado, afiliados pendientes',
            'El producto está disponible. Puedes reintentar la oferta sin publicar ni duplicar el producto.',
            [
              {
                text: 'Reintentar activar afiliados',
                onPress: () => {
                  void upsertMyLiveAffiliateOffer({
                    productId,
                    offerScope: 'public_creator',
                    creatorId: null,
                    commissionBps: creatorCommissionBps,
                    status: 'active',
                    startsAt: null,
                    endsAt: null,
                    idempotencyKey: affiliateKeyRef.current,
                  }).then(() => {
                    affiliateKeyRef.current = randomUUID();
                    showAlert('Afiliados activados', 'La oferta ya está disponible para futuras ventas.');
                  }).catch(() => {
                    showAlert('Afiliados pendientes', 'Configura la oferta desde Mis productos. El producto no se duplicó.');
                  });
                },
              },
              { text: 'Mis productos', onPress: () => router.replace('/seller/products' as never) },
            ],
          );
          return;
        }
      }
      setDraftProductId(null);
      draftAssetIdsRef.current = [];
      showAlert('¡Producto publicado!', 'Tu producto ya está disponible en Shop.', [
        { text: 'Mis productos', onPress: () => router.replace('/seller/products' as never) },
        ...(hasVariants
          ? [{ text: 'Ver variantes', onPress: () => router.replace(`/seller/product/${productId}/variants` as never) }]
          : []),
      ]);
    } catch (error) {
      const readinessMessage = marketplacePublicationMessage(error)??marketplaceSellerConfigurationMessage(error);
      const code=error instanceof MarketplacePublicationError?error.safeCode:error instanceof Error&&/^[a-z0-9_]+$/i.test(error.message)?error.message:'marketplace_publication_failed';
      if(__DEV__)console.warn('[CreateProduct] publication_failed',{stage:publicationStage,code,postgresCode:error instanceof MarketplacePublicationError?error.postgresCode:null,productFingerprint:activeDraftId?.slice(0,8)??null,shippingProfilePresent:Boolean(shippingProfileId),variantMode:hasVariants,imageCount:imageAssetIds.length});
      const message=readinessMessage??(code==='marketplace_sku_exists'?'Ese SKU ya existe en tu tienda.':code==='marketplace_publication_failed'?'No pudimos conectar con Marketplace. El borrador permanece guardado.':`No pudimos publicar el producto. Código: ${code}.`);
      showAlert('No se pudo publicar', message);
    } finally {
      publishLockRef.current = false;
      setIsPublishing(false);
      setSubmissionStage('');
    }
  };

  const handleBack = () => {
    if (step > 0 && !isPublishing) {
      setStep(current => current - 1);
      return;
    }
    if (!hasUnsavedData) {
      router.back();
      return;
    }
    Alert.alert(
      draftProductId ? 'Tu producto permanece privado' : 'Cambios sin guardar',
      draftProductId
        ? 'Puedes retomarlo desde Mis productos o continuar trabajando ahora.'
        : '¿Quieres salir? La información que escribiste en este formulario se perderá.',
      [{ text: 'Seguir editando', style: 'cancel' }, { text: 'Salir', style: 'destructive', onPress: () => router.back() }],
    );
  };

  const createShippingProfile = async () => {
    if (!store) return;
    const amount = Number(shippingPrice);
    if (!/^[A-Za-z]{2}$/.test(shippingCountry) || !Number.isFinite(amount) || amount < 0 || returnPolicy.trim().length < 2) {
      showAlert('Envío inválido', 'Revisa el país, el precio y la política de devolución.');
      return;
    }
    try {
      const profileId = await upsertMyMarketplaceShippingProfile({
        storeId: store.id, name: `Envío ${shippingCountry.toUpperCase()}`,
        processingDaysMin: 1, processingDaysMax: 3, shipsFromCountry: shippingCountry,
        returnPolicySummary: returnPolicy.trim(),
        regions: [{ countryCode: shippingCountry, regionCode: null, shippingPrice: amount,
          freeShippingThreshold: null, transitDaysMin: 2, transitDaysMax: 7 }],
      });
      const profiles = await fetchMyMarketplaceShippingProfiles(store.id);
      setShippingProfiles(profiles);
      setShippingProfileId(profileId);
      setShippingState('ready');
    } catch {
      showAlert('No se pudo guardar el envío', 'Revisa la configuración e inténtalo nuevamente.');
    }
  };

  const field = (
    label: string, value: string, onChangeText: (value: string) => void,
    options: { placeholder?: string; multiline?: boolean; maxLength?: number; keyboardType?: 'default' | 'decimal-pad' | 'number-pad'; error?: string; helper?: string } = {},
  ) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, options.multiline && styles.textarea, options.error && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder={options.placeholder}
        placeholderTextColor={Colors.textSubtle}
        multiline={options.multiline}
        maxLength={options.maxLength}
        keyboardType={options.keyboardType}
        accessibilityLabel={label}
      />
      {options.error ? <Text style={styles.errorText}>{options.error}</Text> : null}
      {options.helper ? <Text style={styles.helper}>{options.helper}</Text> : null}
      {options.maxLength ? <Text style={styles.charCount}>{value.length}/{options.maxLength}</Text> : null}
    </View>
  );

  const renderInformation = () => (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Crear producto</Text>
        <Text style={styles.heroSubtitle}>Agrega la información principal que verá el comprador.</Text>
      </View>
      <MarketplaceSectionCard icon="edit-note" title="Información principal">
        {field('Nombre del producto *', title, value => { setTitle(value); clearError('title'); }, {
          placeholder: 'Ej. Camiseta premium', maxLength: 80, error: errors.title,
        })}
        {field('Descripción *', description, value => { setDescription(value); clearError('description'); }, {
          placeholder: 'Cuenta qué hace especial a tu producto…', multiline: true, maxLength: 500, error: errors.description,
        })}
        {field('Marca (opcional)', brand, setBrand, { placeholder: 'Ej. ClipDAG Studio', maxLength: 80 })}
        {field('Etiquetas (opcional)', tags, setTags, {
          placeholder: 'moda, edición limitada, regalo',
          helper: 'Sepáralas por comas para ayudar a descubrir tu producto.',
        })}
      </MarketplaceSectionCard>
      <MarketplaceSectionCard icon="category" title="Categoría" subtitle="Elige dónde encontrarán tu producto.">
        <View style={styles.categoryGrid}>
          {categories.map(item => {
            const selected = category === item.slug;
            return (
              <Pressable
                key={item.id}
                onPress={() => { setCategory(item.slug); clearError('category'); }}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                style={[styles.categoryChip, selected && styles.categoryChipSelected]}
              >
                <MaterialIcons name={selected ? 'check-circle' : 'category'} size={18} color={selected ? Colors.textOnBrand : Colors.textSecondary} />
                <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{item.name}</Text>
              </Pressable>
            );
          })}
        </View>
        {errors.category ? <Text style={styles.errorText}>{errors.category}</Text> : null}
      </MarketplaceSectionCard>
    </>
  );

  const renderPhotos = () => (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Fotos del producto</Text>
        <Text style={styles.heroSubtitle}>Una buena portada ayuda a que tu producto destaque.</Text>
      </View>
      <MarketplaceSectionCard icon="photo-camera" title="Agrega hasta 5 fotos" subtitle="La primera foto será la portada del producto.">
        <Pressable
          onPress={handlePickImage}
          disabled={isUploadingImage || images.length >= MAX_PRODUCT_IMAGES}
          accessibilityRole="button"
          accessibilityLabel="Agregar foto del producto"
          style={({ pressed }) => [
            styles.uploadCard, (isUploadingImage || images.length >= MAX_PRODUCT_IMAGES) && styles.disabled, pressed && styles.pressed,
          ]}
        >
          <View style={styles.uploadIcon}>
            <MaterialIcons name={isUploadingImage ? 'cloud-upload' : 'add-photo-alternate'} size={32} color={Colors.primaryLight} />
          </View>
          <Text style={styles.uploadTitle}>
            {photoUploadProgress
              ? `Subiendo foto ${photoUploadProgress.current} de ${photoUploadProgress.total}…`
              : 'Seleccionar desde tu galería'}
          </Text>
          <Text style={styles.uploadSubtitle}>{images.length}/{MAX_PRODUCT_IMAGES} fotos agregadas</Text>
          {isUploadingImage ? <View style={styles.uploadProgress}><View style={styles.uploadProgressBar} /></View> : null}
        </Pressable>
        {images.length ? (
          <View style={styles.photoGrid}>
            {images.map((uri, index) => (
              <View key={imageAssetIds[index] ?? uri} style={styles.photoWrap}>
                <Image source={{ uri }} style={styles.photo} contentFit="cover" transition={180} />
                {index === 0 ? <View style={styles.coverBadge}><Text style={styles.coverText}>Portada</Text></View> : null}
                <Pressable
                  onPress={() => removeImage(index)}
                  accessibilityLabel={`Quitar foto ${index + 1}`}
                  style={styles.removePhoto}
                >
                  <MaterialIcons name="close" size={18} color={Colors.textPrimary} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyPhotos}>
            <MaterialIcons name="collections" size={24} color={Colors.textSubtle} />
            <Text style={styles.helper}>Puedes continuar y agregar fotos antes de publicar.</Text>
          </View>
        )}
      </MarketplaceSectionCard>
    </>
  );

  const renderSimpleProduct = () => (
    <MarketplaceSectionCard icon="payments" title="Precio e inventario" subtitle="Define cómo venderás esta única versión.">
      <View style={styles.twoColumns}>
        <View style={styles.column}>{field('Precio (BDAG) *', price, value => { setPrice(value); clearError('price'); }, {
          placeholder: '0.00', keyboardType: 'decimal-pad', error: errors.price,
          helper: 'Cantidad que pagará el comprador, con un máximo de 8 decimales.',
        })}</View>
        <View style={styles.column}>{field('Precio anterior', compareAtPrice, setCompareAtPrice, {
          placeholder: 'Opcional', keyboardType: 'decimal-pad',
        })}</View>
      </View>
      <View style={styles.twoColumns}>
        <View style={styles.column}>{field('Inventario inicial *', stock, value => { setStock(value); clearError('stock'); }, {
          placeholder: '0', keyboardType: 'number-pad', error: errors.stock,
          helper: 'Cantidad disponible al publicar.',
        })}</View>
        <View style={styles.column}>{field('Umbral de stock bajo', simpleThreshold, setSimpleThreshold, {
          placeholder: '0', keyboardType: 'number-pad',
        })}</View>
      </View>
      {field('SKU *', simpleSku, value => { setSimpleSku(value.toUpperCase()); clearError('sku'); }, {
        placeholder: 'Código interno único', error: errors.sku,
        helper: 'Código interno único para identificar este producto.',
      })}
      <Pressable style={styles.softButton} onPress={autoSimpleSku}>
        <MaterialIcons name="auto-awesome" size={18} color={Colors.primaryLight} />
        <Text style={styles.softButtonText}>Generar SKU automáticamente</Text>
      </Pressable>
    </MarketplaceSectionCard>
  );

  const renderOptionBuilder = () => (
    <MarketplaceSectionCard
      icon="tune"
      title="¿Qué opciones tiene tu producto?"
      subtitle="Puedes agregar hasta tres opciones, como color, talla, material, capacidad o estilo."
    >
      <View style={styles.suggestionWrap}>
        {OPTION_SUGGESTIONS.map(suggestion => (
          <Pressable
            key={suggestion}
            style={styles.suggestionChip}
            onPress={() => {
              const target = optionBuilders.find(option => !option.name.trim()) ?? optionBuilders[optionBuilders.length - 1];
              if (target) updateOptionName(target.id, suggestion);
            }}
          >
            <Text style={styles.suggestionText}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
      {optionBuilders.map((option, index) => (
        <View key={option.id} style={styles.optionCard}>
          <View style={styles.optionHeader}>
            <View>
              <Text style={styles.optionNumber}>OPCIÓN {index + 1}</Text>
              <Text style={styles.optionTitle}>{option.name.trim() || 'Nueva opción'}</Text>
            </View>
            <Pressable onPress={() => removeOption(option.id)} accessibilityLabel={`Quitar opción ${index + 1}`} style={styles.iconButton}>
              <MaterialIcons name="delete-outline" size={21} color={Colors.error} />
            </Pressable>
          </View>
          {field('Nombre de la opción', option.name, value => updateOptionName(option.id, value), {
            placeholder: 'Ej. Material', maxLength: 40,
          })}
          <View style={styles.valueComposer}>
            <TextInput
              value={option.draftValue}
              onChangeText={value => updateOptionDraft(option.id, value)}
              onSubmitEditing={() => addOptionValue(option.id)}
              returnKeyType="done"
              placeholder="Escribe un valor"
              placeholderTextColor={Colors.textSubtle}
              accessibilityLabel={`Nuevo valor para ${option.name || `opción ${index + 1}`}`}
              style={styles.valueInput}
            />
            <Pressable style={styles.addValueButton} onPress={() => addOptionValue(option.id)}>
              <Text style={styles.addValueText}>Agregar</Text>
            </Pressable>
          </View>
          <View style={styles.valueChips}>
            {option.values.map(value => (
              <View key={value.toLocaleLowerCase('es')} style={styles.valueChip}>
                <Text style={styles.valueChipText}>{value}</Text>
                <Pressable onPress={() => removeOptionValue(option.id, value)} accessibilityLabel={`Quitar ${value}`}>
                  <MaterialIcons name="close" size={16} color={Colors.primaryLight} />
                </Pressable>
              </View>
            ))}
          </View>
          {!option.values.length ? <Text style={styles.helper}>Agrega al menos un valor.</Text> : null}
        </View>
      ))}
      {optionBuilders.length < 3 ? (
        <Pressable style={styles.outlineButton} onPress={addOption}>
          <MaterialIcons name="add" size={20} color={Colors.primaryLight} />
          <Text style={styles.outlineButtonText}>Agregar otra opción</Text>
        </Pressable>
      ) : null}
      <View style={[styles.combinationCard, combinationEstimate > 100 && styles.combinationError]}>
        <MaterialIcons name="account-tree" size={22} color={combinationEstimate > 100 ? Colors.error : Colors.primaryLight} />
        <View style={{ flex: 1 }}>
          <Text style={styles.combinationTitle}>
            {combinationEstimate > 100 ? 'Demasiadas combinaciones' : `Se generarán ${combinationEstimate} variantes`}
          </Text>
          <Text style={styles.helper}>
            {combinationEstimate > 100
              ? 'Reduce la cantidad de valores. El máximo es 100 variantes.'
              : 'Cada combinación podrá tener su propio precio, SKU e inventario.'}
          </Text>
        </View>
      </View>
      {variantsNeedRegeneration ? (
        <View style={styles.warningCard}>
          <MaterialIcons name="warning-amber" size={21} color={Colors.warning} />
          <Text style={styles.warningText}>Las opciones cambiaron. Vuelve a generar antes de continuar.</Text>
        </View>
      ) : null}
      {errors.options ? <Text style={styles.errorText}>{errors.options}</Text> : null}
      <Pressable style={styles.primaryInlineButton} onPress={regenerateVariants}>
        <MaterialIcons name="auto-awesome" size={19} color={Colors.textOnBrand} />
        <Text style={styles.primaryInlineText}>{variantDrafts.length ? 'Volver a generar variantes' : 'Generar variantes'}</Text>
      </Pressable>
    </MarketplaceSectionCard>
  );

  const renderOptions = () => (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Elige el tipo de producto</Text>
        <Text style={styles.heroSubtitle}>Configura una sola versión o crea opciones para cada combinación.</Text>
      </View>
      <View style={styles.choiceStack}>
        <MarketplaceChoiceCard
          selected={!hasVariants} icon="inventory-2" title="Producto simple"
          description="Una sola versión con un precio e inventario general."
          onPress={() => chooseVariantMode(false)}
        />
        <MarketplaceChoiceCard
          selected={hasVariants} icon="style" title="Producto con variantes"
          description="Varias versiones, como colores, tallas, materiales o capacidades."
          onPress={() => chooseVariantMode(true)}
        />
      </View>
      {hasVariants ? renderOptionBuilder() : renderSimpleProduct()}
    </>
  );

  const renderVariantEditor = (variant: CreationVariantDraft, index: number) => (
    <>
      {field('SKU', variant.sku, value => updateVariantDraft(index, { sku: value.toUpperCase() }), {
        helper: 'Código interno único para identificar esta variante.',
      })}
      <View style={styles.twoColumns}>
        <View style={styles.column}>{field('Precio BDAG', variant.price, value => updateVariantDraft(index, { price: value }), {
          keyboardType: 'decimal-pad',
        })}</View>
        <View style={styles.column}>{field('Precio anterior', variant.compareAtPrice, value => updateVariantDraft(index, { compareAtPrice: value }), {
          keyboardType: 'decimal-pad', placeholder: 'Opcional',
        })}</View>
      </View>
      <View style={styles.twoColumns}>
        <View style={styles.column}>{field('Inventario inicial', variant.onHand, value => updateVariantDraft(index, { onHand: value }), {
          keyboardType: 'number-pad',
        })}</View>
        <View style={styles.column}>{field('Umbral bajo', variant.threshold, value => updateVariantDraft(index, { threshold: value }), {
          keyboardType: 'number-pad',
        })}</View>
      </View>
      {images.length ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Imagen de esta variante</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imageChoices}>
            <Pressable
              onPress={() => updateVariantDraft(index, { imageAssetId: null })}
              style={[styles.imageChoiceEmpty, !variant.imageAssetId && styles.imageChoiceSelected]}
            >
              <MaterialIcons name="collections" size={21} color={Colors.textSecondary} />
              <Text style={styles.imageChoiceText}>Portada</Text>
            </Pressable>
            {images.map((uri, imageIndex) => (
              <Pressable
                key={imageAssetIds[imageIndex]}
                onPress={() => updateVariantDraft(index, { imageAssetId: imageAssetIds[imageIndex] })}
                style={[styles.imageChoice, variant.imageAssetId === imageAssetIds[imageIndex] && styles.imageChoiceSelected]}
              >
                <Image source={{ uri }} style={styles.imageChoicePhoto} contentFit="cover" />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <Pressable
        onPress={() => updateVariantDraft(index, { active: !variant.active })}
        accessibilityRole="switch"
        accessibilityState={{ checked: variant.active }}
        style={styles.settingRow}
      >
        <View style={styles.settingCopy}>
          <Text style={styles.settingTitle}>Variante activa</Text>
          <Text style={styles.helper}>Estará disponible para el comprador al publicar.</Text>
        </View>
        <MaterialIcons name={variant.active ? 'toggle-on' : 'toggle-off'} size={40} color={variant.active ? Colors.success : Colors.textSubtle} />
      </Pressable>
      <Pressable
        onPress={() => setVariantDrafts(current => current.map((item, itemIndex) => ({ ...item, isDefault: itemIndex === index })))}
        accessibilityRole="radio"
        accessibilityState={{ checked: variant.isDefault }}
        style={[styles.settingRow, variant.isDefault && styles.defaultRow]}
      >
        <View style={styles.settingCopy}>
          <Text style={styles.settingTitle}>Mostrar primero</Text>
          <Text style={styles.helper}>Esta variante aparecerá seleccionada cuando el comprador abra el producto.</Text>
        </View>
        <MaterialIcons name={variant.isDefault ? 'star' : 'star-border'} size={28} color={variant.isDefault ? Colors.warning : Colors.textSubtle} />
      </Pressable>
    </>
  );

  const renderVariants = () => {
    if (!hasVariants) {
      return (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>Tu producto simple está listo</Text>
            <Text style={styles.heroSubtitle}>Revisa el precio, inventario y SKU antes de continuar.</Text>
          </View>
          {renderSimpleProduct()}
        </>
      );
    }
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Personaliza tus variantes</Text>
          <Text style={styles.heroSubtitle}>Abre solo la combinación que quieras editar.</Text>
        </View>
        <View style={styles.summaryChips}>
          <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{variantDrafts.length} variantes</Text></View>
          <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{activeVariantCount} activas</Text></View>
          <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{totalInventory} unidades</Text></View>
        </View>
        <Pressable style={styles.bulkButton} onPress={() => setBulkVisible(true)}>
          <MaterialIcons name="edit" size={19} color={Colors.primaryLight} />
          <Text style={styles.bulkButtonText}>Editar en grupo</Text>
          <Text style={styles.bulkButtonCount}>{variantDrafts.length}</Text>
        </Pressable>
        {errors.variants ? <Text style={styles.errorText}>{errors.variants}</Text> : null}
        <FlatList
          data={variantDrafts}
          scrollEnabled={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          keyExtractor={item => item.key}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          renderItem={({ item, index }) => (
            <MarketplaceVariantListItem
              label={item.optionValues.join(' / ')}
              sku={item.sku}
              price={item.price}
              inventory={item.onHand}
              active={item.active}
              imageUrl={item.imageAssetId ? images[imageAssetIds.indexOf(item.imageAssetId)] : images[0]}
              expanded={expandedVariantKey === item.key}
              onPress={() => setExpandedVariantKey(current => current === item.key ? null : item.key)}
            >
              {renderVariantEditor(item, index)}
            </MarketplaceVariantListItem>
          )}
        />
      </>
    );
  };

  const reviewRow = (icon: keyof typeof MaterialIcons.glyphMap, label: string, value: string, editStep: number) => (
    <View style={styles.reviewRow}>
      <View style={styles.reviewIcon}><MaterialIcons name={icon} size={20} color={Colors.primaryLight} /></View>
      <View style={styles.reviewCopy}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewValue}>{value}</Text>
      </View>
      <Pressable onPress={() => setStep(editStep)} accessibilityLabel={`Editar ${label}`} style={styles.editButton}>
        <Text style={styles.editText}>Editar</Text>
      </Pressable>
    </View>
  );
  const renderReview = () => {
    const categoryName = categories.find(item => item.slug === category)?.name ?? category;
    const reviewPrice = hasVariants
      ? minVariantPrice === maxVariantPrice ? `${minVariantPrice.toFixed(2)} BDAG` : `Desde ${minVariantPrice.toFixed(2)} BDAG`
      : `${Number(price || 0).toFixed(2)} BDAG`;
    return (
      <>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Todo listo para publicar</Text>
          <Text style={styles.heroSubtitle}>Revisa cómo se presentará tu producto antes de hacerlo público.</Text>
        </View>
        <View style={styles.previewCard}>
          <View style={styles.previewMedia}>
            {images[0]
              ? <Image source={{ uri: images[0] }} style={styles.previewImage} contentFit="cover" />
              : <MaterialIcons name="image" size={52} color={Colors.textSubtle} />}
            <View style={styles.previewType}><Text style={styles.previewTypeText}>{hasVariants ? 'CON VARIANTES' : 'SIMPLE'}</Text></View>
          </View>
          <View style={styles.previewBody}>
            <Text style={styles.previewCategory}>{categoryName.toUpperCase()}</Text>
            <Text style={styles.previewTitle}>{title}</Text>
            {brand ? <Text style={styles.previewBrand}>{brand}</Text> : null}
            <Text style={styles.previewPrice}>{reviewPrice}</Text>
            <View style={styles.previewStats}>
              <Text style={styles.previewStat}>{hasVariants ? variantDrafts.length : 1} {hasVariants ? 'variantes' : 'producto'}</Text>
              <Text style={styles.previewDot}>•</Text>
              <Text style={styles.previewStat}>{hasVariants ? totalInventory : Number(stock) || 0} unidades disponibles</Text>
            </View>
          </View>
        </View>
        <MarketplaceSectionCard icon="fact-check" title="Resumen">
          {reviewRow('edit-note', 'Información', `${title} · ${categoryName}`, 0)}
          {reviewRow('photo-library', 'Fotos', images.length ? `${images.length} fotos · primera como portada` : 'Sin fotos', 1)}
          {reviewRow('tune', 'Opciones', hasVariants
            ? optionBuilders.map(option => option.name).join(', ')
            : 'Producto simple', 2)}
          {reviewRow('inventory-2', 'Variantes', hasVariants
            ? `${activeVariantCount} activas · ${totalInventory} unidades`
            : `${price} BDAG · ${stock} unidades`, 3)}
        </MarketplaceSectionCard>
        <MarketplaceSectionCard icon="groups" title="Creadores afiliados">
          <Pressable
            style={styles.affiliateToggle}
            onPress={() => setAffiliateEnabled(current => !current)}
            accessibilityRole="switch"
            accessibilityState={{ checked: affiliateEnabled }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Permitir que otros creadores vendan este producto</Text>
              <Text style={styles.helper}>La comisión se congela al crear el pedido y no cambia ventas anteriores.</Text>
            </View>
            <MaterialIcons
              name={affiliateEnabled ? 'toggle-on' : 'toggle-off'}
              size={42}
              color={affiliateEnabled ? Colors.primaryLight : Colors.textSubtle}
            />
          </Pressable>
          {affiliateEnabled ? (
            <View style={styles.field}>
              <Text style={styles.settingTitle}>Comisión del creador (%)</Text>
              <TextInput
                style={styles.input}
                value={affiliatePercent}
                onChangeText={setAffiliatePercent}
                keyboardType="decimal-pad"
                accessibilityLabel="Porcentaje de comisión para creadores"
              />
              <Text style={styles.helper}>
                Entre 0.01% y 30%. El vendedor recibe el total menos la tarifa de plataforma y esta comisión.
              </Text>
            </View>
          ) : null}
        </MarketplaceSectionCard>
        <MarketplaceSectionCard icon="local-shipping" title="Envío">
          <Text style={styles.settingTitle}>Perfil de envío</Text>
          {shippingState==='loading'?<Text style={styles.helper}>Cargando perfiles de envío…</Text>:shippingState==='error'?<Text style={styles.errorText}>No pudimos cargar tus perfiles de envío.</Text>:shippingProfiles.length ? shippingProfiles.map(profile => (
            <Pressable
              key={profile.id}
              style={[styles.affiliateToggle, shippingProfileId === profile.id && { borderColor: Colors.primaryLight }]}
              onPress={() => setShippingProfileId(profile.id)}
              disabled={profile.configurationStatus !== 'explicit_ready'}
              accessibilityRole="radio"
              accessibilityState={{ checked: shippingProfileId === profile.id }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.settingTitle}>{profile.name}</Text>
                <Text style={styles.helper}>{profile.processingDaysMin}–{profile.processingDaysMax} días de preparación · {profile.regions.length ? `${profile.regions.length} destinos` : 'configuración heredada'}</Text>
                {profile.configurationStatus !== 'explicit_ready' ? <><Text style={styles.errorText}>Configura al menos un destino de envío para volver a aceptar compras.</Text><Pressable style={styles.recoveryRetry} onPress={()=>router.push({pathname:'/seller/shipping-profile',params:{storeId:store?.id??'',profileId:profile.id}} as never)}><Text style={styles.recoveryRetryText}>Configurar destinos</Text></Pressable></> : null}
                <Text style={styles.helper}>{profile.returnPolicySummary}</Text>
              </View>
              <MaterialIcons name={shippingProfileId === profile.id ? 'radio-button-checked' : 'radio-button-unchecked'} size={24} color={Colors.primaryLight} />
            </Pressable>
          )) : (
            <View style={styles.field}>
              <TextInput style={styles.input} value={shippingCountry} onChangeText={setShippingCountry} autoCapitalize="characters" maxLength={2} placeholder="País (US)" placeholderTextColor={Colors.textSubtle} />
              <TextInput style={styles.input} value={shippingPrice} onChangeText={setShippingPrice} keyboardType="decimal-pad" placeholder="Precio de envío BDAG" placeholderTextColor={Colors.textSubtle} />
              <TextInput style={[styles.input, { minHeight: 76 }]} value={returnPolicy} onChangeText={setReturnPolicy} multiline placeholder="Política de devolución" placeholderTextColor={Colors.textSubtle} />
              <Text style={styles.helper}>Preparación: 1–3 días · tránsito estimado: 2–7 días.</Text>
              <Pressable style={styles.recoveryRetry} onPress={() => void createShippingProfile()} accessibilityRole="button">
                <Text style={styles.recoveryRetryText}>Crear perfil de envío</Text>
              </Pressable>
            </View>
          )}
        </MarketplaceSectionCard>
        {draftProductId ? (
          <View style={styles.recoveryCard}>
            <View style={styles.recoveryIcon}><MaterialIcons name="lock" size={24} color={Colors.warning} /></View>
            <View style={styles.recoveryCopy}>
              <Text style={styles.recoveryTitle}>Tu producto permanece privado.</Text>
              <Text style={styles.helper}>Puedes reintentar la publicación sin crear otro producto ni duplicar movimientos.</Text>
            </View>
            <Pressable style={styles.recoveryRetry} onPress={handlePublish} disabled={isPublishing}>
              <Text style={styles.recoveryRetryText}>Reintentar publicación</Text>
            </Pressable>
            <Pressable
              onPress={() => Alert.alert('Eliminar borrador', 'Esta acción quitará el borrador privado.', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Eliminar', style: 'destructive', onPress: () => void deleteIncompleteDraft() },
              ])}
              disabled={isPublishing}
            >
              <Text style={styles.deleteDraftText}>Eliminar borrador</Text>
            </Pressable>
          </View>
        ) : null}
        {submissionStage ? (
          <View style={styles.submissionCard}>
            <MaterialIcons name="cloud-sync" size={24} color={Colors.primaryLight} />
            <View style={{ flex: 1 }}>
              <Text style={styles.submissionTitle}>{submissionStage}</Text>
              <Text style={styles.helper}>Mantén esta pantalla abierta. No volveremos a enviar el mismo paso.</Text>
            </View>
          </View>
        ) : null}
      </>
    );
  };

  const contents = [renderInformation, renderPhotos, renderOptions, renderVariants, renderReview][step]();
  const primaryDisabled = isPublishing
    || !accessReady
    || (step === 0 && (!title.trim() || !description.trim() || !category))
    || (step === 1 && isUploadingImage);

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.headerBack} accessibilityLabel={step ? 'Volver al paso anterior' : 'Salir de crear producto'}>
          <MaterialIcons name="arrow-back-ios-new" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Crear producto</Text>
        <View style={styles.headerBack} />
      </View>
      <MarketplaceCreationProgress current={step} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {contents}
        </ScrollView>
        <MarketplaceStickyFooter
          bottom={insets.bottom}
          secondaryLabel={step === 0 ? 'Salir' : 'Volver'}
          onSecondary={handleBack}
          primaryLabel={step === 4 ? (draftProductId ? 'Reintentar publicación' : 'Publicar producto') : 'Continuar'}
          onPrimary={step === 4 ? handlePublish : continueFlow}
          disabled={primaryDisabled}
          loading={isPublishing}
        />
      </KeyboardAvoidingView>
      <MarketplaceBulkEditSheet
        visible={bulkVisible}
        count={variantDrafts.length}
        price={bulkPrice}
        stock={bulkStock}
        onPriceChange={setBulkPrice}
        onStockChange={setBulkStock}
        onClose={() => setBulkVisible(false)}
        onApplyPrice={() => {
          if (!bulkPrice) return;
          Alert.alert('Aplicar precio', `Este precio se aplicará a ${variantDrafts.length} variantes.`, [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Aplicar', onPress: () => setVariantDrafts(current => current.map(item => ({ ...item, price: bulkPrice }))) },
          ]);
        }}
        onApplyStock={() => {
          if (!bulkStock) return;
          Alert.alert('Aplicar inventario', `Este inventario se aplicará a ${variantDrafts.length} variantes.`, [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Aplicar', onPress: () => setVariantDrafts(current => current.map(item => ({ ...item, onHand: bulkStock }))) },
          ]);
        }}
        onGenerateSkus={() => setVariantDrafts(current => current.map((item, index) => ({
          ...item, sku: generateVariantSku(`${title}-${skuSeedRef.current}`, item.optionValues, index),
        })))}
        onActivateAll={() => setVariantDrafts(current => current.map(item => ({ ...item, active: true })))}
        onDeactivateAll={() => Alert.alert('Desactivar todas', 'Ninguna variante estará disponible al publicar.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Desactivar', style: 'destructive', onPress: () => setVariantDrafts(current => current.map(item => ({ ...item, active: false }))) },
        ])}
        onClearCompareAt={() => setVariantDrafts(current => current.map(item => ({ ...item, compareAtPrice: '' })))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  header: { height: 52, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  scrollContent: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.md },
  hero: { gap: 6, paddingVertical: Spacing.sm },
  heroTitle: { color: Colors.textPrimary, fontSize: FontSize.xxl, lineHeight: 31, fontWeight: FontWeight.extrabold },
  heroSubtitle: { color: Colors.textSecondary, fontSize: FontSize.md, lineHeight: 22 },
  field: { gap: 7 },
  fieldLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  input: { minHeight: 52, paddingHorizontal: Spacing.md, paddingVertical: 13, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated, color: Colors.textPrimary, fontSize: FontSize.md },
  textarea: { minHeight: 124, textAlignVertical: 'top' },
  inputError: { borderColor: Colors.error },
  errorText: { color: Colors.error, fontSize: FontSize.sm, lineHeight: 19 },
  helper: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19 },
  charCount: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  categoryChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated },
  categoryChipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  categoryText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  categoryTextSelected: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
  uploadCard: { minHeight: 176, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primaryGlow, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.sm },
  uploadIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primaryGlow, alignItems: 'center', justifyContent: 'center' },
  uploadTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  uploadSubtitle: { color: Colors.textSecondary, fontSize: FontSize.sm },
  uploadProgress: { width: '72%', height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: Colors.surfaceHighlight },
  uploadProgressBar: { width: '68%', height: 4, backgroundColor: Colors.primaryLight },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photoWrap: { width: '48%', aspectRatio: 1, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surfaceElevated },
  photo: { width: '100%', height: '100%' },
  coverBadge: { position: 'absolute', bottom: 8, left: 8, paddingHorizontal: 9, paddingVertical: 5, borderRadius: Radius.full, backgroundColor: Colors.primary },
  coverText: { color: Colors.textOnBrand, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  removePhoto: { position: 'absolute', top: 8, right: 8, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,15,.78)' },
  emptyPhotos: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.72 },
  choiceStack: { gap: Spacing.sm },
  twoColumns: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  column: { flex: 1 },
  softButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: Radius.md, backgroundColor: Colors.primaryDim },
  softButtonText: { color: Colors.primaryLight, fontWeight: FontWeight.semibold },
  suggestionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  suggestionChip: { minHeight: 38, paddingHorizontal: 12, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.primaryGlow, justifyContent: 'center', backgroundColor: Colors.primaryDim },
  suggestionText: { color: Colors.primaryLight, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  optionCard: { borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.borderSubtle },
  optionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionNumber: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1 },
  optionTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginTop: 3 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceHighlight },
  valueComposer: { flexDirection: 'row', gap: Spacing.sm },
  valueInput: { flex: 1, minHeight: 48, borderRadius: Radius.md, paddingHorizontal: Spacing.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, color: Colors.textPrimary },
  addValueButton: { minWidth: 88, minHeight: 48, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  addValueText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
  valueChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  valueChip: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: Radius.full, backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primaryGlow },
  valueChipText: { color: Colors.textPrimary, fontSize: FontSize.sm },
  outlineButton: { minHeight: 50, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primaryGlow, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  outlineButtonText: { color: Colors.primaryLight, fontWeight: FontWeight.semibold },
  combinationCard: { padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.primaryDim, flexDirection: 'row', gap: 12, alignItems: 'center' },
  combinationError: { backgroundColor: Colors.secondaryDim },
  combinationTitle: { color: Colors.textPrimary, fontWeight: FontWeight.bold, marginBottom: 3 },
  warningCard: { padding: 12, borderRadius: Radius.md, backgroundColor: Colors.warningDim, flexDirection: 'row', alignItems: 'center', gap: 9 },
  warningText: { flex: 1, color: Colors.warning, fontSize: FontSize.sm },
  primaryInlineButton: { minHeight: 52, borderRadius: Radius.md, backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...Shadow.brand },
  primaryInlineText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
  summaryChips: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  summaryChip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated },
  summaryChipText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  bulkButton: { minHeight: 54, paddingHorizontal: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.primaryDim, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: Colors.primaryGlow },
  bulkButtonText: { flex: 1, color: Colors.primaryLight, fontWeight: FontWeight.bold },
  bulkButtonCount: { color: Colors.textOnBrand, fontWeight: FontWeight.bold, minWidth: 28, textAlign: 'center', paddingVertical: 5, borderRadius: Radius.full, backgroundColor: Colors.primary },
  imageChoices: { gap: 9 },
  imageChoice: { width: 62, height: 62, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  imageChoicePhoto: { width: 58, height: 58 },
  imageChoiceEmpty: { width: 70, height: 62, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: Colors.surfaceElevated, borderWidth: 2, borderColor: 'transparent' },
  imageChoiceSelected: { borderColor: Colors.primary },
  imageChoiceText: { color: Colors.textSecondary, fontSize: 9 },
  settingRow: { minHeight: 68, padding: 12, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  defaultRow: { backgroundColor: Colors.warningDim, borderWidth: 1, borderColor: Colors.warning },
  settingCopy: { flex: 1, gap: 3 },
  settingTitle: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  previewCard: { borderRadius: Radius.xl, overflow: 'hidden', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle, ...Shadow.card },
  previewMedia: { height: 220, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '100%' },
  previewType: { position: 'absolute', left: 12, top: 12, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: Colors.overlay },
  previewTypeText: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: .8 },
  previewBody: { padding: Spacing.lg, gap: 5 },
  previewCategory: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1 },
  previewTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.extrabold },
  previewBrand: { color: Colors.textSecondary, fontSize: FontSize.sm },
  previewPrice: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, marginTop: 8 },
  previewStats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 4 },
  previewStat: { color: Colors.textSecondary, fontSize: FontSize.sm },
  previewDot: { color: Colors.textSubtle },
  reviewRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle },
  reviewIcon: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryDim },
  reviewCopy: { flex: 1, gap: 3 },
  reviewLabel: { color: Colors.textSecondary, fontSize: FontSize.xs },
  reviewValue: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  editButton: { minWidth: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  editText: { color: Colors.primaryLight, fontWeight: FontWeight.semibold, fontSize: FontSize.sm },
  affiliateToggle: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  recoveryCard: { padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.warningDim, borderWidth: 1, borderColor: Colors.warning, gap: Spacing.sm },
  recoveryIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.warningDim, alignItems: 'center', justifyContent: 'center' },
  recoveryCopy: { gap: 3 },
  recoveryTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  recoveryRetry: { minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.warning },
  recoveryRetryText: { color: Colors.textInverse, fontWeight: FontWeight.bold },
  deleteDraftText: { color: Colors.error, fontWeight: FontWeight.semibold, textAlign: 'center', padding: 8 },
  submissionCard: { padding: Spacing.md, borderRadius: Radius.lg, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.primaryDim },
  submissionTitle: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
});
