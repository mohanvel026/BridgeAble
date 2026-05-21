// client/src/components/GestureNavigator.jsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useCallStore } from '../store/stores';

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

const HISTORY_FRAMES  = 12;   
const SWIPE_THRESHOLD = 0.12; 
const FIST_HOLD_FRAMES = 10;
const COOLDOWN_MS     = 1500; 

function distanceTo(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Scale-invariant fist detection
function isFist(lm) {
  const fingers = [
    { tip: 8, mcp: 5 },
    { tip: 12, mcp: 9 },
    { tip: 16, mcp: 13 },
    { tip: 20, mcp: 17 },
  ];
  return fingers.every(f => distanceTo(lm[f.tip], lm[0]) < distanceTo(lm[f.mcp], lm[0]));
}

// Aspect-ratio-aware swipe detection (fixes portrait/landscape skew)
function detectSwipe(history, videoAspect) {
  if (history.length < HISTORY_FRAMES) return null;
  const first = history[0];
  const last  = history[history.length - 1];
  
  const dx = (last.x - first.x) * (videoAspect > 1 ? videoAspect : 1);
  const dy = (last.y - first.y) * (videoAspect < 1 ? 1 / videoAspect : 1);
  
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return null;

  if (absDx >= absDy) {
    return dx < 0 ? 'RIGHT' : 'LEFT'; // MediaPipe X is mirrored
  } else {
    return dy < 0 ? 'UP' : 'DOWN';
  }
}

function tts(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.2;
  window.speechSynthesis.speak(u);
}

const ACTION_META = {
  RIGHT: { label: '→ Next',        color: '#22d3ee' },
  LEFT:  { label: '← Back',        color: '#f59e0b' },
  UP:    { label: '↑ Scroll Up',    color: '#a78bfa' },
  DOWN:  { label: '↓ Scroll Down',  color: '#a78bfa' },
  FIST:  { label: '✊ Select!',     color: '#2dd4bf' },
};

export default function GestureNavigator() {
  const { user } = useAuthStore();
  const { inputMode } = useCallStore();
  const navigate = useNavigate();

  const videoRef     = useRef(null);
  const handsRef     = useRef(null);
  const rafIdRef     = useRef(null);
  const streamRef    = useRef(null);
  const lastFireRef  = useRef(0);
  const wristHistory = useRef([]);
  const fistHoldRef  = useRef(0);

  const [active, setActive]           = useState(false);
  const [lastAction, setLastAction]   = useState('');
  const [fistProgress, setFistProgress] = useState(0);

  const effectiveMode = inputMode || user?.inputMode;
  const isGestureMode = effectiveMode === 'gesture';

  const getFocusableElements = useCallback(() =>
    Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      el => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
    ), []);

  const moveFocus = useCallback((delta = 1) => {
    const elements = getFocusableElements();
    if (!elements.length) return;

    const currentFocus = document.activeElement;
    let currentIndex = elements.indexOf(currentFocus);
    if (currentIndex === -1) currentIndex = delta > 0 ? -1 : 0;

    const next = ((currentIndex + delta) + elements.length) % elements.length;
    const el = elements[next];
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });

    const label = el.getAttribute('aria-label') || el.innerText?.trim() || el.placeholder || '';
    tts(label.substring(0, 80) || 'focused item');
  }, [getFocusableElements]);

  const clickFocused = useCallback(() => {
    const el = document.activeElement;
    const isFocusable = getFocusableElements().includes(el);
    if (!el || !isFocusable || el === document.body) {
      tts('Nothing focused. Wave right to select an item first.');
      return;
    }
    tts('Selected');
    setTimeout(() => el.click(), 200);
  }, [getFocusableElements]);

  const fireAction = useCallback((action) => {
    const now = Date.now();
    if (now - lastFireRef.current < COOLDOWN_MS) return;
    lastFireRef.current = now;

    setLastAction(action);
    setTimeout(() => setLastAction(''), 1500);

    const scrollAmount = window.innerHeight * 0.4;

    switch (action) {
      case 'RIGHT': moveFocus(1); break;
      case 'LEFT':  moveFocus(-1); break;
      case 'UP':    window.scrollBy({ top: -scrollAmount, behavior: 'smooth' }); tts('Scrolling up'); break;
      case 'DOWN':  window.scrollBy({ top: scrollAmount, behavior: 'smooth' }); tts('Scrolling down'); break;
      case 'FIST':  clickFocused(); break;
      default: break;
    }

    wristHistory.current = [];
  }, [moveFocus, clickFocused]);

  const handleResults = useCallback((results) => {
    if (!results.multiHandLandmarks?.length) {
      wristHistory.current = [];
      fistHoldRef.current = 0;
      setFistProgress(0);
      return;
    }

    const lm    = results.multiHandLandmarks[0];
    const wrist = { x: lm[0].x, y: lm[0].y };
    const fist  = isFist(lm);

    if (fist) {
      fistHoldRef.current += 1;
      wristHistory.current = [];
      const progress = Math.min(100, Math.round((fistHoldRef.current / FIST_HOLD_FRAMES) * 100));
      setFistProgress(progress);
      if (fistHoldRef.current >= FIST_HOLD_FRAMES) {
        fistHoldRef.current = 0;
        setFistProgress(0);
        fireAction('FIST');
      }
    } else {
      fistHoldRef.current = 0;
      setFistProgress(0);

      const lastWrist = wristHistory.current[wristHistory.current.length - 1];
      if (!lastWrist || distanceTo(wrist, lastWrist) > 0.01) {
        wristHistory.current = [...wristHistory.current.slice(-(HISTORY_FRAMES - 1)), wrist];
      }

      const videoElement = videoRef.current;
      const aspect = videoElement ? (videoElement.videoWidth / videoElement.videoHeight) || 1 : 1;
      const swipe = detectSwipe(wristHistory.current, aspect);
      if (swipe) {
        wristHistory.current = [];
        fireAction(swipe);
      }
    }
  }, [fireAction]);

  useEffect(() => {
    // Define cleanup FIRST so it can be used in the early-return guard
    const cleanupCamera = () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      handsRef.current?.close?.();
      streamRef.current = null;
      setActive(false);
    };

    if (!isGestureMode) {
      cleanupCamera();
      return;
    }

    let mounted = true;

    const initHands = async () => {
      try {
        const handsModule = await import('@mediapipe/hands');
        const Hands = handsModule.Hands || handsModule.default?.Hands || window.Hands;

        if (!mounted || !videoRef.current) return;

        const hands = new Hands({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0,        // 0 = fast, lower battery drain
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        hands.onResults((r) => { if (mounted) handleResults(r); });
        handsRef.current = hands;

        // Native WebRTC — forces front camera on mobile
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        streamRef.current = stream;
        videoRef.current.srcObject = stream;

        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          if (mounted) setActive(true);

          const processFrame = async () => {
            if (!mounted || !videoRef.current || videoRef.current.paused || videoRef.current.ended) return;
            if (document.visibilityState === 'visible') {
              await hands.send({ image: videoRef.current });
            }
            rafIdRef.current = requestAnimationFrame(processFrame);
          };
          processFrame();
        };
      } catch (err) {
        console.error('GestureNavigator init error:', err);
      }
    };

    initHands();

    // Battery saver: pause processing when tab is hidden
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') videoRef.current?.pause();
      else videoRef.current?.play();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      cleanupCamera();
    };
  }, [isGestureMode, handleResults]);

  if (!isGestureMode && !active) return null;

  const meta = ACTION_META[lastAction];
  const RADIUS = 10;
  const CIRCUM = 2 * Math.PI * RADIUS;
  const fistDash = (fistProgress / 100) * CIRCUM;

  return (
    <>
      <video ref={videoRef} className="hidden" playsInline muted />

      {active && (
        <>
          {/* Status badge */}
          <div
            className="fixed bottom-4 left-4 z-[9998] flex items-center gap-2 px-3 py-1.5
                       bg-dark-900/90 backdrop-blur border rounded-full text-xs shadow-lg
                       pointer-events-none transition-all duration-200 mb-4 sm:mb-0"
            style={{
              borderColor: meta ? `${meta.color}50` : '#22d3ee30',
              color: meta?.color || '#22d3ee',
            }}
            aria-hidden="true"
          >
            {fistProgress > 0 ? (
              <svg width="24" height="24" viewBox="0 0 24 24" className="flex-shrink-0">
                <circle cx="12" cy="12" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
                <circle
                  cx="12" cy="12" r={RADIUS}
                  fill="none" stroke="#2dd4bf" strokeWidth="2.5"
                  strokeDasharray={`${fistDash} ${CIRCUM}`}
                  strokeLinecap="round"
                  transform="rotate(-90 12 12)"
                  style={{ transition: 'stroke-dasharray 0.05s linear' }}
                />
                <text x="12" y="15" textAnchor="middle" fontSize="8" fill="#2dd4bf">✊</text>
              </svg>
            ) : (
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'currentColor' }} />
            )}
            <span className="whitespace-nowrap">
              {lastAction ? meta?.label : '👋 Gesture Nav Active'}
            </span>
          </div>

          {/* Cheat sheet — hidden on small screens */}
          {!lastAction && fistProgress === 0 && (
            <div
              className="hidden sm:flex fixed bottom-16 left-4 z-[9997] flex-col gap-0.5 px-3 py-2
                         bg-dark-900/80 backdrop-blur border border-dark-700 rounded-xl
                         text-[10px] text-text-muted pointer-events-none"
              aria-hidden="true"
            >
              <div className="text-text-secondary text-[11px] font-medium mb-0.5">Hand Controls</div>
              <div>👋 Wave <b>right</b> → Next item</div>
              <div>👋 Wave <b>left</b> → Previous item</div>
              <div>👋 Wave <b>up / down</b> → Scroll</div>
              <div>✊ Close fist → Select</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
