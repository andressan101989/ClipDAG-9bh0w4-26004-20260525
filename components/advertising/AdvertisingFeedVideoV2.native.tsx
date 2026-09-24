import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "@/components/ui/SafeImage";

let VideoView: any = null;
let useVideoPlayer: any = (_source: unknown, _setup?: (player: any) => void) => null;
try {
  // Match the established native Feed/Story video loading boundary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoVideo = require("expo-video");
  VideoView = expoVideo.VideoView ?? null;
  useVideoPlayer = expoVideo.useVideoPlayer ?? useVideoPlayer;
} catch { /* A safe thumbnail may still render; otherwise readiness stays closed. */ }

type Props = { url: string; thumbnailUrl: string | null; isActive: boolean; onReady: () => void };

export function AdvertisingFeedVideoV2({ url, thumbnailUrl, isActive, onReady }: Props) {
  const [ready, setReady] = useState(false);
  const notifiedRef = useRef(false);
  const player = useVideoPlayer({ uri: url, contentType: "hls" }, (instance: any) => {
    instance.loop = true;
    instance.muted = true;
    instance.staysActiveInBackground = false;
  });

  useEffect(() => {
    const markReady = () => {
      setReady(true);
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        onReady();
      }
    };
    const subscription = player?.addListener?.("statusChange", ({ status }: { status?: string }) => {
      if (status === "readyToPlay") markReady();
      if (status === "error") setReady(false);
    });
    if (player?.status === "readyToPlay") markReady();
    return () => subscription?.remove?.();
  }, [onReady, player]);

  useEffect(() => {
    try {
      if (isActive && ready) player?.play?.();
      else player?.pause?.();
    } catch {}
    return () => { try { player?.pause?.(); } catch {} };
  }, [isActive, player, ready]);

  return (
    <View style={StyleSheet.absoluteFillObject}>
      {VideoView && player ? <VideoView player={player} style={StyleSheet.absoluteFillObject} contentFit="cover" nativeControls={false} /> : null}
      {!ready && thumbnailUrl ? <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" onLoad={onReady} /> : null}
    </View>
  );
}
