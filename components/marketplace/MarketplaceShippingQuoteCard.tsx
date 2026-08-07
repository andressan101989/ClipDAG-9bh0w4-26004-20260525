import React,{useCallback,useEffect,useRef,useState}from'react';
import{ActivityIndicator,Pressable,StyleSheet,Text,View}from'react-native';
import{Colors,Radius,Spacing}from'@/constants/theme';
import{marketplaceShippingMessage,MarketplaceShippingError,quoteMarketplaceShipping,type MarketplaceShippingQuote}from'@/services/marketplaceShippingService';

export type MarketplaceShippingQuoteState={status:'idle'|'loading'|'ready'|'error';quote:MarketplaceShippingQuote|null;message:string|null};
export function MarketplaceShippingQuoteCard({productId,quantity,countryCode,regionCode,onChange,onRequestAddress}:{productId:string;quantity:number;countryCode?:string|null;regionCode?:string|null;onChange?:(state:MarketplaceShippingQuoteState)=>void;onRequestAddress?:()=>void}){
 const[state,setState]=useState<MarketplaceShippingQuoteState>({status:'idle',quote:null,message:null}),onChangeRef=useRef(onChange);onChangeRef.current=onChange;
 const publish=useCallback((next:MarketplaceShippingQuoteState)=>{setState(next);onChangeRef.current?.(next);},[]);
 const load=useCallback(async()=>{if(!countryCode){publish({status:'idle',quote:null,message:'Selecciona o agrega una dirección para calcular el envío.'});return;}publish({status:'loading',quote:null,message:null});try{const quote=await quoteMarketplaceShipping(productId,countryCode,regionCode??null,quantity);publish({status:'ready',quote,message:null});}catch(error){const code=error instanceof MarketplaceShippingError?error.code:'marketplace_shipping_unknown';publish({status:'error',quote:null,message:marketplaceShippingMessage(code)});}},[countryCode,productId,publish,quantity,regionCode]);
 useEffect(()=>{void load();},[load]);
 return <View style={styles.card} accessibilityLabel="Disponibilidad de envío">
  <Text style={styles.title}>Envío</Text>
  {state.status==='loading'?<View style={styles.row}><ActivityIndicator color={Colors.primary}/><Text style={styles.text}>Calculando envío…</Text></View>:null}
  {state.status==='idle'||state.status==='error'?<><Text style={state.status==='error'?styles.error:styles.text}>{state.message}</Text>{state.status==='idle'&&onRequestAddress?<Pressable onPress={onRequestAddress} style={styles.retry}><Text style={styles.retryText}>Agregar dirección</Text></Pressable>:null}{state.status==='error'?<Pressable onPress={()=>void load()} style={styles.retry}><Text style={styles.retryText}>Reintentar</Text></Pressable>:null}</>:null}
  {state.quote?<><View style={styles.between}><Text style={styles.text}>Costo</Text><Text style={styles.value}>{state.quote.shippingAmount.toFixed(2)} BDAG</Text></View><Text style={styles.text}>Preparación: {state.quote.processingDaysMin}–{state.quote.processingDaysMax} días</Text><Text style={styles.text}>Tránsito: {state.quote.transitDaysMin}–{state.quote.transitDaysMax} días</Text><Text style={styles.text}>Entrega estimada total: {state.quote.estimatedDeliveryDaysMin}–{state.quote.estimatedDeliveryDaysMax} días</Text><Text style={styles.destination}>Destino: {state.quote.countryCode}{state.quote.regionCode?` / ${state.quote.regionCode}`:''}</Text></>:null}
 </View>;
}
const styles=StyleSheet.create({card:{padding:Spacing.md,gap:Spacing.sm,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,backgroundColor:Colors.surfaceElevated},title:{color:Colors.textPrimary,fontWeight:'700'},row:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},between:{flexDirection:'row',justifyContent:'space-between'},text:{color:Colors.textSecondary},value:{color:Colors.primaryLight,fontWeight:'700'},destination:{color:Colors.textSubtle,fontSize:12},error:{color:Colors.error},retry:{alignSelf:'flex-start',paddingVertical:8,paddingHorizontal:12},retryText:{color:Colors.primaryLight,fontWeight:'700'}});
