import React from 'react';
import { Stack } from 'expo-router';
import { CanonicalLegalDocument } from '@/components/legal/CanonicalLegalDocument';

export default function PrivacyPolicyScreen() {
  return <>
    <Stack.Screen options={{ headerShown: true, title: 'Privacy Policy' }} />
    <CanonicalLegalDocument id="privacy" locale="en" />
  </>;
}
