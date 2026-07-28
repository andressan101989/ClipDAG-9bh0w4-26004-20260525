import React,{useCallback,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {useFocusEffect,useRouter} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Colors,FontSize,FontWeight,Radius,Spacing} from '@/constants/theme';
import {fetchSellerFoundation,type MarketplaceSeller,type MarketplaceStore} from '@/services/marketplaceService';

export default function SellerHome(){
  const router=useRouter();const insets=useSafeAreaInsets();
  const [seller,setSeller]=useState<MarketplaceSeller|null>(null);
  const [store,setStore]=useState<MarketplaceStore|null>(null);
  const [loading,setLoading]=useState(true);
  useFocusEffect(useCallback(()=>{let active=true;setLoading(true);
    void fetchSellerFoundation().then(value=>{if(active){setSeller(value.seller);setStore(value.store);}})
      .finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]));
  if(loading)return <View style={s.center}><ActivityIndicator color={Colors.primary}/></View>;
  const message=!seller?'Aún no has solicitado acceso como vendedor.'
    :seller.status==='pending'?'Tu solicitud está en revisión.'
    :seller.status==='rejected'?'Tu solicitud no fue aprobada. Puedes actualizarla y volver a enviarla.'
    :seller.status==='suspended'?'Tu cuenta de vendedor está suspendida.'
    :store?'Tu tienda está lista para administrar productos.':'Crea tu tienda para comenzar.';
  return <View style={[s.page,{paddingTop:insets.top+Spacing.lg}]}>
    <Text style={s.title}>Centro de vendedor</Text><Text style={s.body}>{message}</Text>
    {!seller||seller.status==='rejected'?<Action label={seller?'Actualizar solicitud':'Solicitar acceso'} onPress={()=>router.push('/seller/apply' as never)}/>:null}
    {seller?.status==='approved'?<>
      <Action label={store?'Configurar tienda':'Crear tienda'} onPress={()=>router.push('/seller/store' as never)}/>
      {store?<Action label="Mis productos" onPress={()=>router.push('/seller/products' as never)}/>:null}
    </>:null}
  </View>;
}
function Action({label,onPress}:{label:string;onPress:()=>void}){return <Pressable style={s.button} onPress={onPress}><Text style={s.buttonText}>{label}</Text></Pressable>;}
const s=StyleSheet.create({page:{flex:1,backgroundColor:Colors.bg,padding:Spacing.lg,gap:Spacing.md},center:{flex:1,backgroundColor:Colors.bg,alignItems:'center',justifyContent:'center'},title:{color:Colors.textPrimary,fontSize:FontSize.xxl,fontWeight:FontWeight.bold},body:{color:Colors.textSecondary,fontSize:FontSize.md,lineHeight:22},button:{backgroundColor:Colors.primary,borderRadius:Radius.md,padding:Spacing.md,alignItems:'center'},buttonText:{color:'#000',fontWeight:FontWeight.bold}});
