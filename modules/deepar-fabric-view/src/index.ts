import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { NativeModules, type ViewProps } from 'react-native';

export type DeepARCameraPosition = 'front' | 'back';

export type DeepARFabricViewProps = ViewProps & {
  apiKey: string;
  cameraPosition?: DeepARCameraPosition;
  onInitialized?: () => void;
  onCameraReady?: () => void;
  onScreenshotTaken?: (uri: string) => void;
  onVideoRecordingFinished?: (uri: string) => void;
  onError?: (text: string, isFatal?: boolean) => void;
};

export type DeepARFabricViewRef = {
  switchEffect(path: string): Promise<void>;
  clearEffect(): Promise<void>;
  takeScreenshot(): Promise<void>;
  startVideoRecording(): Promise<void>;
  finishVideoRecording(): Promise<void>;
};

type NativeDeepARFabricView = React.ComponentType<DeepARFabricViewProps> & {
  switchEffect?: (path: string) => Promise<void>;
  clearEffect?: () => Promise<void>;
  takeScreenshot?: () => Promise<void>;
  startVideoRecording?: () => Promise<void>;
  finishVideoRecording?: () => Promise<void>;
};

let NativeDeepARFabricViewComponent: NativeDeepARFabricView | null = null;

function getNativeDeepARFabricView(): NativeDeepARFabricView {
  if (!NativeDeepARFabricViewComponent) {
    const proxy = NativeModules.NativeUnimoduleProxy;
    console.log('[DeepARDiag] NativeUnimoduleProxy exists:', !!proxy);
    console.log('[DeepARDiag] viewManagersMetadata keys:', Object.keys(proxy?.viewManagersMetadata ?? {}));
    console.log('[DeepARDiag] DeepARFabricView metadata:', proxy?.viewManagersMetadata?.DeepARFabricView);
    console.log('[DeepARDiag] modulesConstants keys:', Object.keys(proxy?.modulesConstants ?? {}));
    console.log('[DeepARDiag] DeepARFabricView constants:', proxy?.modulesConstants?.DeepARFabricView);

    NativeDeepARFabricViewComponent =
      requireNativeViewManager('DeepARFabricView') as NativeDeepARFabricView;
  }

  return NativeDeepARFabricViewComponent;
}

const DeepARFabricView = React.forwardRef<DeepARFabricViewRef, DeepARFabricViewProps>(
  ({
    cameraPosition = 'front',
    onInitialized,
    onCameraReady,
    onScreenshotTaken,
    onVideoRecordingFinished,
    onError,
    ...props
  }, ref) => {
    const nativeRef = React.useRef<DeepARFabricViewRef | null>(null);

    React.useImperativeHandle(ref, () => ({
      switchEffect: async (path: string) => {
        await nativeRef.current?.switchEffect?.(path);
      },
      clearEffect: async () => {
        await nativeRef.current?.clearEffect?.();
      },
      takeScreenshot: async () => {
        console.log('[DeepARCapture] takeScreenshot ref call');
        await nativeRef.current?.takeScreenshot?.();
      },
      startVideoRecording: async () => {
        console.log('[DeepARCapture] startVideoRecording ref call');
        await nativeRef.current?.startVideoRecording?.();
      },
      finishVideoRecording: async () => {
        console.log('[DeepARCapture] finishVideoRecording ref call');
        await nativeRef.current?.finishVideoRecording?.();
      },
    }));

    const getPayload = React.useCallback((eventOrPayload: any) => (
      eventOrPayload?.nativeEvent ?? eventOrPayload ?? {}
    ), []);

    const handleInitialized = React.useCallback(() => {
      console.log('[DeepARCapture] onInitialized event');
      onInitialized?.();
    }, [onInitialized]);

    const handleCameraReady = React.useCallback(() => {
      console.log('[DeepARCapture] onCameraReady event');
      onCameraReady?.();
    }, [onCameraReady]);

    const handleScreenshotTaken = React.useCallback((event: any) => {
      const uri = getPayload(event)?.uri;
      console.log('[DeepARCapture] onScreenshotTaken event uri:', uri ?? 'null');
      if (typeof uri === 'string' && uri.length > 0) {
        onScreenshotTaken?.(uri);
      }
    }, [getPayload, onScreenshotTaken]);

    const handleVideoRecordingFinished = React.useCallback((event: any) => {
      const uri = getPayload(event)?.uri;
      console.log('[DeepARCapture] onVideoRecordingFinished event uri:', uri ?? 'null');
      if (typeof uri === 'string' && uri.length > 0) {
        onVideoRecordingFinished?.(uri);
      }
    }, [getPayload, onVideoRecordingFinished]);

    const handleError = React.useCallback((event: any) => {
      const payload = getPayload(event);
      const message = payload?.message ?? payload?.text ?? 'DeepAR error';
      const isFatal = Boolean(payload?.isFatal);
      console.log('[DeepARCapture] onError event:', message, 'fatal:', isFatal);
      onError?.(message, isFatal);
    }, [getPayload, onError]);

    return React.createElement(
      getNativeDeepARFabricView(),
      {
        ...props,
        ref: nativeRef,
        cameraPosition,
        onInitialized: handleInitialized,
        onCameraReady: handleCameraReady,
        onScreenshotTaken: handleScreenshotTaken,
        onVideoRecordingFinished: handleVideoRecordingFinished,
        onError: handleError,
      } as DeepARFabricViewProps & { ref: React.Ref<DeepARFabricViewRef> }
    );
  }
);

DeepARFabricView.displayName = 'DeepARFabricView';

export default DeepARFabricView;
export { DeepARFabricView };
