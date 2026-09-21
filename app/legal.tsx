import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Stack, useRouter, type Href } from 'expo-router';
import { legalManifest } from '@/shared/legal/manifest';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const reviewedNames: Record<string, string> = {
  community: 'Community',
  copyright: 'Copyright',
  monetization: 'Monetization',
  cookies: 'Cookies',
};

export default function LegalScreen() {
  const router = useRouter();
  return <>
    <Stack.Screen options={{ headerShown: true, title: 'Legal and policies' }} />
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.heading}>Legal and policies</Text>
      <Text style={styles.intro}>Current document availability is shown on each page.</Text>
      <View style={styles.group}>
        <Pressable accessibilityRole="link" accessibilityLabel="Privacy Policy" onPress={() => router.push(legalManifest.routes.privacy.mobile as Href)} style={styles.link}>
          <Text style={styles.linkText}>Privacy Policy</Text>
        </Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="Terms of Service" onPress={() => router.push(legalManifest.routes.terms.mobile as Href)} style={styles.link}>
          <Text style={styles.linkText}>Terms of Service</Text>
        </Pressable>
      </View>
      <Text accessibilityRole="header" style={styles.subheading}>Other policies</Text>
      {legalManifest.legacyHub.reviewRequired.map((id) => <View key={id} style={styles.card}>
        <Text style={styles.cardTitle}>{reviewedNames[id] ?? id}</Text>
        <Text style={styles.cardBody}>This policy is under review and is not published as a final version.</Text>
      </View>)}
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.md },
  heading: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  intro: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 22 },
  group: { gap: Spacing.sm },
  link: { minHeight: 48, justifyContent: 'center', padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  linkText: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  subheading: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  card: { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  cardTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  cardBody: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 22 },
});
