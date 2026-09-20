import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { getMobileLegalPageState } from '../../shared/legal/mobile.ts';
import type { LegalId, LegalLocale } from '../../shared/legal/core.ts';

// Future route component only. Active legacy mobile legal routes do not import it.
export function CanonicalLegalDocument({ id, locale }: { id: LegalId; locale: LegalLocale }) {
  const state = getMobileLegalPageState(id, locale);
  if (state.state !== 'approved') {
    return <View style={styles.pending}><Text accessibilityRole="header" style={styles.title}>{id === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}</Text><Text style={styles.body}>{state.state === 'retired' ? 'This document is no longer current.' : 'This document has not yet been approved or published as a current policy.'}</Text></View>;
  }
  const document = state.document;
  return <ScrollView contentContainerStyle={styles.page} accessibilityLabel={document.title}>
    <Text accessibilityRole="header" style={styles.title}>{document.title}</Text>
    <Text style={styles.meta}>Version {document.version} · Effective {document.effectiveDate} · Updated {document.lastUpdated}</Text>
    {document.sections.map((section) => <View key={section.id} style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
      {section.blocks.map((block, index) => block.type === 'paragraph'
        ? <Text key={index} style={styles.body}>{block.text}</Text>
        : block.type === 'list'
          ? <View key={index}>{block.items.map((item, itemIndex) => <Text key={itemIndex} style={styles.body}>• {item}</Text>)}</View>
          : <Text key={index} style={styles.body}>{block.value}</Text>)}
    </View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 60, backgroundColor: '#F5F7FA' },
  pending: { flex: 1, padding: 24, backgroundColor: '#F5F7FA' },
  title: { color: '#0C1F4F', fontSize: 30, fontWeight: '700', marginBottom: 12 },
  meta: { color: '#52627D', fontSize: 14, lineHeight: 22, marginBottom: 28 },
  section: { marginBottom: 28 },
  heading: { color: '#123B9E', fontSize: 22, fontWeight: '700', marginBottom: 10 },
  body: { color: '#23334D', fontSize: 16, lineHeight: 25, marginBottom: 10 },
});
