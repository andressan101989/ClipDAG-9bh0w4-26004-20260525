console.log('[DIAG] JS ENTRY');

// Sequential require() calls — no static imports.
// Each require is numbered so the last log visible before a crash
// identifies the exact module that kills the process.

console.log('[DIAG] 1 - requiring expo-router');
const { Stack } = require('expo-router');
console.log('[DIAG] 2 - expo-router OK');

console.log('[DIAG] 3 - requiring ErrorBoundary');
const { ErrorBoundary } = require('@/components/ui/ErrorBoundary');
console.log('[DIAG] 4 - ErrorBoundary OK');

console.log('[DIAG] 5 - requiring SafeAreaProvider');
const { SafeAreaProvider } = require('react-native-safe-area-context');
console.log('[DIAG] 6 - SafeAreaProvider OK');

console.log('[DIAG] 7 - requiring React');
const React = require('react');
console.log('[DIAG] 8 - React OK');

console.log('[DIAG] 9 - all requires done, defining RootLayout');

export default function RootLayout() {
  console.log('[DIAG] 10 - RootLayout render');
  return (
    <ErrorBoundary module="RootLayout" showReset>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="boot-test" />
          <Stack.Screen
            name="creator-studio"
            options={{ presentation: 'fullScreenModal' }}
          />
          <Stack.Screen
            name="chat/[userId]"
            options={{ headerShown: true, title: '' }}
          />
          <Stack.Screen
            name="creator/[id]"
            options={{ headerShown: true, title: '' }}
          />
          <Stack.Screen
            name="product/[id]"
            options={{ headerShown: true, title: '' }}
          />
          <Stack.Screen
            name="live/[sessionId]"
            options={{ presentation: 'fullScreenModal', headerShown: false }}
          />
          <Stack.Screen
            name="battle/[roomId]"
            options={{ presentation: 'fullScreenModal', headerShown: false }}
          />
        </Stack>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
