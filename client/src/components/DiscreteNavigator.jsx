// client/src/components/DiscreteNavigator.jsx
// ── Production Spatial Navigator ──────────────────────────────
// Combines the best of every iteration:
//   ✦ Velocity-based flick detection   (px/ms — ignores slow tremors)
//   ✦ DOM Caching + MutationObserver   (zero layout thrashing)
//   ✦ Score-based spatial routing      (primaryDist + 2.5×offset)
//   ✦ Zone memory map                  (returns to last item per zone)
//   ✦ aria-live region                 (wires into VoiceOver/NVDA natively)
//   ✦ Store-driven activation          (inputMode, no prop)
//   ✦ Stream ref cleanup               (no camera leak)
//   ✦ Viewport-correct focus ring      (fixed position, NO scrollY bug)
//   ✦ Battery-saver visibility pause

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore, useCallStore } from '../store/stores';

// ── Config ───────────────────────────────────────────────────
const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', '[tabindex="0"]',
].join(', ');

const VELOCITY_THRESHOLD = 0.55;  // px/ms — fast enough to be intentional
const PINCH_THRESHOLD    = 0.04;  // 3D distance index→thumb
const COOLDOWN_MS        = 280;   // ms between actions (tremor protection)

// Zone memory: zone-name → last focused element in that zone
const zoneMemory = new Map();

// ── Math helpers ─────────────────────────────────────────────
function getDist3D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z || 0) - (b.z || 0)) ** 2);
}

// Position-based zone detection (no data attributes required)
function getZone(rect) {
  const cy = rect.top  + rect.height / 2;
  const cx = rect.left + rect.width  / 2;
  if (cy < 70)   return 'topnav';
  if (cx < 260)  return 'sidebar';
  return 'content';
}

const ZONE_META = {
  topnav:  { label: 'Top Nav',  color: '#a78bfa' },
  sidebar: { label: 'Sidebar',  color: '#38bdf8' },
  content: { label: 'Content',  color: '#2dd4bf' },
};

function speak(text) {
  if (!window.speechSynthesis || !text?.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.substring(0, 80));
  u.rate = 1.2;
  window.speechSynthesis.speak(u);
}

export default function DiscreteNavigator() {
  const { user }      = useAuthStore();
  const { inputMode } = useCallStore();

  const effectiveMode = inputMode || user?.inputMode;
  const isActive      = effectiveMode === 'gesture';

  const videoRef  = useRef(null);
  const handsRef  = useRef(null);
  const streamRef = useRef(null);
  const rafId     = useRef(null);

  const [focusBox, setFocusBox]       = useState({ top: -200, left: -200, width: 0, height: 0, opacity: 0, br: '8px', isClicking: false });
  const [zoneName, setZoneName]       = useState('sidebar');
  const [flash, setFlash]             = useState('');
  const [statusMsg, setStatusMsg]     = useState('Initializing...');
  const [announcement, setAnnouncement] = useState(''); // aria-live → VoiceOver / NVDA

  const S = useRef({
    history: [],        // [{ x, y, time }] — pixel coords for velocity
    lastActionTime: 0,
    isPinched: false,
    domCache: [],       // [{ el, rect, zone }]
    cacheDirty: true,
  });

  const flashTimer = useRef(null);

  // ── 1. DOM CACHE + MUTATION OBSERVER ─────────────────────
  const buildCache = useCallback(() => {
    if (!S.current.cacheDirty) return;
    S.current.domCache = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter(el => el.offsetParent !== null
        && window.getComputedStyle(el).visibility !== 'hidden'
        && !el.closest('[aria-hidden="true"]'))
      .map(el => {
        const rect = el.getBoundingClientRect(); // calculated ONCE per cache rebuild
        return { el, rect, zone: getZone(rect) };
      });
    S.current.cacheDirty = false;
  }, []);

  useEffect(() => {
    const invalidate = () => { S.current.cacheDirty = true; };
    const observer = new MutationObserver(invalidate);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'disabled', 'hidden'],
    });
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
    };
  }, []);

  // ── 2. FOCUS RING UPDATE ──────────────────────────────────
  const updateRing = useCallback((el, isClicking = false) => {
    const target = el || document.activeElement;
    if (!target || target === document.body) {
      setFocusBox(p => ({ ...p, opacity: 0 }));
      return;
    }
    const rect = target.getBoundingClientRect();
    if (!rect.width) return;

    // KEY FIX: position:fixed uses VIEWPORT coords. Never add scrollY.
    setFocusBox({
      top: rect.top, left: rect.left,
      width: rect.width, height: rect.height, opacity: 1,
      br: window.getComputedStyle(target).borderRadius || '8px',
      isClicking,
    });

    const z = getZone(rect);
    setZoneName(z);

    // Persist zone memory
    const zn = target.closest('[data-spatial-zone]')?.dataset.spatialZone || z;
    zoneMemory.set(zn, target);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const sync = () => updateRing();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => { window.removeEventListener('scroll', sync); window.removeEventListener('resize', sync); };
  }, [isActive, updateRing]);

  // ── 3. SPATIAL ROUTING ENGINE ─────────────────────────────
  // Score = primaryDist + 2.5 × lateral offset.
  // This strongly favours "straight ahead" elements over diagonal ones,
  // making sidebar-to-topnav jumps feel precise.
  const findBest = useCallback((currentEl, direction) => {
    buildCache();
    const cache = S.current.domCache;
    if (!currentEl || currentEl === document.body) return cache[0]?.el ?? null;

    const cur = cache.find(c => c.el === currentEl)?.rect
      ?? currentEl.getBoundingClientRect();

    const curCX = cur.left + cur.width  / 2;
    const curCY = cur.top  + cur.height / 2;

    let best = null, bestScore = Infinity;
    let bestZone = null;

    for (const { el, rect, zone } of cache) {
      if (el === currentEl) continue;

      const elCX = rect.left + rect.width  / 2;
      const elCY = rect.top  + rect.height / 2;

      let inDir = false, primary = 0, lateral = 0;
      switch (direction) {
        case 'RIGHT':
          inDir   = rect.left  >= cur.right  - 10;
          primary = rect.left  -  cur.right;
          lateral = Math.abs(elCY - curCY);
          break;
        case 'LEFT':
          inDir   = rect.right <= cur.left   + 10;
          primary = cur.left   -  rect.right;
          lateral = Math.abs(elCY - curCY);
          break;
        case 'DOWN':
          inDir   = rect.top    >= cur.bottom - 10;
          primary = rect.top    -  cur.bottom;
          lateral = Math.abs(elCX - curCX);
          break;
        case 'UP':
          inDir   = rect.bottom <= cur.top   + 10;
          primary = cur.top     -  rect.bottom;
          lateral = Math.abs(elCX - curCX);
          break;
      }
      if (!inDir) continue;

      const score = primary + lateral * 2.5;
      if (score < bestScore) { bestScore = score; best = el; bestZone = zone; }
    }

    // Zone memory override: return the last visited element in the target zone
    if (bestZone) {
      const mem = zoneMemory.get(bestZone);
      if (mem && document.body.contains(mem) && mem !== currentEl) return mem;
    }

    return best;
  }, [buildCache]);

  // ── 4. ACTION DISPATCHER ─────────────────────────────────
  const fireAction = useCallback((action) => {
    const now = Date.now();
    if (now - S.current.lastActionTime < COOLDOWN_MS) return;
    S.current.lastActionTime = now;

    const doFlash = (text, z = zoneName) => {
      setFlash({ text, color: ZONE_META[z]?.color || '#38bdf8' });
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(''), 700);
    };

    if (action === 'CLICK') {
      const el = document.activeElement;
      if (el && el !== document.body) {
        updateRing(el, true);
        setTimeout(() => { el.click(); updateRing(el, false); }, 100);
        setAnnouncement('Activated');
        doFlash('✓');
      } else {
        speak('Nothing selected. Flick to highlight an item.');
      }
      return;
    }

    const next = findBest(document.activeElement, action);
    if (next) {
      next.focus({ preventScroll: true });

      const rect = next.getBoundingClientRect();
      if (rect.top < 60 || rect.bottom > window.innerHeight - 60) {
        next.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }

      updateRing(next);
      const z = getZone(rect);
      const label = next.getAttribute('aria-label') || next.innerText?.trim().split('\n')[0] || next.placeholder || '';
      const prevZone = getZone((document.activeElement || next).getBoundingClientRect());

      if (z !== prevZone) {
        speak(`${ZONE_META[z]?.label}: ${label}`);
        doFlash(`→ ${ZONE_META[z]?.label}`, z);
      } else {
        if (label) speak(label);
        doFlash({ UP:'↑',DOWN:'↓',LEFT:'←',RIGHT:'→' }[action] || '', z);
      }
      setAnnouncement(label); // Feed to native screen reader
    } else {
      // Edge of layout → scroll instead
      if (action === 'UP')   window.scrollBy({ top: -(window.innerHeight * 0.4), behavior: 'smooth' });
      if (action === 'DOWN') window.scrollBy({ top:   window.innerHeight * 0.4,  behavior: 'smooth' });
      setAnnouncement('End of layout');
      doFlash('─ End', zoneName);
    }
  }, [findBest, updateRing, zoneName]);

  // ── 5. KINEMATIC GESTURE AI ───────────────────────────────
  // Uses px/ms VELOCITY, not raw displacement.
  // Benefit: slow, deliberate hand movements are completely ignored.
  // Only fast, intentional flicks register.
  const handleResults = useCallback((results) => {
    if (!results.multiHandLandmarks?.length) {
      setStatusMsg('Waiting for hand...');
      S.current.history = [];
      return;
    }
    setStatusMsg(`${ZONE_META[zoneName]?.label || 'Active'} — Flick to navigate`);

    const lm = results.multiHandLandmarks[0];
    const wrist    = lm[0];
    const indexTip = lm[8];
    const thumbTip = lm[4];
    const now      = performance.now();

    // Pinch (tap to click)
    const pinchDist = getDist3D(indexTip, thumbTip);
    if (pinchDist < PINCH_THRESHOLD) {
      if (!S.current.isPinched) { S.current.isPinched = true; fireAction('CLICK'); }
    } else {
      S.current.isPinched = false;
    }

    // Map to pixel space for correct velocity units (mirror X)
    const px = (1 - wrist.x) * window.innerWidth;
    const py = wrist.y * window.innerHeight;

    S.current.history.push({ x: px, y: py, time: now });
    if (S.current.history.length > 6) S.current.history.shift();

    if (S.current.history.length === 6 && !S.current.isPinched) {
      const first = S.current.history[0];
      const last  = S.current.history[5];
      const dt    = last.time - first.time;

      if (dt > 0) {
        const vx = (last.x - first.x) / dt; // px/ms
        const vy = (last.y - first.y) / dt;

        if (Math.abs(vx) > VELOCITY_THRESHOLD || Math.abs(vy) > VELOCITY_THRESHOLD) {
          if (Math.abs(vx) >= Math.abs(vy)) {
            fireAction(vx > 0 ? 'RIGHT' : 'LEFT');
          } else {
            fireAction(vy < 0 ? 'UP' : 'DOWN');
          }
          S.current.history = [];
        }
      }
    }
  }, [fireAction, zoneName]);

  // ── 6. HARDWARE INIT ──────────────────────────────────────
  useEffect(() => {
    const cleanup = () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      handsRef.current?.close?.();
      setFocusBox(p => ({ ...p, opacity: 0 }));
    };

    if (!isActive) { cleanup(); return; }
    let mounted = true;

    (async () => {
      try {
        const hm    = await import('@mediapipe/hands');
        const Hands = hm.Hands || hm.default?.Hands || window.Hands;

        const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
        hands.setOptions({
          maxNumHands: 1, modelComplexity: 0,
          minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
        });
        hands.onResults(r => { if (mounted) handleResults(r); });
        handsRef.current = hands;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();

            // Auto-focus first sidebar item on start
            setTimeout(() => {
              buildCache();
              const first = S.current.domCache.find(c => c.zone === 'sidebar');
              if (first) { first.el.focus({ preventScroll: true }); updateRing(first.el); }
            }, 900);

            const loop = async () => {
              if (mounted && videoRef.current && document.visibilityState === 'visible') {
                await hands.send({ image: videoRef.current });
              }
              rafId.current = requestAnimationFrame(loop);
            };
            loop();
          };
        }
      } catch (err) {
        setStatusMsg('Camera Error. Please allow camera permissions.');
      }
    })();

    const onVis = () => {
      if (document.visibilityState === 'hidden') videoRef.current?.pause();
      else videoRef.current?.play();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { mounted = false; document.removeEventListener('visibilitychange', onVis); cleanup(); };
  }, [isActive, handleResults, buildCache, updateRing]);

  if (!isActive) return null;

  const meta = ZONE_META[zoneName] || ZONE_META.content;

  return (
    <>
      {/* aria-live: pipes focus label directly into VoiceOver (Mac/iOS) and NVDA (Windows) */}
      <div aria-live="polite" aria-atomic="true"
        className="fixed w-0 h-0 overflow-hidden opacity-0 pointer-events-none -z-10">
        {announcement}
      </div>

      <video ref={videoRef} className="hidden" playsInline muted />

      {/* Focus Ring */}
      <div
        className={`fixed pointer-events-none z-[9999] border-[3px] will-change-transform transition-all ease-out
                    ${focusBox.isClicking ? 'duration-75' : 'duration-[160ms]'}`}
        style={{
          top:    focusBox.top    - 7,
          left:   focusBox.left   - 7,
          width:  focusBox.width  + 14,
          height: focusBox.height + 14,
          opacity: focusBox.opacity,
          borderRadius: `calc(${focusBox.br || '8px'} + 5px)`,
          borderColor: focusBox.isClicking ? '#34d399' : meta.color,
          boxShadow: focusBox.isClicking
            ? '0 0 18px rgba(52,211,153,0.8)'
            : `0 0 20px ${meta.color}88, inset 0 0 6px ${meta.color}20`,
          background: focusBox.isClicking ? 'rgba(52,211,153,0.1)' : 'transparent',
          transform: `translate3d(0,0,0) scale(${focusBox.isClicking ? 0.92 : 1})`,
        }}
      />

      {/* Direction Flash */}
      {flash?.text && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[10001] px-5 py-1.5 text-lg font-bold rounded-2xl backdrop-blur pointer-events-none"
          style={{ color: flash.color, background: `${flash.color}18`, border: `1px solid ${flash.color}44` }}>
          {flash.text}
        </div>
      )}

      {/* Status Bar */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-2 px-4 py-1.5 bg-slate-900/90 rounded-full text-xs backdrop-blur shadow-xl border border-slate-700/40">
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: meta.color }} />
        <span className="font-semibold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400">{statusMsg}</span>
      </div>

      {/* Cheatsheet */}
      <div className="hidden sm:block fixed bottom-[52px] left-1/2 -translate-x-1/2 z-[9998] px-4 py-1 text-[10px] text-slate-500 bg-slate-900/70 backdrop-blur border border-slate-700/30 rounded-xl pointer-events-none whitespace-nowrap">
        🤏 Pinch = Click &nbsp;·&nbsp; ← → = Move in zone &nbsp;·&nbsp; ↑ = Go up zone &nbsp;·&nbsp; ↓ = Go down zone
      </div>
    </>
  );
}
