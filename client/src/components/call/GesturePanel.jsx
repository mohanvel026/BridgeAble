// client/src/components/call/GesturePanel.jsx
// Industry-Grade Sign Language Recognition Panel
// Uses MediaPipe Hands (21 landmarks) to detect ASL hand signs in real-time.
// Finger-state vector → sign classifier → auto-sent as subtitle after stable hold.

import { useState, useEffect, useRef, useCallback } from 'react';

// ── ASL Sign vocabulary with emoji, text, and finger-state fingerprints ──────
// Finger order: [Thumb, Index, Middle, Ring, Pinky] — 1 = extended, 0 = curled
const ASL_SIGNS = [
  { word: 'Hello',       emoji: '👋', fingers: [1,1,1,1,1],  gesture: 'wave'      },
  { word: 'Yes',         emoji: '✅', fingers: [0,0,0,0,0],  gesture: 'fist_nod'  },
  { word: 'No',          emoji: '❌', fingers: [0,1,1,0,0],  gesture: 'no'        },
  { word: 'Help',        emoji: '🆘', fingers: [1,1,1,1,0],  gesture: 'help'      },
  { word: 'Thank you',   emoji: '🙏', fingers: [1,0,0,0,0],  gesture: 'thank_you' },
  { word: 'Please',      emoji: '🤲', fingers: [0,1,0,0,0],  gesture: 'please'    },
  { word: 'Good',        emoji: '👍', fingers: [1,0,0,0,0],  gesture: 'thumbs_up' },
  { word: 'Bad',         emoji: '👎', fingers: [1,0,0,0,0],  gesture: 'thumbs_dn' },
  { word: 'Stop',        emoji: '✋', fingers: [0,1,1,1,1],  gesture: 'stop'      },
  { word: 'I love you',  emoji: '🤟', fingers: [1,1,0,0,1],  gesture: 'ily'       },
  { word: 'Water',       emoji: '💧', fingers: [0,1,1,1,0],  gesture: 'water'     },
  { word: 'Food',        emoji: '🍽', fingers: [0,1,1,0,1],  gesture: 'eat'       },
  { word: 'Pain',        emoji: '😣', fingers: [1,1,0,0,0],  gesture: 'pain'      },
  { word: 'Doctor',      emoji: '👨‍⚕️', fingers: [0,0,1,0,0], gesture: 'doctor'    },
  { word: 'Medicine',    emoji: '💊', fingers: [0,0,1,1,0],  gesture: 'medicine'  },
  { word: 'Emergency',   emoji: '🚨', fingers: [1,1,1,0,0],  gesture: 'emergency' },
  { word: 'Come',        emoji: '👉', fingers: [0,1,0,0,0],  gesture: 'come'      },
  { word: 'Wait',        emoji: '🤚', fingers: [0,1,1,1,1],  gesture: 'wait'      },
  { word: 'Finished',    emoji: '✔', fingers: [0,0,0,0,1],  gesture: 'done'      },
  { word: 'More',        emoji: '➕', fingers: [1,1,0,1,0],  gesture: 'more'      },
];

const STABLE_FRAME_THRESHOLD = 18; // frames at ~30fps → ~0.6s stable hold
const CONFIDENCE_THRESHOLD   = 0.72;

// ── Real finger-state extractor from MediaPipe Hands landmarks ───────────────
// Landmarks: 0=wrist, 4=thumb tip, 8=index tip, 12=middle tip, 16=ring tip, 20=pinky tip
// MCP joints (knuckles): 2=thumb, 5=index, 9=middle, 13=ring, 17=pinky
function getFingerStates(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;

  const states = [0, 0, 0, 0, 0]; // [thumb, index, middle, ring, pinky]

  // Thumb: compare tip (4) x vs IP joint (3) x — flipped for mirroring
  states[0] = landmarks[4].x < landmarks[3].x ? 1 : 0;

  // Fingers: tip y < PIP joint y means extended (less y = higher on screen)
  const tipIds  = [8,  12, 16, 20];
  const pipIds  = [6,  10, 14, 18];
  for (let i = 0; i < 4; i++) {
    states[i + 1] = landmarks[tipIds[i]].y < landmarks[pipIds[i]].y ? 1 : 0;
  }
  return states;
}

// ── Classify finger states against vocabulary ────────────────────────────────
function classifySign(states, wrist, indexTip, thumbTip) {
  if (!states) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const sign of ASL_SIGNS) {
    // Weighted Hamming similarity
    let matches = 0;
    for (let i = 0; i < 5; i++) {
      if (states[i] === sign.fingers[i]) matches++;
    }
    const score = matches / 5;

    // Special overrides for ambiguous states
    if (sign.gesture === 'thumbs_up' && states[0] === 1 && states[1] === 0 && thumbTip && indexTip) {
      // Thumbs up: thumb above index tip
      if (thumbTip.y < wrist.y - 0.1) { bestMatch = sign; bestScore = 0.9; break; }
    }
    if (sign.gesture === 'thumbs_dn' && states[0] === 1 && states[1] === 0 && thumbTip) {
      // Thumbs down: thumb below wrist
      if (thumbTip.y > wrist.y + 0.05) { bestMatch = sign; bestScore = 0.88; break; }
    }
    if (sign.gesture === 'wave' && states.every(s => s === 1)) {
      bestMatch = sign; bestScore = 0.92; break;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = sign;
    }
  }

  return bestScore >= CONFIDENCE_THRESHOLD ? { sign: bestMatch, confidence: bestScore } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GesturePanel({ onSend }) {
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const frameCountRef = useRef({});   // gesture → stable frame count
  const handsRef      = useRef(null);
  const cameraRef     = useRef(null);
  const activeRef     = useRef(true);

  const [cameraReady, setCameraReady]     = useState(false);
  const [detected, setDetected]           = useState(null);   // { sign, confidence }
  const [sentence, setSentence]           = useState('');
  const [status, setStatus]               = useState('loading'); // loading | ready | error
  const [handVisible, setHandVisible]     = useState(false);
  const [cooldown, setCooldown]           = useState(false);    // brief lock after auto-send

  // ── Draw skeleton + classify on each frame ────────────────────────────────
  const onHandResults = useCallback((results) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hasHands = results.multiHandLandmarks?.length > 0;
    setHandVisible(hasHands);

    if (!hasHands) {
      frameCountRef.current = {};
      return;
    }

    const landmarks = results.multiHandLandmarks[0];

    // Draw skeleton
    ctx.save();
    const connections = [
      [0,1],[1,2],[2,3],[3,4],       // thumb
      [0,5],[5,6],[6,7],[7,8],       // index
      [0,9],[9,10],[10,11],[11,12],  // middle
      [0,13],[13,14],[14,15],[15,16],// ring
      [0,17],[17,18],[18,19],[19,20],// pinky
      [5,9],[9,13],[13,17],          // palm
    ];

    ctx.strokeStyle = 'rgba(34,211,238,0.8)';
    ctx.lineWidth = 2;
    connections.forEach(([a, b]) => {
      const pA = landmarks[a], pB = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(pA.x * canvas.width, pA.y * canvas.height);
      ctx.lineTo(pB.x * canvas.width, pB.y * canvas.height);
      ctx.stroke();
    });

    // Draw joints
    landmarks.forEach((lm, i) => {
      ctx.beginPath();
      ctx.arc(lm.x * canvas.width, lm.y * canvas.height, i === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#22d3ee' : 'rgba(255,255,255,0.85)';
      ctx.fill();
    });
    ctx.restore();

    // Classify
    if (cooldown) return;
    const states = getFingerStates(landmarks);
    const result = classifySign(states, landmarks[0], landmarks[8], landmarks[4]);

    if (result) {
      const key = result.sign.gesture;
      frameCountRef.current[key] = (frameCountRef.current[key] || 0) + 1;

      if (frameCountRef.current[key] >= STABLE_FRAME_THRESHOLD) {
        frameCountRef.current = {};
        setDetected(result);
      }
    } else {
      // Decay counts for unstable states
      Object.keys(frameCountRef.current).forEach(k => {
        frameCountRef.current[k] = Math.max(0, (frameCountRef.current[k] || 0) - 2);
      });
    }
  }, [cooldown]);

  // ── Load MediaPipe Hands ──────────────────────────────────────────────────
  useEffect(() => {
    activeRef.current = true;
    let camera = null;

    const init = async () => {
      try {
        const handsModule = await import('@mediapipe/hands');
        const Hands = handsModule.Hands || handsModule.default?.Hands || window.Hands;
        const cameraModule = await import('@mediapipe/camera_utils');
        const Camera = cameraModule.Camera || cameraModule.default?.Camera || window.Camera;

        const hands = new Hands({
          locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.65,
          minTrackingConfidence: 0.5,
        });
        hands.onResults(onHandResults);
        handsRef.current = hands;

        camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (activeRef.current && handsRef.current && videoRef.current) {
              await handsRef.current.send({ image: videoRef.current });
            }
          },
          width: 320,
          height: 240,
        });
        cameraRef.current = camera;
        await camera.start();

        if (activeRef.current) {
          setCameraReady(true);
          setStatus('ready');
        }
      } catch (err) {
        console.error('GesturePanel init error:', err);
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
  }, [onHandResults]);

  // ── Add detected sign to sentence ─────────────────────────────────────────
  const addToSentence = useCallback(() => {
    if (!detected) return;
    setSentence(prev => prev + (prev ? ' ' : '') + detected.sign.word);
    setDetected(null);
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1200); // 1.2s cooldown before next detection
  }, [detected]);

  // ── Auto-add on stable detection ─────────────────────────────────────────
  useEffect(() => {
    if (detected && !cooldown) {
      addToSentence();
    }
  }, [detected, cooldown, addToSentence]);

  // ── Send completed sentence ───────────────────────────────────────────────
  const sendMessage = useCallback(() => {
    if (!sentence.trim()) return;
    onSend(sentence.trim(), 0.85);
    setSentence('');
    setDetected(null);
  }, [sentence, onSend]);

  const clearSentence = () => { setSentence(''); setDetected(null); };

  return (
    <div className="space-y-4 relative" role="region" aria-label="Sign language gesture detection">

      {/* Status badge */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === 'ready' ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)] animate-pulse' :
            status === 'error' ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]' : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse'
          }`} />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            {status === 'loading' ? 'Loading AI model...' :
             status === 'error'   ? 'Camera error' :
             handVisible          ? 'Hand detected ✓' : 'Show your hand'}
          </span>
        </div>
        <span className="text-[9px] font-black text-cyan-500/50 uppercase tracking-widest border border-cyan-500/20 px-2 py-0.5 rounded-full">ASL Mode</span>
      </div>

      {/* Camera + skeleton overlay */}
      <div className="relative rounded-2xl overflow-hidden bg-zinc-950/80 backdrop-blur-md border border-white/5 shadow-inner"
           style={{ aspectRatio: '4/3' }}>
        <video
          ref={videoRef}
          className="w-full h-full object-cover scale-x-[-1]"
          playsInline muted autoPlay
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full scale-x-[-1]"
          width={320} height={240}
        />

        {/* Loading spinner */}
        {!cameraReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-sm z-10">
            <div className="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mb-4 shadow-[0_0_15px_rgba(34,211,238,0.2)]" />
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest animate-pulse">
              Initializing MediaPipe
            </p>
          </div>
        )}

        {/* Hand not visible hint */}
        {cameraReady && !handVisible && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="px-4 py-2 rounded-2xl bg-black/50 backdrop-blur-md border border-white/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300 flex items-center gap-2">
                <span className="text-sm">✋</span> Hold hand in frame
              </span>
            </div>
          </div>
        )}

        {/* Cooldown overlay */}
        {cooldown && (
          <div className="absolute top-3 right-3 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-500/40 shadow-[0_0_15px_rgba(20,184,166,0.3)] z-10 animate-fade-in">
            <span className="text-[9px] text-teal-300 font-black uppercase tracking-widest">Added ✓</span>
          </div>
        )}
        
        {/* Inner shadow */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />
      </div>

      {/* Sentence builder */}
      <div className="min-h-[4rem] px-4 py-3 rounded-2xl bg-zinc-950/60 backdrop-blur-sm border border-white/5 relative shadow-inner">
        {!sentence ? (
          <p className="text-[10px] text-zinc-600 font-black uppercase tracking-widest absolute top-1/2 left-4 -translate-y-1/2">
            Signs will appear here automatically...
          </p>
        ) : (
          <p className="text-sm font-black text-white leading-snug break-words pr-8 drop-shadow-md">
            {sentence}
          </p>
        )}
        {sentence && (
          <button onClick={clearSentence}
            className="absolute top-3 right-3 w-6 h-6 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 transition-all text-xs shadow-sm active:scale-95">
            ✕
          </button>
        )}
      </div>

      {/* Quick vocab reference */}
      <div className="grid grid-cols-4 gap-2 relative z-10">
        {ASL_SIGNS.slice(0, 8).map(sign => (
          <button
            key={sign.gesture}
            onClick={() => {
              setSentence(prev => prev + (prev ? ' ' : '') + sign.word);
            }}
            title={sign.word}
            className="flex flex-col items-center py-2 rounded-xl bg-zinc-950/60 backdrop-blur-sm border border-white/5 hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all active:scale-95 group"
          >
            <span className="text-xl leading-tight group-hover:scale-110 transition-transform drop-shadow-sm">{sign.emoji}</span>
            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500 group-hover:text-cyan-400 transition-colors mt-1 leading-none truncate w-full text-center px-1">
              {sign.word.split(' ')[0]}
            </span>
          </button>
        ))}
      </div>

      {/* Send button */}
      <button
        onClick={sendMessage}
        disabled={!sentence.trim()}
        className="w-full py-4 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-400 text-[11px] font-black uppercase tracking-[0.2em]
                   hover:bg-cyan-500/25 hover:shadow-[0_0_20px_rgba(34,211,238,0.25)] active:scale-[0.98] transition-all disabled:opacity-30 disabled:hover:shadow-none disabled:cursor-not-allowed
                   flex items-center justify-center gap-3 relative z-10 group overflow-hidden"
      >
        <span className="text-xl group-hover:scale-110 transition-transform">👋</span>
        <span>Send ASL Message</span>
      </button>

      <p className="text-[9px] text-zinc-500 font-black uppercase tracking-widest text-center leading-relaxed px-4 relative z-10">
        Hold sign for 0.6s to auto-detect <span className="mx-1 text-zinc-700">·</span> Tap grid for manual input
      </p>
    </div>
  );
}
