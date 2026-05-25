/**
 * hooks/useMlKitFaceDetector.ts
 *
 * Standalone face detector using @react-native-ml-kit/face-detection.
 * Works WITHOUT expo-camera's onFacesDetected callback — instead we:
 *
 *   1. Accept a `cameraRef` (expo-camera CameraView ref)
 *   2. Every `intervalMs` milliseconds, call takePictureAsync() to grab
 *      a JPEG frame (quality=0.3, no shutter sound/flash)
 *   3. Feed the image URI to FaceDetector.detectFromUri()
 *   4. Call updateFromMLKit() with the first detected face
 *   5. Call clearFace() if no faces found
 *
 * The interval is paused while recording video (isRecording=true) so that
 * takePictureAsync doesn't interfere with recordAsync.
 *
 * Fall-back: if @react-native-ml-kit/face-detection is not installed / fails
 * to import, the hook becomes a no-op so the rest of the app keeps working.
 *
 * ML Kit landmark map → NormalisedFace landmark keys:
 *   LEFT_EYE  → leftEye     RIGHT_EYE  → rightEye
 *   NOSE_BASE → noseBase    LEFT_CHEEK → leftCheek
 *   RIGHT_CHEEK → rightCheek
 *   LEFT_EAR  → leftEar     RIGHT_EAR  → rightEar
 *   LEFT_MOUTH → leftMouth  RIGHT_MOUTH → rightMouth
 *
 * Image size: ML Kit returns coords in image-pixel space.
 * takePictureAsync at quality=0.3 on a 1080p sensor → ~540×960 px image.
 * We obtain the actual width/height from the result and forward it so
 * useFaceTracking can scale correctly.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { NormalisedFace } from './useFaceTracking';

// ── Lazy-load ML Kit so the import never hard-crashes on unsupported envs ────
let FaceDetector: any = null;
let FaceDetectorContourType: any = null;
let FaceDetectorLandmarkType: any = null;

try {
  const mlkit = require('@react-native-ml-kit/face-detection');
  FaceDetector            = mlkit.default ?? mlkit.FaceDetector ?? null;
  FaceDetectorLandmarkType = mlkit.FaceDetectorLandmarkType ?? null;
} catch {
  // Package not installed — silently degraded
}

// ── Landmark type IDs (fallback numbers match ML Kit's enum) ─────────────────
const LM = FaceDetectorLandmarkType ?? {
  LEFT_EYE:    0,
  RIGHT_EYE:   1,
  LEFT_EAR:    3,
  RIGHT_EAR:   4,
  LEFT_CHEEK:  5,
  RIGHT_CHEEK: 6,
  NOSE_BASE:   7,
  LEFT_MOUTH:  8,
  RIGHT_MOUTH: 9,
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface UseMlKitFaceDetectorParams {
  cameraRef:       React.MutableRefObject<any>;
  isRecording:     boolean;
  facing:          'front' | 'back';
  enabled:         boolean;
  intervalMs?:     number;
  updateFromMLKit: (face: NormalisedFace) => void;
  clearFace:       () => void;
  onDebug?:        (info: string) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useMlKitFaceDetector({
  cameraRef,
  isRecording,
  facing,
  enabled,
  intervalMs = 150,
  updateFromMLKit,
  clearFace,
  onDebug,
}: UseMlKitFaceDetectorParams) {
  const runningRef    = useRef(false);
  const enabledRef    = useRef(enabled);
  const recordingRef  = useRef(isRecording);

  // Keep refs current without adding them to effect deps
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { recordingRef.current = isRecording; }, [isRecording]);

  // ── Adapter: ML Kit face → NormalisedFace ─────────────────────────────────
  const adaptMLKitFace = useCallback(
    (face: any, imageWidth: number, imageHeight: number): NormalisedFace => {
      // Helper to pull a landmark by type id
      const lm = (typeId: number) => {
        const arr: any[] = face.landmarks ?? [];
        const found = arr.find((l: any) => l.type === typeId);
        return found ? { x: found.position.x, y: found.position.y } : undefined;
      };

      // ML Kit face object can expose frame as:
      //   face.frame         → {left, top, width, height}  (newer versions)
      //   face.boundingBox   → {left, top, width, height}  (some versions)
      const fr = face.frame ?? face.boundingBox ?? {};
      return {
        bounds: {
          x:      fr.left   ?? face.left   ?? 0,
          y:      fr.top    ?? face.top    ?? 0,
          width:  fr.width  ?? face.width  ?? 100,
          height: fr.height ?? face.height ?? 100,
        },
        imageSize: { width: imageWidth, height: imageHeight },
        landmarks: {
          leftEye:     lm(LM.LEFT_EYE),
          rightEye:    lm(LM.RIGHT_EYE),
          noseBase:    lm(LM.NOSE_BASE),
          leftMouth:   lm(LM.LEFT_MOUTH),
          rightMouth:  lm(LM.RIGHT_MOUTH),
          leftCheek:   lm(LM.LEFT_CHEEK),
          rightCheek:  lm(LM.RIGHT_CHEEK),
          leftEar:     lm(LM.LEFT_EAR),
          rightEar:    lm(LM.RIGHT_EAR),
        },
        angles: {
          roll:  face.headEulerAngleZ ?? 0,
          yaw:   face.headEulerAngleY ?? 0,
          smile: face.smilingProbability ?? 0,
        },
      };
    }, [],
  );

  // ── Detection loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!FaceDetector) {
      // ML Kit not available — no-op
      onDebug?.('ML Kit not available on this device/environment');
      return;
    }

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const detect = async () => {
      if (stopped) return;
      if (!enabledRef.current || recordingRef.current) {
        // Paused — retry later
        timerId = setTimeout(detect, intervalMs);
        return;
      }

      const cam = cameraRef.current;
      if (!cam) {
        timerId = setTimeout(detect, intervalMs);
        return;
      }

      try {
        // Capture a low-quality still frame for processing
        const photo = await cam.takePictureAsync({
          quality:         0.25,
          skipProcessing:  true,
          shutterSound:    false,
          flash:           'off',
          exif:            false,
        });

        if (!photo?.uri || stopped) {
          timerId = setTimeout(detect, intervalMs);
          return;
        }

        const imgW = photo.width  ?? 480;
        const imgH = photo.height ?? 640;

        // Run ML Kit face detection on the captured frame
        // API: detect(uri) — NOT detectFromUri (that method doesn't exist)
        const detectFn =
          typeof FaceDetector?.detect === 'function'
            ? (uri: string) => FaceDetector.detect(uri)
            : typeof FaceDetector?.detectFromUri === 'function'
            ? (uri: string) => FaceDetector.detectFromUri(uri, { landmarkMode: 'all', classificationMode: 'all', performanceMode: 'fast' })
            : null;

        if (!detectFn) {
          onDebug?.('ML Kit: no detect method found on FaceDetector');
          timerId = setTimeout(detect, intervalMs);
          return;
        }

        const faces = await detectFn(photo.uri);

        if (stopped) return;

        if (!faces || faces.length === 0) {
          clearFace();
          onDebug?.('No face detected');
        } else {
          const norm = adaptMLKitFace(faces[0], imgW, imgH);
          updateFromMLKit(norm);
          if (onDebug) {
            const b = norm.bounds;
            onDebug(`MLKit bbox: x${b.x.toFixed(0)} y${b.y.toFixed(0)} w${b.width.toFixed(0)} h${b.height.toFixed(0)} | img:${imgW}×${imgH}`);
          }
        }
      } catch (err: any) {
        // Don't crash — just retry
        if (!stopped) onDebug?.(`ML Kit err: ${err?.message ?? err}`);
      }

      if (!stopped) {
        timerId = setTimeout(detect, intervalMs);
      }
    };

    // Kick off the loop
    detect();

    return () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    };
  }, []); // intentionally empty — loop manages its own state via refs
}
