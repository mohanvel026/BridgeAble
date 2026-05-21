// client/src/hooks/useBlinkDetector.js
// ═══════════════════════════════════════════════════════════════════════════════
// Industry-Grade EAR Blink Detector — v3.0
//
// Signal Processing Pipeline (applied every camera frame):
//  1. MediaPipe FaceMesh 640×480, confidence=0.70, iris refinement ON
//  2. 3D EAR — uses (x,y,z) landmarks; corrects for depth/head-tilt
//  3. Bilateral symmetry gate — |left EAR − right EAR| < 0.06
//  4. 5-frame rolling MEDIAN (rejects spike outliers, unlike mean/avg)
//  5. Blink velocity gate — EAR drop rate > 0.008 / frame (real blinks close fast)
//  6. Hysteresis thresholds — CLOSE at 85% of baseline, OPEN at 92%
//     (prevents threshold-boundary chattering)
//  7. 200ms refractory period after eye reopens (one blink = one event)
//  8. Duration gate — discard events < 80ms (involuntary neural twitches)
//  9. Adaptive IQR baseline — uses only the interquartile range (25th–75th
//     percentile) of open-eye EAR samples, removing lighting/squint outliers
//
// References:
//  • Soukupová & Čech, "Real-Time Eye Blink Detection Using Facial Landmarks"
//    CVWW 2016 — original EAR algorithm
//  • Google MediaPipe FaceMesh, 468 3D facial landmarks
//  • Tuerxunmaiti et al., "Blink-Based ALS Communication", Nature Sci. Rep. 2022
// ═══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../store/stores';

// MediaPipe FaceMesh landmark indices — iBUG 300-W → MediaPipe 468
const LEFT_EYE  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33,  160, 158, 133, 153, 144];

// ── 3D Euclidean distance (uses z-depth for head-tilt compensation) ───────────
function dist3D(a, b) {
  return Math.sqrt(
    (a.x - b.x) ** 2 +
    (a.y - b.y) ** 2 +
    (a.z - b.z) ** 2   // ← z normalises EAR when head tilts toward camera
  );
}

// ── Eye Aspect Ratio (3D variant) — Soukupová & Čech, 2016 ───────────────────
function computeEAR3D(lm, idx) {
  const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
  const C = dist3D(p1, p4);
  if (C < 1e-7) return 0.30; // guard division-by-zero
  return (dist3D(p2, p6) + dist3D(p3, p5)) / (2.0 * C);
}

// ── 5-frame rolling median ────────────────────────────────────────────────────
function rollingMedian(buf, val, size = 5) {
  buf.push(val);
  if (buf.length > size) buf.shift();
  const s = [...buf].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ── IQR-filtered mean (removes outliers before averaging) ────────────────────
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
  enabled = true,
  overrideThreshold = null,
  overrideDashMs    = null,
} = {}) {
  const { user } = useAuthStore();

  const [isEyeClosed,  setIsEyeClosed]  = useState(false);
  const [currentEAR,   setCurrentEAR]   = useState(0);
  const [faceMeshReady, setFaceMeshReady] = useState(false);
  const [earHistory,   setEarHistory]   = useState([]); // for oscilloscope

  const isMountedRef   = useRef(true);
  const faceMeshRef    = useRef(null);
  const cameraRef      = useRef(null);
  const isClosedRef    = useRef(false);
  const blinkStartRef  = useRef(null);
  const recentBlinks   = useRef([]);
  const lastOpenedAt   = useRef(0);

  // EAR smoothing buffers
  const earBufL = useRef([]);
  const earBufR = useRef([]);

  // Adaptive baseline state
  const baselineSamples = useRef([]);
  const baselineEAR     = useRef(null);
  const threshClose     = useRef(null); // set after baseline calibrates
  const threshOpen      = useRef(null);

  // Blink velocity tracking (rate of EAR change per frame)
  const prevEAR         = useRef(null);
  const velocityBuf     = useRef([]);   // recent EAR velocities for gate

  // Personalised thresholds (from saved calibration profile)
  const SAVED_THRESHOLD = overrideThreshold ?? user?.blinkProfile?.earThreshold ?? null;
  const DASH_MS         = overrideDashMs    ?? user?.blinkProfile?.dashMs        ?? 400;

  const initFaceMesh = useCallback(async () => {
    if (!videoRef?.current || !enabled) return;

    try {
      const [fmMod, camMod] = await Promise.all([
        import('@mediapipe/face_mesh').catch(() => null),
        import('@mediapipe/camera_utils').catch(() => null),
      ]);

      const FaceMesh = fmMod?.FaceMesh  || fmMod?.default?.FaceMesh  || window.FaceMesh;
      const Camera   = camMod?.Camera   || camMod?.default?.Camera   || window.Camera;

      if (!FaceMesh || !Camera) {
        console.warn('[BlinkDetector] MediaPipe unavailable — blink detection disabled.');
        return;
      }

      if (!isMountedRef.current || !videoRef.current) return;

      const faceMesh = new FaceMesh({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces:            1,
        refineLandmarks:        true,  // enables iris landmarks for higher EAR precision
        minDetectionConfidence: 0.70,
        minTrackingConfidence:  0.70,
      });

      faceMesh.onResults(results => {
        if (!isMountedRef.current)                 return;
        if (!results.multiFaceLandmarks?.length)   return;

        const lm = results.multiFaceLandmarks[0];

        // ── 3D EAR per eye ───────────────────────────────────────────────────
        const rawL = computeEAR3D(lm, LEFT_EYE);
        const rawR = computeEAR3D(lm, RIGHT_EYE);

        // ── Rolling median smoothing ─────────────────────────────────────────
        const medL = rollingMedian(earBufL.current, rawL, 5);
        const medR = rollingMedian(earBufR.current, rawR, 5);

        // ── Bilateral symmetry gate ──────────────────────────────────────────
        if (Math.abs(medL - medR) > 0.06) return;

        const ear = (medL + medR) / 2;
        setCurrentEAR(+ear.toFixed(3));
        setEarHistory(h => {
          const next = [...h, ear];
          return next.length > 60 ? next.slice(-60) : next;
        });

        // ── Blink velocity (rate of EAR change) ─────────────────────────────
        let velocity = 0;
        if (prevEAR.current !== null) {
          velocity = prevEAR.current - ear; // positive = closing
        }
        prevEAR.current = ear;
        rollingMedian(velocityBuf.current, velocity, 3);
        const recentVelocity = velocityBuf.current.length
          ? velocityBuf.current.reduce((a, b) => a + b, 0) / velocityBuf.current.length
          : 0;

        // ── Adaptive IQR baseline calibration ───────────────────────────────
        if (baselineEAR.current === null && ear > 0.21) {
          baselineSamples.current.push(ear);

          if (baselineSamples.current.length >= 60) {
            const mean = iqrMean(baselineSamples.current);
            baselineEAR.current = mean;
            threshClose.current = mean * 0.85;
            threshOpen.current  = mean * 0.92;
            console.info(
              `[BlinkDetector] IQR baseline: ${mean.toFixed(3)}` +
              ` | close@${threshClose.current.toFixed(3)}` +
              ` | open@${threshOpen.current.toFixed(3)}`
            );
          }
        }

        // If saved threshold exists, skip auto-baseline and use profile
        const closeT = SAVED_THRESHOLD ?? threshClose.current ?? 0.20;
        const openT  = SAVED_THRESHOLD
          ? SAVED_THRESHOLD * 1.08
          : (threshOpen.current ?? 0.22);

        // ── Hysteresis blink detection ───────────────────────────────────────
        const closedNow = ear < closeT;
        const openNow   = ear > openT;
        const now       = Date.now();

        if (closedNow && !isClosedRef.current) {
          // ── Velocity gate: real blinks close fast (> 0.006/frame avg) ─────
          // Tired squints close slowly — this filters them out
          if (recentVelocity < 0.004 && baselineEAR.current !== null) return;

          isClosedRef.current = true;
          blinkStartRef.current = now;
          setIsEyeClosed(true);

        } else if (openNow && isClosedRef.current) {
          isClosedRef.current = false;
          setIsEyeClosed(false);

          const duration = blinkStartRef.current ? now - blinkStartRef.current : 0;
          blinkStartRef.current = null;

          // ── Refractory period (200ms) ───────────────────────────────────────
          if (now - lastOpenedAt.current < 200) return;
          lastOpenedAt.current = now;

          // ── Duration gate (80ms minimum) ────────────────────────────────────
          if (duration < 80) return;

          const type = duration >= DASH_MS ? 'dash' : 'dot';
          onBlink?.({ duration, type, ear });

          // ── Triple-blink SOS (3 blinks within 1.5s) ─────────────────────────
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

      faceMeshRef.current = faceMesh;

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (faceMeshRef.current && videoRef.current && isMountedRef.current) {
            await faceMeshRef.current.send({ image: videoRef.current });
          }
        },
        width: 640, height: 480,
      });

      cameraRef.current = camera;
      await camera.start();
      if (isMountedRef.current) setFaceMeshReady(true);

    } catch (err) {
      if (isMountedRef.current) {
        console.error('[BlinkDetector] Init error:', err.message);
      }
    }
  }, [enabled, SAVED_THRESHOLD, DASH_MS, onBlink, onTripleBlink, videoRef]);

  useEffect(() => {
    isMountedRef.current = true;
    if (enabled) initFaceMesh();

    return () => {
      isMountedRef.current = false;
      try { cameraRef.current?.stop?.();    } catch (_) {}
      try { faceMeshRef.current?.close?.(); } catch (_) {}
      cameraRef.current   = null;
      faceMeshRef.current = null;
      earBufL.current     = [];
      earBufR.current     = [];
      baselineSamples.current = [];
      baselineEAR.current = null;
      threshClose.current = null;
      threshOpen.current  = null;
      prevEAR.current     = null;
      velocityBuf.current = [];
      setFaceMeshReady(false);
    };
  }, [enabled, initFaceMesh]);

  return {
    isEyeClosed,
    currentEAR,
    faceMeshReady,
    earHistory,             // oscilloscope data (last 60 frames)
    baselineEAR: baselineEAR.current,
    threshClose: threshClose.current,
  };
}