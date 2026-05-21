// client/src/components/UltimateSpatialNav.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore, useCallStore } from '../store/stores';

// ─── CONFIGURATION ───────────────────────────────────────────────────
export const SPATIAL_CONFIG = {
  AI: {
    MODEL_PATH: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    DELEGATE: "GPU",
    CONFIDENCE: 0.6,
  },
  PHYSICS: {
    // Ultra-forgiving fist openness threshold. (Open hand ~2.0+, Fist ~0.5)
    FIST_THRESHOLD: 1.15,
    PINCH_THRESHOLD: 0.32,
    DEADZONE: 0.12,
    MAGNET_RADIUS: 80,
    SPRING_STIFFNESS: 0.35,
    SPRING_DAMPING: 0.65,
    PREDICTION_MULT: 4.0, // Aim-assist vector multiplier
  },
  TIMING: {
    DWELL_MS: 900,
    ZONE_COOLDOWN_MS: 700,
    SLEEP_TIMEOUT_FRAMES: 30, // Frames before resting mode
  },
  UI: {
    SELECTOR: 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  }
};

// ─── UTILS & MATH ───────────────────────────────────────────────────
const getDist = (a, b) => Math.hypot((a.x - b.x), (a.y - b.y));

const triggerHaptic = (type = 'snap') => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(type === 'snap' ? 10 : [20, 30, 20]);
  }
};

// ─── HOOK 1: DOM SPATIAL MAPPER (Zero-Reflow Engine) ────────────────
function useSpatialMap(isActive) {
  const EngineZones = useRef([]);

  const buildMap = useCallback(() => {
    let containers = Array.from(document.querySelectorAll('[data-spatial-zone]'));
    if (!containers.length) {
      containers = Array.from(document.querySelectorAll('nav, aside, main, header, .chat-container'));
    }
    // Fallback: If no semantic tags, just group everything into document.body
    if (!containers.length) containers = [document.body];

    const mappedZones = containers.reduce((acc, container) => {
      const cRect = container === document.body ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : container.getBoundingClientRect();
      if (cRect.width === 0) return acc;

      const items = Array.from(container.querySelectorAll(SPATIAL_CONFIG.UI.SELECTOR)).map(el => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          x: rect.left, y: rect.top, w: rect.width, h: rect.height,
          cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
          isHidden: rect.width === 0 || window.getComputedStyle(el).visibility === 'hidden'
        };
      }).filter(item => !item.isHidden);

      if (items.length > 0) acc.push({ container, cRect, items });
      return acc;
    }, []);

    EngineZones.current = mappedZones;
  }, []);

  useEffect(() => {
    if (!isActive) return;
    buildMap();

    const ro = new ResizeObserver(() => requestAnimationFrame(buildMap));
    const mo = new MutationObserver(() => requestAnimationFrame(buildMap));

    ro.observe(document.body);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', buildMap, { passive: true, capture: true });

    return () => {
      ro.disconnect(); mo.disconnect();
      window.removeEventListener('scroll', buildMap, { capture: true });
    };
  }, [isActive, buildMap]);

  return EngineZones;
}

// ─── MAIN COMPONENT (Direct DOM Manipulation for 120fps) ────────────
export default function UltimateSpatialNav() {
  const { user } = useAuthStore();
  const { inputMode } = useCallStore();
  const storeActive = (inputMode || user?.inputMode) === 'gesture';

  const [manualOn, setManualOn] = useState(false);
  const isActive = storeActive || manualOn;

  const videoRef = useRef(null);
  const [status, setStatus] = useState('idle');

  // Direct DOM Refs to completely bypass React rendering
  const cursorRef = useRef(null);
  const focusRef = useRef(null);
  const progressRef = useRef(null);
  const zoneBoxRef = useRef(null);
  const hudRef = useRef(null);

  const EngineZones = useSpatialMap(isActive);

  const Engine = useRef({
    activeZoneIdx: 0, activeElement: null,
    velX: 0, velY: 0, scrollStartY: 0, scrollVelocity: 0, grabStartY: 0,
    isClickPinch: false, wasClickPinched: false, 
    dwellStartTs: 0, isDwelling: false, isResting: false
  });

  // ─── CORE PHYSICS TICK ──────────────────────────────────────────
  const tick = useCallback((aiData) => {
    const E = Engine.current;
    const zones = EngineZones.current;
    if (!zones.length) return;

    const now = performance.now();
    let activeZone = zones[E.activeZoneIdx] || zones[0];

    // Sync AI inputs
    if (aiData) {
      E.vx = aiData.x - E.targetX;
      E.vy = aiData.y - E.targetY;
      E.targetX = aiData.x; E.targetY = aiData.y;
      E.isClickPinch = aiData.isClickPinch; 
      
      // Live HUD Debug Output
      if (hudRef.current) {
        hudRef.current.textContent = E.isClickPinch ? `🤏 PINCHING` : `👋 TRACKING`;
      }
    }

    // ── 1. SPATIAL HOT-ZONES (No Gestures Required) ──
    // Automatically switch the active UI layer based on absolute hand position
    let newZoneIdx = E.activeZoneIdx;
    
    // Top 15% of screen -> Navbar
    if (E.targetY < window.innerHeight * 0.15) {
      newZoneIdx = zones.findIndex(z => z.container.tagName.toLowerCase() === 'nav' || z.cRect.top < 80);
    } 
    // Left 25% of screen -> Sidebar
    else if (E.targetX < window.innerWidth * 0.25) {
      newZoneIdx = zones.findIndex(z => z.container.tagName.toLowerCase() === 'aside' || z.cRect.left < 80);
    } 
    // Everywhere else -> Main Chat Area
    else {
      newZoneIdx = zones.findIndex(z => z.container.tagName.toLowerCase() === 'main' || (z.cRect.left > 80 && z.cRect.top > 80));
    }

    // Fallback if the specific tag wasn't found, keep the current zone
    if (newZoneIdx === -1) newZoneIdx = E.activeZoneIdx;

    // If the user moved their hand into a new zone, switch to it instantly
    if (newZoneIdx !== E.activeZoneIdx) {
      E.activeZoneIdx = newZoneIdx;
      activeZone = zones[newZoneIdx]; // update reference for this tick
      E.isDwelling = false;
      if (progressRef.current) { progressRef.current.style.width = '0%'; progressRef.current.style.opacity = '0'; }
      triggerHaptic('snap');
    }

    // Draw active zone highlight
    if (zoneBoxRef.current && activeZone.container !== document.body) {
      zoneBoxRef.current.style.opacity = '1';
      zoneBoxRef.current.style.transform = `translate3d(${activeZone.cRect.left - 10}px, ${activeZone.cRect.top - 10}px, 0)`;
      zoneBoxRef.current.style.width = `${activeZone.cRect.width + 20}px`;
      zoneBoxRef.current.style.height = `${activeZone.cRect.height + 20}px`;
    } else if (zoneBoxRef.current) {
      zoneBoxRef.current.style.opacity = '0';
    }

    // 2. Predictive Aim & Magnetism
    const predX = E.targetX + (E.vx * SPATIAL_CONFIG.PHYSICS.PREDICTION_MULT);
    const predY = E.targetY + (E.vy * SPATIAL_CONFIG.PHYSICS.PREDICTION_MULT);
    
    let closestItem = null;
    let minDistance = SPATIAL_CONFIG.PHYSICS.MAGNET_RADIUS + Math.hypot(E.vx, E.vy);

    activeZone?.items.forEach(item => {
      // Sticky focus (tremor lock)
      let dist = Math.hypot(predX - item.cx, predY - item.cy);
      if (item.el === E.activeElement) dist -= 40;

      if (dist < minDistance) { minDistance = dist; closestItem = item; }
    });

    // 3. Spring Physics Engine
    const tx = closestItem ? closestItem.cx : E.targetX;
    const ty = closestItem ? closestItem.cy : E.targetY;

    E.velX = (E.velX + (tx - E.renderX) * SPATIAL_CONFIG.PHYSICS.SPRING_STIFFNESS) * SPATIAL_CONFIG.PHYSICS.SPRING_DAMPING;
    E.velY = (E.velY + (ty - E.renderY) * SPATIAL_CONFIG.PHYSICS.SPRING_STIFFNESS) * SPATIAL_CONFIG.PHYSICS.SPRING_DAMPING;
    E.renderX += E.velX; E.renderY += E.velY;

    if (cursorRef.current) {
      cursorRef.current.style.transform = `translate3d(${E.renderX}px, ${E.renderY}px, 0) scale(${E.isClickPinch ? 0.6 : 1})`;
    }

    // 4. Pinch-to-Scroll Mechanic (Index Pinch)
    const scrollEl = activeZone?.container === document.body ? window : activeZone?.container;
    if (E.isClickPinch && !E.wasClickPinched && !closestItem) {
      E.grabStartY = E.targetY; E.scrollVelocity = 0;
    } else if (E.isClickPinch && E.wasClickPinched && !closestItem && scrollEl) {
      const scrollAmt = -(E.targetY - E.grabStartY) * 3.0;
      scrollEl.scrollBy({ top: scrollAmt, behavior: 'auto' });
      E.scrollVelocity = scrollAmt; E.grabStartY = E.targetY;
    } else if (!E.isClickPinch && E.wasClickPinched && Math.abs(E.scrollVelocity) > 2 && scrollEl) {
      scrollEl.scrollBy({ top: E.scrollVelocity * 6, behavior: 'smooth' }); // Inertia scroll
    }

    // 5. Interaction (Hover, Focus, Click)
    const targetEl = closestItem?.el;

    if (targetEl !== E.activeElement) {
      if (E.activeElement) E.activeElement.blur();
      E.activeElement = targetEl;
      
      if (targetEl) {
        targetEl.focus({ preventScroll: true });
        E.isDwelling = true; E.dwellStartTs = now;
        E.velX += (E.targetX > closestItem.cx ? -8 : 8); // Haptic micro-bounce
        triggerHaptic('snap');
        
        if (focusRef.current) {
          focusRef.current.style.opacity = '1';
          focusRef.current.style.transform = `translate3d(${closestItem.x - 5}px, ${closestItem.y - 5}px, 0)`;
          focusRef.current.style.width = `${closestItem.w + 10}px`;
          focusRef.current.style.height = `${closestItem.h + 10}px`;
        }
      } else {
        E.isDwelling = false;
        if (focusRef.current) focusRef.current.style.opacity = '0';
      }
      if (progressRef.current) { progressRef.current.style.width = '0%'; progressRef.current.style.opacity = '0'; }

    } else if (targetEl) {
      // Dynamic Focus Follow
      if (focusRef.current) {
         focusRef.current.style.transform = `translate3d(${closestItem.x - 5}px, ${closestItem.y - 5}px, 0)`;
      }

      // Dwell To Click
      if (E.isDwelling) {
        const progress = Math.min(((now - E.dwellStartTs) / SPATIAL_CONFIG.TIMING.DWELL_MS) * 100, 100);
        if (progressRef.current) {
          progressRef.current.style.width = `${progress}%`;
          progressRef.current.style.opacity = progress > 5 ? '1' : '0';
        }

        if (progress >= 100) {
          triggerHaptic('click'); targetEl.click();
          E.isDwelling = false;
          if (progressRef.current) { progressRef.current.style.opacity = '0'; progressRef.current.style.width = '0%'; }
          if (focusRef.current) {
            focusRef.current.style.transform = `translate3d(${closestItem.x - 5}px, ${closestItem.y - 5}px, 0) scale(0.9)`;
            setTimeout(() => { if (focusRef.current) focusRef.current.style.transform = `translate3d(${closestItem.x - 5}px, ${closestItem.y - 5}px, 0) scale(1)`; }, 200);
          }
        }
      }
    }

    // Physical Pinch Click
    if (E.isClickPinch && !E.wasClickPinched && targetEl) {
      triggerHaptic('click'); targetEl.click();
      E.isDwelling = false;
      if (progressRef.current) { progressRef.current.style.opacity = '0'; progressRef.current.style.width = '0%'; }
      if (focusRef.current) {
        focusRef.current.style.transform = `translate3d(${closestItem.x - 5}px, ${closestItem.y - 5}px, 0) scale(0.9)`;
        setTimeout(() => { if (focusRef.current) focusRef.current.style.transform = `translate3d(${closestItem.x - 5}px, ${closestItem.y - 5}px, 0) scale(1)`; }, 200);
      }
    }
    E.wasClickPinched = E.isClickPinch;
  }, []);

  // ─── BOOT MEDIAPIPE AI LOOP ──────────────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    let isCancelled = false, landmarker = null;
    let aiRaf, renderRaf;
    let missingFrames = 0;

    const initAI = async () => {
      setStatus('initializing');
      try {
        const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: SPATIAL_CONFIG.AI.MODEL_PATH, delegate: SPATIAL_CONFIG.AI.DELEGATE },
          runningMode: "VIDEO", numHands: 1, minHandDetectionConfidence: SPATIAL_CONFIG.AI.CONFIDENCE,
        });

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        if (isCancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setStatus('active');

          // Decoupled 120fps Visual Loop
          const renderLoop = () => { if (!isCancelled) { tick(); renderRaf = requestAnimationFrame(renderLoop); } };
          renderRaf = requestAnimationFrame(renderLoop);

          // Standard 30fps AI Inference Loop
          let lastTime = -1;
          const aiLoop = () => {
            if (isCancelled) return;
            if (videoRef.current.currentTime !== lastTime) {
              lastTime = videoRef.current.currentTime;
              const res = landmarker.detectForVideo(videoRef.current, performance.now());

              if (res.landmarks?.length > 0) {
                missingFrames = 0;
                if (Engine.current.isResting) { Engine.current.isResting = false; setStatus('active'); }
                
                const lm = res.landmarks[0];
                const palmSize = getDist(lm[0], lm[9]) || 0.1;
                
                // Primary Click / Scroll (Index + Thumb)
                const isClickPinch = (getDist(lm[8], lm[4]) / palmSize) < SPATIAL_CONFIG.PHYSICS.PINCH_THRESHOLD;

                // Deadzone mapped X/Y coords
                const rawX = lm[9].x, rawY = lm[9].y;
                const x = Math.max(0, Math.min(1, (1 - rawX - SPATIAL_CONFIG.PHYSICS.DEADZONE) / (1 - SPATIAL_CONFIG.PHYSICS.DEADZONE * 2))) * window.innerWidth;
                const y = Math.max(0, Math.min(1, (rawY - SPATIAL_CONFIG.PHYSICS.DEADZONE) / (1 - SPATIAL_CONFIG.PHYSICS.DEADZONE * 2))) * window.innerHeight;

                tick({ x, y, isClickPinch });
              } else {
                missingFrames++;
                if (missingFrames > SPATIAL_CONFIG.TIMING.SLEEP_TIMEOUT_FRAMES && !Engine.current.isResting) {
                  Engine.current.isResting = true; setStatus('resting');
                  if (focusRef.current) focusRef.current.style.opacity = '0';
                  if (zoneBoxRef.current) zoneBoxRef.current.style.opacity = '0';
                  if (hudRef.current) hudRef.current.textContent = '💤 Hand missing';
                }
              }
            }
            aiRaf = requestAnimationFrame(aiLoop);
          };
          aiLoop();
        };
      } catch (err) {
        console.error(err);
        setStatus('error');
      }
    };
    initAI();

    return () => {
      isCancelled = true;
      if (renderRaf) cancelAnimationFrame(renderRaf);
      if (aiRaf) cancelAnimationFrame(aiRaf);
      if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      try { landmarker?.close(); } catch(e){}
    };
  }, [isActive, tick]);

  if (!isActive) {
    return (
      <button onClick={() => setManualOn(true)} title="Enable Spatial Navigation"
        className="fixed bottom-6 right-6 z-[99998] w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 shadow-2xl transition-all hover:scale-110 bg-gray-900 border-white/20 hover:border-sky-400">
        ✋
      </button>
    );
  }

  return (
    <>
      <video ref={videoRef} className="hidden" playsInline muted />

      <div ref={cursorRef} className="fixed top-0 left-0 w-8 h-8 -ml-4 -mt-4 rounded-full z-[99999] pointer-events-none mix-blend-difference bg-white border border-white/50" 
           style={{ willChange: 'transform', boxShadow: '0 0 15px rgba(255,255,255,0.7)' }} />

      <div ref={zoneBoxRef} className="fixed top-0 left-0 z-[9995] pointer-events-none rounded-2xl bg-sky-500/5 border border-sky-500/20 opacity-0"
           style={{ transition: 'opacity 300ms, transform 350ms cubic-bezier(0.2, 0, 0, 1), width 350ms, height 350ms', willChange: 'transform, width, height, opacity' }} />

      <div ref={focusRef} className="fixed top-0 left-0 z-[9999] pointer-events-none rounded-xl border-2 border-sky-400 overflow-hidden opacity-0"
           style={{ boxShadow: '0 0 15px rgba(56, 189, 248, 0.4), inset 0 0 10px rgba(56, 189, 248, 0.2)', background: 'rgba(56, 189, 248, 0.15)', transition: 'transform 100ms linear, width 100ms, height 100ms, opacity 150ms', willChange: 'transform, width, height, opacity' }}>
        <div ref={progressRef} className="absolute bottom-0 left-0 h-1.5 bg-gradient-to-r from-sky-400 to-cyan-300 opacity-0 rounded-full" 
             style={{ transition: 'width 100ms linear, opacity 100ms' }} />
      </div>

      <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-4 px-6 py-3 bg-gray-950/95 backdrop-blur-xl border border-gray-700/60 rounded-full shadow-2xl pointer-events-none transition-opacity duration-500 ${status === 'resting' ? 'opacity-60' : 'opacity-100'}`}>
        {status === 'initializing' ? <span className="text-sm font-semibold text-gray-200 animate-pulse">Initializing Vision Engine...</span> :
         status === 'error' ? <span className="text-sm font-semibold text-red-400">Camera Error</span> :
         status === 'resting' ? <span className="text-sm font-semibold text-gray-400">💤 Raise hand to wake.</span> : (
          <>
            <div className="flex items-center gap-2 text-xs font-medium text-sky-400">
              <span className="text-base drop-shadow-md">👋</span> Point to Navigate
            </div>
            <div className="w-[1px] h-4 bg-gray-700"></div>
            <div className="flex items-center gap-2 text-xs font-medium text-sky-400">
              <span className="text-base drop-shadow-md">🤏</span> Pinch to Scroll
            </div>
            <div className="w-[1px] h-4 bg-gray-700"></div>
            <div className="flex items-center gap-2 text-xs font-medium text-sky-400">
              <span className="text-base drop-shadow-md">⌛</span> Hover to Click
            </div>
            {/* Live diagnostic hook for tick engine */}
            <div ref={hudRef} className="hidden"></div>
          </>
        )}
      </div>

      {!storeActive && (
        <button onClick={() => setManualOn(false)} title="Disable Spatial Navigation"
          className="fixed bottom-6 right-6 z-[99998] w-12 h-12 rounded-full flex items-center justify-center text-lg border-2 shadow-xl transition-all hover:scale-110 bg-sky-600 border-sky-400 text-white">
          ✋
        </button>
      )}
    </>
  );
}
