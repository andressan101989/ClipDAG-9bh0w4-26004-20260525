import React,{useEffect,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {useRouter} from 'expo-router';import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAlert} from '@/template';import {createStore,fetchSellerFoundation,updateStore,type MarketplaceStore} from '@/services/marketplaceService';
import {Colors,FontSize,FontWeight,Radius,Spacing} from '@/constants/theme';
export default function SellerStore(){
 const insets=useSafeAreaInsets();const router=useRouter();const {showAlert}=useAlert();const lock=useRef(false);
 const [store,setStore]=useState<MarketplaceStore|null>(null);const [name,setName]=useState('');const [slug,setSlug]=useState('');const [description,setDescription]=useState('');
 useEffect(()=>{void fetchSellerFoundation().then(value=>{if(value.seller?.status!=='approved'){router.replace('/seller' as never);return;}if(value.store){setStore(value.store);setName(value.store.name);setSlug(value.store.slug);setDescription(value.store.description??'');}});},[router]);
 const save=async()=>{if(lock.current)return;lock.current=true;try{if(store)await updateStore(store.id,name,slug,description);else await createStore(name,slug,description);showAlert('Tienda guardada','La configuración se actualizó correctamente.');router.replace('/seller' as never);}catch{showAlert('No se pudo guardar','Revisa el nombre y el identificador de la tienda.');}finally{lock.current=false;}};
 return <View style={[s.page,{paddingTop:insets.top+Spacing.lg}]}><Text style={s.title}>Tu tienda</Text>
 <TextInput style={s.input} value={name} onChangeText={setName} maxLength={100} placeholder="Nombre" placeholderTextColor={Colors.textSubtle}/>
 <TextInput style={s.input} value={slug} onChangeText={setSlug} autoCapitalize="none" maxLength={80} placeholder="identificador-tienda" placeholderTextColor={Colors.textSubtle}/>
 <TextInput style={[s.input,s.note]} value={description} onChangeText={setDescription} maxLength={1000} multiline placeholder="Descripción" placeholderTextColor={Colors.textSubtle}/>
 <Text style={s.help}>Logo y banner usan activos R2 autorizados; la edición visual se habilitará desde este panel sin aceptar URLs externas.</Text>
 <Pressable style={s.button} onPress={save}><Text style={s.buttonText}>Guardar tienda</Text></Pressable></View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:Colors.bg,padding:Spacing.lg,gap:Spacing.md},title:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.bold},input:{backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,padding:Spacing.md,color:Colors.textPrimary},note:{height:110,textAlignVertical:'top'},help:{color:Colors.textSubtle,fontSize:FontSize.xs,lineHeight:18},button:{backgroundColor:Colors.primary,borderRadius:Radius.md,padding:Spacing.md,alignItems:'center'},buttonText:{color:'#000',fontWeight:FontWeight.bold}});
