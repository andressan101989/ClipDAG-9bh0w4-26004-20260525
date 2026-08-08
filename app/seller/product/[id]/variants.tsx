import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {
  ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,TextInput,View,
} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {useLocalSearchParams,useRouter} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {SellerScreenHeader} from '@/components/marketplace/SellerScreenHeader';
import {Colors,FontSize,FontWeight,Radius,Spacing} from '@/constants/theme';
import {useAlert} from '@/template';
import {
  adjustVariantInventory,archiveVariant,configureProductVariants,
  fetchSellerProductVariants,setDefaultVariant,setVariantInventory,
  setVariantLowStockThreshold,updateVariant,
  type SellerProductInventory,type VariantConfiguration,
} from '@/services/marketplaceService';
import {
  cartesianVariantValues,estimateVariantCount,generateVariantSku,parseVariantOptions,
  VariantDraftValidationError,
} from '@/services/marketplaceVariantDraft';

type DraftOption={name:string;valuesText:string};
type DraftVariant={
  id?:string;sku:string;price:string;compareAtPrice:string;active:boolean;isDefault:boolean;
  optionValues:string[];onHand:string;setOnHand:string;threshold:string;adjustment:string;imageAssetId:string|null;
};

const errorMessage=(error:unknown)=>{
  const message=error&&typeof error==='object'&&'message' in error?String((error as {message:unknown}).message):'';
  if(message.includes('marketplace_sku_exists')) return 'Ese SKU ya existe en tu tienda.';
  if(message.includes('marketplace_duplicate_combination')) return 'Hay una combinación duplicada.';
  if(message.includes('marketplace_existing_inventory_requires_inventory_action'))
    return 'El inventario de una variante existente debe cambiarse con Establecer o Ajustar.';
  if(message.includes('marketplace_invalid_inventory_quantity')) return 'El inventario no puede quedar negativo.';
  return 'Verifica los datos e inténtalo nuevamente.';
};
export default function SellerVariantsScreen(){
  const {id}=useLocalSearchParams<{id:string}>();const router=useRouter();
  const insets=useSafeAreaInsets();const {showAlert}=useAlert();
  const [data,setData]=useState<SellerProductInventory|null>(null);
  const [options,setOptions]=useState<DraftOption[]>([]);
  const [variants,setVariants]=useState<DraftVariant[]>([]);
  const [loading,setLoading]=useState(true);const [dirty,setDirty]=useState(false);
  const [saving,setSaving]=useState(false);const [showAdvanced,setShowAdvanced]=useState(false);const actionLock=useRef(false);

  const hydrate=useCallback((payload:SellerProductInventory)=>{
    const labels=new Map<string,string>();
    payload.detail.options.forEach(option=>option.values.forEach(value=>labels.set(value.id,value.value)));
    const inventory=new Map(payload.inventory.map(level=>[level.variant_id,level]));
    setData(payload);
    setOptions(payload.detail.options.map(option=>({
      name:option.name,valuesText:option.values.map(value=>value.value).join(', '),
    })));
    setVariants(payload.detail.variants.filter(item=>item.status!=='archived').map(item=>({
      id:item.id,sku:item.sku??'',price:String(item.price),
      compareAtPrice:item.compare_at_price==null?'':String(item.compare_at_price),
      active:item.status==='active',isDefault:item.is_default,
      imageAssetId:item.image_asset_id,
      optionValues:item.option_value_ids.map(valueId=>labels.get(valueId)??''),
      onHand:String(inventory.get(item.id)?.on_hand??0),
      setOnHand:String(inventory.get(item.id)?.on_hand??0),
      threshold:String(inventory.get(item.id)?.low_stock_threshold??0),adjustment:'',
    })));
    setDirty(false);
  },[]);
  const reload=useCallback(async()=>{
    setLoading(true);
    try{hydrate(await fetchSellerProductVariants(id));}
    catch{showAlert('Producto no disponible','No puedes administrar este producto.');router.back();}
    finally{setLoading(false);}
  },[hydrate,id,router,showAlert]);
  useEffect(()=>{void reload();},[reload]);

  const leave=()=>dirty?Alert.alert('Cambios sin guardar','¿Salir y descartar los cambios?',[
    {text:'Cancelar',style:'cancel'},{text:'Salir',style:'destructive',onPress:()=>router.back()},
  ]):router.back();
  const updateDraft=(index:number,patch:Partial<DraftVariant>)=>{
    setVariants(current=>current.map((item,i)=>i===index?{...item,...patch}:item));setDirty(true);
  };
  const parsedOptions=useMemo(()=>options.map(option=>({
    name:option.name.trim(),values:option.valuesText.split(',').map(value=>value.trim()).filter(Boolean),
  })),[options]);
  const isPublished=Boolean((data?.detail.product as unknown as {published_at?:string|null})?.published_at);
  const generate=()=>{
    if(isPublished&&variants.some(item=>item.id)){
      showAlert('Protegemos tus variantes','Para un producto publicado, edita precio y stock por combinación o archiva variantes desde Opciones avanzadas. No reemplazaremos combinaciones con historial.');return;
    }
    let validated;
    try{validated=parseVariantOptions(options);}
    catch(error){
      showAlert('Opciones incompletas',error instanceof VariantDraftValidationError?error.message:
        'Agrega entre una y tres opciones con valores.');return;
    }
    const combinations=cartesianVariantValues(validated.map(option=>option.values));
    if(combinations.length>100){showAlert('Demasiadas variantes','El máximo es 100 combinaciones.');return;}
    const perform=()=>{
      if(__DEV__)console.info('[ProductVariants]',{operation:'generate',optionCount:validated.length,combinationCount:combinations.length});
      const base=data?.detail.product.price??1;
      const prefix=`${data?.detail.product.title??'PRODUCTO'}-${id.slice(0,8)}`;
      setVariants(combinations.map((values,index)=>({
        sku:generateVariantSku(prefix,values,index),price:String(base),compareAtPrice:'',active:true,
        isDefault:index===0,optionValues:values,onHand:'0',setOnHand:'0',threshold:'0',adjustment:'',imageAssetId:null,
      })));setDirty(true);
    };
    if(variants.some(item=>item.id)||dirty){
      Alert.alert('Volver a generar variantes',
        'Cambiar las opciones volverá a generar las variantes y puede descartar cambios sin guardar.',[
          {text:'Cancelar',style:'cancel'},{text:'Continuar',style:'destructive',onPress:perform},
        ]);return;
    }
    perform();
  };
  const saveConfiguration=async()=>{
    if(saving||actionLock.current)return;
    if(variants.length<1){showAlert('Variante requerida','Debe existir al menos una variante.');return;}
    setSaving(true);actionLock.current=true;
    try{
      const payload:VariantConfiguration[]=variants.map(item=>({
        id:item.id,sku:item.sku,price:item.price,
        compare_at_price:item.compareAtPrice||null,status:item.active?'active':'inactive',
        is_default:item.isDefault,option_values:item.optionValues,
        image_asset_id:item.imageAssetId,
        on_hand:Math.max(0,Number.parseInt(item.onHand,10)||0),
        low_stock_threshold:Math.max(0,Number.parseInt(item.threshold,10)||0),
      }));
      await configureProductVariants(id,parsedOptions,payload,randomUUID());
      if(__DEV__)console.info('[ProductVariants]',{operation:'save_success',variantCount:payload.length});
      showAlert('Variantes guardadas','Las variantes fueron guardadas y las proyecciones del producto se actualizaron.');
      await reload();
    }catch(error){if(__DEV__)console.info('[ProductVariants]',{operation:'save_failed',code:error instanceof Error?error.message:null});showAlert('No se pudo guardar',errorMessage(error));}
    finally{setSaving(false);actionLock.current=false;}
  };
  const saveVariant=async(index:number)=>{
    const item=variants[index];if(!item.id||actionLock.current)return;actionLock.current=true;
    try{
      await updateVariant(item.id,{sku:item.sku,price:item.price,
        compareAtPrice:item.compareAtPrice||null,status:item.active?'active':'inactive',
        imageAssetId:item.imageAssetId});
      await setVariantLowStockThreshold(item.id,Math.max(0,Number.parseInt(item.threshold,10)||0));
      if(item.setOnHand!==item.onHand)await setVariantInventory(item.id,Math.max(0,Number.parseInt(item.setOnHand,10)||0),'Conteo del vendedor',randomUUID());
      showAlert('Variante actualizada','Los cambios fueron guardados.');await reload();
    }catch(error){showAlert('No se pudo actualizar',errorMessage(error));}
    finally{actionLock.current=false;}
  };
  const inventoryAction=async(index:number,adjust:boolean)=>{
    const item=variants[index];if(!item.id||actionLock.current)return;actionLock.current=true;
    const key=randomUUID();
    try{
      if(adjust)await adjustVariantInventory(item.id,Number.parseInt(item.adjustment,10)||0,'Ajuste del vendedor',key);
      else await setVariantInventory(item.id,Math.max(0,Number.parseInt(item.setOnHand,10)||0),'Conteo del vendedor',key);
      await reload();
    }catch(error){showAlert('Inventario no actualizado',errorMessage(error));}
    finally{actionLock.current=false;}
  };
  const makeDefault=async(index:number)=>{
    const item=variants[index];if(!item.id||actionLock.current)return;
    actionLock.current=true;try{await setDefaultVariant(item.id);await reload();}
    catch(error){showAlert('No se pudo cambiar',errorMessage(error));}
    finally{actionLock.current=false;}
  };
  const confirmArchive=(index:number)=>{
    const item=variants[index];if(!item.id)return;
    const replacement=variants.find(candidate=>candidate.id!==item.id&&candidate.id);
    Alert.alert('Archivar variante','La variante desaparecerá del catálogo público.',[
      {text:'Cancelar',style:'cancel'},{text:'Archivar',style:'destructive',onPress:async()=>{
        try{await archiveVariant(item.id!,item.isDefault?replacement?.id:null);await reload();}
        catch(error){showAlert('No se pudo archivar',errorMessage(error));}
      }},
    ]);
  };

  if(loading)return <View style={[s.page,s.center,{paddingTop:insets.top}]}><ActivityIndicator color={Colors.primary}/></View>;
  return <View style={[s.page,{paddingTop:insets.top}]}>
    <SellerScreenHeader title="Variantes e inventario" fallbackRoute={`/seller/product/${id}/edit` as never} onBack={leave}/>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.summary}>
        <Text style={s.section}>{options.length?'Producto con variantes':'Producto simple'}</Text>
        <Text style={s.muted}>{options.length
          ?`${variants.filter(item=>item.active).length} combinaciones · ${options.length} opciones`
          :'Este producto no tiene opciones. Solo configura precio y stock.'}</Text>
      </View>
      <Text style={s.section}>¿Tu producto tiene opciones como talla o color?</Text>
      <View style={s.row}>
        <Pressable style={[s.pill,!options.length&&s.pillActive]} onPress={()=>{if(options.length&&variants.some(item=>item.id)){showAlert('Conservamos tus variantes','Archiva las combinaciones existentes desde Opciones avanzadas antes de convertir el producto.');return;}if(__DEV__)console.info('[ProductVariants]',{operation:'mode_changed',mode:'simple'});setOptions([]);setDirty(true);}}><Text style={s.pillText}>No</Text></Pressable>
        <Pressable style={[s.pill,options.length>0&&s.pillActive]} onPress={()=>{
          if(options.length)return;if(__DEV__)console.info('[ProductVariants]',{operation:'mode_changed',mode:'variants'});
        Alert.alert('Convertir en producto con variantes',
          'Se generarán nuevas combinaciones. El producto, sus fotos y la propiedad del vendedor se conservarán.',[
            {text:'Cancelar',style:'cancel'},{text:'Continuar',onPress:()=>{setOptions([{name:'Color',valuesText:''}]);setDirty(true);}},
          ]);
        }}><Text style={s.pillText}>Sí</Text></Pressable>
      </View>
      {options.length?<><Text style={s.section}>1. ¿Qué varía?</Text><View style={s.imageChoices}>{['Color','Talla','Material','Capacidad','Estilo'].map(template=><Pressable key={template} style={s.pill} onPress={()=>{setOptions(current=>current.map((item,index)=>index===0?{...item,name:template}:item));setDirty(true);}}><Text style={s.pillText}>{template}</Text></Pressable>)}</View><Text style={s.muted}>Escribe los valores separados por comas. Ejemplo: Negro, Blanco, Azul.</Text></>:null}
      {options.map((option,index)=><View key={index} style={s.card}>
        <TextInput style={s.input} value={option.name} placeholder="Color, Talla o Material"
          placeholderTextColor={Colors.textSubtle} maxLength={40}
          onChangeText={name=>{setOptions(current=>current.map((item,i)=>i===index?{...item,name}:item));setDirty(true);}}/>
        <TextInput style={s.input} value={option.valuesText} placeholder="Negro, Blanco, Azul"
          placeholderTextColor={Colors.textSubtle}
          onChangeText={valuesText=>{setOptions(current=>current.map((item,i)=>i===index?{...item,valuesText}:item));setDirty(true);}}/>
        <Pressable onPress={()=>{setOptions(current=>current.filter((_,i)=>i!==index));setDirty(true);}}>
          <Text style={s.danger}>Quitar opción</Text>
        </Pressable>
      </View>)}
      {options.length<3?<Pressable style={s.outline} onPress={()=>{
        setOptions(current=>[...current,{name:'',valuesText:''}]);setDirty(true);
      }}><Text style={s.outlineText}>Agregar opción</Text></Pressable>:null}
      {options.length>0?<><Text style={s.muted}>Se crearán {estimateVariantCount(options)} variantes.</Text>
        <Pressable style={s.outline} onPress={generate}><Text style={s.outlineText}>
          {variants.some(item=>item.id)?'Actualizar combinaciones':'Generar variantes'}</Text></Pressable><Text style={s.muted}>Cambiar las opciones puede reemplazar combinaciones que todavía no hayas guardado.</Text></>:null}

      <Text style={s.section}>{options.length?'2. Precio y stock por combinación':'Precio y stock'}</Text>
      <Pressable style={s.outline} onPress={()=>setShowAdvanced(value=>!value)}><Text style={s.outlineText}>{showAdvanced?'Ocultar opciones avanzadas':'Opciones avanzadas'}</Text></Pressable>
      {variants.map((variant,index)=><View key={variant.id??`${index}-${variant.optionValues.join('-')}`} style={s.card}>
        {variant.optionValues.length?<Text style={s.variantTitle}>{variant.optionValues.join(' / ')}</Text>:<Text style={s.variantTitle}>Producto simple</Text>}
        <Text style={s.label}>Precio (BDAG)</Text><TextInput style={s.input} value={variant.price} placeholder="Precio BDAG"
          placeholderTextColor={Colors.textSubtle} keyboardType="decimal-pad" onChangeText={price=>updateDraft(index,{price})}/>
        {showAdvanced?<><Text style={s.label}>SKU (código interno)</Text><Text style={s.muted}>Puedes dejar el código generado automáticamente.</Text><TextInput style={s.input} value={variant.sku} placeholder="SKU generado automáticamente" placeholderTextColor={Colors.textSubtle}
          autoCapitalize="characters" onChangeText={sku=>updateDraft(index,{sku})}/>
        <TextInput style={s.input} value={variant.compareAtPrice} placeholder="Precio anterior"
            placeholderTextColor={Colors.textSubtle} keyboardType="decimal-pad"
            onChangeText={compareAtPrice=>updateDraft(index,{compareAtPrice})}/>
        <View style={s.row}>
          <Pressable style={[s.pill,variant.active&&s.pillActive]} onPress={()=>updateDraft(index,{active:!variant.active})}>
            <Text style={s.pillText}>{variant.active?'Activa':'Inactiva'}</Text>
          </Pressable>
          <Pressable style={[s.pill,variant.isDefault&&s.pillActive]} onPress={()=>variant.id?void makeDefault(index):
            setVariants(current=>current.map((item,i)=>({...item,isDefault:i===index})))}>
            <Text style={s.pillText}>Variante principal</Text>
          </Pressable>
        </View>
        {data?.mediaAssets.length?<View style={s.imageChoices}>
          <Pressable style={[s.pill,!variant.imageAssetId&&s.pillActive]}
            onPress={()=>updateDraft(index,{imageAssetId:null})}><Text style={s.pillText}>Imagen general</Text></Pressable>
          {data.mediaAssets.map((asset,assetIndex)=><Pressable key={asset.id}
            style={[s.pill,variant.imageAssetId===asset.id&&s.pillActive]}
            onPress={()=>updateDraft(index,{imageAssetId:asset.id})}>
            <Text style={s.pillText}>Imagen {assetIndex+1}</Text>
          </Pressable>)}
        </View>:null}</>:null}
        <Text style={s.label}>Stock</Text>
        {variant.id?<><TextInput style={s.input} value={variant.setOnHand} keyboardType="number-pad"
            onChangeText={setOnHand=>setVariants(current=>current.map((item,i)=>i===index?{...item,setOnHand}:item))}/>
          {showAdvanced?<><Text style={s.label}>Corrección rápida</Text><Text style={s.muted}>Úsalo para registrar entradas, daños o correcciones.</Text>
          <View style={s.row}><TextInput style={[s.input,s.flex]} value={variant.adjustment} keyboardType="numbers-and-punctuation"
            placeholder="+5 o -2" placeholderTextColor={Colors.textSubtle}
            onChangeText={adjustment=>setVariants(current=>current.map((item,i)=>i===index?{...item,adjustment}:item))}/>
            <Pressable style={s.smallButton} onPress={()=>void inventoryAction(index,true)}>
              <Text style={s.buttonText}>Aplicar</Text></Pressable></View></>:null}</>:
          <TextInput style={s.input} value={variant.onHand} keyboardType="number-pad"
            onChangeText={onHand=>updateDraft(index,{onHand,setOnHand:onHand})}/>}
        {showAdvanced?<><TextInput style={s.input} value={variant.threshold} keyboardType="number-pad"
          placeholder="Umbral de stock bajo" placeholderTextColor={Colors.textSubtle}
          onChangeText={threshold=>updateDraft(index,{threshold})}/>
        {variant.id?<Pressable style={s.outline} onPress={()=>confirmArchive(index)}><Text style={s.danger}>Archivar variante</Text></Pressable>:null}</>:null}
        {variant.id?<Pressable style={s.outline} onPress={()=>void saveVariant(index)}><Text style={s.outlineText}>Guardar precio y stock</Text></Pressable>:null}
      </View>)}
      <Pressable disabled={saving} style={[s.button,saving&&s.disabled]} onPress={()=>void saveConfiguration()}>
        <Text style={s.buttonText}>{saving?'Guardando…':'Guardar configuración'}</Text>
      </Pressable>
      <Text style={s.section}>Movimientos de inventario</Text>
      {data?.movements.map(movement=><View key={movement.id} style={s.history}>
        <Text style={s.historyTitle}>{movement.movement_type} · {movement.delta>=0?'+':''}{movement.delta}</Text>
        <Text style={s.muted}>{new Date(movement.created_at).toLocaleString()} · Resultado {movement.resulting_on_hand}</Text>
        {movement.reason?<Text style={s.muted}>{movement.reason}</Text>:null}
      </View>)}
    </ScrollView>
  </View>;
}

const s=StyleSheet.create({
  page:{flex:1,backgroundColor:Colors.bg},center:{alignItems:'center',justifyContent:'center'},
  content:{padding:Spacing.lg,paddingBottom:80,gap:Spacing.md},
  summary:{backgroundColor:Colors.primary+'12',borderWidth:1,borderColor:Colors.primary,
    borderRadius:Radius.lg,padding:Spacing.md,gap:Spacing.xs},
  section:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold,marginTop:Spacing.sm},
  card:{backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.lg,padding:Spacing.md,gap:Spacing.sm},
  input:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,padding:Spacing.md,color:Colors.textPrimary},
  readOnly:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,padding:Spacing.md,opacity:.75},
  readOnlyText:{color:Colors.textSecondary},
  row:{flexDirection:'row',gap:Spacing.sm,alignItems:'center'},flex:{flex:1},
  outline:{borderWidth:1,borderColor:Colors.primary,borderRadius:Radius.md,padding:Spacing.md,alignItems:'center',flex:1},
  outlineText:{color:Colors.primary,fontWeight:FontWeight.bold},
  button:{backgroundColor:Colors.primary,borderRadius:Radius.md,padding:Spacing.md,alignItems:'center'},
  smallButton:{backgroundColor:Colors.primary,borderRadius:Radius.md,padding:Spacing.md},
  buttonText:{color:'#000',fontWeight:FontWeight.bold},disabled:{opacity:.5},
  danger:{color:Colors.secondary,fontWeight:FontWeight.bold},
  variantTitle:{color:Colors.textPrimary,fontWeight:FontWeight.bold},
  label:{color:Colors.textSecondary,fontSize:FontSize.sm},
  pill:{borderWidth:1,borderColor:Colors.border,borderRadius:Radius.full,paddingHorizontal:12,paddingVertical:8},
  pillActive:{backgroundColor:Colors.primary+'33',borderColor:Colors.primary},
  pillText:{color:Colors.textPrimary,fontSize:FontSize.xs},
  imageChoices:{flexDirection:'row',flexWrap:'wrap',gap:Spacing.sm},
  history:{borderBottomWidth:1,borderBottomColor:Colors.border,paddingVertical:Spacing.sm,gap:3},
  historyTitle:{color:Colors.textPrimary,fontWeight:FontWeight.semibold},muted:{color:Colors.textSubtle,fontSize:FontSize.xs},
});
