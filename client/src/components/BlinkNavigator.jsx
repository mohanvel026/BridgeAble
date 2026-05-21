// client/src/components/BlinkNavigator.jsx
// Activates when inputMode === 'blink' (switchable via InputModeSwitcher)
// Blink grammar:
//   < 180ms              → ignored (natural blink)
//   180ms…dashMs         → intentional → move focus FORWARD (after 900ms wait)
//   Two within 900ms     → CLICK
//   > dashMs             → move focus BACKWARD
//   1.8s cooldown after each action

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore, useCallStore } from '../store/stores';

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const MIN_INTENTIONAL_BLINK_MS = 80;    // < 80ms = natural/involuntary blink (ignored)
const DOUBLE_BLINK_WINDOW_MS   = 700;   // two blinks within 700ms = click action
const ACTION_COOLDOWN_MS       = 1500;  // 1.5s lockout after any action (prevents cascade)

export default function BlinkNavigator() {
  const { user } = useAuthStore();
  const { inputMode } = useCallStore();

  const videoRef = useRef(null);
  const isClosedRef = useRef(false);
  const blinkStartRef = useRef(null);
  const lastIntentionalBlinkRef = useRef(0);
  const lastActionTimeRef = useRef(0);
  const pendingSingleRef = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  const focusedIndexRef = useRef(-1);

  const [active, setActive] = useState(false);
  const [pendingAction, setPendingAction] = useState('');

  // Active when inputMode is blink (user can switch modes live)
  const effectiveMode = inputMode || user?.inputMode;
  const isBlinkMode = effectiveMode === 'blink';
  const dashMs = user?.blinkProfile?.dashMs || 400;
  const earThreshold = user?.blinkProfile?.earThreshold || 0.25;

  const getFocusableElements = useCallback(() =>
    Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      el => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
    ), []);

  const tts = useCallback((text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.substring(0, 120));
    u.rate = 1.2;
    window.speechSynthesis.speak(u);
  }, []);

  const moveFocus = useCallback((delta = 1) => {
    const elements = getFocusableElements();
    if (!elements.length) return;
    const next = ((focusedIndexRef.current + delta) + elements.length) % elements.length;
    focusedIndexRef.current = next;
    const el = elements[next];
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const label = el.getAttribute('aria-label') || el.innerText?.trim() || el.placeholder || el.tagName;
    tts(label || 'focused');
  }, [getFocusableElements, tts]);

  const clickFocused = useCallback(() => {
    const elements = getFocusableElements();
    const el = elements[focusedIndexRef.current];
    if (!el) { tts('Nothing focused. Blink to move first.'); return; }
    tts('Selected');
    setTimeout(() => el.click(), 200);
  }, [getFocusableElements, tts]);

  const handleBlink = useCallback(({ duration }) => {
    if (window.PAUSE_BLINK_NAVIGATOR) return;
    
    const now = Date.now();
    if (duration < MIN_INTENTIONAL_BLINK_MS) return;
    if (now - lastActionTimeRef.current < ACTION_COOLDOWN_MS) return;

    const isLong = duration >= dashMs;

    if (isLong) {
      if (pendingSingleRef.current) { clearTimeout(pendingSingleRef.current); pendingSingleRef.current = null; }
      lastActionTimeRef.current = now;
      lastIntentionalBlinkRef.current = 0;
      setPendingAction('back');
      moveFocus(-1);
      setTimeout(() => setPendingAction(''), ACTION_COOLDOWN_MS);
      return;
    }

    const timeSinceLast = now - lastIntentionalBlinkRef.current;
    if (timeSinceLast < DOUBLE_BLINK_WINDOW_MS && timeSinceLast > 0) {
      if (pendingSingleRef.current) { clearTimeout(pendingSingleRef.current); pendingSingleRef.current = null; }
      lastActionTimeRef.current = now;
      lastIntentionalBlinkRef.current = 0;
      setPendingAction('click');
      clickFocused();
      setTimeout(() => setPendingAction(''), ACTION_COOLDOWN_MS);
    } else {
      lastIntentionalBlinkRef.current = now;
      setPendingAction('next?');
      pendingSingleRef.current = setTimeout(() => {
        pendingSingleRef.current = null;
        if (Date.now() - lastIntentionalBlinkRef.current >= DOUBLE_BLINK_WINDOW_MS - 50) {
          lastActionTimeRef.current = Date.now();
          setPendingAction('next');
          moveFocus(1);
          setTimeout(() => setPendingAction(''), ACTION_COOLDOWN_MS);
        }
      }, DOUBLE_BLINK_WINDOW_MS);
    }
  }, [dashMs, moveFocus, clickFocused]);

  useEffect(() => {
    if (!isBlinkMode) {
      // Stop camera if mode switched away
      cameraRef.current?.stop();
      faceMeshRef.current?.close?.();
      setActive(false);
      return;
    }

    let mounted = true;

    const initFaceMesh = async () => {
      try {
        const FaceMesh = window.FaceMesh;
        const Camera = window.Camera;

        if (!mounted || !videoRef.current) return;

        const LEFT_EYE = [362, 385, 387, 263, 373, 380];
        const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
        function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
        function computeEAR(lm, idx) {
          const p = idx.map(i => lm[i]);
          return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * dist(p[0], p[3]));
        }

        const faceMesh = new FaceMesh({
          locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`,
        });
        faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.65, minTrackingConfidence: 0.65 });
        faceMesh.onResults((results) => {
          if (!results.multiFaceLandmarks?.length) return;
          const lm = results.multiFaceLandmarks[0];
          const ear = (computeEAR(lm, LEFT_EYE) + computeEAR(lm, RIGHT_EYE)) / 2;
          const eyeClosed = ear < earThreshold;
          if (eyeClosed && !isClosedRef.current) {
            isClosedRef.current = true;
            blinkStartRef.current = Date.now();
          } else if (!eyeClosed && isClosedRef.current) {
            isClosedRef.current = false;
            const duration = Date.now() - (blinkStartRef.current || Date.now());
            blinkStartRef.current = null;
            if (mounted) handleBlink({ duration });
          }
        });

        faceMeshRef.current = faceMesh;
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMeshRef.current)
              await faceMeshRef.current.send({ image: videoRef.current });
          },
          width: 640, height: 480, // VGA for accurate EAR landmark positions
        });

        await camera.start();
        if (mounted) { cameraRef.current = camera; setActive(true); }
      } catch (err) {
        console.error('BlinkNavigator init error:', err);
      }
    };

    initFaceMesh();
    return () => {
      mounted = false;
      cameraRef.current?.stop();
      faceMeshRef.current?.close?.();
      if (pendingSingleRef.current) clearTimeout(pendingSingleRef.current);
      setActive(false);
    };
  }, [isBlinkMode, earThreshold, handleBlink]);

  if (!isBlinkMode && !active) return null;

  const actionLabel = {
    'next?': '⏳ Blink again to click…',
    'next':  '→ Moving forward',
    'click': '✓ Selected!',
    'back':  '← Moving back',
  }[pendingAction] || '👁 Blink Nav Active';

  const actionColor = {
    'next?': 'border-accent-amber/40 text-accent-amber',
    'next':  'border-accent-violet/40 text-accent-violet',
    'click': 'border-accent-teal/40 text-accent-teal',
    'back':  'border-accent-rose/40 text-accent-rose',
  }[pendingAction] || 'border-accent-violet/30 text-accent-violet';

  return (
    <>
      <video ref={videoRef} className="hidden" playsInline muted />
      {active && (
        <div className={`fixed bottom-4 left-4 z-[9998] flex items-center gap-2 px-3 py-1.5
                        bg-dark-900/90 backdrop-blur border rounded-full text-xs shadow-lg
                        pointer-events-none transition-all duration-300 ${actionColor}`}
          aria-hidden="true">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'currentColor' }} />
          {actionLabel}
        </div>
      )}
    </>
  );
}
