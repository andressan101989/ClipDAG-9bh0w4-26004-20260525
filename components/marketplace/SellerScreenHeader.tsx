import React,{useCallback} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {MaterialIcons} from '@expo/vector-icons';
import {type Href,useRouter} from 'expo-router';
import {Colors,FontSize,FontWeight,Spacing} from '@/constants/theme';

export function SellerScreenHeader({title,fallbackRoute}:{title:string;fallbackRoute:Href}){
  const router=useRouter();
  const goBack=useCallback(()=>{
    if(router.canGoBack()) router.back();
    else router.replace(fallbackRoute);
  },[fallbackRoute,router]);
  return <View style={styles.header}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Volver desde ${title}`}
      hitSlop={8}
      onPress={goBack}
      style={styles.backButton}
    >
      <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary}/>
    </Pressable>
    <Text style={styles.title} numberOfLines={1}>{title}</Text>
    <View style={styles.balance}/>
  </View>;
}

const styles=StyleSheet.create({
  header:{height:56,flexDirection:'row',alignItems:'center',paddingHorizontal:Spacing.md},
  backButton:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  title:{flex:1,color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.bold,textAlign:'center'},
  balance:{width:44},
});
