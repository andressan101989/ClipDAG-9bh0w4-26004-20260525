import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import type { ViewProps } from 'react-native';

export type DeepARCameraPosition = 'front' | 'back';

export type DeepARFabricViewProps = ViewProps & {
  apiKey: string;
  cameraPosition?: DeepARCameraPosition;
};

export type DeepARFabricViewRef = {
  switchEffect(path: string): Promise<void>;
  clearEffect(): Promise<void>;
};

type NativeDeepARFabricView = React.ComponentType<DeepARFabricViewProps> & {
  switchEffect?: (path: string) => Promise<void>;
  clearEffect?: () => Promise<void>;
};

let NativeDeepARFabricViewComponent: NativeDeepARFabricView | null = null;

function getNativeDeepARFabricView(): NativeDeepARFabricView {
  if (!NativeDeepARFabricViewComponent) {
    NativeDeepARFabricViewComponent =
      requireNativeViewManager('DeepARFabricView') as NativeDeepARFabricView;
  }

  return NativeDeepARFabricViewComponent;
}

const DeepARFabricView = React.forwardRef<DeepARFabricViewRef, DeepARFabricViewProps>(
  ({ cameraPosition = 'front', ...props }, ref) => {
    const nativeRef = React.useRef<DeepARFabricViewRef | null>(null);

    React.useImperativeHandle(ref, () => ({
      switchEffect: async (path: string) => {
        await nativeRef.current?.switchEffect?.(path);
      },
      clearEffect: async () => {
        await nativeRef.current?.clearEffect?.();
      },
    }));

    return React.createElement(
      getNativeDeepARFabricView(),
      {
        ...props,
        ref: nativeRef,
        cameraPosition,
      } as DeepARFabricViewProps & { ref: React.Ref<DeepARFabricViewRef> }
    );
  }
);

DeepARFabricView.displayName = 'DeepARFabricView';

export default DeepARFabricView;
export { DeepARFabricView };
