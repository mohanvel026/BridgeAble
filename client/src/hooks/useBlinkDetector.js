// client/src/hooks/useBlinkDetector.js
// ═══════════════════════════════════════════════════════════════════════════════
// Industry-Grade EAR Blink Detector — v4.0 (Zero-Render Optimization)
// 
// Architecture Upgrades:
//  - Fully decouples 60fps tracking data from React State (Zero Re-renders).
//  - Exposes `onFrameUpdate` for consumers to directly mutate DOM refs.
//  - Pinned WASM binary loader to v0.4.1633559619.
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/stores';

// MediaPipe FaceMesh landmark indices
const LEFT_EYE  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33,  160, 158, 133, 153, 144];

// 3D Euclidean distance (uses z-depth for head-tilt compensation)
function dist3D(a, b) {
  return Math.sqrt(
    (a.x - b.x) ** 2 +
    (a.y - b.y) ** 2 +
    (a.z - b.z) ** 2
  );
}

function computeEAR3D(lm, idx) {
  const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
  const C = dist3D(p1, p4);
  if (C < 1e-7) return 0.30; 
  return (dist3D(p2, p6) + dist3D(p3, p5)) / (2.0 * C);
}

function rollingMedian(buf, val, size = 5) {
  buf.push(val);
  if (buf.length > size) buf.shift();
  const s = [...buf].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function iqrMean(arr) {
  if (!arr.length) return 0.28;
  const s = [...arr].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  const clean = s.filter(v => v >= q1 && v <= q3);
  return clean.reduce((a, b) => a + b, 0) / (clean.length || 1);
}

export default function useBlinkDetector(videoRef, {
  onBlink,
  onTripleBlink,
  onFrameUpdate, // High-freq callback for direct DOM mutation
  enabled = true,
  overrideThreshold = null,
  overrideDashMs    = null,
} = {}) {
  const { user } = useAuthStore();
  
  // Condense all mutable tracking data into a single, synchronous ref object
  // This completely eliminates React re-renders during the 60fps tracking loop
  const state = useRef({
    isMounted: true,
    isClosed: false,
    baselineEAR: null,
    threshClose: null,
    threshOpen: null,
    blinkStart: null,
    lastOpenedAt: 0,
    recentBlinks: [],
    earHistory: [],
    earBufL: [],
    earBufR: [],
    baselineSamples: [],
    prevEAR: null,
    velocityBuf: []
  });

  const refs = useRef({
    faceMesh: null,
    camera: null,
  });

  const SAVED_THRESHOLD = overrideThreshold ?? user?.blinkProfile?.earThreshold ?? null;
  const DASH_MS         = overrideDashMs    ?? user?.blinkProfile?.dashMs        ?? 400;

  const initFaceMesh = useCallback(async () => {
    if (!videoRef?.current || !enabled) return;

    try {
      const [fmMod, camMod] = await Promise.all([
        import('@mediapipe/face_mesh').catch(() => ({})),
        import('@mediapipe/camera_utils').catch(() => ({})),
      ]);

      const FaceMesh = fmMod.FaceMesh || fmMod.default?.FaceMesh || window.FaceMesh;
      const Camera   = camMod.Camera  || camMod.default?.Camera  || window.Camera;

      if (!FaceMesh || !Camera || !state.current.isMounted || !videoRef.current) return;

      const faceMesh = new FaceMesh({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true, // Requires iris landmarks for accuracy
        minDetectionConfidence: 0.70,
        minTrackingConfidence: 0.70,
      });

      faceMesh.onResults(results => {
        if (!state.current.isMounted || !results.multiFaceLandmarks?.length) return;

        const lm = results.multiFaceLandmarks[0];
        const s = state.current;
        
        const rawL = computeEAR3D(lm, LEFT_EYE);
        const rawR = computeEAR3D(lm, RIGHT_EYE);
        
        const medL = rollingMedian(s.earBufL, rawL, 5);
        const medR = rollingMedian(s.earBufR, rawR, 5);

        // Gate: Asymmetrical squints usually mean head turn/lighting failure
        if (Math.abs(medL - medR) > 0.06) return;

        const ear = (medL + medR) / 2;
        
        s.earHistory.push(ear);
        if (s.earHistory.length > 60) s.earHistory.shift();

        // Blink velocity tracking
        let velocity = 0;
        if (s.prevEAR !== null) {
          velocity = s.prevEAR - ear;
        }
        s.prevEAR = ear;
        rollingMedian(s.velocityBuf, velocity, 3);
        const recentVelocity = s.velocityBuf.length
          ? s.velocityBuf.reduce((a, b) => a + b, 0) / s.velocityBuf.length
          : 0;

        // Baseline Calibration
        if (s.baselineEAR === null && ear > 0.21) {
          s.baselineSamples.push(ear);
          if (s.baselineSamples.length >= 60) {
            const mean = iqrMean(s.baselineSamples);
            s.baselineEAR = mean;
            s.threshClose = mean * 0.85;
            s.threshOpen  = mean * 0.92;
          }
        }

        const closeT = SAVED_THRESHOLD ?? s.threshClose ?? 0.20;
        const openT  = SAVED_THRESHOLD ? SAVED_THRESHOLD * 1.08 : (s.threshOpen ?? 0.22);
        const now    = Date.now();

        if (ear < closeT && !s.isClosed) {
          // Velocity gate - real blinks close fast, slow drops are usually looking down
          if (recentVelocity > 0.005 || SAVED_THRESHOLD) {
            s.isClosed = true;
            s.blinkStart = now;
          }
        } else if (ear > openT && s.isClosed) {
          s.isClosed = false;
          const duration = s.blinkStart ? now - s.blinkStart : 0;
          s.blinkStart = null;

          if (now - s.lastOpenedAt >= 200 && duration >= 80) { // Refractory & duration gates
            s.lastOpenedAt = now;
            onBlink?.({ duration, type: duration >= DASH_MS ? 'dash' : 'dot', ear });

            s.recentBlinks = [...s.recentBlinks.filter(t => now - t < 1500), now];
            if (s.recentBlinks.length >= 3) {
              onTripleBlink?.();
              s.recentBlinks = [];
            }
          }
        }

        // Push data to UI without triggering React state updates
        if (onFrameUpdate) {
          onFrameUpdate({
            ear,
            isClosed: s.isClosed,
            history: s.earHistory,
            baseline: s.baselineEAR,
            threshold: closeT,
            lm // Pass landmarks in case consumer wants to draw them
          });
        }
      });

      refs.current.faceMesh = faceMesh;
      refs.current.camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (refs.current.faceMesh && videoRef.current && state.current.isMounted) {
            await refs.current.faceMesh.send({ image: videoRef.current });
          }
        },
        width: 640, height: 480, // VGA for landmark precision
      });

      await refs.current.camera.start();

    } catch (err) {
      console.error('[BlinkDetector] Init error:', err.message);
    }
  }, [enabled, SAVED_THRESHOLD, DASH_MS, onBlink, onTripleBlink, onFrameUpdate, videoRef]);

  useEffect(() => {
    state.current.isMounted = true;
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        refs.current.camera?.stop();
      } else if (enabled) {
        refs.current.camera?.start();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (enabled) initFaceMesh();

    return () => {
      state.current.isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      try { refs.current.camera?.stop(); } catch (_) {}
      try { refs.current.faceMesh?.close(); } catch (_) {}
      
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [enabled, initFaceMesh, videoRef]);

  return { forceRestart: initFaceMesh };
}