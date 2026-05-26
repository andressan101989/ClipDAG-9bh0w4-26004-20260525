/**
 * app/_layout.tsx — STARTUP ISOLATION MODE (Phase 4 active)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * PROGRESS LOG:
 *   Phase 0 ✅ — Bare boot confirmed on OnSpace web emulator
 *   Phase 1 ✅ — AlertProvider + SafeAreaProvider (always active)
 *   Phase 2 🔄 — I18nProvider (activating now)
 *   Phase 3 🔄 — TemplateAuthProvider (activating now)
 *   Phase 4 🔄 — AuthProvider (activating now — needed by tab bar hooks)
 *   Phase 5–8 — Still commented out
 *
 * WHY Phase 4 is needed now:
 *   app/(tabs)/_layout.tsx calls useAuth() via useWallet().
 *   Even though index.tsx redirects to /boot-test, expo-router evaluates
 *   ALL layout files at startup for route registration. Without AuthProvider,
 *   any render of the tabs layout would crash.
 *   useAuth/useMessages/useNotifications now have safe fallbacks (no throw),
 *   but AuthProvider should be active anyway for correctness.
 *
 * REMAINING SUSPECTS (uncomment one at a time, rebuild EAS after each):
 *   Phase 5: FeedProvider
 *   Phase 6: StoriesProvider + MessagesProvider + NotificationsProvider
 *   Phase 7: ShopProvider
 *   Phase 8: WalletConnectProvider ← highest crash risk (native modules)
 * ═══════════════════════════════════════════════════════════════════════
 */

console.log('[BOOT] 0 - _layout module evaluated');

import { Stack } from 'expo-router';
console.log('[BOOT] 1 - expo-router imported');

import React, { Component, ReactNode } from 'react';
console.log('[BOOT] 2 - react imported');

import { View, Text, Pressable, StyleSheet } from 'react-native';
console.log('[BOOT] 3 - react-native imported');

import { SafeAreaProvider } from 'react-native-safe-area-context';
console.log('[BOOT] 4 - safe-area-context imported');

import { AlertProvider } from '@/template';
console.log('[BOOT] 5 - template/AlertProvider imported');

// ── PHASE 2 ──────────────────────────────────────────────────────────────────
import { I18nProvider } from '@/contexts/I18nContext';
console.log('[BOOT] 6 - I18nContext imported');

// ── PHASE 3 ──────────────────────────────────────────────────────────────────
import { AuthProvider as TemplateAuthProvider } from '@/template';
console.log('[BOOT] 7 - TemplateAuthProvider imported');

// ── PHASE 4 ──────────────────────────────────────────────────────────────────
import { AuthProvider } from '@/contexts/AuthContext';
console.log('[BOOT] 8 - AuthContext imported');

// ── PHASE 5 ──────────────────────────────────────────────────────────────────
// import { FeedProvider } from '@/contexts/FeedContext';
// console.log('[BOOT] 9 - FeedContext imported');

// ── PHASE 6 ──────────────────────────────────────────────────────────────────
// import { StoriesProvider } from '@/contexts/StoriesContext';
// import { MessagesProvider } from '@/contexts/MessagesContext';
// import { NotificationsProvider } from '@/contexts/NotificationsContext';
// console.log('[BOOT] 10 - Stories/Messages/Notifications contexts imported');

// ── PHASE 7 ──────────────────────────────────────────────────────────────────
// import { ShopProvider } from '@/contexts/ShopContext';
// console.log('[BOOT] 11 - ShopContext imported');

// ── PHASE 8 — HIGHEST CRASH RISK ─────────────────────────────────────────────
// import { WalletConnectProvider } from '@/components/feature/WalletConnectProvider';
// console.log('[BOOT] 12 - WalletConnectProvider imported');

console.log('[BOOT] 13 - all imports done, defining components...');

// ── Global Error Boundary ─────────────────────────────────────────────────────
interface EBState { hasError: boolean; error: string; stack: string }
class GlobalErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: '', stack: '' };
  }
  static getDerivedStateFromError(err: any): EBState {
    return {
      hasError: true,
      error: err?.message ?? String(err) ?? 'Error desconocido',
      stack: err?.stack ?? '',
    };
  }
  componentDidCatch(err: any, info: any) {
    console.error('[GlobalErrorBoundary] CRASH');
    console.error('Name   :', err?.name);
    console.error('Message:', err?.message ?? err);
    console.error('Stack  :', err?.stack ?? '(no stack)');
    console.error('Comp   :', info?.componentStack ?? '(no info)');
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={eb.root}>
        <Text style={eb.emoji}>⚠️</Text>
        <Text style={eb.title}>Crash detectado</Text>
        <Text style={eb.msg}>{this.state.error}</Text>
        {this.state.stack ? (
          <Text style={eb.stack} numberOfLines={20}>{this.state.stack}</Text>
        ) : null}
        <Pressable style={eb.btn} onPress={() => this.setState({ hasError: false, error: '', stack: '' })}>
          <Text style={eb.btnText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }
}

const eb = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#07070F', alignItems: 'center', justifyContent: 'center', padding: 28 },
  emoji:   { fontSize: 48, marginBottom: 16 },
  title:   { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  msg:     { color: '#FF6B6B', fontSize: 13, textAlign: 'center', marginBottom: 14, lineHeight: 20 },
  stack:   { color: '#888', fontSize: 9, lineHeight: 14, marginBottom: 20, width: '100%' },
  btn:     { backgroundColor: '#7C5CFF', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 13 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

// ── Root layout ───────────────────────────────────────────────────────────────
export default function RootLayout() {
  console.log('[BOOT] 14 - RootLayout render START');

  return (
    <GlobalErrorBoundary>
      <AlertProvider>
        <SafeAreaProvider>
          <I18nProvider>
            <TemplateAuthProvider>
              <AuthProvider>
                {/*
                 * Phases 5–8 wrappers go here once confirmed stable.
                 * Current tree: I18n → TemplateAuth → AppAuth → Stack
                 */}
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="login" />
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="chat/[userId]" />
                  <Stack.Screen name="call/[userId]" />
                  <Stack.Screen name="videocall/[userId]" />
                  <Stack.Screen name="product/[id]" />
                  <Stack.Screen name="creator/[id]" />
                  <Stack.Screen name="notifications" />
                  <Stack.Screen name="create-product" />
                  <Stack.Screen name="my-orders" />
                  <Stack.Screen name="new-message" />
                  <Stack.Screen name="settings" />
                  <Stack.Screen name="messages" />
                  <Stack.Screen name="my-content" />
                  <Stack.Screen name="account-settings" />
                  <Stack.Screen name="notification-settings" />
                  <Stack.Screen name="privacy-settings" />
                  <Stack.Screen name="two-factor" />
                  <Stack.Screen name="legal" />
                  <Stack.Screen name="promotions" />
                  <Stack.Screen name="creator-monetization" />
                  <Stack.Screen name="my-subscriptions" />
                  <Stack.Screen name="creator-studio" />
                  <Stack.Screen name="boost-profile" />
                  <Stack.Screen name="earnings" />
                  <Stack.Screen name="ai-avatar" />
                  <Stack.Screen name="deepar-test" />
                  <Stack.Screen name="boot-test" options={{ headerShown: false }} />
                </Stack>
              </AuthProvider>
            </TemplateAuthProvider>
          </I18nProvider>
        </SafeAreaProvider>
      </AlertProvider>
    </GlobalErrorBoundary>
  );
}
