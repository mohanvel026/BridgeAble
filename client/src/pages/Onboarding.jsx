// client/src/pages/Onboarding.jsx — v5 (stable, self-contained, Zero-Render)
// Complete blink calibration wizard using MediaPipe FaceMesh
// All signal processing runs inside refs — zero stale closures, zero React renders.

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

  // DOM refs for direct manipulation (Bypassing React render cycle for 60fps data)
  const videoRef = useRef(null);
  const oscRef = useRef(null);
  const healthBarRef = useRef(null);
  const eyeStateRef = useRef(null);
  const eyeDotRef = useRef(null);
  const earValueRef = useRef(null);
  
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  const mountedRef = useRef(true);

  // Core logic refs
  const earBufL = useRef([]);
  const earBufR = useRef([]);
  const baselineBuf = useRef([]);
  const baselineEAR = useRef(null);
  const threshClose = useRef(null);
  const threshOpen = useRef(null);
  const isClosedRef = useRef(false);
  const blinkStart = useRef(null);
  const lastOpenedAt = useRef(0);
  const stepRef = useRef(1);
  const blinkCountR = useRef(0);
  const dashMsRef = useRef(400);
  const earHistory = useRef([]);

  // Low-frequency React State
  const [step, setStep] = useState(1);
  const [blinkCount, setBlinkCount] = useState(0);
  const [dashMs, setDashMs] = useState(null);
  const [morse, setMorse] = useState('');
  const [cameraOK, setCameraOK] = useState(false);
  const [cameraErr, setCameraErr] = useState(null);
  const [basePct, setBasePct] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { stepRef.current = step; }, [step]);

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
      setMorse(prev => prev + (duration >= dashMsRef.current ? '— ' : '· '));
    }
  };

  const onResults = useCallback((results) => {
    if (!mountedRef.current || !results.multiFaceLandmarks?.length) return;

    const lm = results.multiFaceLandmarks[0];
    const rawL = computeEAR(lm, LEFT_EYE);
    const rawR = computeEAR(lm, RIGHT_EYE);
    const medL = rollingMedian(earBufL.current, rawL, 5);
    const medR = rollingMedian(earBufR.current, rawR, 5);

    if (Math.abs(medL - medR) > 0.07) return;

    const ear = (medL + medR) / 2;
    
    // 1. Direct DOM Updates (Zero React Re-renders)
    if (earValueRef.current) {
      earValueRef.current.innerText = `EAR ${ear.toFixed(3)}`;
    }
    
    if (healthBarRef.current) {
      const pct = Math.min(100, Math.max(0, Math.round((ear / (baselineEAR.current || 0.30)) * 100)));
      healthBarRef.current.style.width = `${pct}%`;
    }

    earHistory.current.push(ear);
    if (earHistory.current.length > 80) earHistory.current.shift();
    
    // Draw canvas synchronously
    if (oscRef.current) {
      requestAnimationFrame(() => {
        drawOscilloscope(oscRef.current, earHistory.current, threshClose.current);
      });
    }

    // 2. Logic processing
    if (stepRef.current === 1 && ear > 0.18) {
      baselineBuf.current.push(ear);
      const computedPct = Math.min(100, Math.round((baselineBuf.current.length / 60) * 100));
      
      // Update state for progress text
      if (computedPct % 10 === 0) {
          setBasePct(computedPct);
      }

      if (baselineBuf.current.length >= 60) {
        const mean = iqrMean(baselineBuf.current);
        baselineEAR.current = mean;
        threshClose.current = mean * 0.82;
        threshOpen.current = mean * 0.90;
        toast.success('Baseline done! Blink 5 times.');
        setStep(2); stepRef.current = 2;
      }
      return;
    }

    if (!threshClose.current) return;

    const closedNow = ear < threshClose.current;
    const openNow = ear > threshOpen.current;
    const now = Date.now();

    if (closedNow && !isClosedRef.current) {
      isClosedRef.current = true;
      blinkStart.current = now;
      
      // Direct DOM mutation for eye state
      if (eyeStateRef.current) {
         eyeStateRef.current.innerText = 'CLOSED';
         eyeStateRef.current.style.color = '#fb7185';
      }
      if (eyeDotRef.current) {
         eyeDotRef.current.style.backgroundColor = '#fb7185';
      }
      if (healthBarRef.current) {
         healthBarRef.current.style.background = 'linear-gradient(90deg,#fb7185,#f43f5e)';
      }

    } else if (openNow && isClosedRef.current) {
      isClosedRef.current = false;
      
      if (eyeStateRef.current) {
         eyeStateRef.current.innerText = 'OPEN';
         eyeStateRef.current.style.color = '#2dd4bf';
      }
      if (eyeDotRef.current) {
         eyeDotRef.current.style.backgroundColor = '#2dd4bf';
      }
      if (healthBarRef.current) {
         healthBarRef.current.style.background = 'linear-gradient(90deg,#22d3ee,#2dd4bf)';
      }

      const dur = blinkStart.current ? now - blinkStart.current : 0;
      blinkStart.current = null;

      if (now - lastOpenedAt.current < 200) return;
      lastOpenedAt.current = now;

      if (dur >= 80) handleBlinkRef.current(dur);
    }
  }, []);

  // ── Init FaceMesh ─────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    let cam = null;
    let fm  = null;

    (async () => {
      try {
        const FaceMesh = window.FaceMesh;
        const Camera   = window.Camera;

        if (!FaceMesh || !Camera) {
          if (mountedRef.current) setCameraErr('MediaPipe unavailable. Please use Chrome or Edge.');
          return;
        }
        if (!mountedRef.current || !videoRef.current) return;

        fm = new FaceMesh({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`,
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
        <div className="rounded-2xl p-6 shadow-2xl relative overflow-hidden" style={{ background: '#0a0a0a', border: '1px solid #27272a' }}>
          
          {/* Ambient Glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 blur-[80px] pointer-events-none" />

          {/* Camera + overlays */}
          <div className="relative rounded-2xl overflow-hidden mb-6 shadow-inner border border-white/5"
               style={{ aspectRatio: '4/3', background: '#000' }}>

            <video ref={videoRef} className="w-full h-full object-cover"
                   style={{ transform: 'scaleX(-1)' }} playsInline muted />

            {/* Loading */}
            {!cameraOK && !cameraErr && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
                <div className="w-10 h-10 border-2 border-teal-500/30 border-t-teal-400 rounded-full animate-spin mb-3" />
                <p className="text-sm font-semibold tracking-wide text-zinc-300">Booting AI FaceMesh…</p>
              </div>
            )}

            {/* Error */}
            {cameraErr && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-black/90 backdrop-blur-md">
                <div className="text-4xl mb-3">⚠️</div>
                <p className="font-bold mb-1 text-white text-lg">Camera Error</p>
                <p className="text-sm mb-4 text-rose-400 font-medium">{cameraErr}</p>
                <button onClick={() => window.location.reload()}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold bg-white/10 hover:bg-white/20 transition-colors text-white border border-white/20">
                  Try Again
                </button>
              </div>
            )}

            {/* Zero-Render Fast DOM Eye State Badge */}
            {cameraOK && (
              <div className="absolute top-4 right-4 rounded-xl px-3 py-2.5 shadow-[0_5px_15px_rgba(0,0,0,0.5)] border border-white/10"
                   style={{ background: 'rgba(4,4,4,0.8)', backdropFilter: 'blur(12px)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span ref={eyeDotRef} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#2dd4bf' }} />
                  <span ref={eyeStateRef} className="text-xs font-mono font-bold" style={{ color: '#2dd4bf' }}>OPEN</span>
                </div>
                <div ref={earValueRef} className="text-[10px] font-mono text-zinc-400 ml-4">
                  EAR 0.000
                </div>
              </div>
            )}

            {/* Canvas Oscilloscope */}
            {cameraOK && (
              <div className="absolute bottom-4 left-4 rounded-xl overflow-hidden shadow-lg border border-white/10"
                   style={{ width: 140, height: 60, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
                <canvas ref={oscRef} width={140} height={60} className="w-full h-full" />
              </div>
            )}
          </div>

          {/* Dynamic Instructions */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-2">{STEPS[step - 1].title}</h2>
            <p className="text-sm font-medium text-zinc-400 mb-6">{STEPS[step - 1].subtitle}</p>

            {/* Step 1: Base Calibration */}
            {step === 1 && (
              <div className="max-w-xs mx-auto">
                <div className="flex justify-between text-xs font-semibold mb-2 text-zinc-300 tracking-wide uppercase">
                  <span>Auto-calibrating</span>
                  <span className="text-teal-400">{basePct}%</span>
                </div>
                <div className="h-2.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-white/5 shadow-inner">
                  {/* Zero-Render Health Bar */}
                  <div ref={healthBarRef} 
                       className="h-full rounded-full transition-all duration-75 ease-out w-0" 
                       style={{ background: 'linear-gradient(90deg, #22d3ee, #2dd4bf)' }} />
                </div>
                <p className="text-[10px] text-zinc-500 font-medium mt-3">Keep eyes relaxed, looking straight ahead.</p>
              </div>
            )}

            {/* Step 2: 5 Blinks */}
            {step === 2 && (
              <div className="flex flex-col items-center">
                <div className="text-4xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] mb-2">{blinkCount} <span className="text-lg text-zinc-500">/ 5</span></div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={`w-10 h-2.5 rounded-full transition-all duration-300 ${
                      blinkCount >= i ? 'bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.5)]' : 'bg-zinc-800'
                    }`} />
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Long Blink Dash */}
            {step === 3 && (
              <div className="flex flex-col items-center">
                {dashMs ? (
                  <div className="text-3xl font-bold text-teal-400 mb-2">{dashMs}ms</div>
                ) : (
                  <div className="w-12 h-12 rounded-full border-2 border-zinc-700 flex items-center justify-center mb-2">
                    <span className="animate-ping w-4 h-4 rounded-full bg-zinc-600" />
                  </div>
                )}
                <p className="text-xs text-zinc-500 font-medium max-w-[200px]">Close eyes and hold for about 1 second, then open.</p>
              </div>
            )}

            {/* Step 4: Test & Save */}
            {step === 4 && (
              <div className="flex flex-col items-center w-full max-w-sm mx-auto">
                <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 min-h-[4rem] flex items-center justify-center text-3xl font-black tracking-[0.2em] text-white shadow-inner mb-6">
                  {morse || <span className="text-zinc-700 text-sm tracking-normal uppercase font-semibold">Test your blinks</span>}
                </div>
                <div className="flex gap-3 w-full">
                  <button onClick={() => setMorse('')}
                          className="flex-1 py-3.5 rounded-xl font-bold text-sm bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors border border-zinc-700">
                    Clear Input
                  </button>
                  <button onClick={handleSave} disabled={saving}
                          className="flex-[2] py-3.5 rounded-xl font-black uppercase tracking-widest text-[11px] bg-teal-500 hover:bg-teal-400 text-black shadow-[0_10px_20px_rgba(45,212,191,0.3)] transition-all active:scale-95 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Finish Setup'}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}