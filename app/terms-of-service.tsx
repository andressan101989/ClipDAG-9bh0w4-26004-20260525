import React from 'react';
import { Stack } from 'expo-router';
import { CanonicalLegalDocument } from '@/components/legal/CanonicalLegalDocument';

export default function TermsOfServiceScreen() {
  return <>
    <Stack.Screen options={{ headerShown: true, title: 'Terms of Service' }} />
    <CanonicalLegalDocument id="terms" locale="en" />
  </>;
}
