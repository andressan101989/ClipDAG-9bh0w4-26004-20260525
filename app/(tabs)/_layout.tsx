/**
 * app/(tabs)/_layout.tsx — Full Tab Navigation Restored
 *
 * Custom tab bar with BDAG-styled navigation.
 * Badge counts hardcoded to 0 — no hooks with side effects at this level.
 * Individual screens manage their own unread counts via context.
 */

import { Tabs } from 'expo-router';
import { Platform, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMessages } from '@/hooks/useMessages';
import { useNotifications } from '@/hooks/useNotifications';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// Height exported so other components can offset correctly
export const TAB_BAR_HEIGHT = Platform.select({ ios: 82, android: 70, default: 70 });

const TABS = [
  { name: 'index',   icon: 'home-variant',        label: 'Inicio' },
  { name: 'search',  icon: 'magnify',              label: 'Buscar' },
  { name: 'upload',  icon: 'plus-circle-outline',  label: 'Crear'  },
  { name: 'shop',    icon: 'store-outline',        label: 'Shop'   },
  { name: 'profile', icon: 'account-circle-outline', label: 'Perfil' },
] as const;

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Safe context access — hooks return defaults if providers not ready
  const { unreadTotal } = useMessages();
  const { unreadCount } = useNotifications();

  return (
    <View style={[styles.tabBarOuter, { paddingBottom: insets.bottom || 8 }]}>
      <LinearGradient
        colors={['rgba(10,10,15,0)', 'rgba(10,10,15,0.97)']}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View style={styles.tabBarInner}>
        {state.routes
          .filter(r => ['index','search','upload','shop','profile'].includes(r.name))
          .map((route, idx) => {
            const tab = TABS.find(t => t.name === route.name);
            if (!tab) return null;
            const isFocused = state.index === state.routes.indexOf(route);
            const isUpload = route.name === 'upload';

            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
            };

            if (isUpload) {
              return (
                <Pressable key={route.key} onPress={onPress} style={styles.uploadBtn} hitSlop={4}>
                  <LinearGradient
                    colors={['#7C5CFF', '#FF2D78']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.uploadGrad}
                  >
                    <MaterialCommunityIcons name="plus" size={28} color="#fff" />
                  </LinearGradient>
                </Pressable>
              );
            }

            const badge = route.name === 'profile' ? (unreadTotal + unreadCount) : 0;

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.tabBtn}
                hitSlop={4}
              >
                <View style={styles.tabIconWrap}>
                  <MaterialCommunityIcons
                    name={tab.icon as any}
                    size={24}
                    color={isFocused ? '#7C5CFF' : 'rgba(255,255,255,0.45)'}
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
    paddingTop: 8,
  },
  tabBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    height: 54,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabIconWrap: { position: 'relative' },
  tabLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#7C5CFF',
    fontWeight: '600',
  },
  uploadBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadGrad: {
    width: 48, height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C5CFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
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
