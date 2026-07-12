import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function LegacyLiveSessionRedirect() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const href = sessionId ? `/live/watch/${sessionId}` : '/(tabs)';
  return <Redirect href={href as any} />;
}
