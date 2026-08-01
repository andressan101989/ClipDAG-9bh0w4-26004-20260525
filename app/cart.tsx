import React,{useCallback,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
import {Image} from 'expo-image';
import {MaterialIcons} from '@expo/vector-icons';
import {StatusBar} from 'expo-status-bar';
import {useFocusEffect,useRouter} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAuth} from '@/hooks/useAuth';
import {useMarketplaceCart} from '@/hooks/useMarketplaceCart';
import {Colors,FontSize,FontWeight,Radius,Spacing} from '@/constants/theme';
import type {MarketplaceCartItem} from '@/services/marketplaceCart';

const availabilityText:Record<MarketplaceCartItem['availability'],string>={
  available:'Disponible',out_of_stock:'Agotado',variant_unavailable:'Variante no disponible',product_unavailable:'Producto no disponible',
};

export default function MarketplaceCartScreen(){
  const insets=useSafeAreaInsets();
  const router=useRouter();
  const {user}=useAuth();
  const cart=useMarketplaceCart();
  const {refreshCart}=cart;
  const [refreshWarning,setRefreshWarning]=useState(false);
  const [priceChangedKeys,setPriceChangedKeys]=useState<Set<string>>(new Set());

  const runRefresh=useCallback(async()=>{
    const result=await refreshCart();
    setRefreshWarning(!result.complete);
    setPriceChangedKeys(new Set(result.priceChangedKeys));
    const changes:string[]=[];
    if(result.adjustedItemCount)changes.push(`Se ajustó la cantidad de ${result.adjustedItemCount} ${result.adjustedItemCount===1?'producto':'productos'} por cambios de inventario.`);
    if(result.priceChangedKeys.length)changes.push(`Se actualizó el precio de ${result.priceChangedKeys.length} ${result.priceChangedKeys.length===1?'producto':'productos'}.`);
    if(changes.length)Alert.alert('Carrito actualizado',changes.join(' '));
    return result;
  },[refreshCart]);

  useFocusEffect(useCallback(()=>{
    if(cart.isHydrated)void runRefresh();
  },[cart.isHydrated,runRefresh]));

  const checkout=async()=>{
    if(!user){Alert.alert('Inicia sesión','Inicia sesión para reservar los productos de tu carrito.',[
      {text:'Cancelar',style:'cancel'},{text:'Iniciar sesión',onPress:()=>router.push('/login' as never)},
    ]);return;}
    const result=await runRefresh();
    if(!result.complete){Alert.alert('No pudimos actualizar el carrito','Verifica tu conexión e inténtalo nuevamente.');return;}
    const hasAvailable=cart.items.length-result.unavailableItemCount>0;
    if(!hasAvailable){Alert.alert('Carrito no disponible','Revisa los productos agotados o eliminados antes de continuar.');return;}
    router.push('/checkout' as never);
  };

  if(!cart.isHydrated)return <View style={[styles.root,styles.center,{paddingTop:insets.top}]}>
    <StatusBar style="light"/><ActivityIndicator size="large" color={Colors.primary}/>
    <Text style={styles.stateBody}>Cargando tu carrito…</Text>
  </View>;

  return <View style={[styles.root,{paddingTop:insets.top}]}>
    <StatusBar style="light"/>
    <View style={styles.header}>
      <Pressable style={styles.iconButton} onPress={()=>router.back()} accessibilityRole="button" accessibilityLabel="Volver">
        <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary}/>
      </Pressable>
      <View style={styles.headerCopy}><Text style={styles.headerTitle}>Tu carrito</Text><Text style={styles.headerSubtitle}>{cart.totalQuantity} unidades</Text></View>
      {cart.items.length?<Pressable style={styles.clearButton} onPress={()=>Alert.alert('Vaciar carrito','Se eliminarán todos los productos de este carrito.',[
        {text:'Cancelar',style:'cancel'},{text:'Vaciar',style:'destructive',onPress:cart.clearCart},
      ])} accessibilityRole="button" accessibilityLabel="Vaciar carrito"><Text style={styles.clearText}>Vaciar</Text></Pressable>:<View style={styles.iconButton}/>}
    </View>
    {refreshWarning?<View style={styles.warningBanner}><MaterialIcons name="wifi-off" size={18} color={Colors.warning}/><Text style={styles.warningText}>No pudimos actualizar algunos productos. Verifica tu conexión.</Text></View>:null}
    {!cart.items.length?<View style={styles.empty}>
      <View style={styles.emptyIcon}><MaterialIcons name="shopping-cart" size={54} color={Colors.primaryLight}/></View>
      <Text style={styles.stateTitle}>Tu carrito está vacío</Text>
      <Text style={styles.stateBody}>Explora el Marketplace y agrega productos para verlos aquí.</Text>
      <Pressable style={styles.primaryButton} onPress={()=>router.replace('/(tabs)/shop' as never)} accessibilityRole="button" accessibilityLabel="Explorar productos">
        <Text style={styles.primaryButtonText}>Explorar productos</Text>
      </Pressable>
    </View>:<>
      <ScrollView contentContainerStyle={[styles.list,{paddingBottom:230+insets.bottom}]}
        refreshControl={<RefreshControl refreshing={cart.isRefreshing} onRefresh={()=>void runRefresh()} tintColor={Colors.primary}/> }>
        {cart.items.map(item=><View key={item.key} style={[styles.itemCard,item.availability!=='available'&&styles.itemUnavailable]}
          accessibilityLabel={`${item.title}, ${item.options.map(option=>option.value).join(', ')}`}>
          <View style={styles.itemTop}>
            {item.imageUrl?<Image source={{uri:item.imageUrl}} style={styles.itemImage} contentFit="cover"/>:<View style={[styles.itemImage,styles.imageFallback]}><MaterialIcons name="image" size={28} color={Colors.textSubtle}/></View>}
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
              {item.sellerUsername?<Text style={styles.seller}>@{item.sellerUsername}</Text>:null}
              <Text style={styles.options}>{item.options.map(option=>`${option.optionName}: ${option.value}`).join(' · ')}</Text>
              {item.sku?<Text style={styles.sku}>SKU {item.sku}</Text>:null}
              <View style={styles.priceRow}><Text style={styles.price}>{item.unitPrice.toFixed(2)} BDAG</Text>
                {item.compareAtPrice!=null&&item.compareAtPrice>item.unitPrice?<Text style={styles.compare}>{item.compareAtPrice.toFixed(2)}</Text>:null}</View>
              {priceChangedKeys.has(item.key)?<Text style={styles.updated}>Precio actualizado</Text>:null}
            </View>
            <Pressable style={styles.iconButton} onPress={()=>cart.removeItem(item.key)} accessibilityRole="button" accessibilityLabel={`Eliminar ${item.title} del carrito`}>
              <MaterialIcons name="delete-outline" size={22} color={Colors.secondary}/>
            </Pressable>
          </View>
          <View style={styles.itemBottom}>
            <Text style={[styles.availability,item.availability!=='available'&&styles.unavailableText]}>{availabilityText[item.availability]}</Text>
            <View style={styles.quantityControl}>
              <Pressable style={styles.quantityButton} onPress={()=>cart.decrementItem(item.key)} disabled={item.quantity<=1||item.availability!=='available'}
                accessibilityRole="button" accessibilityLabel={`Disminuir cantidad de ${item.title}`} accessibilityState={{disabled:item.quantity<=1||item.availability!=='available'}}>
                <MaterialIcons name="remove" size={18} color={Colors.textPrimary}/>
              </Pressable><Text style={styles.quantity}>{item.quantity}</Text>
              <Pressable style={styles.quantityButton} onPress={()=>cart.incrementItem(item.key)} disabled={item.availability!=='available'||item.quantity>=item.availableQuantitySnapshot}
                accessibilityRole="button" accessibilityLabel={`Aumentar cantidad de ${item.title}`} accessibilityState={{disabled:item.availability!=='available'||item.quantity>=item.availableQuantitySnapshot}}>
                <MaterialIcons name="add" size={18} color={Colors.textPrimary}/>
              </Pressable>
            </View>
            <Text style={styles.lineTotal}>{item.availability==='available'?(item.unitPrice*item.quantity).toFixed(2):'—'} BDAG</Text>
          </View>
        </View>)}
      </ScrollView>
      <View style={[styles.summary,{paddingBottom:insets.bottom+Spacing.sm}]}>
        <View style={styles.summaryCard}>
          <View><Text style={styles.summaryLabel}>Productos disponibles</Text><Text style={styles.summaryValue}>{cart.availableItemCount}</Text></View>
          <View><Text style={styles.summaryLabel}>Unidades</Text><Text style={styles.summaryValue}>{cart.totalQuantity}</Text></View>
          <View style={styles.subtotalWrap}><Text style={styles.summaryLabel}>Subtotal</Text><Text style={styles.subtotal}>{cart.subtotal.toFixed(2)} BDAG</Text></View>
          <Text style={styles.disclaimer}>Precio e inventario se revalidarán antes del checkout.</Text>
        </View>
        <Pressable style={styles.primaryButton} onPress={()=>void checkout()} disabled={cart.isRefreshing} accessibilityRole="button"
          accessibilityLabel="Continuar al checkout" accessibilityState={{disabled:cart.isRefreshing}}>
          {cart.isRefreshing?<ActivityIndicator color="#fff"/>:<><MaterialIcons name="verified-user" size={20} color="#fff"/><Text style={styles.primaryButtonText}>Continuar al checkout</Text></>}
        </Pressable>
      </View>
    </>}
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:Colors.bg},center:{alignItems:'center',justifyContent:'center',gap:Spacing.md},
  header:{height:64,flexDirection:'row',alignItems:'center',paddingHorizontal:Spacing.sm,borderBottomWidth:1,borderBottomColor:Colors.border},
  iconButton:{width:44,height:44,alignItems:'center',justifyContent:'center'},headerCopy:{flex:1},headerTitle:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.extrabold},headerSubtitle:{color:Colors.textSubtle,fontSize:FontSize.xs},
  clearButton:{minWidth:60,height:44,alignItems:'center',justifyContent:'center'},clearText:{color:Colors.secondary,fontWeight:FontWeight.semibold},
  warningBanner:{margin:Spacing.md,marginBottom:0,padding:Spacing.sm,flexDirection:'row',gap:Spacing.sm,alignItems:'center',backgroundColor:Colors.warningDim,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.warning+'44'},warningText:{flex:1,color:Colors.warning,fontSize:FontSize.sm},
  empty:{flex:1,alignItems:'center',justifyContent:'center',padding:Spacing.xl,gap:Spacing.md},emptyIcon:{width:96,height:96,borderRadius:48,backgroundColor:Colors.primaryDim,alignItems:'center',justifyContent:'center'},stateTitle:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.bold},stateBody:{color:Colors.textSecondary,fontSize:FontSize.sm,textAlign:'center',lineHeight:20},
  list:{padding:Spacing.md,gap:Spacing.md},itemCard:{backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,padding:Spacing.md,borderWidth:1,borderColor:Colors.border,gap:Spacing.md},itemUnavailable:{opacity:.72,borderColor:Colors.secondary+'66'},itemTop:{flexDirection:'row',gap:Spacing.md},itemImage:{width:84,height:84,borderRadius:Radius.md},imageFallback:{backgroundColor:Colors.surface,alignItems:'center',justifyContent:'center'},itemInfo:{flex:1,gap:3},itemTitle:{color:Colors.textPrimary,fontSize:FontSize.md,fontWeight:FontWeight.bold},seller:{color:Colors.textSubtle,fontSize:FontSize.xs},options:{color:Colors.primaryLight,fontSize:FontSize.sm},sku:{color:Colors.textSubtle,fontSize:10},priceRow:{flexDirection:'row',alignItems:'center',gap:Spacing.xs},price:{color:Colors.textPrimary,fontWeight:FontWeight.bold},compare:{color:Colors.textSubtle,textDecorationLine:'line-through',fontSize:FontSize.xs},updated:{color:Colors.warning,fontSize:FontSize.xs},
  itemBottom:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},availability:{flex:1,color:Colors.accent,fontSize:FontSize.xs,fontWeight:FontWeight.semibold},unavailableText:{color:Colors.secondary},quantityControl:{flexDirection:'row',alignItems:'center',backgroundColor:Colors.surface,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.border},quantityButton:{width:44,height:44,alignItems:'center',justifyContent:'center'},quantity:{color:Colors.textPrimary,minWidth:28,textAlign:'center',fontWeight:FontWeight.bold},lineTotal:{minWidth:82,textAlign:'right',color:Colors.primaryLight,fontWeight:FontWeight.bold},
  summary:{position:'absolute',bottom:0,left:0,right:0,padding:Spacing.md,gap:Spacing.sm,backgroundColor:Colors.bg,borderTopWidth:1,borderTopColor:Colors.border},summaryCard:{flexDirection:'row',alignItems:'flex-end',gap:Spacing.md,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.md,padding:Spacing.md,borderWidth:1,borderColor:Colors.border,flexWrap:'wrap'},summaryLabel:{color:Colors.textSubtle,fontSize:10},summaryValue:{color:Colors.textPrimary,fontWeight:FontWeight.bold},subtotalWrap:{marginLeft:'auto',alignItems:'flex-end'},subtotal:{color:Colors.primaryLight,fontSize:FontSize.lg,fontWeight:FontWeight.extrabold},disclaimer:{width:'100%',color:Colors.textSubtle,fontSize:10},
  primaryButton:{minHeight:50,borderRadius:Radius.md,backgroundColor:Colors.primary,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:Spacing.sm,paddingHorizontal:Spacing.lg},primaryButtonText:{color:'#fff',fontSize:FontSize.md,fontWeight:FontWeight.bold},
});
