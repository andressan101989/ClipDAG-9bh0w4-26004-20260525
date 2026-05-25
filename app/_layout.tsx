import { Stack } from 'expo-router';
import React, { Component, ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AlertProvider, AuthProvider as TemplateAuthProvider } from '@/template';
import { AuthProvider } from '@/contexts/AuthContext';
import { FeedProvider } from '@/contexts/FeedContext';
import { StoriesProvider } from '@/contexts/StoriesContext';
import { MessagesProvider } from '@/contexts/MessagesContext';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { ShopProvider } from '@/contexts/ShopContext';
import { I18nProvider } from '@/contexts/I18nContext';
import { WalletConnectProvider } from '@/components/feature/WalletConnectProvider';

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
        <Text style={eb.title}>La app encontró un error</Text>
        <Text style={eb.msg}>{this.state.error}</Text>
        {this.state.stack ? (
          <Text style={eb.stack} numberOfLines={12}>{this.state.stack}</Text>
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
  stack:   { color: '#555577', fontSize: 10, lineHeight: 15, marginBottom: 20, width: '100%' },
  btn:     { backgroundColor: '#7C5CFF', borderRadius: 14, paddingHorizontal: 32, paddingVertical: 13 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

// ── Root layout ───────────────────────────────────────────────────────────────
export default function RootLayout() {
  return (
    <GlobalErrorBoundary>
      <I18nProvider>
      {/* WalletConnectProvider wraps everything so useWalletConnectModal()
          is available to any component in the tree (wallet screen etc.) */}
      <WalletConnectProvider>
        <AlertProvider>
          <SafeAreaProvider>
            <TemplateAuthProvider>
            <AuthProvider>
                <FeedProvider>
                  <StoriesProvider>
                    <MessagesProvider>
                      <NotificationsProvider>
                        <ShopProvider>
                          <Stack screenOptions={{ headerShown: false }}>
                            <Stack.Screen name="index" />
                            <Stack.Screen name="login" />
                            <Stack.Screen name="(tabs)" />
                            <Stack.Screen name="chat/[userId]" />
                            <Stack.Screen name="call/[userId]" />
                            <Stack.Screen name="videocall/[userId]" />
                            <Stack.Screen name="product/[id]" />
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
                            <Stack.Screen name="creator/[id]" />
                            <Stack.Screen name="creator-studio" />
                            <Stack.Screen name="boost-profile" />
                            <Stack.Screen name="earnings" />
                            <Stack.Screen name="ai-avatar" />
                            <Stack.Screen name="deepar-test" />
                          </Stack>
                        </ShopProvider>
                      </NotificationsProvider>
                    </MessagesProvider>
                  </StoriesProvider>
                </FeedProvider>
              </AuthProvider>
            </TemplateAuthProvider>
          </SafeAreaProvider>
        </AlertProvider>
      </WalletConnectProvider>
      </I18nProvider>
    </GlobalErrorBoundary>
  );
}
