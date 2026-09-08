/**
 * app/(tabs)/_layout.tsx — Full Tab Navigation Restored
 *
 * Custom tab bar with BDAG-styled navigation.
 * Badge counts hardcoded to 0 — no hooks with side effects at this level.
 * Individual screens manage their own unread counts via context.
 */

import { Tabs } from 'expo-router';
import { Platform, View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Inter_400Regular, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { useMessages } from '@/hooks/useMessages';
import { useNotifications } from '@/hooks/useNotifications';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// Figma FAB anchor: 68px canonical bar + 7px visual bridge; Inbox adds its approved 14px clearance.
export const TAB_BAR_HEIGHT = Platform.select({ ios: 75, android: 75, default: 75 });

const TABS = [
  { name: 'index',   icon: 'home-variant',        label: 'Inicio' },
  { name: 'search',  icon: 'magnify',              label: 'Buscar' },
  { name: 'upload',  icon: 'plus-circle-outline',  label: 'Crear'  },
  { name: 'shop',    icon: 'store-outline',        label: 'Shop'   },
  { name: 'profile', icon: 'account-circle-outline', label: 'Perfil' },
] as const;

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const [tabFontsLoaded] = useFonts({ Inter_400Regular, Inter_600SemiBold });
  // Safe context access — hooks return defaults if providers not ready
  const { unreadTotal } = useMessages();
  const { unreadCount } = useNotifications();

  return (
    <View style={[styles.tabBarOuter, !tabFontsLoaded && styles.tabBarLoading]}>
      <View style={styles.tabBarInner}>
        {state.routes
          .filter(r => ['index','search','upload','shop','profile'].includes(r.name))
          .map((route, idx) => {
            const tab = TABS.find(t => t.name === route.name);
            if (!tab) return null;
            const isFocused = state.index === state.routes.indexOf(route);
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
            };

            const badge = route.name === 'profile' ? (unreadTotal + unreadCount) : 0;

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.tabBtn}
                hitSlop={4}
              >
                <View style={[styles.tabIconWrap, route.name === 'upload' && styles.uploadGrad]}>
                  <MaterialCommunityIcons
                    name={tab.icon as any}
                    size={24}
                    color={isFocused ? '#9B5CFF' : '#9298AD'}
                  />
                  {badge > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="upload" />
      <Tabs.Screen name="shop" />
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="messages"      options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="wallet"        options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarOuter: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 68,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: '#0B0E16',
    borderTopWidth: 1,
    borderTopColor: '#23283A',
  },
  tabBarLoading: { opacity: 0 },
  tabBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 54,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabIconWrap: { position: 'relative' },
  // Keep the canonical create slot as its own visual authority without
  // restoring the obsolete raised gradient treatment.
  uploadGrad: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 12,
    color: '#9298AD',
  },
  tabLabelActive: {
    color: '#9B5CFF',
    fontFamily: 'Inter_600SemiBold',
  },
  badge: {
    position: 'absolute',
    top: -4, right: -6,
    backgroundColor: '#FF2D78',
    borderRadius: 8,
    minWidth: 16, height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
});
