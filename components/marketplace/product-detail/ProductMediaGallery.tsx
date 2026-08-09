import React, { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { MaterialIcons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { Colors, FontWeight, Radius, Spacing } from "@/constants/theme";
import type { MarketplaceProductGalleryItem } from "@/services/marketplaceService";

type Props = { items: MarketplaceProductGalleryItem[]; selectedIndex: number; onSelect: (index: number) => void };

export function ProductMediaGallery({ items, selectedIndex, onSelect }: Props) {
  const selected = items[selectedIndex] ?? null;
  const player = useVideoPlayer(selected?.kind === "video" ? selected.url : null, instance => { instance.muted = true; });
  useEffect(() => { if (selected?.kind !== "video") player.pause(); }, [player, selected?.kind]);
  const imageUrl = selected?.kind === "image" ? selected.url : items.find(item => item.kind === "image")?.url;
  return <View style={styles.wrap}>
    <View style={styles.stage}>
      {selected?.kind === "video" ? <VideoView player={player} style={styles.media} nativeControls contentFit="contain" accessibilityLabel="Video del producto" />
        : imageUrl ? <Image source={{ uri: imageUrl }} style={styles.media} contentFit="cover" transition={180} accessibilityLabel={`Imagen ${selectedIndex + 1} del producto`} />
        : <View style={[styles.media, styles.empty]}><MaterialIcons name="image-not-supported" size={54} color={Colors.textSubtle}/><Text style={styles.emptyText}>Imagen no disponible</Text></View>}
      {items.length ? <View style={styles.count}><Text style={styles.countText}>{Math.min(selectedIndex + 1, items.length)} / {items.length}</Text></View> : null}
    </View>
    {items.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
      {items.map((item,index)=><Pressable key={`${item.kind}-${item.url}`} onPress={()=>onSelect(index)} accessibilityRole="button" accessibilityLabel={item.kind === "video" ? "Seleccionar video del producto" : `Seleccionar imagen ${index + 1}`} accessibilityState={{selected:index===selectedIndex}} style={[styles.thumb,index===selectedIndex&&styles.thumbSelected]}>
        {item.kind === "image" ? <Image source={{uri:item.url}} style={styles.thumbMedia} contentFit="cover"/> : <View style={[styles.thumbMedia,styles.video]}><MaterialIcons name="play-circle-filled" size={30} color="#fff"/><Text style={styles.videoText}>Video</Text></View>}
      </Pressable>)}
    </ScrollView> : null}
  </View>;
}

const styles=StyleSheet.create({wrap:{backgroundColor:Colors.surface},stage:{position:"relative",backgroundColor:"#090A0E"},media:{width:"100%",height:390},empty:{alignItems:"center",justifyContent:"center",gap:Spacing.sm},emptyText:{color:Colors.textSecondary},count:{position:"absolute",right:Spacing.md,bottom:Spacing.md,backgroundColor:"rgba(0,0,0,.68)",borderRadius:Radius.full,paddingHorizontal:10,paddingVertical:5},countText:{color:"#fff",fontSize:12,fontWeight:FontWeight.bold},thumbs:{padding:Spacing.sm,gap:Spacing.sm},thumb:{width:58,height:58,borderRadius:Radius.md,overflow:"hidden",borderWidth:2,borderColor:"transparent"},thumbSelected:{borderColor:Colors.primary},thumbMedia:{width:"100%",height:"100%"},video:{backgroundColor:"#171923",alignItems:"center",justifyContent:"center"},videoText:{color:"#fff",fontSize:9,fontWeight:FontWeight.bold}});
