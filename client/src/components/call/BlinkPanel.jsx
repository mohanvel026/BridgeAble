// client/src/components/call/BlinkPanel.jsx
// Industry-Grade Blink/ALS Communication Panel
// Uses MediaPipe FaceMesh to track Eye Aspect Ratio (EAR)
// Translates long/short blinks into Morse code and then into words with AI prediction.

import { useState, useEffect, useRef, useCallback } from 'react';
import useMorseDecoder from '../../hooks/useMorseDecoder';

// ── EAR (Eye Aspect Ratio) computation ───────────────────────────────────────
function computeEAR(landmarks, indices) {
  const pts = indices.map(i => landmarks[i]);
  const A = dist(pts[1], pts[5]);
  const B = dist(pts[2], pts[4]);
  const C = dist(pts[0], pts[3]);
  return (A + B) / (2.0 * C);
}
function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

const LEFT_EYE  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];

// ─────────────────────────────────────────────────────────────────────────────
export default function BlinkPanel({ onSend, blinkProfile }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const fmRef     = useRef(null);
  const cameraRef = useRef(null);
  const activeRef = useRef(true);

  const [sentence, setSentence] = useState('');
  const [isEyeClosed, setIsEyeClosed] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [faceVisible, setFaceVisible] = useState(false);

  // Settings
  const earThreshold = blinkProfile?.earThreshold || 0.22;
  const dashMs       = blinkProfile?.dashMs || 400;

  const {
    morseBuffer,
    currentWord,
    predictions,
    addSymbol,
    acceptPrediction,
    confirmWord,
    deleteLetter,
    clear,
  } = useMorseDecoder({
    onWord: (word) => {
      setSentence(prev => prev + (prev ? ' ' : '') + word);
    }
  });

  const blinkStartRef = useRef(null);
  const isClosedRef   = useRef(false);

  // ── FaceMesh Initialization ───────────────────────────────────────────────
  useEffect(() => {
    activeRef.current = true;
    let camera = null;

    const init = async () => {
      try {
        const faceMeshModule = await import('@mediapipe/face_mesh');
        const FaceMesh = faceMeshModule.FaceMesh || faceMeshModule.default?.FaceMesh || window.FaceMesh;
        const cameraModule = await import('@mediapipe/camera_utils');
        const Camera = cameraModule.Camera || cameraModule.default?.Camera || window.Camera;

        const fm = new FaceMesh({
          locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`,
        });
        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
        fm.onResults(onResults);
        fmRef.current = fm;

        camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (activeRef.current && fmRef.current && videoRef.current) {
              await fmRef.current.send({ image: videoRef.current });
            }
          },
          width: 320,
          height: 240,
        });
        cameraRef.current = camera;
        await camera.start();

        if (activeRef.current) setStatus('ready');
      } catch (err) {
        console.error('FaceMesh init error:', err);
        if (activeRef.current) setStatus('error');
      }
    };

    init();

    return () => {
      activeRef.current = false;
      try { 
        cameraRef.current?.stop?.(); 
        if (videoRef.current && videoRef.current.srcObject) {
          videoRef.current.srcObject.getTracks().forEach(track => track.stop());
          videoRef.current.srcObject = null;
        }
      } catch {}
    };
  }, []);

  // ── Frame Processing & Rendering ──────────────────────────────────────────
  const onResults = useCallback((results) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hasFace = results.multiFaceLandmarks?.length > 0;
    setFaceVisible(hasFace);
    if (!hasFace) return;

    const lm = results.multiFaceLandmarks[0];

    // 1. Calculate EAR
    const leftEar  = computeEAR(lm, LEFT_EYE);
    const rightEar = computeEAR(lm, RIGHT_EYE);
    const ear = (leftEar + rightEar) / 2;
    const eyeClosed = ear < earThreshold;

    // 2. Draw eye tracking boundaries (visual feedback)
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = eyeClosed ? 'rgba(244, 63, 94, 0.9)' : 'rgba(34, 211, 238, 0.7)'; // Rose if closed, Cyan if open
    
    [LEFT_EYE, RIGHT_EYE].forEach(eyeIndices => {
      ctx.beginPath();
      eyeIndices.forEach((idx, i) => {
        const pt = lm[idx];
        if (i === 0) ctx.moveTo(pt.x * canvas.width, pt.y * canvas.height);
        else ctx.lineTo(pt.x * canvas.width, pt.y * canvas.height);
      });
      ctx.closePath();
      ctx.stroke();
      
      // Draw center dot
      ctx.beginPath();
      const cPt = lm[eyeIndices[0]]; // anchor
      ctx.arc(cPt.x * canvas.width, cPt.y * canvas.height, 2, 0, 2*Math.PI);
      ctx.fillStyle = eyeClosed ? '#f43f5e' : '#22d3ee';
      ctx.fill();
    });
    ctx.restore();

    // 3. Process Blink Logic
    if (eyeClosed && !isClosedRef.current) {
      isClosedRef.current = true;
      setIsEyeClosed(true);
      blinkStartRef.current = Date.now();
      
      // Audio feedback (tiny tick)
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const actx = new AudioCtx();
        const osc = actx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, actx.currentTime);
        osc.connect(actx.destination);
        osc.start();
        osc.stop(actx.currentTime + 0.02);
      } catch(e) {}

    } else if (!eyeClosed && isClosedRef.current) {
      isClosedRef.current = false;
      setIsEyeClosed(false);
      
      const duration = Date.now() - blinkStartRef.current;
      addSymbol(duration >= dashMs ? 'dash' : 'dot');
    }
  }, [earThreshold, dashMs, addSymbol]);

  // ── Communication Actions ─────────────────────────────────────────────────
  const sendSentence = () => {
    const finalMsg = sentence + (currentWord ? (sentence ? ' ' : '') + currentWord : '');
    if (!finalMsg.trim()) return;
    
    onSend(finalMsg.trim(), 0.95);
    setSentence('');
    clear();
  };

  return (
    <div className="space-y-4 relative" role="region" aria-label="Eye tracking blink communication panel">

      {/* Header Status */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === 'ready' ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)] animate-pulse' :
            status === 'error' ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]' : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse'
          }`} />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            {status === 'loading' ? 'Initializing AI...' :
             status === 'error'   ? 'Camera Fault' :
             faceVisible          ? 'Tracking Eyes ✓' : 'Position Face'}
          </span>
        </div>
        <span className="text-[9px] font-black text-violet-400/60 uppercase tracking-widest border border-violet-500/20 px-2 py-0.5 rounded-full">Morse Mode</span>
      </div>

      {/* Camera Feed & Tracking UI */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-950/80 backdrop-blur-md border border-white/5 shadow-inner"
           style={{ aspectRatio: '4/3' }}>
        <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted autoPlay />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full scale-x-[-1]" width={320} height={240} />

        {/* Loading Overlay */}
        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-sm z-10">
            <div className="w-10 h-10 border-2 border-violet-500/20 border-t-violet-400 rounded-full animate-spin mb-4 shadow-[0_0_15px_rgba(139,92,246,0.2)]" />
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest animate-pulse">
              Loading Face Detector
            </p>
          </div>
        )}

        {/* Blink Indicator Overlay */}
        {status === 'ready' && (
          <div className="absolute top-3 left-3 flex flex-col gap-2">
            {/* Eye state indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 shadow-lg w-max">
              <div className={`w-2.5 h-2.5 rounded-full transition-all ${isEyeClosed ? 'bg-rose-500 shadow-[0_0_12px_#f43f5e] animate-pulse' : 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.5)]'}`} />
              <span className="text-[9px] font-black uppercase tracking-widest text-white">
                {isEyeClosed ? 'CLOSED' : 'OPEN'}
              </span>
            </div>
            {/* Privacy Assurance Badge */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-amber-500/10 border-amber-500/20 shadow-md backdrop-blur-md w-max">
              <span className="text-amber-500 text-[10px]">🔒</span>
              <span className="text-[7.5px] font-black uppercase tracking-[0.15em] text-amber-500">
                Local Tracking Only · Not Transmitted
              </span>
            </div>
          </div>
        )}
        
        {/* Inner shadow */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />
      </div>

      {/* Morse Decoding HUD */}
      <div className="grid grid-cols-2 gap-3 relative z-10">
        <div className="px-4 py-3 rounded-2xl bg-zinc-950/60 backdrop-blur-sm border border-white/5 flex flex-col shadow-inner">
          <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest mb-1">Buffer</p>
          <p className="font-mono text-violet-400 text-2xl tracking-[0.3em] font-black leading-none h-8 flex items-center drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]">
            {morseBuffer || <span className="opacity-20">...</span>}
          </p>
        </div>
        
        <div className="px-4 py-3 rounded-2xl bg-zinc-950/60 backdrop-blur-sm border border-white/5 flex flex-col relative shadow-inner">
          <div className="flex justify-between items-center mb-1">
            <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Word</p>
            {currentWord && (
              <button onClick={deleteLetter} className="text-[9px] font-black uppercase tracking-widest text-rose-400 hover:text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded transition-colors">Del</button>
            )}
          </div>
          <p className="font-sans font-black text-cyan-400 text-xl leading-none h-8 flex items-center truncate drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">
            {currentWord || <span className="opacity-20 font-mono">_</span>}
          </p>
        </div>
      </div>

      {/* AI Predictions */}
      {predictions.length > 0 && (
        <div className="animate-fade-in space-y-2 relative z-10">
          <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Predictions</p>
          <div className="grid grid-cols-2 gap-2">
            {predictions.map(w => (
              <button key={w} onClick={() => acceptPrediction(w)}
                className="py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/30
                           text-violet-300 text-xs font-black uppercase tracking-wider hover:bg-violet-500/25 hover:shadow-[0_0_15px_rgba(139,92,246,0.15)] transition-all active:scale-95 shadow-sm">
                {w}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Final Sentence Builder */}
      <div className="min-h-[4rem] px-4 py-3 rounded-2xl bg-zinc-950/60 backdrop-blur-sm border border-white/5 relative shadow-inner z-10">
        <div className="flex justify-between items-center mb-2">
          <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest">Message</p>
          {(sentence || currentWord) && (
            <button onClick={() => { setSentence(''); clear(); }} className="text-[9px] font-black uppercase tracking-widest text-rose-400 hover:text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded transition-colors">Clear</button>
          )}
        </div>
        <p className="text-sm font-black text-white leading-snug break-words drop-shadow-md">
          {sentence} <span className="opacity-50 text-cyan-400">{currentWord}</span>
          {!sentence && !currentWord && <span className="text-zinc-600 text-[10px] uppercase tracking-widest absolute top-1/2 left-4 mt-2 -translate-y-1/2">Blink to build message...</span>}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3 relative z-10">
        <button onClick={confirmWord} disabled={!currentWord}
          className="py-3.5 rounded-2xl border border-violet-500/40 text-violet-400
                     text-[10px] font-black uppercase tracking-widest hover:bg-violet-500/15 hover:shadow-[0_0_15px_rgba(139,92,246,0.15)] transition-all disabled:opacity-30 disabled:hover:shadow-none active:scale-95 shadow-sm">
          Space (Confirm)
        </button>
        <button onClick={sendSentence} disabled={!sentence && !currentWord}
          className="py-3.5 rounded-2xl bg-violet-500/20 border border-violet-500/40
                     text-violet-300 text-[11px] font-black uppercase tracking-[0.2em] hover:bg-violet-500/30 hover:shadow-[0_0_20px_rgba(139,92,246,0.25)] transition-all disabled:opacity-30 disabled:hover:shadow-none active:scale-95 flex items-center justify-center gap-2 shadow-sm group">
          <span>Transmit</span>
          <span className="text-lg group-hover:scale-110 transition-transform">✓</span>
        </button>
      </div>

      <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest text-center leading-relaxed px-4 relative z-10">
        Short blink (&lt;{dashMs}ms) = DOT <span className="mx-1 text-zinc-700">·</span> Long blink = DASH<br/>
        Auto-space 1.2s <span className="mx-1 text-zinc-700">·</span> Auto-word 2.5s
      </p>
    </div>
  );
}