import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "@/components/ui/SafeImage";
import { createAdvertisingV2VideoQualificationController } from "@/services/advertisingV2FeedRuntime.mjs";

let VideoView: any = null;
let useVideoPlayer: any = (_source: unknown, _setup?: (player: any) => void) => null;
try {
  // Match the established native Feed/Story video loading boundary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const expoVideo = require("expo-video");
  VideoView = expoVideo.VideoView ?? null;
  useVideoPlayer = expoVideo.useVideoPlayer ?? useVideoPlayer;
} catch { /* A safe thumbnail may still render; otherwise readiness stays closed. */ }

type Props = {
  url: string;
  thumbnailUrl: string | null;
  isActive: boolean;
  onReady: () => void;
  onQualifiedView?: () => void;
};

export function AdvertisingFeedVideoV2({ url, thumbnailUrl, isActive, onReady, onQualifiedView }: Props) {
  const [ready, setReady] = useState(false);
  const notifiedRef = useRef(false);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const qualifiedCallbackRef = useRef(onQualifiedView);
  qualifiedCallbackRef.current = onQualifiedView;
  const qualificationRef = useRef<ReturnType<typeof createAdvertisingV2VideoQualificationController> | null>(null);
  qualificationRef.current ??= createAdvertisingV2VideoQualificationController(() => qualifiedCallbackRef.current?.());
  const player = useVideoPlayer({ uri: url, contentType: "hls" }, (instance: any) => {
    instance.loop = true;
    instance.muted = true;
    instance.staysActiveInBackground = false;
    instance.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    setReady(false);
    notifiedRef.current = false;
    qualificationRef.current?.reset();
    qualificationRef.current?.setActive(activeRef.current);
  }, [url]);

  useEffect(() => { qualificationRef.current?.setActive(isActive); }, [isActive]);
  useEffect(() => { qualificationRef.current?.setReady(ready); }, [ready]);

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
    const playingSubscription = player?.addListener?.("playingChange", ({ isPlaying }: { isPlaying?: boolean }) => {
      qualificationRef.current?.setPlaying(Boolean(isPlaying));
    });
    const sourceSubscription = player?.addListener?.("sourceLoad", ({ duration }: { duration?: number }) => {
      qualificationRef.current?.setDuration(duration);
    });
    const timeSubscription = player?.addListener?.("timeUpdate", ({ currentTime }: { currentTime?: number }) => {
      qualificationRef.current?.observeTime(Number(currentTime));
    });
    const endSubscription = player?.addListener?.("playToEnd", () => qualificationRef.current?.complete());
    return () => {
      playingSubscription?.remove?.();
      sourceSubscription?.remove?.();
      timeSubscription?.remove?.();
      endSubscription?.remove?.();
    };
  }, [player]);

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
      {!ready && thumbnailUrl ? <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" /> : null}
    </View>
  );
}
