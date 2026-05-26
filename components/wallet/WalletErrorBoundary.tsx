/**
 * components/wallet/WalletErrorBoundary.tsx
 * Error boundary for the Wallet screen.
 */
import React, { Component } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const C_ERR = '#FF6B6B';
const C_BG  = '#07070F';
const C_PRI = '#7C5CFF';
const C_TXT = '#FFFFFF';
const C_SUB = '#8888AA';

interface State { hasError: boolean; errorMsg: string }

export class WalletErrorBoundary extends Component<{ children: React.ReactNode }, State> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(e: any): State {
    return { hasError: true, errorMsg: e?.message ?? String(e) };
  }

  componentDidCatch(e: any, info: any) {
    console.error('[WalletErrorBoundary]', e?.message, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={s.wrap}>
          <MaterialCommunityIcons name="alert-circle-outline" size={52} color={C_ERR} />
          <Text style={s.title}>Error al cargar billetera</Text>
          <Text style={s.msg}>{this.state.errorMsg}</Text>
          <Pressable
            style={s.btn}
            onPress={() => this.setState({ hasError: false, errorMsg: '' })}
          >
            <Text style={s.btnText}>Reintentar</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: C_BG, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title:   { color: C_TXT, fontSize: 18, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  msg:     { color: C_SUB, fontSize: 13, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  btn:     { marginTop: 24, backgroundColor: C_PRI, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
