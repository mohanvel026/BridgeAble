// client/src/hooks/useBlinkDetector.js
// Industry-Grade EAR Blink Detector
//
// Standards applied:
//  • EAR (Eye Aspect Ratio) algorithm — Soukupová & Čech, 2016 (CVWW)
//  • Rolling 4-frame EAR average to eliminate single-frame sensor noise
//  • Adaptive baseline: first 30 frames auto-calibrate open-eye EAR
//  • Refractory period: 250ms after blink open — prevents re-trigger
//  • Confidence gate: both eyes must agree (diff < 0.05) to count a blink
//  • Duration classification: dot (<dashMs) vs dash (≥dashMs) for Morse input

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../store/stores';

// MediaPipe FaceMesh landmark indices for 6-point EAR formula
// Based on iBUG 300-W face dataset mapping to MediaPipe 468 landmarks
const LEFT_EYE  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33,  160, 158, 133, 153, 144];

// Euclidean distance between two 2D/3D landmarks
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Eye Aspect Ratio — Soukupová & Čech, 2016
// EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
// Drops sharply below ~0.2 when eye closes
function computeEAR(landmarks, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map(i => landmarks[i]);
  const A = dist(p2, p6); // vertical distance 1
  const B = dist(p3, p5); // vertical distance 2
  const C = dist(p1, p4); // horizontal distance
  if (C < 1e-6) return 0.3; // guard against division by zero
  return (A + B) / (2.0 * C);
}

// Rolling average over last N samples
function rollingAvg(buffer, newValue, maxLen = 4) {
  buffer.push(newValue);
  if (buffer.length > maxLen) buffer.shift();
  return buffer.reduce((s, v) => s + v, 0) / buffer.length;
}

export default function useBlinkDetector(videoRef, {
  onBlink,           // ({ duration, type, ear }) — called on every intentional blink
  onTripleBlink,     // () — called when 3 blinks within 1.5s (SOS trigger)
  enabled = true,
  overrideThreshold = null,
  overrideDashMs    = null,
} = {}) {
  const { user } = useAuthStore();

  const [isEyeClosed,  setIsEyeClosed]  = useState(false);
  const [currentEAR,   setCurrentEAR]   = useState(0);
  const [faceMeshReady, setFaceMeshReady] = useState(false);

  const isMountedRef   = useRef(true);
  const faceMeshRef    = useRef(null);
  const cameraRef      = useRef(null);
  const isClosedRef    = useRef(false);
  const blinkStartRef  = useRef(null);
  const recentBlinks   = useRef([]);

  // EAR smoothing buffers (one per eye)
  const earBufL = useRef([]);
  const earBufR = useRef([]);

  // Adaptive open-eye baseline (first 30 frames)
  const baselineSamples = useRef([]);
  const baselineEAR     = useRef(null);

  // Refractory period — ignore events within 250ms of last blink reopening
  const lastOpenedAt = useRef(0);

  // Personalised thresholds (from calibration profile or safe defaults)
  // Industry default: 0.21 (Soukupová paper) — we use 0.22 as a conservative floor
  const EAR_THRESHOLD = overrideThreshold
    ?? user?.blinkProfile?.earThreshold
    ?? 0.22;

  const DASH_MS = overrideDashMs
    ?? user?.blinkProfile?.dashMs
    ?? 400;

  const initFaceMesh = useCallback(async () => {
    if (!videoRef?.current || !enabled) return;

    try {
      const [faceMeshModule, cameraModule] = await Promise.all([
        import('@mediapipe/face_mesh').catch(() => null),
        import('@mediapipe/camera_utils').catch(() => null),
      ]);

      const FaceMesh = faceMeshModule?.FaceMesh
        || faceMeshModule?.default?.FaceMesh
        || window.FaceMesh;

      const Camera = cameraModule?.Camera
        || cameraModule?.default?.Camera
        || window.Camera;

      if (!FaceMesh || !Camera) {
        console.warn('[BlinkDetector] MediaPipe unavailable — blink detection disabled.');
        return;
      }

      if (!isMountedRef.current || !videoRef.current) return;

      const faceMesh = new FaceMesh({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces:           1,
        refineLandmarks:       true,   // iris landmarks improve EAR accuracy
        minDetectionConfidence: 0.65,  // higher than default — fewer false faces
        minTrackingConfidence:  0.65,
      });

      faceMesh.onResults(results => {
        if (!isMountedRef.current) return;
        if (!results.multiFaceLandmarks?.length) return;

        const lm = results.multiFaceLandmarks[0];

        // ── Per-eye EAR with smoothing ─────────────────────────────────────────
        const rawL = computeEAR(lm, LEFT_EYE);
        const rawR = computeEAR(lm, RIGHT_EYE);

        const smoothL = rollingAvg(earBufL.current, rawL, 4);
        const smoothR = rollingAvg(earBufR.current, rawR, 4);
        const ear = (smoothL + smoothR) / 2;

        setCurrentEAR(+ear.toFixed(3));

        // ── Adaptive baseline (first 30 frames while eyes are clearly open) ────
        if (baselineEAR.current === null && ear > 0.25) {
          baselineSamples.current.push(ear);
          if (baselineSamples.current.length >= 30) {
            const sum = baselineSamples.current.reduce((a, b) => a + b, 0);
            baselineEAR.current = sum / baselineSamples.current.length;
            console.info(`[BlinkDetector] Baseline EAR calibrated: ${baselineEAR.current.toFixed(3)}`);
          }
        }

        // Use adaptive threshold if available (70% of personal open-eye EAR)
        const threshold = baselineEAR.current
          ? Math.max(EAR_THRESHOLD, baselineEAR.current * 0.70)
          : EAR_THRESHOLD;

        // ── Confidence gate: both eyes must agree ──────────────────────────────
        const bothEyesAgree = Math.abs(smoothL - smoothR) < 0.06;
        const eyeClosed = ear < threshold && bothEyesAgree;

        // ── State transitions ──────────────────────────────────────────────────
        if (eyeClosed && !isClosedRef.current) {
          // Eye just CLOSED
          isClosedRef.current = true;
          blinkStartRef.current = Date.now();
          setIsEyeClosed(true);

        } else if (!eyeClosed && isClosedRef.current) {
          // Eye just OPENED — blink complete
          isClosedRef.current = false;
          setIsEyeClosed(false);

          const now = Date.now();
          const duration = blinkStartRef.current
            ? now - blinkStartRef.current
            : 0;
          blinkStartRef.current = null;

          // ── Refractory period: skip micro-bounces within 250ms ─────────────
          if (now - lastOpenedAt.current < 250) return;
          lastOpenedAt.current = now;

          // ── Ignore natural involuntary blinks (< 80ms) ─────────────────────
          // Human intentional blink: 150–400ms. Natural blink: 100–150ms.
          if (duration < 80) return;

          const type = duration >= DASH_MS ? 'dash' : 'dot';
          onBlink?.({ duration, type, ear });

          // ── Triple-blink SOS detection (3 blinks within 1.5s) ─────────────
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
          if (faceMeshRef.current && videoRef.current) {
            await faceMeshRef.current.send({ image: videoRef.current });
          }
        },
        width: 640, height: 480, // Full VGA — required for sub-millimetre EAR accuracy
      });

      cameraRef.current = camera;
      await camera.start();

      if (isMountedRef.current) setFaceMeshReady(true);

    } catch (err) {
      if (isMountedRef.current) {
        console.error('[BlinkDetector] Init error:', err.message);
      }
    }
  }, [enabled, EAR_THRESHOLD, DASH_MS, onBlink, onTripleBlink, videoRef]);

  useEffect(() => {
    isMountedRef.current = true;

    if (enabled) initFaceMesh();

    return () => {
      isMountedRef.current = false;
      try { cameraRef.current?.stop?.(); } catch (_) {}
      try { faceMeshRef.current?.close?.(); } catch (_) {}
      cameraRef.current  = null;
      faceMeshRef.current = null;
      earBufL.current = [];
      earBufR.current = [];
      baselineSamples.current = [];
      baselineEAR.current = null;
      setFaceMeshReady(false);
    };
  }, [enabled, initFaceMesh]);

  return { isEyeClosed, currentEAR, faceMeshReady };
}