import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';

let VideoView: any = null;
let useVideoPlayer: any = (_source: unknown, _setup?: (player: any) => void) => null;
try {
  // Match the established native Story viewer loading boundary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoVideo = require('expo-video');
  VideoView = expoVideo.VideoView ?? null;
  useVideoPlayer = expoVideo.useVideoPlayer ?? useVideoPlayer;
} catch { /* Native preview degrades safely if the module is unavailable. */ }

export function StoryEditorVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance: any) => {
    instance.loop = true;
    instance.muted = true;
  });
  useEffect(() => {
    try { player?.play?.(); } catch {}
    return () => { try { player?.pause?.(); } catch {} };
  }, [player]);
  if (!VideoView || !player) return null;
  return <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFillObject} />;
}
