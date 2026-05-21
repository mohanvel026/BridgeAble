// client/src/components/InputModeSwitcher.jsx
import { useState, useEffect } from 'react';
import { useAuthStore, useCallStore } from '../store/stores';
import { getSocket } from '../lib/socket';

const MODES = [
  { id: 'gesture', label: 'Sign', icon: '👋', color: 'cyan', desc: 'ASL Gesture' },
  { id: 'blink', label: 'Blink', icon: '👁', color: 'violet', desc: 'Eye Morse' },
  { id: 'symbol', label: 'Symbol', icon: '🗂', color: 'amber', desc: 'Symbol Board' },
  { id: 'voice', label: 'Voice', icon: '🎙', color: 'teal', desc: 'Microphone' },
  { id: 'type', label: 'Type', icon: '⌨', color: 'rose', desc: 'Keyboard' },
];

const colorClass = {
  cyan: 'bg-accent-cyan/15 border-accent-cyan/40 text-accent-cyan',
  violet: 'bg-accent-violet/15 border-accent-violet/40 text-accent-violet',
  amber: 'bg-accent-amber/15 border-accent-amber/40 text-accent-amber',
  teal: 'bg-accent-teal/15 border-accent-teal/40 text-accent-teal',
  rose: 'bg-accent-rose/15 border-accent-rose/40 text-accent-rose',
};

export default function InputModeSwitcher({ compact = false, roomCode = null }) {
  const { user, updateUser } = useAuthStore();
  const { inputMode, setInputMode } = useCallStore();
  const [open, setOpen] = useState(false);

  const current = MODES.find(m => m.id === (inputMode || user?.inputMode)) || MODES[3];

  const handleSwitch = (mode) => {
    setInputMode(mode.id);
    updateUser({ inputMode: mode.id });

    if (roomCode) {
      const socket = getSocket();
      socket?.emit('mode:switch', { roomCode, newMode: mode.id });
    }

    if (user?.disabilityType === 'blind') {
      const msg = new SpeechSynthesisUtterance(`Switched to ${mode.desc} mode`);
      window.speechSynthesis.speak(msg);
    }

    localStorage.setItem('ba_inputMode', mode.id);
    setOpen(false);
  };

  if (compact) return (
    <div className="relative">
      <button onClick={() => setOpen(p => !p)}
        className={`flex items-center gap-2.5 px-4 py-2 rounded-full border border-white/10 backdrop-blur-md shadow-lg transition-all duration-300 hover:scale-105 active:scale-95 group overflow-hidden
                     ${colorClass[current.color].split(' ')[0]} ${colorClass[current.color].split(' ')[2]}`}>
        {/* Button Background Glow */}
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
        
        <span className="text-lg drop-shadow-md group-hover:-translate-y-0.5 transition-transform">{current.icon}</span>
        <span className="text-sm font-bold tracking-wide drop-shadow-md">{current.label}</span>
        <span className="text-[10px] opacity-50 ml-1 group-hover:translate-y-0.5 transition-transform">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 sm:left-0 top-full mt-3 w-64 p-2 z-[99999] animate-scale-in rounded-[1.5rem] border border-white/10 shadow-[0_30px_100px_rgba(0,0,0,0.95)] bg-[#040404] overflow-hidden">
            {/* Ambient top light */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/20 blur-md pointer-events-none" />

            <div className="px-3 py-2 border-b border-white/5 mb-2">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Select Input Modality</span>
            </div>

            <div className="flex flex-col gap-1">
              {MODES.map(mode => {
                const isActive = mode.id === current.id;
                return (
                  <button key={mode.id} onClick={() => handleSwitch(mode)}
                    className={`relative w-full flex items-center gap-4 px-3 py-3 rounded-2xl text-left transition-all duration-300 group overflow-hidden
                                 ${isActive ? 'bg-white/5 shadow-inner' : 'hover:bg-white/5 hover:shadow-lg'}`}>
                    
                    {/* Active Indicator Bar */}
                    {isActive && (
                      <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-3/4 rounded-r-full shadow-[0_0_15px_currentColor] ${colorClass[mode.color].split(' ')[2]}`} 
                           style={{ backgroundColor: 'currentColor' }} />
                    )}

                    {/* Hover Gradient Background */}
                    <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-md border transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3
                                     ${isActive ? colorClass[mode.color] : 'bg-zinc-900 border-white/5 text-zinc-400'}`}>
                      {mode.icon}
                    </div>

                    <div className="flex-1 relative z-10">
                      <div className={`text-sm font-black tracking-wide ${isActive ? 'text-white' : 'text-zinc-300 group-hover:text-white transition-colors'}`}>
                        {mode.label}
                      </div>
                      <div className={`text-[10px] uppercase tracking-widest font-bold mt-0.5 ${isActive ? colorClass[mode.color].split(' ')[2] : 'text-zinc-500'}`}>
                        {mode.desc}
                      </div>
                    </div>

                    {isActive && (
                      <div className={`text-lg drop-shadow-[0_0_10px_currentColor] ${colorClass[mode.color].split(' ')[2]}`}>
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );

  // Full mode switcher (used inside call screen)
  return (
    <div className="flex items-center gap-2">
      {MODES.map(mode => (
        <button key={mode.id} onClick={() => handleSwitch(mode)}
          title={mode.desc}
          className={`group flex flex-col items-center justify-center gap-1.5 w-16 h-16 rounded-2xl border transition-all duration-300 hover:-translate-y-1 hover:shadow-xl relative overflow-hidden
                       ${mode.id === current.id
              ? `${colorClass[mode.color]} shadow-[0_0_20px_rgba(255,255,255,0.05)]`
              : 'bg-zinc-900 border-white/5 text-zinc-500 hover:text-zinc-300 hover:border-white/15'}`}>
          <div className="absolute inset-0 bg-gradient-to-t from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <span className="text-2xl drop-shadow-md group-hover:scale-110 transition-transform">{mode.icon}</span>
          <span className="text-[9px] font-black uppercase tracking-widest">{mode.label}</span>
        </button>
      ))}
    </div>
  );
}
