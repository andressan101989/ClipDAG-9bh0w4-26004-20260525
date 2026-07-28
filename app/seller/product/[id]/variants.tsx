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

type DraftOption={name:string;valuesText:string};
type DraftVariant={
  id?:string;sku:string;price:string;compareAtPrice:string;active:boolean;isDefault:boolean;
  optionValues:string[];onHand:string;threshold:string;adjustment:string;imageAssetId:string|null;
};

const errorMessage=(error:unknown)=>{
  const message=error&&typeof error==='object'&&'message' in error?String((error as {message:unknown}).message):'';
  if(message.includes('marketplace_sku_exists')) return 'Ese SKU ya existe en tu tienda.';
  if(message.includes('marketplace_duplicate_combination')) return 'Hay una combinación duplicada.';
  if(message.includes('marketplace_invalid_inventory_quantity')) return 'El inventario no puede quedar negativo.';
  return 'Verifica los datos e inténtalo nuevamente.';
};
const cartesian=(groups:string[][])=>groups.reduce<string[][]>(
  (result,group)=>result.flatMap(prefix=>group.map(value=>[...prefix,value])),[[]],
);

export default function SellerVariantsScreen(){
  const {id}=useLocalSearchParams<{id:string}>();const router=useRouter();
  const insets=useSafeAreaInsets();const {showAlert}=useAlert();
  const [data,setData]=useState<SellerProductInventory|null>(null);
  const [options,setOptions]=useState<DraftOption[]>([]);
  const [variants,setVariants]=useState<DraftVariant[]>([]);
  const [loading,setLoading]=useState(true);const [dirty,setDirty]=useState(false);
  const [saving,setSaving]=useState(false);const actionLock=useRef(false);

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
  const generate=()=>{
    if(parsedOptions.length<1||parsedOptions.length>3||parsedOptions.some(option=>!option.name||!option.values.length)){
      showAlert('Opciones incompletas','Agrega entre una y tres opciones con valores.');return;
    }
    const combinations=cartesian(parsedOptions.map(option=>option.values));
    if(combinations.length>100){showAlert('Demasiadas variantes','El máximo es 100 combinaciones.');return;}
    const base=data?.detail.product.price??1;
    setVariants(combinations.map((values,index)=>({
      sku:`VAR-${index+1}`,price:String(base),compareAtPrice:'',active:true,
      isDefault:index===0,optionValues:values,onHand:'0',threshold:'0',adjustment:'',imageAssetId:null,
    })));setDirty(true);
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
      showAlert('Variantes guardadas','Precio e inventario del producto fueron recalculados.');
      await reload();
    }catch(error){showAlert('No se pudo guardar',errorMessage(error));}
    finally{setSaving(false);actionLock.current=false;}
  };
  const saveVariant=async(index:number)=>{
    const item=variants[index];if(!item.id||actionLock.current)return;actionLock.current=true;
    try{
      await updateVariant(item.id,{sku:item.sku,price:item.price,
        compareAtPrice:item.compareAtPrice||null,status:item.active?'active':'inactive',
        imageAssetId:item.imageAssetId});
      await setVariantLowStockThreshold(item.id,Math.max(0,Number.parseInt(item.threshold,10)||0));
      showAlert('Variante actualizada','Los cambios fueron guardados.');await reload();
    }catch(error){showAlert('No se pudo actualizar',errorMessage(error));}
    finally{actionLock.current=false;}
  };
  const inventoryAction=async(index:number,adjust:boolean)=>{
    const item=variants[index];if(!item.id||actionLock.current)return;actionLock.current=true;
    const key=randomUUID();
    try{
      if(adjust)await adjustVariantInventory(item.id,Number.parseInt(item.adjustment,10)||0,'Ajuste del vendedor',key);
      else await setVariantInventory(item.id,Math.max(0,Number.parseInt(item.onHand,10)||0),'Conteo del vendedor',key);
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
      <Text style={s.section}>Opciones</Text>
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
      {options.length>0?<Pressable style={s.outline} onPress={generate}><Text style={s.outlineText}>Generar combinaciones</Text></Pressable>:null}

      <Text style={s.section}>{options.length?'Variantes':'Producto simple'}</Text>
      {variants.map((variant,index)=><View key={variant.id??`${index}-${variant.optionValues.join('-')}`} style={s.card}>
        {variant.optionValues.length?<Text style={s.variantTitle}>{variant.optionValues.join(' · ')}</Text>:<Text style={s.variantTitle}>Variante predeterminada</Text>}
        <TextInput style={s.input} value={variant.sku} placeholder="SKU" placeholderTextColor={Colors.textSubtle}
          autoCapitalize="characters" onChangeText={sku=>updateDraft(index,{sku})}/>
        <View style={s.row}><TextInput style={[s.input,s.flex]} value={variant.price} placeholder="Precio BDAG"
          placeholderTextColor={Colors.textSubtle} keyboardType="decimal-pad" onChangeText={price=>updateDraft(index,{price})}/>
          <TextInput style={[s.input,s.flex]} value={variant.compareAtPrice} placeholder="Precio anterior"
            placeholderTextColor={Colors.textSubtle} keyboardType="decimal-pad"
            onChangeText={compareAtPrice=>updateDraft(index,{compareAtPrice})}/></View>
        <View style={s.row}>
          <Pressable style={[s.pill,variant.active&&s.pillActive]} onPress={()=>updateDraft(index,{active:!variant.active})}>
            <Text style={s.pillText}>{variant.active?'Activa':'Inactiva'}</Text>
          </Pressable>
          <Pressable style={[s.pill,variant.isDefault&&s.pillActive]} onPress={()=>variant.id?void makeDefault(index):
            setVariants(current=>current.map((item,i)=>({...item,isDefault:i===index})))}>
            <Text style={s.pillText}>Predeterminada</Text>
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
        </View>:null}
        <Text style={s.label}>Inventario actual</Text>
        <View style={s.row}><TextInput style={[s.input,s.flex]} value={variant.onHand} keyboardType="number-pad"
          onChangeText={onHand=>updateDraft(index,{onHand})}/><Pressable style={s.smallButton}
          onPress={()=>void inventoryAction(index,false)}><Text style={s.buttonText}>Establecer</Text></Pressable></View>
        <View style={s.row}><TextInput style={[s.input,s.flex]} value={variant.adjustment} keyboardType="numbers-and-punctuation"
          placeholder="+5 o -2" placeholderTextColor={Colors.textSubtle}
          onChangeText={adjustment=>updateDraft(index,{adjustment})}/><Pressable style={s.smallButton}
          onPress={()=>void inventoryAction(index,true)}><Text style={s.buttonText}>Ajustar</Text></Pressable></View>
        <TextInput style={s.input} value={variant.threshold} keyboardType="number-pad"
          placeholder="Umbral de stock bajo" placeholderTextColor={Colors.textSubtle}
          onChangeText={threshold=>updateDraft(index,{threshold})}/>
        {variant.id?<View style={s.row}><Pressable style={s.outline} onPress={()=>void saveVariant(index)}>
          <Text style={s.outlineText}>Guardar variante</Text></Pressable>
          <Pressable style={s.outline} onPress={()=>confirmArchive(index)}><Text style={s.danger}>Archivar</Text></Pressable></View>:null}
      </View>)}
      <Pressable disabled={saving} style={[s.button,saving&&s.disabled]} onPress={()=>void saveConfiguration()}>
        <Text style={s.buttonText}>{saving?'Guardando…':'Guardar configuración'}</Text>
      </Pressable>
      <Text style={s.section}>Historial reciente</Text>
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
  section:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.bold,marginTop:Spacing.sm},
  card:{backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.lg,padding:Spacing.md,gap:Spacing.sm},
  input:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,padding:Spacing.md,color:Colors.textPrimary},
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
