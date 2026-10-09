import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type ProtectedPremiumImageGrant = {
  contentId: string;
  url: string;
  expiresAt: string;
};

type ProtectedPremiumImageProps = {
  grant: ProtectedPremiumImageGrant | null;
  visible: boolean;
  screenProtected: boolean;
  style?: StyleProp<ViewStyle>;
  onError?: () => void;
};

export function ProtectedPremiumImage({
  grant,
  visible,
  screenProtected,
  style,
  onError,
}: ProtectedPremiumImageProps) {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const mayMountSource = Boolean(grant && visible && screenProtected);
  const sourceKey = mayMountSource && grant
    ? `${grant.contentId}:${grant.expiresAt}`
    : null;
  const currentSourceKeyRef = useRef<string | null>(null);
  currentSourceKeyRef.current = sourceKey;
  const sourceIsVisible = sourceKey !== null
    && loadedKey === sourceKey
    && failedKey !== sourceKey;

  useEffect(() => {
    currentSourceKeyRef.current = sourceKey;
    return () => {
      if (currentSourceKeyRef.current === sourceKey) currentSourceKeyRef.current = null;
    };
  }, [sourceKey]);

  return (
    <View style={[styles.frame, style]}>
      {mayMountSource && grant ? (
        <Image
          key={sourceKey}
          source={{ uri: grant.url }}
          recyclingKey={sourceKey}
          cachePolicy="none"
          enableLiveTextInteraction={false}
          contentFit="contain"
          style={styles.media}
          onLoad={() => {
            if (currentSourceKeyRef.current !== sourceKey) return;
            setFailedKey(null);
            setLoadedKey(sourceKey);
          }}
          onError={() => {
            if (currentSourceKeyRef.current !== sourceKey) return;
            setLoadedKey(null);
            setFailedKey(sourceKey);
            onError?.();
          }}
        />
      ) : null}
      {!sourceIsVisible ? <View pointerEvents="none" style={styles.cover} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#05060A',
  },
  media: {
    ...StyleSheet.absoluteFillObject,
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: '#05060A',
  },
});
