/**
 * app/(tabs)/_layout.tsx — ABSOLUTE STUB (startup isolation)
 *
 * Zero custom imports. Zero hooks. Zero side effects.
 * Plain Tabs with default tab bar — no CustomTabBar, no LinearGradient,
 * no MaterialCommunityIcons, no useSafeAreaInsets called here.
 *
 * This file is evaluated by expo-router at startup during route registration
 * even if we never navigate to (tabs). Keeping it completely empty of
 * custom code prevents ANY possibility of it contributing to the crash.
 */

console.log('[BOOT] (tabs)/_layout evaluated');

import { Tabs } from 'expo-router';

export default function TabLayout() {
  console.log('[BOOT] TabLayout render');
  return (
    <Tabs screenOptions={{ headerShown: false }}>
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
