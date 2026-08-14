import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import { formatBDAG, formatMetricCount } from "@/services/marketplaceSellerCenterCore.mjs";
import {
  fetchMyMarketplaceCreatorCommerceAnalytics,
  marketplaceCreatorAnalyticsSurfaceLabel,
  type MarketplaceCreatorAnalytics,
  type MarketplaceCreatorAnalyticsRange,
} from "@/services/marketplaceCreatorAnalyticsService";

const ranges: { key: MarketplaceCreatorAnalyticsRange; label: string }[] = [
  { key: "7d", label: "7D" }, { key: "30d", label: "30D" }, { key: "90d", label: "90D" }, { key: "all", label: "Todo" },
];

export default function CreatorCommerceAnalyticsScreen() {
  const router = useRouter(), insets = useSafeAreaInsets();
  const [range, setRange] = useState<MarketplaceCreatorAnalyticsRange>("30d");
  const [analytics, setAnalytics] = useState<MarketplaceCreatorAnalytics | null>(null);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState(false);
  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try { setAnalytics(await fetchMyMarketplaceCreatorCommerceAnalytics(range)); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);
  const maxTrend = useMemo(() => Math.max(0, ...(analytics?.trend.map((row) => row.attributed_gmv) ?? [])), [analytics]);
  const empty = analytics ? analytics.summary.attributed_orders === 0 && analytics.summary.product_opens === 0 : false;

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      <Pressable style={styles.iconButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver"><MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary}/></Pressable>
      <View style={styles.headerCopy}><Text style={styles.title}>Rendimiento</Text><Text style={styles.subtitle}>Creator Commerce · UTC</Text></View><View style={styles.iconButton}/>
    </View>
    <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={Colors.primary}/>} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={styles.ranges}>{ranges.map((item) => <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected: item.key === range }} style={[styles.range, item.key === range && styles.rangeActive]} onPress={() => setRange(item.key)}><Text style={[styles.rangeText, item.key === range && styles.rangeTextActive]}>{item.label}</Text></Pressable>)}</View>
      {loading ? <View style={styles.center}><ActivityIndicator color={Colors.primary}/><Text style={styles.muted}>Cargando analíticas…</Text></View>
        : error ? <View style={styles.center}><MaterialIcons name="error-outline" size={38} color={Colors.error}/><Text style={styles.sectionTitle}>No pudimos cargar tus analíticas</Text><Pressable style={styles.retry} onPress={() => void load()}><Text style={styles.retryText}>Reintentar</Text></Pressable></View>
        : analytics ? <>
          {empty ? <View style={styles.empty}><MaterialCommunityIcons name="chart-line" size={44} color={Colors.borderHighlight}/><Text style={styles.sectionTitle}>Aún no tienes ventas atribuidas</Text><Text style={styles.muted}>Las aperturas y ventas de tus productos aparecerán aquí.</Text></View> : null}
          <Text style={styles.sectionTitle}>Resumen</Text>
          <View style={styles.kpis}>
            <Kpi accent label="Ventas atribuidas" value={formatBDAG(analytics.summary.attributed_gmv)}/><Kpi label="Pedidos" value={formatMetricCount(analytics.summary.attributed_orders)}/>
            <Kpi label="Unidades" value={formatMetricCount(analytics.summary.units_sold)}/><Kpi accent label="Comisión neta" value={formatBDAG(analytics.summary.commission_net)}/>
            <Kpi label="Aperturas" value={formatMetricCount(analytics.summary.product_opens)}/><Kpi label="Agregados" value={formatMetricCount(analytics.summary.add_to_cart)}/>
          </View>
          <View style={styles.commissionCard}><Commission label="Comisión generada" value={analytics.summary.commission_generated}/><Commission label="Comisión liberada" value={analytics.summary.commission_released}/><Commission label="Comisión revertida" value={analytics.summary.commission_reversed} negative/></View>
          {analytics.trend.length ? <><Text style={styles.sectionTitle}>Tendencia</Text><View style={styles.trend}>{analytics.trend.map((row) => <View key={row.bucket} style={styles.trendRow}><Text style={styles.trendDate}>{row.bucket}</Text><View style={styles.track}><View style={[styles.bar, { width: `${maxTrend > 0 ? Math.max(4, row.attributed_gmv / maxTrend * 100) : 0}%` }]}/></View><Text style={styles.trendMoney}>{formatBDAG(row.attributed_gmv)}</Text></View>)}</View></> : null}
          {analytics.surface_breakdown.length ? <><Text style={styles.sectionTitle}>Por superficie</Text><View style={styles.stack}>{analytics.surface_breakdown.map((row) => <View key={row.source_surface} style={styles.row}><View style={styles.rowIcon}><MaterialCommunityIcons name="chart-donut" size={20} color={Colors.primaryLight}/></View><View style={styles.flex}><Text style={styles.rowTitle}>{marketplaceCreatorAnalyticsSurfaceLabel(row.source_surface)}</Text><Text style={styles.rowMeta}>{row.orders} pedidos · {row.product_opens} aperturas · {formatBDAG(row.commission_generated)} generada</Text></View><Text style={styles.money}>{formatBDAG(row.attributed_gmv)}</Text></View>)}</View></> : null}
          {analytics.top_products.length ? <><Text style={styles.sectionTitle}>Productos principales</Text><View style={styles.stack}>{analytics.top_products.map((row) => <Pressable key={row.product_id} style={styles.product} onPress={() => router.push({ pathname: "/product/[id]", params: { id: row.product_id } } as never)} accessibilityRole="button" accessibilityLabel={`Abrir ${row.title}`}>{row.image_url ? <Image source={{ uri: row.image_url }} style={styles.image} contentFit="cover"/> : <View style={[styles.image, styles.imageFallback]}><MaterialIcons name="image" size={24} color={Colors.textSubtle}/></View>}<View style={styles.flex}><Text style={styles.rowTitle} numberOfLines={1}>{row.title}</Text><Text style={styles.rowMeta}>{row.units_sold} unidades · {row.orders} pedidos · {row.product_opens} aperturas</Text><Text style={styles.rowMeta}>{formatBDAG(row.commission_net)} comisión neta</Text></View><Text style={styles.money}>{formatBDAG(row.attributed_gmv)}</Text></Pressable>)}</View></> : null}
        </> : null}
    </ScrollView>
  </View>;
}

function Kpi({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <View style={[styles.kpi, accent && styles.kpiAccent]}><Text style={styles.kpiLabel}>{label}</Text><Text style={styles.kpiValue}>{value}</Text></View>; }
function Commission({ label, value, negative = false }: { label: string; value: number; negative?: boolean }) { return <View style={styles.commissionRow}><Text style={styles.rowMeta}>{label}</Text><Text style={[styles.commissionValue, negative && value > 0 && styles.negative]}>{formatBDAG(value)}</Text></View>; }

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:Colors.bg},header:{minHeight:64,flexDirection:"row",alignItems:"center",paddingHorizontal:Spacing.sm,borderBottomWidth:1,borderBottomColor:Colors.border},iconButton:{width:44,height:44,alignItems:"center",justifyContent:"center"},headerCopy:{flex:1,alignItems:"center"},title:{color:Colors.textPrimary,fontSize:FontSize.xl,fontWeight:FontWeight.extrabold},subtitle:{color:Colors.textSubtle,fontSize:FontSize.xs},content:{padding:Spacing.md,gap:Spacing.md},ranges:{flexDirection:"row",gap:Spacing.xs,padding:4,backgroundColor:Colors.surface,borderRadius:Radius.full},range:{flex:1,minHeight:38,alignItems:"center",justifyContent:"center",borderRadius:Radius.full},rangeActive:{backgroundColor:Colors.primary},rangeText:{color:Colors.textSecondary,fontWeight:FontWeight.semibold},rangeTextActive:{color:"#fff"},center:{minHeight:260,alignItems:"center",justifyContent:"center",gap:Spacing.md},empty:{alignItems:"center",gap:Spacing.sm,padding:Spacing.xl,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg},muted:{color:Colors.textSecondary,textAlign:"center"},sectionTitle:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.extrabold},kpis:{flexDirection:"row",flexWrap:"wrap",gap:Spacing.sm},kpi:{width:"48%",minHeight:92,padding:Spacing.md,justifyContent:"space-between",backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg,borderWidth:1,borderColor:Colors.border},kpiAccent:{borderColor:Colors.primary},kpiLabel:{color:Colors.textSecondary,fontSize:FontSize.xs},kpiValue:{color:Colors.textPrimary,fontSize:FontSize.lg,fontWeight:FontWeight.extrabold},commissionCard:{padding:Spacing.md,gap:Spacing.sm,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg},commissionRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},commissionValue:{color:Colors.accent,fontWeight:FontWeight.bold},negative:{color:Colors.warning},trend:{padding:Spacing.md,gap:Spacing.sm,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg},trendRow:{flexDirection:"row",alignItems:"center",gap:Spacing.sm},trendDate:{width:68,color:Colors.textSubtle,fontSize:10},track:{flex:1,height:8,borderRadius:4,backgroundColor:Colors.surface,overflow:"hidden"},bar:{height:8,borderRadius:4,backgroundColor:Colors.primary},trendMoney:{width:82,textAlign:"right",color:Colors.textSecondary,fontSize:FontSize.xs},stack:{gap:Spacing.sm},row:{minHeight:72,flexDirection:"row",alignItems:"center",gap:Spacing.sm,padding:Spacing.md,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg},rowIcon:{width:36,height:36,borderRadius:18,backgroundColor:Colors.primaryDim,alignItems:"center",justifyContent:"center"},flex:{flex:1},rowTitle:{color:Colors.textPrimary,fontWeight:FontWeight.bold},rowMeta:{color:Colors.textSecondary,fontSize:FontSize.xs,marginTop:3},money:{color:Colors.accent,fontWeight:FontWeight.bold},product:{minHeight:78,flexDirection:"row",alignItems:"center",gap:Spacing.sm,padding:Spacing.sm,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.lg},image:{width:58,height:58,borderRadius:Radius.md},imageFallback:{backgroundColor:Colors.surface,alignItems:"center",justifyContent:"center"},retry:{minHeight:44,paddingHorizontal:Spacing.lg,borderRadius:Radius.full,backgroundColor:Colors.primary,justifyContent:"center"},retryText:{color:"#fff",fontWeight:FontWeight.bold},
});
