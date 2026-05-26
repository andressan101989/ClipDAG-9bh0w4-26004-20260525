/**
 * app/_layout.tsx — STARTUP ISOLATION MODE
 *
 * ═══════════════════════════════════════════════════════════════════════
 * PURPOSE: Diagnose "Failed to launch app" crash on iOS.
 * The Hermes bundle compiles cleanly. The crash is a RUNTIME startup crash.
 *
 * ISOLATION STRATEGY:
 *   - PHASE 0 (current): Bare minimum — no providers at all.
 *     If this crashes: problem is in expo-router bootstrap, stack, or
 *     a module-level side effect in a file imported at the top of the tree.
 *
 *   - PHASE 1: Add AlertProvider + SafeAreaProvider only.
 *   - PHASE 2: Add I18nProvider.
 *   - PHASE 3: Add TemplateAuthProvider.
 *   - PHASE 4: Add AuthProvider (Supabase auth.onAuthStateChange).
 *   - PHASE 5: Add FeedProvider.
 *   - PHASE 6: Add StoriesProvider + MessagesProvider + NotificationsProvider.
 *   - PHASE 7: Add ShopProvider.
 *   - PHASE 8: Add WalletConnectProvider (most likely candidate for crash).
 *
 * INSTRUCTIONS:
 *   1. Build EAS with THIS file (Phase 0).
 *   2. If app opens → crash was in a provider. Add them back one by one (phases above).
 *   3. Check iOS device console logs for "[BOOT]" entries to pinpoint last step.
 *
 * HOW TO READ CRASH LOGS ON IPHONE:
 *   iPhone Settings → Privacy & Security → Analytics & Improvements → Analytics Data
 *   Look for entries starting with your app bundle ID.
 *   Or use Xcode Organizer → Crashes after connecting the phone.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── [BOOT] STEP 0: Module evaluation ─────────────────────────────────────────
// If the app crashes BEFORE this log appears in the console, the crash is
// in a module that is require()'d at bundle parse time (side-effect imports).
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

// ── PHASE 3–8 providers — commented out for isolation ─────────────────────────
// Uncomment ONE block at a time, rebuild, and test on device.
// The phase that causes "Failed to launch app" is the culprit module.

// ── PHASE 2 ──────────────────────────────────────────────────────────────────
// import { I18nProvider } from '@/contexts/I18nContext';
// console.log('[BOOT] 6 - I18nContext imported');

// ── PHASE 3 ──────────────────────────────────────────────────────────────────
// import { AuthProvider as TemplateAuthProvider } from '@/template';
// console.log('[BOOT] 7 - TemplateAuthProvider imported');

// ── PHASE 4 ──────────────────────────────────────────────────────────────────
// import { AuthProvider } from '@/contexts/AuthContext';
// console.log('[BOOT] 8 - AuthContext imported');

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
    console.error('══════════════════════════════');
    console.error('[GlobalErrorBoundary] CRASH');
    console.error('Name   :', err?.name);
    console.error('Message:', err?.message ?? err);
    console.error('Stack  :', err?.stack ?? '(no stack)');
    console.error('Comp   :', info?.componentStack ?? '(no info)');
    console.error('══════════════════════════════');
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={eb.root}>
        <Text style={eb.emoji}>⚠️</Text>
        <Text style={eb.title}>Crash detectado</Text>
        <Text style={eb.msg}>{this.state.error}</Text>
        {this.state.stack ? (
          <Text style={eb.stack} numberOfLines={16}>{this.state.stack}</Text>
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

// ── Root layout — PHASE 0: bare minimum ──────────────────────────────────────
export default function RootLayout() {
  console.log('[BOOT] 14 - RootLayout render START');

  return (
    <GlobalErrorBoundary>
      <AlertProvider>
        <SafeAreaProvider>
          {/*
           * PHASE 0 TREE — no custom providers.
           *
           * Stack must list ALL known route names to avoid "unmatched route" errors
           * that could look like crashes.
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
        </SafeAreaProvider>
      </AlertProvider>
    </GlobalErrorBoundary>
  );
}
