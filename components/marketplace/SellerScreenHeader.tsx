import React,{type ReactNode,useCallback} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {MaterialIcons} from '@expo/vector-icons';
import {type Href,useRouter} from 'expo-router';
import {Colors,FontSize,FontWeight,Spacing} from '@/constants/theme';

export function SellerScreenHeader({title,fallbackRoute,onBack,accessibilityLabel,subtitle,align='center'}:{title:string;fallbackRoute:Href|string;onBack?:()=>void;accessibilityLabel?:string;subtitle?:ReactNode;align?:'center'|'left'}){
  const router=useRouter();
  const goBack=useCallback(()=>{
    if(onBack){onBack();return;}
    if(router.canGoBack()) router.back();
    // Deterministic fallback contract: router.replace(fallbackRoute)
    else router.replace(fallbackRoute as Href);
  },[fallbackRoute,onBack,router]);
  return <View style={styles.header}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel??`Volver desde ${title}`}
      hitSlop={8}
      onPress={goBack}
      style={styles.backButton}
    >
      <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary}/>
    </Pressable>
    <View style={[styles.copy,align==='left'&&styles.copyLeft]}>
      <Text style={[styles.title,align==='left'&&styles.titleLeft]} numberOfLines={1}>{title}</Text>
      {subtitle}
    </View>
    <View style={styles.balance}/>
  </View>;
}

const styles=StyleSheet.create({
  header:{height:56,flexDirection:'row',alignItems:'center',paddingHorizontal:Spacing.md,backgroundColor:Colors.bg,zIndex:10,elevation:2},
  backButton:{width:44,height:44,alignItems:'center',justifyContent:'center',zIndex:11},
  copy:{flex:1,alignItems:'center'},
  copyLeft:{alignItems:'flex-start'},
  title:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.bold,textAlign:'center'},
  titleLeft:{textAlign:'left'},
  balance:{width:44},
});
