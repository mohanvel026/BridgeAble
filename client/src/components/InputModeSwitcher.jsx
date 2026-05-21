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

    // Notify call room
    if (roomCode) {
      const socket = getSocket();
      socket?.emit('mode:switch', { roomCode, newMode: mode.id });
    }

    // TTS for blind users
    if (user?.disabilityType === 'blind') {
      const msg = new SpeechSynthesisUtterance(`Switched to ${mode.desc} mode`);
      window.speechSynthesis.speak(msg);
    }

    // Persist to localStorage
    localStorage.setItem('ba_inputMode', mode.id);
    setOpen(false);
  };

  if (compact) return (
    <div className="relative">
      <button onClick={() => setOpen(p => !p)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all
                     ${colorClass[current.color]}`}>
        <span>{current.icon}</span>
        <span>{current.label}</span>
        <span className="text-xs opacity-60">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 sm:left-0 top-full mt-3 w-56 p-2 z-[99999] animate-slide-down rounded-2xl border border-white/15 shadow-[0_20px_60px_rgba(0,0,0,0.9)] bg-[#020808] overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/5 before:to-transparent before:pointer-events-none">
          {MODES.map(mode => (
            <button key={mode.id} onClick={() => handleSwitch(mode)}
              className={`relative w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-300 group
                           ${mode.id === current.id
                  ? `${colorClass[mode.color]} shadow-inner font-semibold`
                  : 'text-zinc-400 hover:text-white hover:bg-white/5 hover:shadow-lg'}`}>
              
              {/* Animated selection glow for active item */}
              {mode.id === current.id && (
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/10 to-transparent opacity-50 pointer-events-none" />
              )}

              <span className="text-xl relative z-10 group-hover:scale-110 transition-transform">{mode.icon}</span>
              <div className="text-left relative z-10">
                <div className="text-[13px]">{mode.label}</div>
                <div className="text-[10px] opacity-60 font-medium tracking-wide uppercase">{mode.desc}</div>
              </div>
              {mode.id === current.id && (
                <span className="ml-auto text-sm relative z-10 drop-shadow-md">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Full mode switcher (used inside call screen)
  return (
    <div className="flex items-center gap-2">
      {MODES.map(mode => (
        <button key={mode.id} onClick={() => handleSwitch(mode)}
          title={mode.desc}
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border text-xs transition-all
                       ${mode.id === current.id
              ? colorClass[mode.color]
              : 'bg-dark-800 border-dark-600 text-text-muted hover:text-text-secondary hover:border-dark-500'}`}>
          <span className="text-lg">{mode.icon}</span>
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
}
