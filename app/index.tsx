/**
 * app/index.tsx — STARTUP ISOLATION: redirects to /boot-test
 *
 * No hooks. No auth. No providers. Pure redirect.
 */

console.log('[BOOT] index.tsx evaluated');

import { Redirect } from 'expo-router';

export default function Index() {
  console.log('[BOOT] Index render');
  return <Redirect href="/boot-test" />;
}
