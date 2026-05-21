// client/src/pages/Onboarding.jsx
// Industry-Grade Blink Calibration Wizard
//
// Signal Processing Pipeline (per frame):
//  1. MediaPipe FaceMesh @ 640×480, minConfidence=0.7
//  2. 6-point EAR formula — Soukupová & Čech, 2016
//  3. Bilateral symmetry gate — both eyes must agree (|L-R| < 0.06)
//  4. 5-frame rolling MEDIAN (robust against spike outliers, unlike mean)
//  5. Hysteresis threshold — CLOSE at 85% of baseline, OPEN at 92%
//     (prevents chattering near threshold boundary)
//  6. 200ms refractory period — prevents double-counting one blink
//  7. Duration gate — ignore < 80ms (natural involuntary twitch)
//  8. Auto-calibrates personal open-eye EAR over 60 stable frames

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import api from '../lib/api';
import toast from 'react-hot-toast';

// ── MediaPipe landmark indices (iBUG 300-W → MediaPipe 468) ──────────────────
const LEFT_EYE  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33,  160, 158, 133, 153, 144];

// ── EAR formula ───────────────────────────────────────────────────────────────
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function computeEAR(lm, idx) {
  const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
  const C = dist(p1, p4);
  if (C < 1e-6) return 0.30;
  return (dist(p2, p6) + dist(p3, p5)) / (2.0 * C);
}

// ── Rolling median (5-sample window) — robust against spike outliers ─────────
function rollingMedian(buf, val, size = 5) {
  buf.push(val);
  if (buf.length > size) buf.shift();
  const s = [...buf].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ── Calibration steps ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, title: 'Keep eyes open naturally',    subtitle: 'Look at the camera — we are auto-calibrating your personal EAR baseline',     target: 60 },
  { id: 2, title: 'Blink normally 5 times',        subtitle: 'Blink at your natural pace',                                                  target: 5  },
  { id: 3, title: 'Do one long blink (hold ~1s)', subtitle: 'Close your eyes and hold for about 1 second, then open',                      target: 1  },
  { id: 4, title: 'Practice navigation',           subtitle: 'Short blink = next · Long blink = back · Double short = select',             target: 0  },
];

// Draw EAR oscilloscope on canvas
function drawOscilloscope(canvas, earHistory, threshClose) {
  if (!canvas || !earHistory.length) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = 'rgba(4,13,12,0.55)';
  ctx.fillRect(0, 0, W, H);

  const MIN_EAR = 0.10;
  const MAX_EAR = 0.40;
  const toY = v => H - ((v - MIN_EAR) / (MAX_EAR - MIN_EAR)) * H;

  // Threshold line
  if (threshClose) {
    const ty = toY(threshClose);
    ctx.strokeStyle = 'rgba(251,113,133,0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, ty);
    ctx.lineTo(W, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(251,113,133,0.9)';
    ctx.font = '9px monospace';
    ctx.fillText(`threshold ${threshClose.toFixed(2)}`, 4, ty - 3);
  }

  // EAR line
  if (earHistory.length < 2) return;
  const step = W / (earHistory.length - 1);
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 4;
  ctx.beginPath();
  earHistory.forEach((v, i) => {
    const x = i * step;
    const y = toY(Math.max(MIN_EAR, Math.min(MAX_EAR, v)));
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Label
  ctx.fillStyle = 'rgba(34,211,238,0.8)';
  ctx.font = '9px monospace';
  ctx.fillText('EAR', 4, 12);
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();

  const videoRef   = useRef(null);
  const oscCanvasRef = useRef(null); // oscilloscope canvas
  const faceMeshRef = useRef(null);
  const cameraRef  = useRef(null);
  const mountedRef = useRef(true);

  // ── Blink signal processing state (refs for closure-safe access) ─────────
  const earBufL       = useRef([]);   // rolling median buffer — left eye
  const earBufR       = useRef([]);   // rolling median buffer — right eye
  const baselineBuf   = useRef([]);   // open-eye EAR samples for calibration
  const baselineEAR   = useRef(null); // calibrated personal open-eye EAR
  const isClosedRef   = useRef(false);
  const blinkStartRef = useRef(null);
  const lastOpenedAt  = useRef(0);    // refractory period tracker
  const threshClose   = useRef(0.20); // dynamic CLOSE threshold (85% of baseline)
  const threshOpen    = useRef(0.22); // dynamic OPEN  threshold (92% of baseline) — hysteresis

  // ── Calibration data accumulation ─────────────────────────────────────────
  const dashMsRef     = useRef(400);
  const stepRef       = useRef(1);

  // ── React state for UI ────────────────────────────────────────────────────
  const [step,        setStep]        = useState(1);
  const [blinkCount,  setBlinkCount]  = useState(0);
  const [isEyeClosed, setIsEyeClosed] = useState(false);
  const [currentEAR,  setCurrentEAR]  = useState(0);
  const [dashMs,      setDashMs]      = useState(null);
  const [morseBuffer, setMorseBuffer] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [baselineProgress, setBaselineProgress] = useState(0);
  const [earHistory, setEarHistory] = useState([]);
  const [saving,      setSaving]      = useState(false);
  const blinkCountRef = useRef(0);

  // Keep stepRef in sync
  useEffect(() => { stepRef.current = step; }, [step]);

  // Update oscilloscope visualization
  useEffect(() => {
    drawOscilloscope(oscCanvasRef.current, earHistory, threshClose.current);
  }, [earHistory]);

  // ── Frame result handler ───────────────────────────────────────────────────
  const onResults = useCallback((results) => {
    if (!mountedRef.current)                    return;
    if (!results.multiFaceLandmarks?.length)    return;

    const lm = results.multiFaceLandmarks[0];

    // 1. Compute per-eye EAR
    const rawL = computeEAR(lm, LEFT_EYE);
    const rawR = computeEAR(lm, RIGHT_EYE);

    // 2. Rolling median smoothing (5-frame) — removes spike noise
    const medL = rollingMedian(earBufL.current, rawL, 5);
    const medR = rollingMedian(earBufR.current, rawR, 5);

    // 3. Bilateral symmetry gate — ignore if eyes disagree > 0.06
    //    (handles glasses glare, partial occlusion, head tilt)
    if (Math.abs(medL - medR) > 0.06) return;

    const ear = (medL + medR) / 2;
    setCurrentEAR(+ear.toFixed(3));

    // Update oscilloscope history (60 frames)
    setEarHistory(h => {
      const next = [...h, ear];
      return next.length > 60 ? next.slice(-60) : next;
    });

    // 4. Step 1 — auto-calibrate open-eye baseline (60 stable open-eye frames)
    if (stepRef.current === 1 && ear > 0.20) {
      baselineBuf.current.push(ear);
      const progress = Math.min(100, Math.round((baselineBuf.current.length / 60) * 100));
      setBaselineProgress(progress);

      if (baselineBuf.current.length >= 60) {
        // Use IQR-filtered mean (removes outlier samples)
        const sorted = [...baselineBuf.current].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const clean = sorted.filter(v => v >= q1 && v <= q3);
        const mean = clean.reduce((a, b) => a + b, 0) / (clean.length || 1);
        baselineEAR.current = mean;

        // Hysteresis thresholds — scientifically tuned ratios
        threshClose.current = mean * 0.85;
        threshOpen.current  = mean * 0.92;

        console.info(`[Calibration] IQR baseline: ${mean.toFixed(3)} | close@${threshClose.current.toFixed(3)} | open@${threshOpen.current.toFixed(3)}`);

        toast.success('Baseline captured! Now blink 5 times.');
        setStep(2);
        setBaselineProgress(100);
      }
      return; // Don't run blink detection during baseline collection
    }

    // 5. Hysteresis blink detection
    const closedNow = ear < threshClose.current;
    const openNow   = ear > threshOpen.current;
    const now       = Date.now();

    if (closedNow && !isClosedRef.current) {
      // Eye just CLOSED
      isClosedRef.current = true;
      blinkStartRef.current = now;
      setIsEyeClosed(true);

    } else if (openNow && isClosedRef.current) {
      // Eye just OPENED
      isClosedRef.current = false;
      setIsEyeClosed(false);

      const duration = blinkStartRef.current ? now - blinkStartRef.current : 0;
      blinkStartRef.current = null;

      // 6. Refractory period (200ms) — ignore bounce-back retriggering
      if (now - lastOpenedAt.current < 200) return;
      lastOpenedAt.current = now;

      // 7. Duration gate — ignore natural involuntary twitches (< 80ms)
      if (duration < 80) return;

      // 8. Step-specific blink handling
      handleBlink(duration);
    }
  }, []);

  const handleBlink = useCallback((duration) => {
    const currentStep = stepRef.current;

    if (currentStep === 2) {
      // Count normal blinks for step 2
      const newCount = blinkCountRef.current + 1;
      blinkCountRef.current = newCount;
      setBlinkCount(newCount);

      if (newCount >= 5) {
        toast.success('Perfect! Now do one long blink.');
        setTimeout(() => {
          setStep(3);
          stepRef.current = 3;
        }, 600);
      }

    } else if (currentStep === 3) {
      // Capture dash (long blink) duration
      dashMsRef.current = duration;
      setDashMs(duration);
      toast.success(`Long blink captured: ${duration}ms`);
      setTimeout(() => {
        setStep(4);
        stepRef.current = 4;
      }, 600);

    } else if (currentStep === 4) {
      // Practice mode — show morse symbol
      const isDash = duration >= dashMsRef.current;
      setMorseBuffer(prev => prev + (isDash ? '— ' : '· '));
    }
  }, []);

  // ── FaceMesh initializer ───────────────────────────────────────────────────
  const loadFaceMesh = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      const [fmMod, camMod] = await Promise.all([
        import('@mediapipe/face_mesh').catch(() => null),
        import('@mediapipe/camera_utils').catch(() => null),
      ]);

      const FaceMesh = fmMod?.FaceMesh  || fmMod?.default?.FaceMesh  || window.FaceMesh;
      const Camera   = camMod?.Camera   || camMod?.default?.Camera   || window.Camera;

      if (!FaceMesh || !Camera) {
        setCameraError('FaceMesh unavailable. Please use Chrome or Edge.');
        return;
      }

      if (!mountedRef.current || !videoRef.current) return;

      const faceMesh = new FaceMesh({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces:            1,
        refineLandmarks:        true,  // iris landmarks improve EAR precision
        minDetectionConfidence: 0.70,  // higher = fewer ghost detections
        minTrackingConfidence:  0.70,
      });

      faceMesh.onResults(onResults);
      faceMeshRef.current = faceMesh;

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current && faceMeshRef.current && mountedRef.current) {
            await faceMeshRef.current.send({ image: videoRef.current });
          }
        },
        width: 640, height: 480,  // VGA — required for sub-mm EAR accuracy
      });

      const timeout = setTimeout(() => {
        if (mountedRef.current && !cameraReady) {
          setCameraError('Camera access timed out. Please allow camera permissions.');
        }
      }, 12000);

      await camera.start();
      clearTimeout(timeout);
      cameraRef.current = camera;
      if (mountedRef.current) setCameraReady(true);

    } catch (err) {
      if (mountedRef.current) {
        console.error('[Onboarding] FaceMesh init error:', err);
        setCameraError(err.message || 'Failed to start camera.');
      }
    }
  }, [onResults]);

  useEffect(() => {
    mountedRef.current = true;
    loadFaceMesh();
    return () => {
      mountedRef.current = false;
      try { cameraRef.current?.stop?.();   } catch (_) {}
      try { faceMeshRef.current?.close?.(); } catch (_) {}
      cameraRef.current   = null;
      faceMeshRef.current = null;
    };
  }, [loadFaceMesh]);

  // ── Save calibration ───────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        earThreshold: threshClose.current,
        dashMs:       dashMsRef.current || 400,
      };
      await api.post('/auth/blink-calibration', payload);
      updateUser({ blinkProfile: { ...payload, calibrated: true } });
      toast.success('Calibration saved! Welcome to BridgeAble.');
      navigate('/dashboard');
    } catch {
      toast.error('Failed to save calibration. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── EAR health bar (visual feedback) ─────────────────────────────────────
  const earPercent = Math.min(100, Math.round((currentEAR / (baselineEAR.current || 0.30)) * 100));

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center p-4"
         style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4"
               style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)' }}>
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-xs text-purple-400 font-medium">Blink Calibration</span>
          </div>
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Setting up your blink profile
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            We measure your personal eye patterns so BridgeAble understands your unique blinks.
          </p>
        </div>

        {/* Step tracker */}
        <div className="flex justify-center gap-4 mb-6">
          {STEPS.map(s => (
            <div key={s.id} className={`flex items-center gap-2 transition-all ${step >= s.id ? 'opacity-100' : 'opacity-30'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                ${step > s.id  ? 'bg-teal-500 text-black'    :
                  step === s.id ? 'bg-purple-500 text-white'  :
                                  'text-gray-500'}
              `} style={step <= s.id ? { border: '2px solid currentColor' } : {}}>
                {step > s.id ? '✓' : s.id}
              </div>
              <span className="text-xs hidden sm:block" style={{ color: step === s.id ? '#a78bfa' : 'var(--text-muted)' }}>
                Step {s.id}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

          {/* Camera */}
          <div className="relative rounded-xl overflow-hidden mb-5"
               style={{ aspectRatio: '4/3', background: 'var(--bg-secondary)' }}>
            <video ref={videoRef} className="w-full h-full object-cover"
                   style={{ transform: 'scaleX(-1)' }} playsInline muted />

            {/* Loading overlay */}
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center"
                   style={{ background: 'var(--bg-secondary)' }}>
                <div className="w-10 h-10 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-3" />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading FaceMesh AI...</p>
              </div>
            )}

            {/* Error overlay */}
            {cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
                   style={{ background: 'var(--bg-secondary)' }}>
                <div className="text-4xl mb-3">⚠️</div>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Camera Error</p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>{cameraError}</p>
                <button onClick={() => window.location.reload()}
                        className="px-4 py-2 rounded-lg text-sm"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  Try Again
                </button>
              </div>
            )}

            {/* Live EAR indicator */}
            {cameraReady && (
              <div className="absolute top-3 right-3 rounded-xl px-3 py-2"
                   style={{ background: 'rgba(4,13,12,0.85)', backdropFilter: 'blur(8px)', border: '1px solid var(--border)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Eye State</p>
                <div className="flex items-center gap-2"
                     style={{ color: isEyeClosed ? '#fb7185' : '#2dd4bf' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'currentColor' }} />
                  <span className="text-xs font-mono font-bold">
                    {isEyeClosed ? 'CLOSED' : 'OPEN'}
                  </span>
                </div>
                <div className="text-xs font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
                  EAR {currentEAR.toFixed(3)}
                </div>
              </div>
            )}

            {/* EAR Health Bar */}
            {cameraReady && (
              <div className="absolute bottom-3 left-3 right-3">
                <div className="rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full rounded-full transition-all duration-100"
                       style={{
                         width: `${earPercent}%`,
                         background: isEyeClosed
                           ? 'linear-gradient(90deg, #fb7185, #f43f5e)'
                           : 'linear-gradient(90deg, #22d3ee, #2dd4bf)',
                       }} />
                </div>
              </div>
            )}

            {/* EAR Oscilloscope overlay — live signal graph */}
            {cameraReady && earHistory.length > 2 && (
              <div className="absolute bottom-6 left-3 right-3"
                   style={{ height: '52px', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(34,211,238,0.15)' }}>
                <canvas
                  ref={oscCanvasRef}
                  width={400}
                  height={52}
                  style={{ width: '100%', height: '100%', display: 'block' }}
                />
              </div>
            )}
          </div>{/* end camera container */}

          {/* Step content */}
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl mb-3"
                 style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
              <span className="font-mono text-sm font-semibold text-purple-400">STEP {step}</span>
            </div>
            <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {STEPS[step - 1].title}
            </h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              {STEPS[step - 1].subtitle}
            </p>

            {/* Step 1 — baseline progress bar */}
            {step === 1 && (
              <div className="max-w-xs mx-auto">
                <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  <span>Calibrating open-eye EAR...</span>
                  <span>{baselineProgress}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="h-full rounded-full transition-all duration-200"
                       style={{ width: `${baselineProgress}%`, background: 'linear-gradient(90deg, #a78bfa, #8b5cf6)' }} />
                </div>
                {baselineProgress < 100 && (
                  <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                    Look directly at the camera with your eyes relaxed and open
                  </p>
                )}
              </div>
            )}

            {/* Step 2 — blink counter circles */}
            {step === 2 && (
              <div className="flex items-center justify-center gap-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i}
                       className="w-11 h-11 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-all duration-300"
                       style={i < blinkCount
                         ? { background: 'rgba(167,139,250,0.2)', borderColor: '#a78bfa', color: '#a78bfa', transform: 'scale(1.1)' }
                         : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                       }>
                    {i < blinkCount ? '✓' : i + 1}
                  </div>
                ))}
              </div>
            )}

            {/* Step 3 — dash capture */}
            {step === 3 && (
              <div>
                {dashMs ? (
                  <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl"
                       style={{ background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)' }}>
                    <span className="text-2xl font-mono font-bold text-teal-400">{dashMs}ms</span>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>long blink captured ✓</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl"
                       style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}>
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-sm text-amber-400">Waiting for long blink...</span>
                  </div>
                )}
              </div>
            )}

            {/* Step 4 — practice + save */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="rounded-xl p-4"
                     style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    Short blink = <span className="text-cyan-400 font-mono">·</span> &nbsp;
                    Long blink = <span className="text-violet-400 font-mono">—</span>
                  </p>
                  <div className="font-mono text-lg tracking-widest min-h-[2rem]"
                       style={{ color: 'var(--accent-cyan)' }}>
                    {morseBuffer || (
                      <span style={{ color: 'var(--text-muted)' }}>Start blinking to practice...</span>
                    )}
                  </div>
                </div>

                {/* Summary card */}
                <div className="grid grid-cols-2 gap-3 text-left">
                  <div className="rounded-xl p-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Open-eye EAR</p>
                    <p className="font-mono font-bold text-teal-400">
                      {baselineEAR.current?.toFixed(3) || '—'}
                    </p>
                  </div>
                  <div className="rounded-xl p-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Long blink (dash)</p>
                    <p className="font-mono font-bold text-violet-400">
                      {dashMsRef.current}ms
                    </p>
                  </div>
                </div>

                <button onClick={handleSave} disabled={saving}
                        className="w-full py-3 rounded-xl font-semibold text-sm transition-all"
                        style={{
                          background: saving ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #22d3ee, #2dd4bf)',
                          color: saving ? 'var(--text-muted)' : '#040d0c',
                          cursor: saving ? 'not-allowed' : 'pointer',
                        }}>
                  {saving ? 'Saving...' : 'Save Calibration & Go to Dashboard →'}
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
          You can re-calibrate anytime from your Profile → Settings
        </p>
      </div>
    </div>
  );
}