// client/src/components/call/ModeIndicator.jsx
// Shows each participant's current input mode + allows switching

import { useState } from 'react';

const MODES = [
  { id: 'gesture', icon: '👋', label: 'Sign Language', for: ['deaf'] },
  { id: 'blink', icon: '👁', label: 'Eye Blink', for: ['paralyzed'] },
  { id: 'symbol', icon: '🗂', label: 'Symbol Board', for: ['speech'] },
  { id: 'voice', icon: '🎙', label: 'Voice', for: ['blind', 'normal'] },
  { id: 'type', icon: '⌨️', label: 'Type + TTS', for: [] },
];

const disabilityColors = {
  deaf: '#22d3ee', paralyzed: '#a78bfa',
  speech: '#fbbf24', blind: '#fb7185', normal: '#2dd4bf',
};

export default function ModeIndicator({ myMode, remoteMode, remoteName, onSwitch }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 relative z-50">
      {/* My mode */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-950/80 backdrop-blur-md border border-white/10 shadow-inner group transition-all">
        <span className="text-sm group-hover:scale-110 transition-transform drop-shadow-sm">{MODES.find(m => m.id === myMode)?.icon || '💬'}</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-teal-400">{myMode}</span>
      </div>

      {remoteMode && (
        <span className="text-zinc-600 text-xs font-black px-1 animate-pulse">⇄</span>
      )}

      {/* Remote mode */}
      {remoteMode && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-950/80 backdrop-blur-md border border-white/10 shadow-inner group transition-all">
          <span className="text-sm group-hover:scale-110 transition-transform drop-shadow-sm">{MODES.find(m => m.id === remoteMode)?.icon || '💬'}</span>
          <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">{remoteMode}</span>
        </div>
      )}

      {/* Switch mode button */}
      <div className="relative ml-2">
        <button onClick={() => setOpen(p => !p)}
          className={`px-3 py-1.5 rounded-full backdrop-blur-md border transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm active:scale-95
                       ${open 
                         ? 'bg-teal-500/20 border-teal-500/40 text-teal-300 shadow-[0_0_15px_rgba(20,184,166,0.15)]' 
                         : 'bg-zinc-950/80 border-white/10 text-zinc-400 hover:text-white hover:border-white/20 hover:bg-white/5'}`}>
          <span>Switch</span>
          <span className={`text-xs transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>

        {open && (
          <div className="absolute top-full right-0 mt-3 w-56 bg-zinc-950/95 backdrop-blur-xl border border-white/10
                           rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.5),0_0_20px_rgba(20,184,166,0.1)] z-50 overflow-hidden animate-slide-down origin-top-right">
            <div className="py-2">
              {MODES.map(m => (
                <button key={m.id} onClick={() => { onSwitch(m.id); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left
                               hover:bg-white/5 relative group
                               ${myMode === m.id ? 'bg-teal-500/5' : ''}`}>
                  
                  <span className="text-lg group-hover:scale-110 transition-transform drop-shadow-sm z-10">{m.icon}</span>
                  <span className={`text-[11px] font-black uppercase tracking-widest z-10
                                    ${myMode === m.id ? 'text-teal-400' : 'text-zinc-300 group-hover:text-white'}`}>
                    {m.label}
                  </span>
                  
                  {myMode === m.id && (
                    <span className="ml-auto text-teal-400 text-xs font-black z-10 drop-shadow-[0_0_5px_rgba(45,212,191,0.5)]">✓</span>
                  )}

                  {/* Hover gradient effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-teal-500/0 via-teal-500/5 to-teal-500/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}