import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';

export default function MyOrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Mis pedidos</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.centered}>
        <MaterialIcons name="account-balance-wallet" size={52} color={Colors.textSubtle} />
        <Text style={styles.title}>Checkout BDAG pendiente</Text>
        <Text style={styles.message}>
          Los pedidos se habilitarán cuando el checkout autoritativo en BDAG esté disponible.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  message: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
  },
});
