// client/src/hooks/useBlinkDetector.js
// Reusable FaceMesh EAR blink detector
// Used by: BlinkPanel (call), SOSButton (triple blink), Onboarding (calibration)

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../store/stores';

// Eye landmark indices for MediaPipe FaceMesh
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function computeEAR(landmarks, indices) {
  const p = indices.map(i => landmarks[i]);
  const A = dist(p[1], p[5]);
  const B = dist(p[2], p[4]);
  const C = dist(p[0], p[3]);
  return (A + B) / (2.0 * C);
}

export default function useBlinkDetector(videoRef, {
  onBlink,          // called on each blink with duration ms
  onTripleBlink,    // called when 3 blinks in 1.5s (SOS)
  enabled = true,
  overrideThreshold = null,
  overrideDashMs = null,
} = {}) {
  const { user } = useAuthStore();

  const [isEyeClosed, setIsEyeClosed] = useState(false);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [faceMeshReady, setFaceMeshReady] = useState(false);

  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  const isClosedRef = useRef(false);
  const blinkStartRef = useRef(null);
  const recentBlinks = useRef([]);  // timestamps for triple-blink detection

  // Thresholds from user's personal blink profile
  const EAR_THRESHOLD = overrideThreshold ?? user?.blinkProfile?.earThreshold ?? 0.25;
  const DASH_MS = overrideDashMs ?? user?.blinkProfile?.dashMs ?? 400;

  const initFaceMesh = useCallback(async () => {
    if (!videoRef?.current || !enabled) return;

    try {
      const faceMeshModule = await import('@mediapipe/face_mesh').catch(() => null);
      if (!faceMeshModule && isMountedRef.current) {
        console.warn('FaceMesh module failed to load. Blink detection unavailable.');
        return;
      }
      
      const FaceMesh = faceMeshModule?.FaceMesh || faceMeshModule?.default?.FaceMesh || window.FaceMesh;
      
      const cameraModule = await import('@mediapipe/camera_utils').catch(() => null);
      const Camera = cameraModule?.Camera || cameraModule?.default?.Camera || window.Camera;

      if (!FaceMesh || !Camera) {
         console.warn('MediaPipe FaceMesh/Camera missing.');
         return;
      }

      const faceMesh = new FaceMesh({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results) => {
        if (!results.multiFaceLandmarks?.length) return;

        const lm = results.multiFaceLandmarks[0];
        const leftEAR = computeEAR(lm, LEFT_EYE);
        const rightEAR = computeEAR(lm, RIGHT_EYE);
        const ear = (leftEAR + rightEAR) / 2;

        setCurrentEAR(ear);

        const eyeClosed = ear < EAR_THRESHOLD;
        const wasOpen = !isClosedRef.current;
        const wasClosed = isClosedRef.current;

        // Eye just closed
        if (eyeClosed && wasOpen) {
          isClosedRef.current = true;
          blinkStartRef.current = Date.now();
          setIsEyeClosed(true);
        }

        // Eye just opened — blink complete
        if (!eyeClosed && wasClosed) {
          isClosedRef.current = false;
          setIsEyeClosed(false);

          const duration = blinkStartRef.current
            ? Date.now() - blinkStartRef.current
            : 0;
          blinkStartRef.current = null;

          const type = duration >= DASH_MS ? 'dash' : 'dot';

          // Fire onBlink with duration and type
          onBlink?.({ duration, type, ear });

          // Track for triple-blink SOS detection
          const now = Date.now();
          recentBlinks.current = [
            ...recentBlinks.current.filter(t => now - t < 1500),
            now,
          ];

          if (recentBlinks.current.length >= 3) {
            onTripleBlink?.();
            recentBlinks.current = [];
          }
        }
      });

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (faceMesh) await faceMesh.send({ image: videoRef.current });
        },
        width: 640, height: 480,
      });

      faceMeshRef.current = faceMesh;
      cameraRef.current = camera;

      await camera.start();
      if (isMountedRef.current) setFaceMeshReady(true);
    } catch (err) {
      if (isMountedRef.current) {
         console.error('FaceMesh init error:', err);
      }
    }
  }, [enabled, EAR_THRESHOLD, DASH_MS, onBlink, onTripleBlink, videoRef]);

  const isMountedRef = useRef(true);
  
  useEffect(() => {
    isMountedRef.current = true;
    if (enabled) initFaceMesh();
    
    return () => {
      isMountedRef.current = false;
      if (cameraRef.current) {
         cameraRef.current.stop();
         cameraRef.current = null;
      }
      if (faceMeshRef.current) {
         try { faceMeshRef.current.close(); } catch (e) {}
         faceMeshRef.current = null;
      }
      setFaceMeshReady(false);
    };
  }, [enabled, initFaceMesh]);

  return { isEyeClosed, currentEAR, faceMeshReady };
}