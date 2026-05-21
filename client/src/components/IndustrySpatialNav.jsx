// client/src/components/IndustrySpatialNav.jsx
import { useEffect, useRef, useState } from 'react';
import { useAuthStore, useCallStore } from '../store/stores';

// --- Industry Standard UI Physics ---
const PINCH_THRESHOLD = 0.04;      // Physical click threshold
const PREDICTIVE_VELOCITY = -0.06; // Closing speed that triggers an early click
const SCROLL_DEADZONE = 15;
const ESCAPE_RADIUS = 50;
const DWELL_CLICK_MS = 1500;

// --- 1€ (One-Euro) Filter Implementation ---
// Reduces jitter at low speeds (high smoothing) and lag at high speeds (low smoothing)
class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, t) {
    if (this.tPrev === null) {
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = t;
      return x;
    }

    const dt = (t - this.tPrev) / 1000.0;
    if (dt <= 0) return x;

    const dx = (x - this.xPrev) / dt;
    const edx = this.dxPrev + this.alpha(this.dCutoff, dt) * (dx - this.dxPrev);
    
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const filteredX = this.xPrev + this.alpha(cutoff, dt) * (x - this.xPrev);

    this.xPrev = filteredX;
    this.dxPrev = edx;
    this.tPrev = t;

    return filteredX;
  }
}

// 3D Distance
function getDistance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z || 0) - (b.z || 0)) ** 2);
}

// 2D Distance
function getDist2D(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function tts(text) {
  if (!window.speechSynthesis || !text?.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.substring(0, 80));
  u.rate = 1.2;
  window.speechSynthesis.speak(u);
}

export default function IndustrySpatialNav() {
  const { user } = useAuthStore();
  const { inputMode } = useCallStore();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const handsRef = useRef(null);
  const aiRafId = useRef(null);
  const renderRafId = useRef(null);
  const streamRef = useRef(null);

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'active' | 'lost'

  const effectiveMode = inputMode || user?.inputMode;
  const isActive = effectiveMode === 'gesture';

  // Persistent high-performance state
  const state = useRef({
    filterX: new OneEuroFilter(1.0, 0.007),
    filterY: new OneEuroFilter(1.0, 0.007),
    x: window.innerWidth / 2, // AI coordinates (30fps)
    y: window.innerHeight / 2,
    targetX: window.innerWidth / 2, // Magnetic Snapped coordinates (30fps)
    targetY: window.innerHeight / 2,
    visualX: window.innerWidth / 2, // Smooth Rendered coordinates (60fps)
    visualY: window.innerHeight / 2,
    pinchDistPrev: null,
    lastTime: performance.now(),
    isPinched: false,
    pinchProgress: 0,
    pinchStartY: 0,
    scrollStartY: 0,
    activeElement: null,
    hoverStartTime: 0,
    dwellFired: false,
    ripples: [], // Store click animations
    // Adaptive Bounds
    minX: 0.3, maxX: 0.7,
    minY: 0.3, maxY: 0.7,
    tracking: false,
  });

  const createRipple = (x, y, time) => {
    state.current.ripples.push({ x, y, startTime: time });
  };

  const handleResults = (results) => {
    const now = performance.now();

    if (!results.multiHandLandmarks?.length) {
      if (state.current.tracking) {
        state.current.tracking = false;
        setStatus('lost');
      }
      return;
    }
    if (!state.current.tracking) {
      state.current.tracking = true;
      setStatus('active');
    }

    const lm = results.multiHandLandmarks[0];
    const indexTip = lm[8];
    const indexDip = lm[7]; // Joint below tip
    const thumbTip = lm[4];

    // 1. Multi-Point Stabilization
    // Average the tip and the joint below it to reduce raw tip-wobble
    const rawX_norm = 1 - ((indexTip.x + indexDip.x) / 2); 
    const rawY_norm = (indexTip.y + indexDip.y) / 2;

    // 2. Adaptive Safe Zone (Auto-Calibration with Decay)
    // Expand bounds if user reaches outside
    state.current.minX = Math.min(state.current.minX, rawX_norm + 0.05);
    state.current.maxX = Math.max(state.current.maxX, rawX_norm - 0.05);
    state.current.minY = Math.min(state.current.minY, rawY_norm + 0.05);
    state.current.maxY = Math.max(state.current.maxY, rawY_norm - 0.05);

    // Slowly decay bounds towards defaults to prevent getting stuck wide
    state.current.minX = lerp(state.current.minX, 0.3, 0.001);
    state.current.maxX = lerp(state.current.maxX, 0.7, 0.001);
    state.current.minY = lerp(state.current.minY, 0.3, 0.001);
    state.current.maxY = lerp(state.current.maxY, 0.7, 0.001);
    
    // Map to screen
    const screenX = Math.max(0, Math.min(1, (rawX_norm - state.current.minX) / (state.current.maxX - state.current.minX))) * window.innerWidth;
    const screenY = Math.max(0, Math.min(1, (rawY_norm - state.current.minY) / (state.current.maxY - state.current.minY))) * window.innerHeight;

    // 3. 1€ Filtering
    state.current.x = state.current.filterX.filter(screenX, now);
    state.current.y = state.current.filterY.filter(screenY, now);

    // 4. Predictive Pinch Logic
    const pinchDist = getDistance(indexTip, thumbTip);
    let pinchVelocity = 0;
    
    if (state.current.pinchDistPrev !== null) {
      const dt = (now - state.current.lastTime) / 1000;
      pinchVelocity = (pinchDist - state.current.pinchDistPrev) / dt;
    }
    state.current.pinchDistPrev = pinchDist;
    state.current.lastTime = now;

    // Trigger if physically closed, OR closing fast enough (Prediction)
    const isCurrentlyPinched = pinchDist < PINCH_THRESHOLD || (pinchDist < PINCH_THRESHOLD * 1.5 && pinchVelocity < PREDICTIVE_VELOCITY);
    state.current.pinchProgress = Math.max(0, Math.min(1, 1 - (pinchDist / 0.12)));

    // 5. Hit Testing & Magnetic Hysteresis
    let hoveredEl = null;
    let finalRenderX = state.current.x;
    let finalRenderY = state.current.y;

    if (state.current.activeElement) {
      const rect = state.current.activeElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      if (getDist2D(state.current.x, state.current.y, centerX, centerY) < ESCAPE_RADIUS) {
        hoveredEl = state.current.activeElement;
        finalRenderX = centerX;
        finalRenderY = centerY;
      } else {
        state.current.activeElement.style.transform = '';
        state.current.activeElement = null;
      }
    }

    if (!state.current.activeElement) {
      // O(1) hit testing via DOM (no need to hide canvas because it's pointer-events-none)
      const rawHover = document.elementFromPoint(finalRenderX, finalRenderY);
      hoveredEl = rawHover?.closest('button, a, input, [role="button"]');
      if (hoveredEl) {
        state.current.activeElement = hoveredEl;
        const rect = hoveredEl.getBoundingClientRect();
        finalRenderX = rect.left + rect.width / 2;
        finalRenderY = rect.top + rect.height / 2;
        
        // Read label on enter
        const label = hoveredEl.getAttribute('aria-label') || hoveredEl.innerText?.trim() || '';
        if (label) tts(label);
        
        state.current.hoverStartTime = now;
        state.current.dwellFired = false;
      }
    }

    state.current.targetX = finalRenderX;
    state.current.targetY = finalRenderY;

    // Apply scale transform to hovered element for visual feedback
    if (hoveredEl && !isCurrentlyPinched) {
      hoveredEl.style.transform = `scale(${1 + (state.current.pinchProgress * 0.05)})`;
    }

    // 6. Interaction State Machine
    if (isCurrentlyPinched && !state.current.isPinched) {
      state.current.isPinched = true;
      state.current.pinchStartY = state.current.y;
      state.current.scrollStartY = window.scrollY;
    } else if (isCurrentlyPinched && state.current.isPinched) {
      const deltaY = state.current.y - state.current.pinchStartY;
      if (Math.abs(deltaY) > SCROLL_DEADZONE) {
        window.scrollTo({ top: state.current.scrollStartY + (deltaY * 3), behavior: 'instant' });
      }
    } else if (!isCurrentlyPinched && state.current.isPinched) {
      state.current.isPinched = false;
      const deltaY = Math.abs(state.current.y - state.current.pinchStartY);
      
      if (deltaY < SCROLL_DEADZONE) {
        if (state.current.activeElement) {
          state.current.activeElement.click();
        } else {
          document.elementFromPoint(finalRenderX, finalRenderY)?.click();
        }
        createRipple(finalRenderX, finalRenderY, now);
        tts('Clicked');
      }
      if (state.current.activeElement) state.current.activeElement.style.transform = '';
    }

    // 7. Dwell Click Logic (for users with limited pinch mobility)
    if (hoveredEl && !isCurrentlyPinched && !state.current.isPinched) {
      const dwellTime = now - state.current.hoverStartTime;
      if (dwellTime > DWELL_CLICK_MS && !state.current.dwellFired) {
        state.current.activeElement?.click();
        createRipple(finalRenderX, finalRenderY, now);
        state.current.dwellFired = true;
        tts('Auto Clicked');
      }
    }
  };

  // --- Decoupled 60fps+ Render Loop ---
  const renderCanvas = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const width = window.innerWidth;
    const height = window.innerHeight;
    const now = performance.now();
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, width * dpr, height * dpr);

    // Interpolate Visual Cursor for extreme smoothness
    state.current.visualX = lerp(state.current.visualX, state.current.targetX, 0.4);
    state.current.visualY = lerp(state.current.visualY, state.current.targetY, 0.4);

    // Process & Draw Ripples
    state.current.ripples = state.current.ripples.filter(r => {
      const age = now - r.startTime;
      if (age > 600) return false;
      
      const progress = age / 600;
      const radius = 10 + (progress * 40);
      const alpha = 1 - progress;

      ctx.beginPath();
      ctx.arc(r.x * dpr, r.y * dpr, radius * dpr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(14, 165, 233, ${alpha * 0.5})`;
      ctx.fill();
      return true;
    });

    if (state.current.tracking) {
      const isPinched = state.current.isPinched;
      const pinchProgress = state.current.pinchProgress;
      const isHovering = !!state.current.activeElement;

      // Draw Outer Ring (Physical Hand position -> x, y)
      const ringRadius = isPinched ? 8 : 24 - (pinchProgress * 12);
      const ringAlpha = isPinched ? 0 : 0.2 + (pinchProgress * 0.6);
      
      ctx.beginPath();
      ctx.arc(state.current.x * dpr, state.current.y * dpr, ringRadius * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = isHovering ? `rgba(14, 165, 233, ${ringAlpha})` : `rgba(255, 255, 255, ${ringAlpha})`;
      ctx.lineWidth = (isPinched ? 4 : 2) * dpr;
      ctx.stroke();

      // Dwell Progress Ring
      if (isHovering && !isPinched) {
        const dwellTime = now - state.current.hoverStartTime;
        if (dwellTime < DWELL_CLICK_MS && !state.current.dwellFired) {
          const dwellProgress = dwellTime / DWELL_CLICK_MS;
          ctx.beginPath();
          ctx.arc(state.current.visualX * dpr, state.current.visualY * dpr, 14 * dpr, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * dwellProgress));
          ctx.strokeStyle = 'rgba(167, 139, 250, 0.8)';
          ctx.lineWidth = 3 * dpr;
          ctx.stroke();
        }
      }

      // Draw Logical Dot (Snapped Position)
      ctx.beginPath();
      ctx.arc(state.current.visualX * dpr, state.current.visualY * dpr, 4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 189, 248, 1)';
      ctx.shadowColor = 'rgba(56, 189, 248, 0.8)';
      ctx.shadowBlur = 10 * dpr;
      ctx.fill();
      ctx.shadowBlur = 0; // reset
    }

    renderRafId.current = requestAnimationFrame(renderCanvas);
  };

  useEffect(() => {
    if (!isActive) return;
    let mounted = true;

    // Handle high-DPI displays for crisp canvas rendering
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const resizeCanvas = () => {
      if (!canvas) return;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start 60fps render loop
    renderRafId.current = requestAnimationFrame(renderCanvas);

    const initHands = async () => {
      try {
        const handsModule = await import('@mediapipe/hands');
        const Hands = handsModule.Hands || window.Hands;

        const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0, // 0 for max performance
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        hands.onResults(r => { if (mounted) handleResults(r); });
        handsRef.current = hands;

        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            const processFrame = async () => {
              if (videoRef.current && mounted && document.visibilityState === 'visible') {
                await hands.send({ image: videoRef.current });
              }
              aiRafId.current = requestAnimationFrame(processFrame);
            };
            processFrame();
          };
        }
      } catch (err) {
        setStatus('error');
        console.error('Spatial Nav Error:', err);
      }
    };

    initHands();

    return () => {
      mounted = false;
      window.removeEventListener('resize', resizeCanvas);
      if (aiRafId.current) cancelAnimationFrame(aiRafId.current);
      if (renderRafId.current) cancelAnimationFrame(renderRafId.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      handsRef.current?.close?.();
      if (state.current.activeElement) state.current.activeElement.style.transform = '';
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <>
      <video ref={videoRef} className="hidden" playsInline muted />
      
      {/* 
        Hardware-Accelerated Canvas Overlay 
        Bypasses React render cycle entirely. Pointer-events: none ensures 
        underlying DOM hit-testing works perfectly.
      */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-[10000] pointer-events-none"
      />

      {/* Loading/Status Feedback */}
      {status === 'initializing' && (
        <div className="fixed top-20 right-6 z-[9998] px-3 py-1.5 bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded-full text-xs animate-pulse backdrop-blur-md">
          Loading Navigation...
        </div>
      )}
      {status === 'lost' && (
        <div className="fixed top-20 right-6 z-[9998] px-3 py-1.5 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-full text-xs backdrop-blur-md">
          Hand Lost. Show hand to camera.
        </div>
      )}
    </>
  );
}
