import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";

type Props={bottom:number;quantity:number;available:number;price:number;disabled:boolean;label:string;onQuantity:(value:number)=>void;onAdd:()=>void};
export function ProductPurchaseBar({bottom,quantity,available,price,disabled,label,onQuantity,onAdd}:Props){
 const actionable=!disabled&&available>0;
 return <View style={[styles.bar,{paddingBottom:bottom+Spacing.sm}]}>
  {actionable?<View style={styles.quantity}>
   <Pressable style={[styles.quantityButton,quantity<=1&&styles.controlDisabled]} disabled={quantity<=1} onPress={()=>onQuantity(Math.max(1,quantity-1))} accessibilityRole="button" accessibilityLabel="Reducir cantidad" accessibilityState={{disabled:quantity<=1}}><MaterialIcons name="remove" size={20} color={Colors.textPrimary}/></Pressable>
   <Text style={styles.quantityText}>{quantity}</Text>
   <Pressable style={[styles.quantityButton,quantity>=available&&styles.controlDisabled]} disabled={quantity>=available} onPress={()=>onQuantity(Math.min(available,quantity+1))} accessibilityRole="button" accessibilityLabel="Aumentar cantidad" accessibilityState={{disabled:quantity>=available}}><MaterialIcons name="add" size={20} color={Colors.textPrimary}/></Pressable>
  </View>:null}
  <Pressable style={[styles.cta,!actionable&&styles.ctaDisabled]} disabled={!actionable} onPress={onAdd} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled:!actionable}}>
   <Text style={styles.ctaText}>{actionable?`Agregar · ${(price*quantity).toFixed(2)} BDAG`:label}</Text>
  </Pressable>
 </View>;
}
const styles=StyleSheet.create({bar:{position:"absolute",left:0,right:0,bottom:0,flexDirection:"row",alignItems:"center",gap:Spacing.sm,paddingHorizontal:Spacing.md,paddingTop:Spacing.sm,backgroundColor:Colors.surfaceElevated,borderTopWidth:1,borderTopColor:Colors.border},quantity:{height:50,flexDirection:"row",alignItems:"center",borderWidth:1,borderColor:Colors.border,borderRadius:Radius.full,overflow:"hidden"},quantityButton:{width:44,height:48,alignItems:"center",justifyContent:"center"},controlDisabled:{opacity:.35},quantityText:{minWidth:28,textAlign:"center",color:Colors.textPrimary,fontWeight:FontWeight.bold},cta:{flex:1,minHeight:52,borderRadius:Radius.full,backgroundColor:Colors.primary,alignItems:"center",justifyContent:"center",paddingHorizontal:Spacing.md},ctaDisabled:{backgroundColor:Colors.surface,color:Colors.textSecondary,borderWidth:1,borderColor:Colors.border},ctaText:{color:"#fff",fontSize:FontSize.md,fontWeight:FontWeight.extrabold}});
