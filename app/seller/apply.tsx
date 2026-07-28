import React,{useEffect,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {useRouter} from 'expo-router';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAlert} from '@/template';
import {applySeller,fetchSellerFoundation,updateSellerApplication} from '@/services/marketplaceService';
import {Colors,FontWeight,Radius,Spacing} from '@/constants/theme';
import {SellerScreenHeader} from '@/components/marketplace/SellerScreenHeader';
export default function SellerApply(){
  const insets=useSafeAreaInsets();const router=useRouter();const {showAlert}=useAlert();
  const [name,setName]=useState('');const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [hasApplication,setHasApplication]=useState(false);const lock=useRef(false);
  useEffect(()=>{void fetchSellerFoundation().then(({seller})=>{if(seller){setHasApplication(true);setName(seller.display_name);setNote(seller.application_note??'');}});},[]);
  const submit=async()=>{if(lock.current)return;if(name.trim().length<2){showAlert('Nombre requerido','Ingresa un nombre para tu tienda.');return;}
    lock.current=true;setBusy(true);try{if(hasApplication)await updateSellerApplication(name.trim(),note.trim());else await applySeller(name.trim(),note.trim());showAlert('Solicitud enviada','Revisaremos tu solicitud de vendedor.');router.replace('/seller' as never);}
    catch{showAlert('No se pudo enviar','Revisa los datos e inténtalo nuevamente.');}finally{lock.current=false;setBusy(false);}};
  return <View style={[s.page,{paddingTop:insets.top}]}><SellerScreenHeader title="Solicitud de vendedor" fallbackRoute="/seller"/><View style={s.content}>
    <TextInput style={s.input} value={name} onChangeText={setName} maxLength={80} placeholder="Nombre de tienda" placeholderTextColor={Colors.textSubtle}/>
    <TextInput style={[s.input,s.note]} value={note} onChangeText={setNote} maxLength={1000} multiline placeholder="Cuéntanos qué deseas vender" placeholderTextColor={Colors.textSubtle}/>
    <Pressable style={s.button} disabled={busy} onPress={submit}><Text style={s.buttonText}>{busy?'Enviando...':'Enviar solicitud'}</Text></Pressable></View></View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:Colors.bg},content:{padding:Spacing.lg,gap:Spacing.md},input:{backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,padding:Spacing.md,color:Colors.textPrimary},note:{height:130,textAlignVertical:'top'},button:{backgroundColor:Colors.primary,borderRadius:Radius.md,padding:Spacing.md,alignItems:'center'},buttonText:{color:'#000',fontWeight:FontWeight.bold}});
