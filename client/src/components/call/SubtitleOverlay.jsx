// client/src/components/call/SubtitleOverlay.jsx
import React, { useEffect, useState, useRef, memo, useCallback, useMemo } from 'react';

const MODE_ICON = {
  voice:   '🎙',
  gesture: '👋',
  blink:   '👁',
  symbol:  '🗂',
  type:    '⌨️',
};

// 1. Singleton Audio Engine with Auto-Suspend for Battery Optimization
const audioEngine = (() => {
  let ctx = null;
  let suspendTimer = null;

  return {
    playSweep: async () => {
      try {
        if (!ctx) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          ctx = new AudioCtx();
        }
        
        if (ctx.state === 'suspended') await ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
        
        gain.gain.setValueAtTime(0.015, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);

        // Auto-suspend to save battery/CPU when idle
        clearTimeout(suspendTimer);
        suspendTimer = setTimeout(() => {
          if (ctx && ctx.state === 'running') ctx.suspend();
        }, 1000);
      } catch (e) {
        console.debug('A11y audio suppressed by browser policy.');
      }
    }
  };
})();

// Check for user accessibility preferences
const prefersReducedMotion = typeof window !== 'undefined' 
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches 
  : false;

const SubtitleLine = memo(({ sub, myId, onExpire }) => {
  const [isExiting, setIsExiting] = useState(false);
  const progressBarRef = useRef(null);

  const isMe = sub.senderId === myId?.toString();
  const subColor = sub.color || '#22d3ee';
  
  // Calculate dynamic character-adaptive TTL (Max 10s, Min 3.5s)
  const finalTtl = useMemo(() => 
    sub.ttl ?? Math.max(3500, Math.min(10000, 3500 + sub.text.length * 50)),
  [sub.ttl, sub.text.length]);

  useEffect(() => {
    audioEngine.playSweep();

    // 2. GPU-Accelerated Progress Bar (scaleX instead of width)
    let frameId;
    if (!prefersReducedMotion) {
      frameId = requestAnimationFrame(() => {
        if (progressBarRef.current) {
          progressBarRef.current.style.transitionDuration = `${finalTtl}ms`;
          progressBarRef.current.style.transform = 'scaleX(0)';
        }
      });
    }

    const exitTimer = setTimeout(() => setIsExiting(true), finalTtl);
    const unmountTimer = setTimeout(() => onExpire(sub.id), finalTtl + 400);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(exitTimer);
      clearTimeout(unmountTimer);
    };
  }, [sub.id, finalTtl, onExpire]);

  // Use translate3d to force hardware acceleration on the entire node
  const transformStyle = isExiting 
    ? 'translate3d(0, 1rem, 0) scale(0.95)' 
    : 'translate3d(0, 0, 0) scale(1)';

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-end gap-2 w-full transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform will-change-opacity"
      style={{ 
        justifyContent: isMe ? 'flex-end' : 'flex-start',
        opacity: isExiting ? 0 : 1,
        transform: prefersReducedMotion ? 'none' : transformStyle
      }}
    >
      {/* Container utilizing CSS variables for cleaner inline styles and glassmorphism */}
      <div 
        className="max-w-md px-4 py-3 rounded-2xl backdrop-blur-2xl relative overflow-hidden flex flex-col gap-1.5 border border-white/10"
        style={{
          '--sub-color': subColor,
          background: `linear-gradient(135deg, rgba(4,4,4,0.95) 0%, rgba(4,4,4,0.85) 100%)`,
          boxShadow: `0 10px 40px -10px var(--sub-color)40, inset 0 1px 0 rgba(255,255,255,0.05)`
        }}
      >
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm drop-shadow-md">{MODE_ICON[sub.inputMode] || '💬'}</span>
            <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: 'var(--sub-color)' }}>
              {isMe ? 'You' : sub.senderName}
            </span>
          </div>
          {sub.confidence != null && sub.confidence < 0.85 && (
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/75 bg-amber-500/10 px-1.5 py-0.5 rounded shadow-[0_0_10px_rgba(245,158,11,0.1)]">
              ~{Math.round(sub.confidence * 100)}% Match
            </span>
          )}
        </div>
        
        <p className="text-sm font-black text-white leading-snug break-words pr-4 drop-shadow-[0_2px_5px_rgba(0,0,0,0.8)]">
          {sub.text}
        </p>

        {/* High-Performance Progress Bar */}
        <div className="h-[3px] w-full bg-[#0a0a0a]/80 rounded-full overflow-hidden mt-2 relative shadow-inner border border-white/5">
          <div 
            ref={progressBarRef}
            className="h-full w-full rounded-full transition-transform ease-linear origin-left will-change-transform"
            style={{
              background: `linear-gradient(90deg, var(--sub-color) 0%, var(--sub-color)dd 100%)`,
              boxShadow: `0 0 10px var(--sub-color), 0 0 5px var(--sub-color) inset`
            }}
          />
        </div>
        
        {/* Ambient Glow */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20 blur-xl"
          style={{ background: `radial-gradient(circle at 10% 10%, var(--sub-color) 0%, transparent 60%)` }}
        />
      </div>
    </div>
  );
});

SubtitleLine.displayName = 'SubtitleLine';

export default function SubtitleOverlay({ subtitles = [], myId }) {
  const [activeSubs, setActiveSubs] = useState([]);
  const processedIds = useRef(new Set());

  useEffect(() => {
    if (!subtitles.length) return;

    // Filter only definitively new subtitles
    const newSubs = subtitles.filter(sub => !processedIds.current.has(sub.id));
    
    if (newSubs.length > 0) {
      newSubs.forEach(sub => processedIds.current.add(sub.id));
      
      // Functional state update prevents race conditions during rapid WebSocket bursts
      setActiveSubs(prev => {
        const combined = [...prev, ...newSubs];
        return combined.slice(-3); // Increased to 3 for smoother stack visuals
      });
    }
  }, [subtitles]);

  // O(1) removal, memory leak prevention
  const handleExpire = useCallback((idToRemove) => {
    setActiveSubs(prev => prev.filter(sub => sub.id !== idToRemove));
    // Safe cleanup of Set to ensure O(1) memory footprint over long sessions
    setTimeout(() => processedIds.current.delete(idToRemove), 5000);
  }, []);

  if (!activeSubs.length) return null;

  return (
    <div 
      className="absolute bottom-24 left-6 right-6 flex flex-col gap-3 pointer-events-none z-30" 
      style={{ perspective: '1000px' }}
      aria-hidden="true" // Hide wrapper from screen readers (children handle a11y)
    >
      {activeSubs.map((sub) => (
        <SubtitleLine 
          key={sub.id} 
          sub={sub} 
          myId={myId} 
          onExpire={handleExpire} 
        />
      ))}
    </div>
  );
}