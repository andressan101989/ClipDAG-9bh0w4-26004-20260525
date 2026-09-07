import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from '@/components/ui/SafeImage';
import { Colors } from '@/constants/theme';
import { getStandardChatImageAccess } from '@/services/chatMediaService';

export function PrivateChatImage({ assetId, legacyUrl }: { assetId?: string; legacyUrl?: string }) {
  const [url, setUrl] = useState(legacyUrl); const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active=true;setFailed(false);if(!assetId||legacyUrl){setUrl(legacyUrl);return()=>{active=false;};}setUrl(undefined);void getStandardChatImageAccess(assetId).then(access=>{if(active)setUrl(access.url);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[assetId,attempt,legacyUrl]);
  if(url)return <Image source={{uri:url}} style={styles.image} contentFit="cover" transition={200}/>;
  return <Pressable disabled={!failed} accessibilityRole={failed?'button':undefined} accessibilityLabel={failed?'Reintentar cargar imagen':'Cargando imagen'} onPress={()=>setAttempt(value=>value+1)} style={[styles.image,styles.loading]}>{failed?<MaterialCommunityIcons name="image-refresh-outline" size={24} color={Colors.textSecondary}/>:<ActivityIndicator size="small" color={Colors.primary}/>}</Pressable>;
}
const styles=StyleSheet.create({image:{width:228,height:124,borderRadius:16},loading:{alignItems:'center',justifyContent:'center',backgroundColor:'#252A37'}});
