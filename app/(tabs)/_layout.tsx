/**
 * app/(tabs)/_layout.tsx — DUMB TAB BAR (startup isolation mode)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ALL hooks with side effects are REMOVED:
 *   ❌ useMessages()      → was polling Supabase every 4s from startup
 *   ❌ useNotifications() → was polling Supabase every 10s from startup
 *   ❌ useWallet()        → was calling useAuth() + Supabase on mount
 *
 * These all triggered network I/O + native module calls BEFORE providers
 * were stable, crashing the iOS runtime.
 *
 * CURRENT STATE: Hardcoded zero values — pure static UI, zero side effects.
 *
 * RESTORE BADGES (once startup confirmed stable on iPhone):
 *   1. Uncomment the Phase B import block below
 *   2. Uncomment the hook calls in CustomTabBar
 *   3. Remove the hardcoded zero constants
 * ═══════════════════════════════════════════════════════════════════════
 */

console.log('[BOOT] (tabs)/_layout module evaluated');

import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontWeight, Radius } from '@/constants/theme';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ── PHASE B — re-enable once boot confirmed stable on iPhone ─────────────────
// import { useMessages } from '@/hooks/useMessages';
// import { useNotifications } from '@/hooks/useNotifications';
// import { useWallet } from '@/hooks/useWallet';

console.log('[BOOT] (tabs)/_layout imports done');

// ── 5 visible tabs ────────────────────────────────────────────────────────────
const VISIBLE_TABS = ['index', 'search', 'upload', 'shop', 'profile'] as const;
type TabKey = (typeof VISIBLE_TABS)[number];

interface TabConf {
  activeIcon:   { lib: 'mc' | 'mi'; name: string };
  inactiveIcon: { lib: 'mc' | 'mi'; name: string };
  label:        string;
  accentColor:  string;
}

const TAB_CONFIG: Record<TabKey, TabConf> = {
  index:   {
    activeIcon:   { lib: 'mc', name: 'home' },
    inactiveIcon: { lib: 'mc', name: 'home-outline' },
    label:        'Inicio',
    accentColor:  '#7C5CFF',
  },
  search:  {
    activeIcon:   { lib: 'mc', name: 'compass' },
    inactiveIcon: { lib: 'mc', name: 'compass-outline' },
    label:        'Explorar',
    accentColor:  '#2D9EFF',
  },
  upload:  {
    activeIcon:   { lib: 'mc', name: 'plus-circle' },
    inactiveIcon: { lib: 'mc', name: 'plus-circle-outline' },
    label:        '',
    accentColor:  '#FF2D78',
  },
  shop:    {
    activeIcon:   { lib: 'mc', name: 'hexagon-multiple' },
    inactiveIcon: { lib: 'mc', name: 'hexagon-multiple-outline' },
    label:        'Economía',
    accentColor:  '#FF9D00',
  },
  profile: {
    activeIcon:   { lib: 'mc', name: 'account-circle' },
    inactiveIcon: { lib: 'mc', name: 'account-circle-outline' },
    label:        'Perfil',
    accentColor:  '#00E5A0',
  },
};

function TabIcon({ conf, active }: { conf: TabConf; active: boolean }) {
  const ic = active ? conf.activeIcon : conf.inactiveIcon;
  const color = active ? conf.accentColor : Colors.textSubtle;
  if (ic.lib === 'mc') {
    return <MaterialCommunityIcons name={ic.name as any} size={24} color={color} />;
  }
  return <MaterialIcons name={ic.name as any} size={24} color={color} />;
}

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  // ── DUMB mode: hardcoded zeros — no hooks, no side effects ───────────────
  const unreadTotal = 0;
  const notifCount  = 0;
  // const balance  = 0; // reserved for future Phase B

  // ── PHASE B: uncomment after boot confirmed stable ────────────────────────
  // const { unreadTotal } = useMessages();
  // const { unreadCount: notifCount } = useNotifications();
  // const walletData = useWallet();
  // const balance = walletData?.balance ?? 0;

  const tabBarHeight = 62 + insets.bottom;

  const visibleRoutes = state.routes.filter(r =>
    VISIBLE_TABS.includes(r.name as TabKey),
  );

  const badges: Partial<Record<TabKey, number>> = {
    profile: notifCount + unreadTotal,
  };

  return (
    <View style={[sty.barContainer, { height: tabBarHeight, paddingBottom: insets.bottom }]}>
      {/* Frosted glass backdrop */}
      <LinearGradient
        colors={['rgba(8,8,18,0.98)', 'rgba(12,12,24,1)']}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Top separator line */}
      <LinearGradient
        colors={['#7C5CFF44', '#FF9D0033', '#FF2D7833', 'transparent']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={sty.topLine}
      />

      <View style={sty.tabRow}>
        {visibleRoutes.map(route => {
          const globalIndex = state.routes.findIndex(r => r.key === route.key);
          const isFocused = state.index === globalIndex;
          const key = route.name as TabKey;
          const isUpload = key === 'upload';
          const conf = TAB_CONFIG[key];
          const badge = badges[key] ?? 0;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress', target: route.key, canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          // ── Upload centre pill ──────────────────────────────────────────
          if (isUpload) {
            return (
              <Pressable key={route.key} onPress={onPress}
                style={sty.uploadTab} accessibilityRole="button" hitSlop={6}>
                <LinearGradient
                  colors={['#FF2D78', '#7C5CFF']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={[sty.uploadBtn, isFocused && sty.uploadBtnActive]}>
                  <MaterialCommunityIcons name="plus" size={28} color="#fff" />
                </LinearGradient>
              </Pressable>
            );
          }

          // ── Regular tab ────────────────────────────────────────────────
          return (
            <Pressable key={route.key} onPress={onPress}
              style={sty.tab} accessibilityRole="button" hitSlop={4}>
              <View style={[sty.tabInner, isFocused && sty.tabInnerActive]}>
                {/* Active highlight */}
                {isFocused ? (
                  <LinearGradient
                    colors={[conf.accentColor + '22', conf.accentColor + '08']}
                    style={StyleSheet.absoluteFillObject}
                  />
                ) : null}

                {/* Icon + badge */}
                <View style={sty.iconWrap}>
                  <TabIcon conf={conf} active={isFocused} />
                  {badge > 0 ? (
                    <View style={[sty.badge, { backgroundColor: Colors.secondary }]}>
                      <Text style={sty.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Label */}
                <Text style={[
                  sty.tabLabel,
                  isFocused && { color: conf.accentColor, fontWeight: FontWeight.semibold },
                ]}>
                  {conf.label}
                </Text>

                {/* Active dot */}
                {isFocused ? (
                  <View style={[sty.activeDot, { backgroundColor: conf.accentColor }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  console.log('[BOOT] TabLayout render');
  return (
    <Tabs
      tabBar={props => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {/* ── Visible ── */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="upload" />
      <Tabs.Screen name="shop" />
      <Tabs.Screen name="profile" />

      {/* ── Hidden (accessible via push navigation) ── */}
      <Tabs.Screen name="messages"      options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="wallet"        options={{ href: null }} />
    </Tabs>
  );
}

const sty = StyleSheet.create({
  barContainer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    overflow: 'hidden',
    ...Platform.select({
      ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.4, shadowRadius: 12 },
      android: { elevation: 16 },
    }),
  },
  topLine: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 1,
  },
  tabRow: {
    flex: 1, flexDirection: 'row', alignItems: 'center', paddingTop: 6,
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2,
  },
  tabInner: {
    alignItems: 'center', gap: 2, position: 'relative',
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: Radius.lg,
    minWidth: 52,
  },
  tabInnerActive: {},
  iconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  tabLabel: {
    fontSize: 9, fontWeight: FontWeight.medium,
    color: Colors.textSubtle, letterSpacing: 0.3,
  },
  activeDot: {
    position: 'absolute', bottom: -4,
    width: 4, height: 4, borderRadius: 2,
  },
  badge: {
    position: 'absolute', top: -5, right: -9,
    borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: Colors.bg,
  },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: FontWeight.bold },
  uploadTab: {
    flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -10,
  },
  uploadBtn: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#FF2D78',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12,
    elevation: 12,
  },
  uploadBtnActive: {
    shadowOpacity: 0.8, shadowRadius: 20,
  },
});
