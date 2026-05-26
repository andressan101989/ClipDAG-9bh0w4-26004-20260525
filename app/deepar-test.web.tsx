/**
 * app/deepar-test.web.tsx — Web stub
 *
 * DeepAR requires native iOS/Android modules.
 * This stub replaces deepar-test.tsx on web/PC preview to prevent
 * the "requireNativeComponent is not a function" crash.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

export default function DeepARTestWebStub() {
  const router = useRouter();
  return (
    <View style={s.root}>
      <Text style={s.icon}>📵</Text>
      <Text style={s.title}>DeepAR no disponible en web</Text>
      <Text style={s.body}>
        DeepAR SDK requiere un build nativo iOS/Android.{'\n'}
        Usa EAS Build + TestFlight/APK para probar esta pantalla.
      </Text>
      <Pressable style={s.btn} onPress={() => router.back()}>
        <Text style={s.btnText}>← Volver</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#07070F', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  icon:    { fontSize: 52 },
  title:   { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body:    { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 22 },
  btn:     { marginTop: 12, backgroundColor: '#1A1A2E', borderRadius: 12, paddingHorizontal: 28, paddingVertical: 13, borderWidth: 1, borderColor: '#2A2A3E' },
  btnText: { color: '#aaa', fontSize: 14, fontWeight: '600' },
});
