// client/src/pages/Onboarding.jsx — v4 (stable, self-contained)
// Complete blink calibration wizard using MediaPipe FaceMesh
// All signal processing runs inside refs — no stale closure bugs

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import api from '../lib/api';
import toast from 'react-hot-toast';

// ── Landmark indices ──────────────────────────────────────────────────────────
const LEFT_EYE  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33,  160, 158, 133, 153, 144];

// ── EAR (Eye Aspect Ratio) — Soukupová & Čech 2016 ───────────────────────────
function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function computeEAR(lm, idx) {
  const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
  const C = dist(p1, p4);
  if (C < 1e-6) return 0.30;
  return (dist(p2, p6) + dist(p3, p5)) / (2.0 * C);
}

// ── Rolling median — rejects outlier spikes ───────────────────────────────────
function rollingMedian(buf, val, size = 5) {
  buf.push(val);
  if (buf.length > size) buf.shift();
  const s = [...buf].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// ── IQR mean — excludes lighting/squint outlier samples ──────────────────────
function iqrMean(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  const clean = s.filter(v => v >= q1 && v <= q3);
  return clean.reduce((a, b) => a + b, 0) / (clean.length || 1);
}

// ── Canvas oscilloscope ───────────────────────────────────────────────────────
function drawOscilloscope(canvas, history, threshold) {
  if (!canvas || history.length < 2) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const MIN = 0.10, MAX = 0.40;
  const toY = v => H - ((Math.min(MAX, Math.max(MIN, v)) - MIN) / (MAX - MIN)) * H;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(4,13,12,0.6)';
  ctx.fillRect(0, 0, W, H);

  if (threshold) {
    const ty = toY(threshold);
    ctx.strokeStyle = 'rgba(251,113,133,0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(251,113,133,0.9)';
    ctx.font = '9px monospace';
    ctx.fillText(`close@${threshold.toFixed(3)}`, 4, ty - 3);
  }

  const stepX = W / (history.length - 1);
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 5;
  ctx.beginPath();
  history.forEach((v, i) => {
    i === 0 ? ctx.moveTo(0, toY(v)) : ctx.lineTo(i * stepX, toY(v));
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(34,211,238,0.7)';
  ctx.font = '9px monospace';
  ctx.fillText('EAR signal', 4, 11);
}

// ── Steps ─────────────────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, title: 'Keep your eyes open', subtitle: 'Look at the camera — calibrating your personal open-eye baseline (2 sec)' },
  { id: 2, title: 'Blink 5 times naturally', subtitle: 'Blink at your own comfortable pace' },
  { id: 3, title: 'Long blink — hold ~1 second', subtitle: 'Close your eyes and hold, then open to set your dash threshold' },
  { id: 4, title: 'Practice & save', subtitle: 'Short blink = dot  ·  Long blink = dash  ·  Double short = click' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { updateUser } = useAuthStore();

  // DOM refs
  const videoRef    = useRef(null);
  const oscRef      = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraRef   = useRef(null);
  const mountedRef  = useRef(true);

  // ── All blink signal state lives in refs to avoid stale closures ─────────
  const earBufL      = useRef([]);
  const earBufR      = useRef([]);
  const baselineBuf  = useRef([]);
  const baselineEAR  = useRef(null);
  const threshClose  = useRef(null);   // set after step 1 calibration
  const threshOpen   = useRef(null);   // hysteresis open threshold
  const isClosedRef  = useRef(false);
  const blinkStart   = useRef(null);
  const lastOpenedAt = useRef(0);
  const stepRef      = useRef(1);
  const blinkCountR  = useRef(0);
  const dashMsRef    = useRef(400);
  const earHistory   = useRef([]);

  // ── React UI state ────────────────────────────────────────────────────────
  const [step,        setStep]        = useState(1);
  const [blinkCount,  setBlinkCount]  = useState(0);
  const [isEyeClosed, setIsEyeClosed] = useState(false);
  const [currentEAR,  setCurrentEAR]  = useState(0);
  const [dashMs,      setDashMs]      = useState(null);
  const [morse,       setMorse]       = useState('');
  const [cameraOK,    setCameraOK]    = useState(false);
  const [cameraErr,   setCameraErr]   = useState(null);
  const [basePct,     setBasePct]     = useState(0);
  const [saving,      setSaving]      = useState(false);

  // ── Step ref stays in sync ────────────────────────────────────────────────
  useEffect(() => { stepRef.current = step; }, [step]);

  // ── Oscilloscope redraws whenever earHistory ref is updated ───────────────
  // We use a separate render-tick trigger
  const [oscTick, setOscTick] = useState(0);
  useEffect(() => {
    drawOscilloscope(oscRef.current, earHistory.current, threshClose.current);
  }, [oscTick]);

  // ── Blink event handler — called from onResults via ref ──────────────────
  const handleBlinkRef = useRef(null);
  handleBlinkRef.current = (duration) => {
    const s = stepRef.current;

    if (s === 2) {
      const n = blinkCountR.current + 1;
      blinkCountR.current = n;
      setBlinkCount(n);
      if (n >= 5) {
        toast.success('Great! Now do one long blink.');
        setTimeout(() => { setStep(3); stepRef.current = 3; }, 500);
      }
    } else if (s === 3) {
      dashMsRef.current = duration;
      setDashMs(duration);
      toast.success(`Long blink: ${duration}ms ✓`);
      setTimeout(() => { setStep(4); stepRef.current = 4; }, 500);
    } else if (s === 4) {
      const sym = duration >= dashMsRef.current ? '— ' : '· ';
      setMorse(prev => prev + sym);
    }
  };

  // ── Frame processing — defined once, reads all values from refs ───────────
  const onResults = useCallback((results) => {
    if (!mountedRef.current) return;
    if (!results.multiFaceLandmarks?.length) return;

    const lm = results.multiFaceLandmarks[0];

    // 1. Per-eye EAR
    const rawL = computeEAR(lm, LEFT_EYE);
    const rawR = computeEAR(lm, RIGHT_EYE);

    // 2. 5-frame rolling median smoothing
    const medL = rollingMedian(earBufL.current, rawL, 5);
    const medR = rollingMedian(earBufR.current, rawR, 5);

    // 3. Bilateral symmetry gate
    if (Math.abs(medL - medR) > 0.07) return;

    const ear = (medL + medR) / 2;
    setCurrentEAR(+ear.toFixed(3));

    // Update oscilloscope buffer
    earHistory.current.push(ear);
    if (earHistory.current.length > 80) earHistory.current.shift();
    setOscTick(t => t + 1);

    // 4. Step 1 — build open-eye baseline
    if (stepRef.current === 1 && ear > 0.18) {
      baselineBuf.current.push(ear);
      const pct = Math.min(100, Math.round((baselineBuf.current.length / 60) * 100));
      setBasePct(pct);

      if (baselineBuf.current.length >= 60) {
        const mean = iqrMean(baselineBuf.current);
        baselineEAR.current = mean;
        threshClose.current = mean * 0.82;  // 82% of open-eye EAR
        threshOpen.current  = mean * 0.90;  // 90% for hysteresis
        console.info(`[Calibration] baseline=${mean.toFixed(3)} close@${threshClose.current.toFixed(3)} open@${threshOpen.current.toFixed(3)}`);
        toast.success('Baseline done! Blink 5 times.');
        setStep(2); stepRef.current = 2;
      }
      return;
    }

    // 5. Need baseline before blink detection
    if (!threshClose.current) return;

    // 6. Hysteresis blink detection — reads from refs, never stale
    const closedNow = ear < threshClose.current;
    const openNow   = ear > threshOpen.current;
    const now = Date.now();

    if (closedNow && !isClosedRef.current) {
      isClosedRef.current = true;
      blinkStart.current  = now;
      setIsEyeClosed(true);

    } else if (openNow && isClosedRef.current) {
      isClosedRef.current = false;
      setIsEyeClosed(false);

      const dur = blinkStart.current ? now - blinkStart.current : 0;
      blinkStart.current = null;

      // Refractory period (200ms)
      if (now - lastOpenedAt.current < 200) return;
      lastOpenedAt.current = now;

      // Duration gate — ignore < 80ms twitches
      if (dur < 80) return;

      handleBlinkRef.current(dur);
    }
  }, []); // ← empty deps is SAFE now — all values read from refs

  // ── Init FaceMesh ─────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let cam = null;
    let fm  = null;

    (async () => {
      try {
        const [fmMod, camMod] = await Promise.all([
          import('@mediapipe/face_mesh').catch(() => null),
          import('@mediapipe/camera_utils').catch(() => null),
        ]);

        const FaceMesh = fmMod?.FaceMesh  || fmMod?.default?.FaceMesh  || window.FaceMesh;
        const Camera   = camMod?.Camera   || camMod?.default?.Camera   || window.Camera;

        if (!FaceMesh || !Camera) {
          if (mountedRef.current) setCameraErr('MediaPipe unavailable. Please use Chrome or Edge.');
          return;
        }
        if (!mountedRef.current || !videoRef.current) return;

        fm = new FaceMesh({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        fm.setOptions({
          maxNumFaces:            1,
          refineLandmarks:        true,
          minDetectionConfidence: 0.65,
          minTrackingConfidence:  0.65,
        });
        fm.onResults(onResults);
        faceMeshRef.current = fm;

        cam = new Camera(videoRef.current, {
          onFrame: async () => {
            if (faceMeshRef.current && videoRef.current && mountedRef.current) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width: 640, height: 480,
        });

        await cam.start();
        cameraRef.current = cam;
        if (mountedRef.current) setCameraOK(true);

      } catch (err) {
        if (mountedRef.current) setCameraErr(err.message || 'Camera failed.');
      }
    })();

    return () => {
      mountedRef.current = false;
      try { cam?.stop(); }   catch (_) {}
      try { fm?.close(); }   catch (_) {}
    };
  }, [onResults]);

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { earThreshold: threshClose.current || 0.21, dashMs: dashMsRef.current };
      await api.post('/auth/blink-calibration', payload);
      updateUser({ blinkProfile: { ...payload, calibrated: true } });
      toast.success('Calibration saved!');
      navigate('/dashboard');
    } catch {
      toast.error('Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const earPct = Math.min(100, Math.round((currentEAR / (baselineEAR.current || 0.30)) * 100));

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
            We measure your unique eye patterns so BridgeAble understands exactly how you blink.
          </p>
        </div>

        {/* Step tracker */}
        <div className="flex justify-center gap-6 mb-6">
          {STEPS.map(s => (
            <div key={s.id} className={`flex items-center gap-2 transition-all ${step >= s.id ? 'opacity-100' : 'opacity-30'}`}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                   style={step > s.id
                     ? { background: '#2dd4bf', color: '#040d0c' }
                     : step === s.id
                       ? { background: '#8b5cf6', color: '#fff' }
                       : { border: '2px solid var(--border)', color: 'var(--text-muted)' }
                   }>
                {step > s.id ? '✓' : s.id}
              </div>
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

          {/* Camera + overlays */}
          <div className="relative rounded-xl overflow-hidden mb-5"
               style={{ aspectRatio: '4/3', background: '#000' }}>

            <video ref={videoRef} className="w-full h-full object-cover"
                   style={{ transform: 'scaleX(-1)' }} playsInline muted />

            {/* Loading */}
            {!cameraOK && !cameraErr && (
              <div className="absolute inset-0 flex flex-col items-center justify-center"
                   style={{ background: 'var(--bg-secondary)' }}>
                <div className="w-10 h-10 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin mb-3" />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading FaceMesh AI…</p>
              </div>
            )}

            {/* Error */}
            {cameraErr && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
                   style={{ background: 'var(--bg-secondary)' }}>
                <div className="text-4xl mb-3">⚠️</div>
                <p className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Camera Error</p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>{cameraErr}</p>
                <button onClick={() => window.location.reload()}
                        className="px-4 py-2 rounded-lg text-sm"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  Try Again
                </button>
              </div>
            )}

            {/* Eye state badge */}
            {cameraOK && (
              <div className="absolute top-3 right-3 rounded-xl px-3 py-2"
                   style={{ background: 'rgba(4,13,12,0.88)', backdropFilter: 'blur(8px)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 mb-1"
                     style={{ color: isEyeClosed ? '#fb7185' : '#2dd4bf' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'currentColor' }} />
                  <span className="text-xs font-mono font-bold">{isEyeClosed ? 'CLOSED' : 'OPEN'}</span>
                </div>
                <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  EAR {currentEAR.toFixed(3)}
                </div>
                {threshClose.current && (
                  <div className="text-xs font-mono" style={{ color: 'rgba(251,113,133,0.8)' }}>
                    thr {threshClose.current.toFixed(3)}
                  </div>
                )}
              </div>
            )}

            {/* EAR health bar */}
            {cameraOK && (
              <div className="absolute bottom-14 left-3 right-3">
                <div className="rounded-full overflow-hidden h-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full transition-all duration-75"
                       style={{
                         width: `${earPct}%`,
                         background: isEyeClosed
                           ? 'linear-gradient(90deg,#fb7185,#f43f5e)'
                           : 'linear-gradient(90deg,#22d3ee,#2dd4bf)',
                       }} />
                </div>
              </div>
            )}

            {/* Oscilloscope */}
            {cameraOK && (
              <div className="absolute bottom-3 left-3 right-3"
                   style={{ height: '48px', borderRadius: '8px', overflow: 'hidden',
                            border: '1px solid rgba(34,211,238,0.18)' }}>
                <canvas ref={oscRef} width={600} height={48}
                        style={{ width: '100%', height: '100%', display: 'block' }} />
              </div>
            )}
          </div>

          {/* Step UI */}
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl mb-3"
                 style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)' }}>
              <span className="font-mono text-sm font-semibold" style={{ color: '#a78bfa' }}>STEP {step}</span>
            </div>
            <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              {STEPS[step - 1].title}
            </h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              {STEPS[step - 1].subtitle}
            </p>

            {/* Step 1 — baseline progress */}
            {step === 1 && (
              <div className="max-w-xs mx-auto">
                <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  <span>Auto-calibrating…</span><span>{basePct}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="h-full rounded-full transition-all duration-200"
                       style={{ width: `${basePct}%`, background: 'linear-gradient(90deg,#a78bfa,#7c3aed)' }} />
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                  Keep your eyes relaxed and open, looking at the camera
                </p>
              </div>
            )}

            {/* Step 2 — blink counter */}
            {step === 2 && (
              <div className="flex items-center justify-center gap-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-11 h-11 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-all duration-300"
                       style={i < blinkCount
                         ? { background: 'rgba(167,139,250,0.2)', borderColor: '#a78bfa', color: '#a78bfa', transform: 'scale(1.12)' }
                         : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                       }>
                    {i < blinkCount ? '✓' : i + 1}
                  </div>
                ))}
              </div>
            )}

            {/* Step 3 — long blink */}
            {step === 3 && (
              <div>
                {dashMs ? (
                  <div className="inline-flex items-center gap-3 px-5 py-3 rounded-xl"
                       style={{ background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.25)' }}>
                    <span className="text-2xl font-mono font-bold text-teal-400">{dashMs}ms</span>
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>dash captured ✓</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl"
                       style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)' }}>
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-sm text-amber-400">Waiting for long blink…</span>
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
                    Short = <span className="text-cyan-400 font-mono">·</span> &nbsp;
                    Long = <span className="text-violet-400 font-mono">—</span>
                  </p>
                  <div className="font-mono text-lg tracking-widest min-h-8"
                       style={{ color: 'var(--accent-cyan)' }}>
                    {morse || <span style={{ color: 'var(--text-muted)' }}>Blink to practice…</span>}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-left text-xs">
                  {[
                    { label: 'Baseline EAR', val: baselineEAR.current?.toFixed(3) || '—', color: '#2dd4bf' },
                    { label: 'Close threshold', val: threshClose.current?.toFixed(3) || '—', color: '#fb7185' },
                    { label: 'Dash duration', val: `${dashMsRef.current}ms`, color: '#a78bfa' },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl p-3"
                         style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                      <p style={{ color: 'var(--text-muted)' }} className="mb-1">{item.label}</p>
                      <p className="font-mono font-bold" style={{ color: item.color }}>{item.val}</p>
                    </div>
                  ))}
                </div>

                <button onClick={handleSave} disabled={saving}
                        className="w-full py-3 rounded-xl font-semibold text-sm transition-all"
                        style={{
                          background: saving ? 'var(--bg-secondary)' : 'linear-gradient(135deg,#22d3ee,#2dd4bf)',
                          color: saving ? 'var(--text-muted)' : '#040d0c',
                          cursor: saving ? 'not-allowed' : 'pointer',
                        }}>
                  {saving ? 'Saving…' : 'Save & Go to Dashboard →'}
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
          You can re-calibrate anytime from Profile → Settings
        </p>
      </div>
    </div>
  );
}