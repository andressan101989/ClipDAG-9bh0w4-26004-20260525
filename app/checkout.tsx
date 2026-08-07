import React,{useCallback,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Alert,KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {MaterialIcons} from '@expo/vector-icons';
import {randomUUID} from 'expo-crypto';
import {StatusBar} from 'expo-status-bar';
import {useFocusEffect,useRouter} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '@/hooks/useAuth';
import {useMarketplaceCart} from '@/hooks/useMarketplaceCart';
import {Colors,FontSize,FontWeight,Radius,Spacing} from '@/constants/theme';
import {createCheckoutReservation,expireMarketplaceCheckoutReservations,fetchMyActiveCheckout,MarketplaceOrderServiceError,normalizeShippingAddress,validateShippingAddress,type ShippingAddressInput} from '@/services/marketplaceOrderService';
import {MarketplaceShippingQuoteCard,type MarketplaceShippingQuoteState} from '@/components/marketplace/MarketplaceShippingQuoteCard';

const emptyAddress:ShippingAddressInput={recipientName:'',line1:'',line2:'',city:'',region:'',postalCode:'',country:'',phone:''};
const fields:{key:keyof ShippingAddressInput;label:string;optional?:boolean}[]=[
  {key:'recipientName',label:'Nombre del destinatario'},{key:'line1',label:'Dirección'},
  {key:'line2',label:'Apartamento, unidad o referencia',optional:true},{key:'city',label:'Ciudad'},
  {key:'region',label:'Estado/Provincia'},{key:'postalCode',label:'Código postal'},
  {key:'country',label:'País'},{key:'phone',label:'Teléfono',optional:true},
];

export default function MarketplaceCheckoutScreen(){
  const router=useRouter();const insets=useSafeAreaInsets();const {user}=useAuth();const cart=useMarketplaceCart();
  const {refreshCart}=cart;
  const [address,setAddress]=useState<ShippingAddressInput>(emptyAddress);const [errors,setErrors]=useState<Partial<Record<keyof ShippingAddressInput,string>>>({});
  const [ready,setReady]=useState(false);const [submitting,setSubmitting]=useState(false);const submitLockRef=useRef(false);
  const [quoteStates,setQuoteStates]=useState<Record<string,MarketplaceShippingQuoteState>>({});
  const idempotencyRef=useRef<{signature:string;key:string}|null>(null);
  const availableItems=useMemo(()=>cart.items.filter(item=>item.availability==='available'),[cart.items]);
  const availableGroups=useMemo(()=>Array.from(availableItems.reduce((groups,item)=>{
    const current=groups.get(item.storeId)??[];current.push(item);groups.set(item.storeId,current);return groups;
  },new Map<string,typeof availableItems>()).entries()),[availableItems]);
  const subtotal=useMemo(()=>availableItems.reduce((sum,item)=>sum+item.unitPrice*item.quantity,0),[availableItems]);

  useFocusEffect(useCallback(()=>{let active=true;(async()=>{
    if(!user){setReady(true);return;}await expireMarketplaceCheckoutReservations().catch(()=>{});await refreshCart();if(active)setReady(true);
  })();return()=>{active=false;};},[user,refreshCart]));

  const submit=async()=>{
    if(submitLockRef.current||!user)return;const normalized=normalizeShippingAddress(address);const nextErrors=validateShippingAddress(normalized);
    setErrors(nextErrors);if(Object.keys(nextErrors).length||!availableItems.length)return;
    if(availableItems.some(item=>quoteStates[item.key]?.status!=='ready')){Alert.alert('Envío pendiente','Verifica que todos los productos se envíen a la dirección seleccionada.');return;}
    const requestItems=availableItems.map(item=>({variantId:item.variantId,quantity:item.quantity}));
    const signature=JSON.stringify({items:requestItems,address:normalized});
    if(!idempotencyRef.current||idempotencyRef.current.signature!==signature)idempotencyRef.current={signature,key:randomUUID()};
    submitLockRef.current=true;setSubmitting(true);
    try{
      const result=await createCheckoutReservation(requestItems,normalized,idempotencyRef.current.key);
      cart.removeItems(availableItems.map(item=>item.key));idempotencyRef.current=null;
      router.replace({pathname:'/checkout/reservation/[id]',params:{id:result.checkout.id}} as never);
    }catch(error){
      const code=error instanceof MarketplaceOrderServiceError?error.code:'marketplace_order_unknown';
      if(code==='marketplace_insufficient_inventory'){await cart.refreshCart();Alert.alert('Cambió el inventario','Uno o más productos ya no tienen la cantidad solicitada. Actualizamos tu carrito.');idempotencyRef.current=null;}
      else if(code==='marketplace_active_checkout_exists'){const active=await fetchMyActiveCheckout().catch(()=>null);Alert.alert('Ya tienes una reserva activa','Finaliza o cancela tu reserva antes de crear otra.',active?[{text:'Cerrar',style:'cancel'},{text:'Ver reserva',onPress:()=>router.replace({pathname:'/checkout/reservation/[id]',params:{id:active.checkout.id}} as never)}]:undefined);}
      else if(code==='marketplace_idempotency_conflict'){Alert.alert('No se pudo reutilizar esta solicitud','Actualiza el checkout e inténtalo nuevamente.');idempotencyRef.current=null;}
      else {const active=await fetchMyActiveCheckout().catch(()=>null);if(active)router.replace({pathname:'/checkout/reservation/[id]',params:{id:active.checkout.id}} as never);else if(code==='marketplace_order_transport')Alert.alert('No pudimos confirmar la reserva','Verifica tu conexión e inténtalo nuevamente con la misma solicitud.');else Alert.alert('No se pudo crear la reserva','Ocurrió un error al validar la reserva. Inténtalo nuevamente.');}
    }finally{submitLockRef.current=false;setSubmitting(false);}
  };

  if(!ready)return <View style={[styles.root,styles.center,{paddingTop:insets.top}]}><ActivityIndicator color={Colors.primary}/><Text style={styles.muted}>Verificando carrito…</Text></View>;
  if(!user)return <View style={[styles.root,styles.center,{paddingTop:insets.top,paddingHorizontal:Spacing.xl}]}><MaterialIcons name="lock" size={48} color={Colors.primary}/><Text style={styles.title}>Inicia sesión</Text><Text style={styles.muted}>Inicia sesión para reservar los productos de tu carrito.</Text><Pressable style={styles.primary} onPress={()=>router.push('/login' as never)} accessibilityRole="button"><Text style={styles.primaryText}>Iniciar sesión</Text></Pressable></View>;
  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS==='ios'?'padding':'height'}><StatusBar style="light"/>
    <View style={[styles.header,{paddingTop:insets.top}]}><Pressable style={styles.icon} onPress={()=>router.back()} accessibilityRole="button" accessibilityLabel="Volver"><MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary}/></Pressable><Text style={styles.headerTitle}>Checkout</Text><View style={styles.icon}/></View>
    <ScrollView contentContainerStyle={[styles.content,{paddingBottom:insets.bottom+Spacing.xl}]} keyboardShouldPersistTaps="handled">
      {!availableItems.length?<View style={styles.card}><Text style={styles.title}>No hay productos disponibles</Text><Text style={styles.muted}>Vuelve al carrito para revisar productos agotados o eliminados.</Text></View>:<>
        <View style={styles.card}><Text style={styles.sectionTitle}>Resumen de reserva</Text>{availableGroups.map(([storeId,items],groupIndex)=><View key={storeId}><Text style={styles.storeLabel}>{items[0]?.sellerUsername?`@${items[0].sellerUsername}`:`Tienda ${groupIndex+1}`}</Text>{items.map(item=><View key={item.key} style={styles.line}><View style={{flex:1}}><Text style={styles.itemTitle}>{item.title}</Text><Text style={styles.options}>{item.options.map(option=>option.value).join(' · ')}</Text><Text style={styles.muted}>Cantidad {item.quantity} · {item.unitPrice.toFixed(2)} BDAG</Text></View><Text style={styles.linePrice}>{(item.unitPrice*item.quantity).toFixed(2)} BDAG</Text></View>)}</View>)}<View style={styles.totalRow}><Text style={styles.sectionTitle}>Subtotal</Text><Text style={styles.total}>{subtotal.toFixed(2)} BDAG</Text></View><Text style={styles.notice}>El precio y el inventario se verificarán nuevamente en el servidor.</Text></View>
        <View style={styles.card}><Text style={styles.sectionTitle}>Dirección de envío</Text>{fields.map(field=><View key={field.key} style={styles.field}><Text style={styles.label}>{field.label}{field.optional?' · Opcional':''}</Text><TextInput value={address[field.key]??''} onChangeText={value=>{setAddress(current=>({...current,[field.key]:value}));setErrors(current=>({...current,[field.key]:undefined}));}} style={[styles.input,errors[field.key]&&styles.inputError]} placeholderTextColor={Colors.textSubtle} accessibilityLabel={field.label}/>{errors[field.key]?<Text style={styles.error}>{errors[field.key]}</Text>:null}</View>)}</View>
        {availableItems.map(item=><MarketplaceShippingQuoteCard key={item.key} productId={item.productId} quantity={item.quantity} countryCode={address.country} regionCode={address.region} onChange={state=>setQuoteStates(current=>({...current,[item.key]:state}))}/>)}
        <Text style={styles.notice}>El servidor agrupa el envío una vez por pedido/perfil. La reserva mostrará el total final congelado.</Text>
        <Pressable style={[styles.primary,(submitting||availableItems.some(item=>quoteStates[item.key]?.status!=='ready'))&&styles.disabled]} onPress={()=>void submit()} disabled={submitting||availableItems.some(item=>quoteStates[item.key]?.status!=='ready')} accessibilityRole="button" accessibilityLabel="Reservar productos por 15 minutos" accessibilityState={{disabled:submitting}}>{submitting?<ActivityIndicator color="#fff"/>:<Text style={styles.primaryText}>Reservar por 15 minutos · {subtotal.toFixed(2)} BDAG + envío</Text>}</Pressable><Text style={styles.helper}>No se descontará BDAG en esta etapa.</Text>
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:Colors.bg},center:{alignItems:'center',justifyContent:'center',gap:Spacing.md},header:{minHeight:64,flexDirection:'row',alignItems:'flex-end',paddingHorizontal:Spacing.sm,paddingBottom:Spacing.sm,borderBottomWidth:1,borderBottomColor:Colors.border},icon:{width:44,height:44,alignItems:'center',justifyContent:'center'},headerTitle:{flex:1,textAlign:'center',color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.bold},content:{padding:Spacing.md,gap:Spacing.md},card:{backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,padding:Spacing.md,gap:Spacing.md,borderWidth:1,borderColor:Colors.border},title:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.bold,textAlign:'center'},sectionTitle:{color:Colors.textPrimary,fontSize:FontSize.md,fontWeight:FontWeight.bold},storeLabel:{color:Colors.primaryLight,fontSize:FontSize.sm,fontWeight:FontWeight.bold,marginBottom:Spacing.sm},muted:{color:Colors.textSecondary,fontSize:FontSize.sm,textAlign:'center'},line:{flexDirection:'row',gap:Spacing.sm,paddingBottom:Spacing.sm,borderBottomWidth:1,borderBottomColor:Colors.borderSubtle},itemTitle:{color:Colors.textPrimary,fontWeight:FontWeight.bold},options:{color:Colors.primaryLight,fontSize:FontSize.sm},linePrice:{color:Colors.textPrimary,fontWeight:FontWeight.bold},totalRow:{flexDirection:'row',justifyContent:'space-between'},total:{color:Colors.primaryLight,fontSize:FontSize.lg,fontWeight:FontWeight.extrabold},notice:{color:Colors.warning,fontSize:FontSize.xs},field:{gap:Spacing.xs},label:{color:Colors.textSecondary,fontSize:FontSize.sm},input:{minHeight:48,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.border,backgroundColor:Colors.surface,paddingHorizontal:Spacing.md,color:Colors.textPrimary},inputError:{borderColor:Colors.error},error:{color:Colors.error,fontSize:FontSize.xs},primary:{minHeight:52,borderRadius:Radius.md,backgroundColor:Colors.primary,alignItems:'center',justifyContent:'center',paddingHorizontal:Spacing.lg},primaryText:{color:'#fff',fontWeight:FontWeight.bold,fontSize:FontSize.md},disabled:{opacity:.5},helper:{color:Colors.textSubtle,textAlign:'center',fontSize:FontSize.xs}});
