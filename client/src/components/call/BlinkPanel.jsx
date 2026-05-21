// client/src/components/call/BlinkPanel.jsx
// Industry-Grade Blink/ALS Communication Panel (Zero-Render Edition)
// Uses MediaPipe FaceMesh to track Eye Aspect Ratio (EAR)
// Translates long/short blinks into Morse code and then into words with AI prediction.

import { useState, useEffect, useRef, useCallback } from 'react';
import useMorseDecoder from '../../hooks/useMorseDecoder';
import { Play, Delete, RotateCcw, Send, Check, HelpCircle, X } from 'lucide-react';

// ── EAR (Eye Aspect Ratio) computation ───────────────────────────────────────
function dist(a, b, width = 320, height = 240) { 
  return Math.sqrt(Math.pow((a.x - b.x)*width, 2) + Math.pow((a.y - b.y)*height, 2)); 
}
function computeEAR(landmarks, indices) {
  const pts = indices.map(i => landmarks[i]);
  const A = dist(pts[1], pts[5]);
  const B = dist(pts[2], pts[4]);
  const C = dist(pts[0], pts[3]);
  if (C < 1e-6) return 0.30;
  return (A + B) / (2.0 * C);
}

const LEFT_EYE  = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];

// ─────────────────────────────────────────────────────────────────────────────
export default function BlinkPanel({ onSend, blinkProfile }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const fmRef     = useRef(null);
  const cameraRef = useRef(null);
  const activeRef = useRef(true);
  const audioCtxRef = useRef(null);

  const [sentence, setSentence] = useState('');
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [faceVisible, setFaceVisible] = useState(false);
  const [showCheatSheet, setShowCheatSheet] = useState(false);

  // Only store essential UI state in React, not 60fps tracking data
  const [uiState, setUiState] = useState({ isEyeClosed: false });

  // Settings
  const earThreshold = blinkProfile?.earThreshold || 0.22;
  const dashMs       = blinkProfile?.dashMs || 400;

  const handleWord = useCallback((word) => {
    setSentence(prev => prev + (prev ? ' ' : '') + word);
  }, []);

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
    onWord: handleWord
  });

  const predictionsRef = useRef([]);
  useEffect(() => {
    predictionsRef.current = predictions;
  }, [predictions]);

  // Pause the global blink navigator while typing Morse code
  useEffect(() => {
    window.PAUSE_BLINK_NAVIGATOR = true;
    return () => {
      window.PAUSE_BLINK_NAVIGATOR = false;
    };
  }, []);

  const blinkStartRef = useRef(null);
  const isClosedRef   = useRef(false);
  const predictionBeepTimerRef = useRef(null);
  const sendBeepTimerRef = useRef(null);

  // ── Audio Engine for Haptic/Acoustic Feedback ───────────────────────────
  useEffect(() => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioCtxRef.current = new AudioCtx();
    }
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(console.error);
      }
    };
  }, []);

  const playTone = useCallback(async (freq, duration, type = 'square') => {
    if (!audioCtxRef.current) return;
    try {
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      const osc = audioCtxRef.current.createOscillator();
      const gain = audioCtxRef.current.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtxRef.current.currentTime);
      
      gain.gain.setValueAtTime(0.015, audioCtxRef.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtxRef.current.currentTime + duration);

      osc.connect(gain);
      gain.connect(audioCtxRef.current.destination);
      osc.start();
      osc.stop(audioCtxRef.current.currentTime + duration);
    } catch (e) {}
  }, []);

  const playBeep = useCallback(() => playTone(800, 0.05), [playTone]);
  const playPredictionBeep = useCallback(() => playTone(500, 0.1, 'sine'), [playTone]);
  const playSendBeep = useCallback(() => {
    playTone(400, 0.1, 'sine');
    setTimeout(() => playTone(400, 0.1, 'sine'), 150);
  }, [playTone]);

  const handleSend = useCallback(() => {
    setSentence(prev => {
      // Must use the latest state directly in the updater since handleSend is memoized
      let finalMsg = prev;
      // We can't access currentWord directly reliably without adding it to deps (which restarts camera)
      // So we rely on the parent component triggering onSend. 
      // Actually, we'll just emit a custom event or use refs.
      return prev; 
    });
  }, []);

  // ── 60FPS Zero-Render Results Loop ──────────────────────────────────────────
  const onResults = useCallback((results) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hasFace = results.multiFaceLandmarks?.length > 0;
    
    // Using a ref to track face visibility to avoid useless re-renders
    if (faceVisible !== hasFace) {
        setFaceVisible(hasFace);
    }
    
    if (!hasFace) return;

    const lm = results.multiFaceLandmarks[0];
    const ear = (computeEAR(lm, LEFT_EYE) + computeEAR(lm, RIGHT_EYE)) / 2;
    const eyeClosed = ear < earThreshold;

    // Draw eye bounding boxes directly to canvas context
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = eyeClosed ? 'rgba(244, 63, 94, 0.9)' : 'rgba(34, 211, 238, 0.7)'; 
    ctx.shadowBlur = 10;
    ctx.shadowColor = eyeClosed ? 'rgba(244, 63, 94, 0.8)' : 'rgba(34, 211, 238, 0.8)';
    
    [LEFT_EYE, RIGHT_EYE].forEach(eyeIndices => {
      ctx.beginPath();
      eyeIndices.forEach((idx, i) => {
        const pt = lm[idx];
        if (i === 0) ctx.moveTo(pt.x * canvas.width, pt.y * canvas.height);
        else ctx.lineTo(pt.x * canvas.width, pt.y * canvas.height);
      });
      ctx.closePath();
      ctx.stroke();
    });
    ctx.restore();

    if (eyeClosed && !isClosedRef.current) {
      isClosedRef.current = true;
      setUiState({ isEyeClosed: true });
      blinkStartRef.current = Date.now();
      playBeep();

      // Schedule auditory cues for advanced selection
      predictionBeepTimerRef.current = setTimeout(() => {
        playPredictionBeep();
      }, 1000);
      
      sendBeepTimerRef.current = setTimeout(() => {
        playSendBeep();
      }, 2000);

    } else if (!eyeClosed && isClosedRef.current) {
      isClosedRef.current = false;
      setUiState({ isEyeClosed: false });
      
      clearTimeout(predictionBeepTimerRef.current);
      clearTimeout(sendBeepTimerRef.current);
      
      const duration = Date.now() - blinkStartRef.current;
      
      if (duration >= 2000) {
        // Send
        document.getElementById('hidden-send-trigger')?.click();
      } else if (duration >= 1000) {
        // Accept prediction
        if (predictionsRef.current.length > 0) {
          acceptPrediction(predictionsRef.current[0]);
        } else {
          confirmWord(); // Fallback if no prediction
        }
      } else if (duration >= dashMs) {
        addSymbol('dash');
      } else if (duration > 80) {
        addSymbol('dot');
      }
    }
  }, [earThreshold, dashMs, addSymbol, playBeep, playPredictionBeep, playSendBeep, acceptPrediction, confirmWord, faceVisible]);

  // ── FaceMesh Initialization ───────────────────────────────────────────────
  useEffect(() => {
    activeRef.current = true;
    let camera = null;

    const init = async () => {
      try {
        const FaceMesh = window.FaceMesh;
        const Camera = window.Camera;

        if (!FaceMesh || !Camera) return;

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

    const handleVisibilityChange = () => {
      if (document.hidden) {
        cameraRef.current?.stop();
      } else {
        cameraRef.current?.start();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      activeRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      try { cameraRef.current?.stop(); } catch (_) {}
      try { fmRef.current?.close(); } catch (_) {}
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [onResults]);

  // ── UI Handlers ────────────────────────────────────────────────────────────
  const executeSend = () => {
    const finalMsg = [sentence, currentWord].filter(Boolean).join(' ');
    if (finalMsg.trim()) {
      onSend(finalMsg.trim());
      setSentence('');
      clear();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#040404]/90 backdrop-blur-3xl p-4 gap-4 animate-fade-in relative z-10 border border-white/5 rounded-t-3xl md:rounded-3xl shadow-2xl">
      {/* ── Top section: Camera + Morse status ── */}
      <div className="flex flex-col md:flex-row gap-4 h-[220px]">
        
        {/* Camera / Face detection status */}
        <div className="relative w-full md:w-[280px] h-full rounded-2xl overflow-hidden bg-black shadow-inner border border-white/5 flex-shrink-0 group">
          <video 
            ref={videoRef} 
            className="absolute inset-0 w-full h-full object-cover opacity-0 pointer-events-none"
            style={{ transform: 'scaleX(-1)' }}
            playsInline 
            muted 
          />
          <canvas
            ref={canvasRef}
            width={320}
            height={240}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ transform: 'scaleX(-1)' }}
          />

          {/* High-Visibility Privacy Assurance Overlay */}
          {status === 'ready' && (
            <div className="absolute top-0 left-0 w-full bg-gradient-to-r from-amber-500/20 via-amber-500/5 to-transparent border-b border-amber-500/30 p-2 backdrop-blur-md z-20 flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500 flex items-center justify-center animate-pulse shrink-0">
                <span className="text-amber-400 text-[10px] drop-shadow-md">🔒</span>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-amber-400 drop-shadow-md leading-tight">
                  Privacy Mode Active
                </p>
                <p className="text-[7px] font-bold uppercase tracking-widest text-amber-500/80 leading-tight">
                  Local AI Sensor. Video NOT transmitted.
                </p>
              </div>
            </div>
          )}

          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm z-20">
               <div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-400 rounded-full animate-spin mb-2" />
               <p className="text-xs text-teal-400 font-medium">Booting AI Engine...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20">
               <p className="text-xs text-rose-400 font-medium text-center px-4">Camera/AI failed to load.<br/>Check permissions.</p>
            </div>
          )}

          {/* HUD Overlay */}
          {status === 'ready' && (
            <div className="absolute inset-0 p-3 flex flex-col justify-between pointer-events-none z-10">
              <div className="flex justify-between items-start">
                <div className={`px-2 py-1 rounded-md backdrop-blur-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                  uiState.isEyeClosed 
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' 
                    : 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${uiState.isEyeClosed ? 'bg-rose-400 animate-pulse' : 'bg-teal-400'}`} />
                  {uiState.isEyeClosed ? 'Closed' : 'Open'}
                </div>
                
                <div className={`px-2 py-1 rounded-md backdrop-blur-md text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  faceVisible 
                    ? 'bg-white/10 text-white/70 border border-white/5' 
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse'
                }`}>
                  {faceVisible ? 'Tracking' : 'No Face'}
                </div>
              </div>
              
              <div className="self-end px-2 py-1 bg-black/50 backdrop-blur-md rounded border border-white/5 text-[9px] text-white/50 font-mono">
                Dash &ge; {dashMs}ms
              </div>
            </div>
          )}
        </div>

        {/* Decoder Status / Builder */}
        <div className="flex-1 flex flex-col gap-3 h-full">
          {/* Header Actions */}
          <div className="flex justify-end mb-[-10px] relative z-20">
            <button 
              onClick={() => setShowCheatSheet(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition-all text-[10px] font-black uppercase tracking-widest shadow-[0_0_15px_rgba(20,184,166,0.15)]"
            >
              <HelpCircle size={14} />
              How to Type
            </button>
          </div>

          {/* Current Buffer */}
          <div className="flex-1 rounded-2xl bg-white/[0.03] border border-white/5 p-4 flex flex-col justify-center shadow-inner relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-50" />
            <p className="text-xs text-white/40 font-bold uppercase tracking-widest mb-2 z-10">Live Input</p>
            <div className="flex items-center gap-2 h-10 z-10">
              {morseBuffer.length === 0 ? (
                <div className="text-white/20 font-mono text-lg animate-pulse">Waiting for blink...</div>
              ) : (
                morseBuffer.map((sym, i) => (
                  <div key={i} className="animate-pop-in">
                    {sym === 'dot' ? (
                      <div className="w-3 h-3 rounded-full bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.5)]" />
                    ) : (
                      <div className="w-10 h-3 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.5)]" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Current Word & Predictions */}
          <div className="h-[90px] rounded-2xl bg-white/[0.03] border border-white/5 p-3 flex flex-col gap-2 shadow-inner">
            <div className="flex justify-between items-center">
              <p className="text-xs text-white/40 font-bold uppercase tracking-widest">Builder</p>
              <div className="flex gap-2">
                <button onClick={deleteLetter} className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-rose-400 transition-colors">
                  <RotateCcw size={14} />
                </button>
                <button onClick={confirmWord} disabled={!currentWord} className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-teal-400 transition-colors disabled:opacity-30">
                  <Check size={14} />
                </button>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-1">
              <span className="text-2xl font-black tracking-wider text-white">
                {currentWord || <span className="text-white/10">...</span>}
              </span>
              
              {/* Predictions */}
              <div className="flex gap-2 ml-auto">
                {predictions.map((word, i) => (
                  <button 
                    key={word + i}
                    onClick={() => acceptPrediction(word)}
                    className="px-3 py-1.5 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 text-sm font-bold hover:bg-teal-500/20 transition-colors"
                  >
                    {word}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom section: Sentence Builder & Actions ── */}
      <div className="flex gap-3">
        <div className="flex-1 min-h-[60px] rounded-2xl bg-white/[0.05] border border-white/10 p-4 flex items-center shadow-inner">
          <p className="text-lg font-medium text-white/90">
            {sentence}
            {currentWord && <span className="text-teal-400">{sentence ? ' ' : ''}{currentWord}</span>}
            {!sentence && !currentWord && <span className="text-white/20 italic font-normal">Formulating message...</span>}
            <span className="w-2 h-5 bg-teal-400 inline-block ml-1 animate-pulse align-middle" />
          </p>
        </div>

        <button 
          id="hidden-send-trigger"
          onClick={executeSend}
          disabled={!sentence && !currentWord}
          className="h-[60px] px-8 rounded-2xl bg-teal-500 hover:bg-teal-400 text-black font-black uppercase tracking-widest text-sm flex items-center gap-2 transition-all shadow-[0_0_30px_rgba(45,212,191,0.2)] disabled:opacity-50 disabled:shadow-none"
        >
          <Send size={18} className="fill-black" />
          Send
        </button>
      </div>
      
      <div className="flex justify-center gap-6 mt-2 text-[10px] font-bold uppercase tracking-widest text-white/30">
        <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-white/30" /> Dot (&lt; {dashMs}ms) = Letter</span>
        <span className="flex items-center gap-2"><div className="w-3 h-1.5 rounded-full bg-white/30" /> Dash = Action</span>
        <span className="flex items-center gap-2 text-teal-400/50">Hold 1s = Select AI Word</span>
        <span className="flex items-center gap-2 text-rose-400/50">Hold 2s = Send Message</span>
      </div>

      {/* Cheat Sheet Modal */}
      {showCheatSheet && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md rounded-3xl animate-fade-in">
          <div className="w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-white/[0.02]">
              <h3 className="text-sm font-black text-white tracking-widest uppercase flex items-center gap-2">
                <HelpCircle size={16} className="text-teal-400" /> Blink Communication Guide
              </h3>
              <button onClick={() => setShowCheatSheet(false)} className="p-1.5 text-white/50 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 max-h-[60vh]">
              {/* Timing Guide */}
              <div>
                <h4 className="text-[10px] text-zinc-500 font-black tracking-widest uppercase mb-3 border-b border-white/5 pb-2">1. Blink Actions</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-start gap-3">
                    <div className="mt-0.5"><div className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.5)]" /></div>
                    <div>
                      <p className="text-xs font-bold text-white">Quick Blink (Dot)</p>
                      <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">A normal fast blink builds dots for Morse code letters.</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-start gap-3">
                    <div className="mt-1"><div className="w-5 h-2 rounded-full bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.5)]" /></div>
                    <div>
                      <p className="text-xs font-bold text-white">Long Blink (Dash)</p>
                      <p className="text-[10px] text-zinc-400 leading-relaxed mt-1">Hold eyes closed for half a second to build dashes.</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-start gap-3">
                    <span className="text-lg">🎵</span>
                    <div>
                      <p className="text-xs font-bold text-teal-400">Hold 1 Second (AI Word)</p>
                      <p className="text-[10px] text-teal-400/70 leading-relaxed mt-1">Close your eyes until you hear the single chime to instantly accept the top AI word prediction.</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start gap-3">
                    <span className="text-lg">🎵🎵</span>
                    <div>
                      <p className="text-xs font-bold text-rose-400">Hold 2 Seconds (Send)</p>
                      <p className="text-[10px] text-rose-400/70 leading-relaxed mt-1">Keep eyes closed until you hear the double chime to send your entire message across the call.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Morse Code Alphabet */}
              <div>
                <h4 className="text-[10px] text-zinc-500 font-black tracking-widest uppercase mb-3 border-b border-white/5 pb-2">2. Morse Alphabet</h4>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {Object.entries({
                    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
                    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
                    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
                    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
                    'Y': '-.--', 'Z': '--..'
                  }).map(([letter, code]) => (
                    <div key={letter} className="flex flex-col items-center justify-center p-2 rounded-lg bg-black/40 border border-white/5">
                      <span className="text-sm font-black text-white">{letter}</span>
                      <span className="text-xs font-bold tracking-widest text-teal-400 mt-1">{code}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}