import { useEffect } from 'react';
import { AppState, Linking } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { consumeRecentWalletExternalOperation } from '@/services/walletExternalOperation';

export function WalletConnectReturnHandler() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const routeToWallet = () => {
      if (/\/(call|video-call|group-call)\//.test(pathname)) return;
      router.replace('/(tabs)/wallet');
    };
    const handleUrl = (url: string | null) => {
      if (url?.toLowerCase().startsWith('onspaceapp://wallet')) routeToWallet();
    };
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    const urlSubscription = Linking.addEventListener('url', event => handleUrl(event.url));
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      consumeRecentWalletExternalOperation().then(recent => {
        if (recent) routeToWallet();
      }).catch(() => {});
    });
    return () => {
      urlSubscription.remove();
      appStateSubscription.remove();
    };
  }, [pathname, router]);
  return null;
}

