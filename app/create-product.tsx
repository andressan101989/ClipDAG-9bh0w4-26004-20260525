import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Alert, View, Text, ScrollView, Pressable, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { useShop } from '@/hooks/useShop';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { detectMimeType } from '@/contexts/FeedContext';
import { deleteMediaAsset, getSafeMediaError, uploadMediaFromUri } from '@/services/mediaService';
import type { ProductCategory } from '@/contexts/ShopContext';
import {
  configureProductVariants,createProductDraft,fetchCategories,fetchSellerFoundation,
  setProductPublished,softDeleteProduct,type MarketplaceCategoryRecord,type MarketplaceStore,
  type VariantConfiguration,
} from '@/services/marketplaceService';
import {
  estimateVariantCount,generateCreationVariants,generateVariantSku,parseVariantOptions,
  validateCreationVariants,VariantDraftValidationError,
  type CreationVariantDraft,type VariantDraftOption,
} from '@/services/marketplaceVariantDraft';

export default function CreateProductScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { createProduct } = useShop();
  const { showAlert } = useAlert();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [compareAtPrice,setCompareAtPrice]=useState('');
  const [brand,setBrand]=useState('');
  const [category, setCategory] = useState<ProductCategory>('physical');
  const [categories,setCategories]=useState<MarketplaceCategoryRecord[]>([]);
  const [store,setStore]=useState<MarketplaceStore|null>(null);
  const [accessReady,setAccessReady]=useState(false);
  const [stock, setStock] = useState('1');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isUnlimitedStock, setIsUnlimitedStock] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageAssetIds, setImageAssetIds] = useState<string[]>([]);
  const [hasVariants,setHasVariants]=useState(false);
  const [variantOptions,setVariantOptions]=useState<VariantDraftOption[]>([]);
  const [variantDrafts,setVariantDrafts]=useState<CreationVariantDraft[]>([]);
  const [bulkPrice,setBulkPrice]=useState('');
  const [bulkStock,setBulkStock]=useState('');
  const [draftProductId,setDraftProductId]=useState<string|null>(null);
  const configurationKeyRef=useRef(randomUUID());
  const skuSeedRef=useRef(randomUUID().slice(0,8).toUpperCase());
  const draftAssetIdsRef = useRef<string[]>([]);
  const publishLockRef = useRef(false);

  useEffect(()=>{
    let active=true;
    void Promise.all([fetchSellerFoundation(),fetchCategories()]).then(([foundation,activeCategories])=>{
      if(!active)return;
      if(foundation.seller?.status!=='approved'||!foundation.store||foundation.store.status!=='active'){
        router.replace('/seller' as never);return;
      }
      setStore(foundation.store);setCategories(activeCategories);setAccessReady(true);
    }).catch(()=>{if(active)router.replace('/seller' as never);});
    return()=>{active=false;};
  },[router]);

  useEffect(() => () => {
    const abandoned = [...draftAssetIdsRef.current];
    draftAssetIdsRef.current = [];
    for (const assetId of abandoned) void deleteMediaAsset(assetId).catch(() => {});
  }, []);

  const removeImage = useCallback((index: number) => {
    const assetId = imageAssetIds[index];
    setImages(prev => prev.filter((_, itemIndex) => itemIndex !== index));
    setImageAssetIds(prev => prev.filter((_, itemIndex) => itemIndex !== index));
    draftAssetIdsRef.current = draftAssetIdsRef.current.filter(id => id !== assetId);
    if (assetId) void deleteMediaAsset(assetId).catch(() => {});
  }, [imageAssetIds]);

  const handlePickImage = useCallback(async () => {
    if (images.length >= 4) { showAlert('Máximo 4 imágenes', 'Ya tienes el máximo de fotos'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permiso denegado', 'Habilita el acceso a la galería'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0] || !user) return;

    setIsUploadingImage(true);
    const asset = result.assets[0];
    const mimeType = asset.mimeType || detectMimeType(asset.uri, 'image/jpeg');
    try {
      const uploaded = await uploadMediaFromUri({
        uri: asset.uri,
        purpose: 'product_image',
        mimeType,
        fileName: asset.fileName || undefined,
        sizeBytes: asset.fileSize,
        visibility: 'public',
      });
      if (!uploaded.url?.startsWith('https://')) throw new Error('invalid_ready_media_url');
      setImages(prev => [...prev, uploaded.url!]);
      setImageAssetIds(prev => [...prev, uploaded.assetId]);
      draftAssetIdsRef.current = [...draftAssetIdsRef.current, uploaded.assetId];
    } catch (error) {
      const safe = getSafeMediaError(error, 'MEDIA_UNKNOWN', { mimeType });
      console.warn('[CreateProduct] product image upload failed', {
        operationId: safe.operationId,
        stage: safe.stage,
        code: safe.code,
        message: safe.message,
        mimeType: safe.mimeType,
      });
      const normalizedCode = `${safe.code} ${safe.message}`.toLowerCase();
      const message = safe.code === 'image_normalization_failed' || normalizedCode.includes('invalid_mime')
        ? 'No se pudo procesar este formato de imagen.'
        : normalizedCode.includes('invalid_size') || normalizedCode.includes('size')
          ? 'La imagen supera el tamaño permitido.'
          : normalizedCode.includes('unauthorized') || normalizedCode.includes('jwt') || safe.httpStatus === 401
            ? 'Tu sesión expiró. Inicia sesión nuevamente.'
            : safe.stage === 'MEDIA_R2_PUT'
              ? 'No se pudo transferir la imagen.'
              : safe.stage === 'MEDIA_FINALIZE'
                ? 'La imagen subió, pero no pudo finalizarse.'
                : 'No se pudo subir la imagen.';
      showAlert('Error', `${message}\nCódigo: ${safe.stage}/${safe.code}`);
    } finally {
      setIsUploadingImage(false);
    }
  }, [images, user, showAlert]);

  const combinationEstimate=estimateVariantCount(variantOptions);
  const updateVariantDraft=(index:number,patch:Partial<CreationVariantDraft>)=>{
    setVariantDrafts(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,...patch}:item));
  };
  const regenerateVariants=useCallback(()=>{
    const perform=()=>{
      try{
        setVariantDrafts(generateCreationVariants(variantOptions,{
          price:price.trim(),stock:String(Math.max(0,Number.parseInt(stock,10)||0)),
          skuPrefix:`${title}-${skuSeedRef.current}`,
        }));
      }catch(error){
        const message=error instanceof VariantDraftValidationError?error.message:'Revisa los nombres y valores de las opciones.';
        showAlert('No se pueden generar las variantes',message);
      }
    };
    if(variantDrafts.length){
      Alert.alert(
        'Volver a generar variantes',
        'Cambiar las opciones volverá a generar las variantes y puede descartar cambios sin guardar.',
        [{text:'Cancelar',style:'cancel'},{text:'Continuar',style:'destructive',onPress:perform}],
      );
    }else perform();
  },[price,showAlert,stock,title,variantDrafts.length,variantOptions]);
  const deleteIncompleteDraft=useCallback(async(productId?:string|null)=>{
    const targetId=productId??draftProductId;
    if(!targetId||publishLockRef.current)return;
    publishLockRef.current=true;setIsPublishing(true);
    try{
      await softDeleteProduct(targetId);
      setDraftProductId(null);configurationKeyRef.current=randomUUID();
      setVariantDrafts([]);
      showAlert('Borrador eliminado','Puedes corregir la información y comenzar nuevamente.');
    }catch{
      showAlert('No se pudo eliminar','El borrador sigue privado. Inténtalo nuevamente desde Mis productos.');
    }finally{publishLockRef.current=false;setIsPublishing(false);}
  },[draftProductId,showAlert]);
  const chooseVariantMode=(next:boolean)=>{
    if(draftProductId){
      showAlert('Borrador privado creado','Reintenta o elimina el borrador antes de cambiar el tipo de producto.');
      return;
    }
    if(!next&&variantDrafts.length){
      Alert.alert('Cambiar a producto simple','Se descartarán las variantes sin guardar.',[
        {text:'Cancelar',style:'cancel'},
        {text:'Cambiar',style:'destructive',onPress:()=>{setHasVariants(false);setVariantDrafts([]);setVariantOptions([]);}},
      ]);
      return;
    }
    setHasVariants(next);
    if(next&&variantOptions.length===0)setVariantOptions([{name:'',valuesText:''}]);
  };

  const handlePublish = useCallback(async () => {
    if (publishLockRef.current || isPublishing) return;
    if (!user) { showAlert('Inicia sesión', 'Necesitas una cuenta para vender'); return; }
    if (!title.trim()) { showAlert('Título requerido', 'Ingresa un título para tu producto'); return; }
    if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(price.trim()) || Number(price) <= 0) {
      showAlert('Precio inválido', 'Usa un precio BDAG positivo con un máximo de 8 decimales.');
      return;
    }
    if(compareAtPrice&&(!/^\d{1,12}(?:\.\d{1,8})?$/.test(compareAtPrice.trim())||
      Number(compareAtPrice)<Number(price))){
      showAlert('Precio anterior inválido','Debe ser igual o mayor al precio actual.');
      return;
    }
    if (!description.trim()) { showAlert('Descripción requerida', 'Describe tu producto'); return; }
    const categoryRow=categories.find(item=>item.slug===category);
    if(!store||!categoryRow||!accessReady){
      showAlert('Vendedor no habilitado','Completa y activa tu tienda antes de publicar.');
      return;
    }

    let parsedVariantOptions;
    if(hasVariants){
      try{
        parsedVariantOptions=parseVariantOptions(variantOptions);
        validateCreationVariants(variantDrafts);
      }catch(error){
        showAlert('Variantes incompletas',error instanceof VariantDraftValidationError?error.message:
          'Genera y revisa todas las variantes antes de publicar.');
        return;
      }
    }

    publishLockRef.current = true;
    setIsPublishing(true);
    let activeDraftId=draftProductId;
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      const productInput={
        storeId:store.id,
        categoryId:categoryRow.id,
        title: title.trim(),
        description: description.trim(),
        price:price.trim(),
        brand:brand.trim()||undefined,
        compareAtPrice:compareAtPrice.trim()||null,
        assetIds:imageAssetIds,
        stock: isUnlimitedStock ? 9999 : Math.max(1, parseInt(stock) || 1),
        tags: tagList,
      };
      if(hasVariants){
        let productId=activeDraftId;
        if(!productId){
          productId=await createProductDraft({...productInput,stock:0});
          activeDraftId=productId;
          setDraftProductId(productId);
          draftAssetIdsRef.current=[];
        }
        const payload:VariantConfiguration[]=variantDrafts.map(item=>({
          sku:item.sku,price:item.price,compare_at_price:item.compareAtPrice||null,
          status:item.active?'active':'inactive',is_default:item.isDefault,
          image_asset_id:item.imageAssetId,option_values:item.optionValues,
          on_hand:Number.parseInt(item.onHand,10),low_stock_threshold:Number.parseInt(item.threshold,10)||0,
        }));
        await configureProductVariants(productId,parsedVariantOptions!,payload,configurationKeyRef.current);
        await setProductPublished(productId,true);
        setDraftProductId(null);draftAssetIdsRef.current=[];
        showAlert('¡Producto con variantes publicado!','Las opciones, precios e inventario ya están disponibles.',[
          {text:'Mis productos',onPress:()=>router.replace('/seller/products' as never)},
          {text:'Ver variantes',onPress:()=>router.replace(`/seller/product/${productId}/variants` as never)},
        ]);
        return;
      }
      const result = await createProduct(productInput);

      if (result.success) {
        if (!result.product) {
          await Promise.all(imageAssetIds.map(assetId => deleteMediaAsset(assetId).catch(() => {})));
          draftAssetIdsRef.current = [];
          setImages([]);
          setImageAssetIds([]);
          showAlert('Error', 'El producto no devolvió una identidad válida.');
          return;
        }
        draftAssetIdsRef.current = [];
        showAlert('¡Producto publicado!', 'Tu producto ya está disponible en la tienda', [
          { text: 'Mis productos', onPress: () => router.replace('/seller/products' as never) },
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        await Promise.all(imageAssetIds.map(assetId => deleteMediaAsset(assetId).catch(() => {})));
        draftAssetIdsRef.current = [];
        setImages([]);
        setImageAssetIds([]);
        showAlert('Error', result.error || 'No se pudo publicar el producto');
      }
    }catch(error){
      if(hasVariants&&activeDraftId){
        showAlert('El borrador sigue privado','No se completó la configuración. Reintenta con los mismos datos o elimina el borrador.',[
          {text:'Cerrar'},
          {text:'Eliminar borrador',style:'destructive',onPress:()=>void deleteIncompleteDraft(activeDraftId)},
        ]);
      }else if(hasVariants){
        const message=error instanceof Error&&error.message.includes('marketplace_sku_exists')
          ?'Uno de los SKU ya existe en tu tienda. Corrígelo y reintenta.'
          :'Conservamos tus datos. Reintenta para completar el producto.';
        showAlert('No se pudo completar',message);
      }else throw error;
    } finally {
      publishLockRef.current = false;
      setIsPublishing(false);
    }
  }, [isPublishing,user,title,description,price,compareAtPrice,category,stock,isUnlimitedStock,imageAssetIds,
    tags,createProduct,router,showAlert,categories,store,accessReady,brand,hasVariants,variantOptions,
    variantDrafts,draftProductId,deleteIncompleteDraft]);
  const handleBack=()=>{
    if(draftProductId){
      Alert.alert('Borrador privado','El borrador seguirá en Mis productos para que puedas retomarlo o eliminarlo.',[
        {text:'Seguir editando',style:'cancel'},{text:'Salir',onPress:()=>router.back()},
      ]);return;
    }
    if(title||description||price||images.length||variantDrafts.length){
      Alert.alert('Cambios sin guardar','¿Salir y descartar la información de este producto?',[
        {text:'Cancelar',style:'cancel'},{text:'Salir',style:'destructive',onPress:()=>router.back()},
      ]);return;
    }
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={handleBack} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Crear Producto</Text>
        <View style={{ width: 30 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 + insets.bottom }]}>

          {/* Images */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Imágenes del producto</Text>
            <Text style={styles.sectionSub}>Hasta 4 fotos. La primera será la portada.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imagesRow}>
              {images.map((img, i) => (
                <View key={i} style={styles.imageThumbWrap}>
                  <Image source={{ uri: img }} style={styles.imageThumb} contentFit="cover" transition={200} />
                  {i === 0 ? (
                    <View style={styles.primaryBadge}><Text style={styles.primaryBadgeText}>Portada</Text></View>
                  ) : null}
                  <Pressable
                    style={styles.removeImgBtn}
                    onPress={() => removeImage(i)}
                  >
                    <MaterialIcons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {images.length < 4 ? (
                <Pressable
                  style={[styles.addImgBtn, isUploadingImage && { opacity: 0.5 }]}
                  onPress={handlePickImage}
                  disabled={isUploadingImage}
                >
                  <MaterialIcons name={isUploadingImage ? 'hourglass-empty' : 'add-photo-alternate'} size={28} color={Colors.primary} />
                  <Text style={styles.addImgText}>{isUploadingImage ? 'Subiendo...' : 'Agregar foto'}</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>

          {/* Basic info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Información básica</Text>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Título *</Text>
              <TextInput
                style={styles.fieldInput}
                value={title}
                onChangeText={setTitle}
                placeholder="Nombre del producto"
                placeholderTextColor={Colors.textSubtle}
                maxLength={80}
              />
              <Text style={styles.charCount}>{title.length}/80</Text>
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Descripción *</Text>
              <TextInput
                style={[styles.fieldInput, { height: 100, textAlignVertical: 'top' }]}
                value={description}
                onChangeText={setDescription}
                placeholder="Describe detalladamente tu producto..."
                placeholderTextColor={Colors.textSubtle}
                multiline
                maxLength={500}
              />
              <Text style={styles.charCount}>{description.length}/500</Text>
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Marca</Text>
              <TextInput style={styles.fieldInput} value={brand} onChangeText={setBrand}
                placeholder="Opcional" placeholderTextColor={Colors.textSubtle} maxLength={80}/>
            </View>
          </View>

          {/* Category */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Categoría</Text>
            <View style={styles.categoryGrid}>
              {categories.map(cat => (
                <Pressable
                  key={cat.id}
                  style={[styles.catBtn, category === cat.slug && styles.catBtnActive]}
                  onPress={() => setCategory(cat.slug)}
                >
                  <MaterialIcons
                    name="category"
                    size={18}
                    color={category === cat.slug ? '#000' : Colors.textSecondary}
                  />
                  <Text style={[styles.catBtnText, category === cat.slug && styles.catBtnTextActive]}>
                    {cat.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Price & Stock */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Precio y stock</Text>
            <View style={styles.rowFields}>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Precio (BDAG) *</Text>
                <View style={styles.priceInput}>
                  <Text style={styles.priceDollar}>BDAG</Text>
                  <TextInput
                    style={[styles.fieldInput, { flex: 1, borderWidth: 0, paddingHorizontal: 0 }]}
                    value={price}
                    onChangeText={setPrice}
                    placeholder="0.00"
                    placeholderTextColor={Colors.textSubtle}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              {!isUnlimitedStock ? (
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Stock</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={stock}
                    onChangeText={setStock}
                    placeholder="1"
                    placeholderTextColor={Colors.textSubtle}
                    keyboardType="number-pad"
                  />
                </View>
              ) : null}
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Stock ilimitado</Text>
              <Switch
                value={isUnlimitedStock}
                onValueChange={setIsUnlimitedStock}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Precio anterior (BDAG)</Text>
              <TextInput style={styles.fieldInput} value={compareAtPrice} onChangeText={setCompareAtPrice}
                placeholder="Opcional" placeholderTextColor={Colors.textSubtle} keyboardType="decimal-pad"/>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tipo de producto</Text>
            <Text style={styles.sectionSub}>¿Este producto tiene variantes?</Text>
            <Text style={styles.helper}>Usa variantes cuando el mismo producto se vende en diferentes colores, tallas, materiales, capacidades u otras opciones.</Text>
            <Pressable style={[styles.modeCard,!hasVariants&&styles.modeCardActive]} onPress={()=>chooseVariantMode(false)}>
              <MaterialIcons name={!hasVariants?'radio-button-checked':'radio-button-unchecked'} size={20} color={Colors.primary}/>
              <View style={styles.modeCopy}><Text style={styles.modeTitle}>No, es un producto simple</Text>
                <Text style={styles.sectionSub}>Un precio y un inventario para todo el producto.</Text></View>
            </Pressable>
            <Pressable style={[styles.modeCard,hasVariants&&styles.modeCardActive]} onPress={()=>chooseVariantMode(true)}>
              <MaterialIcons name={hasVariants?'radio-button-checked':'radio-button-unchecked'} size={20} color={Colors.primary}/>
              <View style={styles.modeCopy}><Text style={styles.modeTitle}>Sí, tiene opciones como color, talla o material</Text>
                <Text style={styles.sectionSub}>Cada combinación puede tener su propio SKU, precio e inventario.</Text></View>
            </Pressable>
          </View>

          {hasVariants?<>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Opciones</Text>
              <Text style={styles.helper}>Sugerencias: Color, Talla, Material, Capacidad, Modelo o Estilo. También puedes escribir cualquier otro nombre válido.</Text>
              {variantOptions.map((option,index)=><View key={index} style={styles.variantCard}>
                <Text style={styles.fieldLabel}>Nombre de la opción {index+1}</Text>
                <TextInput style={styles.fieldInput} value={option.name}
                  placeholder="Ej. Capacidad" placeholderTextColor={Colors.textSubtle} maxLength={40}
                  onChangeText={name=>setVariantOptions(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,name}:item))}/>
                <Text style={styles.fieldLabel}>Valores separados por comas</Text>
                <TextInput style={styles.fieldInput} value={option.valuesText}
                  placeholder="Ej. 64 GB, 128 GB, 256 GB" placeholderTextColor={Colors.textSubtle}
                  onChangeText={valuesText=>setVariantOptions(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,valuesText}:item))}/>
                <Pressable onPress={()=>setVariantOptions(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>
                  <Text style={styles.dangerText}>Quitar opción</Text>
                </Pressable>
              </View>)}
              {variantOptions.length<3?<Pressable style={styles.outlineButton}
                onPress={()=>setVariantOptions(current=>[...current,{name:'',valuesText:''}])}>
                <Text style={styles.outlineText}>Agregar otra opción</Text>
              </Pressable>:null}
              <Text style={styles.estimate}>Se crearán {combinationEstimate} variantes</Text>
              <Pressable style={styles.outlineButton} onPress={regenerateVariants}>
                <Text style={styles.outlineText}>{variantDrafts.length?'Regenerar variantes':'Generar variantes'}</Text>
              </Pressable>
            </View>

            {variantDrafts.length?<View style={styles.section}>
              <Text style={styles.sectionTitle}>Variantes</Text>
              <Text style={styles.helper}>Configura cada combinación antes de publicar. El SKU es un código interno único para identificar esta variante.</Text>
              <View style={styles.variantCard}>
                <Text style={styles.modeTitle}>Acciones rápidas</Text>
                <View style={styles.rowFields}><TextInput style={[styles.fieldInput,{flex:1}]} value={bulkPrice}
                  onChangeText={setBulkPrice} placeholder="Precio para todas" placeholderTextColor={Colors.textSubtle}
                  keyboardType="decimal-pad"/>
                  <Pressable style={styles.smallAction} onPress={()=>setVariantDrafts(current=>current.map(item=>({...item,price:bulkPrice})))}>
                    <Text style={styles.smallActionText}>Aplicar</Text></Pressable></View>
                <View style={styles.rowFields}><TextInput style={[styles.fieldInput,{flex:1}]} value={bulkStock}
                  onChangeText={setBulkStock} placeholder="Stock para todas" placeholderTextColor={Colors.textSubtle}
                  keyboardType="number-pad"/>
                  <Pressable style={styles.smallAction} onPress={()=>setVariantDrafts(current=>current.map(item=>({...item,onHand:bulkStock})))}>
                    <Text style={styles.smallActionText}>Aplicar</Text></Pressable></View>
                <View style={styles.bulkWrap}>
                  <Pressable style={styles.miniPill} onPress={()=>setVariantDrafts(current=>current.map((item,index)=>({
                    ...item,sku:generateVariantSku(`${title}-${skuSeedRef.current}`,item.optionValues,index),
                  })))}><Text style={styles.miniPillText}>Generar SKU</Text></Pressable>
                  <Pressable style={styles.miniPill} onPress={()=>setVariantDrafts(current=>current.map(item=>({...item,active:true})))}>
                    <Text style={styles.miniPillText}>Activar todas</Text></Pressable>
                  <Pressable style={styles.miniPill} onPress={()=>setVariantDrafts(current=>current.map(item=>({...item,compareAtPrice:''})))}>
                    <Text style={styles.miniPillText}>Limpiar precios anteriores</Text></Pressable>
                </View>
              </View>
              {variantDrafts.map((variant,index)=><View key={variant.key} style={styles.variantCard}>
                <Text style={styles.variantHeading}>{variant.optionValues.join(' / ')}</Text>
                <Text style={styles.fieldLabel}>SKU</Text>
                <TextInput style={styles.fieldInput} value={variant.sku} autoCapitalize="characters"
                  onChangeText={sku=>updateVariantDraft(index,{sku})}/>
                <View style={styles.rowFields}>
                  <View style={{flex:1}}><Text style={styles.fieldLabel}>Precio BDAG</Text><TextInput
                    style={styles.fieldInput} value={variant.price} keyboardType="decimal-pad"
                    onChangeText={value=>updateVariantDraft(index,{price:value})}/></View>
                  <View style={{flex:1}}><Text style={styles.fieldLabel}>Precio anterior</Text><TextInput
                    style={styles.fieldInput} value={variant.compareAtPrice} keyboardType="decimal-pad"
                    onChangeText={value=>updateVariantDraft(index,{compareAtPrice:value})}/></View>
                </View>
                <View style={styles.rowFields}>
                  <View style={{flex:1}}><Text style={styles.fieldLabel}>Inventario inicial</Text><TextInput
                    style={styles.fieldInput} value={variant.onHand} keyboardType="number-pad"
                    onChangeText={value=>updateVariantDraft(index,{onHand:value})}/></View>
                  <View style={{flex:1}}><Text style={styles.fieldLabel}>Umbral bajo</Text><TextInput
                    style={styles.fieldInput} value={variant.threshold} keyboardType="number-pad"
                    onChangeText={value=>updateVariantDraft(index,{threshold:value})}/></View>
                </View>
                <Text style={styles.sectionSub}>Cantidad disponible al publicar el producto.</Text>
                {imageAssetIds.length?<View style={styles.bulkWrap}>
                  <Pressable style={[styles.miniPill,!variant.imageAssetId&&styles.miniPillActive]}
                    onPress={()=>updateVariantDraft(index,{imageAssetId:null})}><Text style={styles.miniPillText}>Imagen general</Text></Pressable>
                  {imageAssetIds.map((assetId,imageIndex)=><Pressable key={assetId}
                    style={[styles.miniPill,variant.imageAssetId===assetId&&styles.miniPillActive]}
                    onPress={()=>updateVariantDraft(index,{imageAssetId:assetId})}>
                    <Text style={styles.miniPillText}>Foto {imageIndex+1}</Text></Pressable>)}
                </View>:null}
                <View style={styles.bulkWrap}>
                  <Pressable style={[styles.miniPill,variant.active&&styles.miniPillActive]}
                    onPress={()=>updateVariantDraft(index,{active:!variant.active})}>
                    <Text style={styles.miniPillText}>{variant.active?'Activa':'Inactiva'}</Text></Pressable>
                  <Pressable style={[styles.miniPill,variant.isDefault&&styles.miniPillActive]}
                    onPress={()=>setVariantDrafts(current=>current.map((item,itemIndex)=>({...item,isDefault:itemIndex===index})))}>
                    <Text style={styles.miniPillText}>Variante predeterminada</Text></Pressable>
                </View>
                <Text style={styles.sectionSub}>Se mostrará primero cuando el comprador abra el producto.</Text>
              </View>)}
            </View>:null}
          </>:null}

          {draftProductId?<View style={styles.draftBanner}>
            <Text style={styles.modeTitle}>Borrador privado guardado</Text>
            <Text style={styles.helper}>El producto no es público. Reintenta para completar sus variantes o elimínalo de forma segura.</Text>
            <Pressable style={styles.outlineButton} onPress={()=>void deleteIncompleteDraft()}>
              <Text style={styles.dangerText}>Eliminar borrador incompleto</Text>
            </Pressable>
          </View>:null}

          {/* Tags */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Etiquetas</Text>
            <TextInput
              style={styles.fieldInput}
              value={tags}
              onChangeText={setTags}
              placeholder="nft, arte, digital (separadas por comas)"
              placeholderTextColor={Colors.textSubtle}
            />
          </View>

          <CyberButton
            label={isPublishing?'Procesando...':draftProductId?'Reintentar y publicar':hasVariants?'Revisar y publicar variantes':'Publicar producto'}
            onPress={handlePublish}
            loading={isPublishing}
            size="lg"
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  scroll: { padding: Spacing.md, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  sectionSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  imagesRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  imageThumbWrap: { position: 'relative', borderRadius: Radius.sm, overflow: 'hidden' },
  imageThumb: { width: 90, height: 90, borderRadius: Radius.sm },
  primaryBadge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,212,255,0.8)', paddingVertical: 3, alignItems: 'center',
  },
  primaryBadgeText: { color: '#000', fontSize: 9, fontWeight: FontWeight.bold },
  removeImgBtn: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.full, padding: 3,
  },
  addImgBtn: {
    width: 90, height: 90, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.primary + '44',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addImgText: { color: Colors.primary, fontSize: 10, textAlign: 'center' },
  formField: { gap: Spacing.xs },
  fieldLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  fieldInput: {
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    color: Colors.textPrimary, fontSize: FontSize.md, height: 52,
  },
  charCount: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  catBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: Colors.border,
  },
  catBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  catBtnTextActive: { color: '#000', fontWeight: FontWeight.bold },
  rowFields: { flexDirection: 'row', gap: Spacing.md },
  priceInput: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 52,
  },
  priceDollar: { color: Colors.primary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, marginRight: 4 },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  switchLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
  helper:{color:Colors.textSecondary,fontSize:FontSize.sm,lineHeight:20},
  modeCard:{flexDirection:'row',alignItems:'flex-start',gap:Spacing.sm,padding:Spacing.md,
    borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,backgroundColor:Colors.surfaceElevated},
  modeCardActive:{borderColor:Colors.primary,backgroundColor:Colors.primary+'12'},
  modeCopy:{flex:1,gap:4},modeTitle:{color:Colors.textPrimary,fontWeight:FontWeight.semibold},
  variantCard:{backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,
    borderRadius:Radius.lg,padding:Spacing.md,gap:Spacing.sm},
  outlineButton:{borderWidth:1,borderColor:Colors.primary,borderRadius:Radius.md,padding:Spacing.md,alignItems:'center'},
  outlineText:{color:Colors.primary,fontWeight:FontWeight.bold},
  dangerText:{color:Colors.secondary,fontWeight:FontWeight.bold},
  estimate:{color:Colors.textPrimary,fontWeight:FontWeight.semibold,textAlign:'center'},
  variantHeading:{color:Colors.textPrimary,fontWeight:FontWeight.bold,fontSize:FontSize.md},
  smallAction:{backgroundColor:Colors.primary,borderRadius:Radius.md,paddingHorizontal:Spacing.md,justifyContent:'center'},
  smallActionText:{color:'#000',fontWeight:FontWeight.bold},
  bulkWrap:{flexDirection:'row',flexWrap:'wrap',gap:Spacing.sm},
  miniPill:{borderWidth:1,borderColor:Colors.border,borderRadius:Radius.full,paddingHorizontal:12,paddingVertical:9},
  miniPillActive:{borderColor:Colors.primary,backgroundColor:Colors.primary+'22'},
  miniPillText:{color:Colors.textPrimary,fontSize:FontSize.xs},
  draftBanner:{gap:Spacing.sm,padding:Spacing.md,borderRadius:Radius.lg,borderWidth:1,
    borderColor:Colors.primary,backgroundColor:Colors.primary+'12'},
});
