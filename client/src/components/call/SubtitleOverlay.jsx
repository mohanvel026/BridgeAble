// client/src/components/call/SubtitleOverlay.jsx
// Premium Live Subtitle Overlay with adaptive character reading timing,
// accessibility synth notification pings, and visual countdown draining bars.

import React, { useEffect, useState, useRef } from 'react';

const MODE_ICON = {
  voice:   '🎙',
  gesture: '👋',
  blink:   '👁',
  symbol:  '🗂',
  type:    '⌨️',
};

// Single subtitle line with linear progress countdown
function SubtitleLine({ sub, myId }) {
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const timerRef = useRef(null);

  const isMe = sub.senderId === myId?.toString();
  const subColor = sub.color || '#22d3ee';

  // Calculate dynamic character-adaptive TTL (base of 3.5s + 50ms per character)
  const finalTtl = sub.ttl ?? Math.max(3500, Math.min(10000, 3500 + sub.text.length * 50));

  useEffect(() => {
    // Play a highly pleasant, soft accessibility audio tone sweeps for assistive feedback
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime); // A4
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.08); // Sweeps up
      
      gain.gain.setValueAtTime(0.015, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      console.debug('Accessibility audio context sweep gesture-blocked by browser security policy.');
    }

    // Trigger shrinking bar transition
    const progressTimer = setTimeout(() => {
      setProgress(0);
    }, 50);

    // Fade sequence
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => setVisible(false), 400);
    }, finalTtl);

    return () => {
      clearTimeout(progressTimer);
      clearTimeout(timerRef.current);
    };
  }, [sub.id, finalTtl]);

  if (!visible) return null;

  return (
    <div
      aria-live="assertive"
      aria-atomic="true"
      className={`flex items-end gap-2 animate-slide-up transition-all duration-400 ${
        exiting ? 'opacity-0 translate-y-4 scale-95' : 'opacity-100 translate-y-0 scale-100'
      }`}
      style={{ 
        justifyContent: isMe ? 'flex-end' : 'flex-start',
        transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <div 
        className="max-w-md px-4 py-3 rounded-2xl backdrop-blur-xl shadow-2xl relative overflow-hidden flex flex-col gap-1.5"
        style={{
          background: `linear-gradient(135deg, rgba(9,9,9,0.95) 0%, rgba(9,9,9,0.85) 100%)`,
          border: `1px solid rgba(255,255,255,0.05)`,
          boxShadow: `0 10px 40px -10px ${subColor}25, inset 0 1px 0 rgba(255,255,255,0.1)`
        }}
      >
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm drop-shadow-md">{MODE_ICON[sub.inputMode] || '💬'}</span>
            <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: subColor }}>
              {isMe ? 'You' : sub.senderName}
            </span>
          </div>
          {sub.confidence != null && sub.confidence < 0.85 && (
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/75 bg-amber-500/10 px-1.5 py-0.5 rounded">
              ~{Math.round(sub.confidence * 100)}% Match
            </span>
          )}
        </div>
        
        <p className="text-sm font-black text-white leading-snug break-words pr-4 drop-shadow-md">
          {sub.text}
        </p>

        {/* Micro progress countdown bar */}
        <div className="h-[3px] w-full bg-zinc-800/60 rounded-full overflow-hidden mt-2 relative shadow-inner">
          <div 
            className="h-full rounded-full transition-all ease-linear"
            style={{
              width: `${progress}%`,
              transitionDuration: `${finalTtl}ms`,
              background: `linear-gradient(90deg, ${subColor} 0%, ${subColor}dd 100%)`,
              boxShadow: `0 0 10px ${subColor}, 0 0 5px ${subColor} inset`
            }}
          />
        </div>
        
        {/* Ambient background glow */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{ background: `radial-gradient(circle at 10% 10%, ${subColor} 0%, transparent 60%)` }}
        />
      </div>
    </div>
  );
}

export default function SubtitleOverlay({ subtitles = [], myId }) {
  const [visible, setVisible] = useState([]);

  useEffect(() => {
    if (!subtitles.length) return;
    const latest = subtitles[subtitles.length - 1];
    const id = Date.now();
    setVisible(p => [...p.slice(-2), { ...latest, id }]);
  }, [subtitles]);

  if (!visible.length) return null;

  return (
    <div className="absolute bottom-24 left-6 right-6 flex flex-col gap-3 pointer-events-none z-30 perspective-1000">
      {visible.map((sub) => (
        <SubtitleLine key={sub.id} sub={sub} myId={myId} />
      ))}
    </div>
  );
}