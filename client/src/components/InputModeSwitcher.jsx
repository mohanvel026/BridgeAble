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
        <div className="absolute left-0 top-full mt-2 w-48 p-1.5 z-[9999] animate-slide-down rounded-xl shadow-2xl"
             style={{ background: 'rgba(4, 13, 12, 0.95)', backdropFilter: 'blur(16px)', border: '1px solid var(--border)' }}>
          {MODES.map(mode => (
            <button key={mode.id} onClick={() => handleSwitch(mode)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all
                           ${mode.id === current.id
                  ? colorClass[mode.color]
                  : 'text-text-secondary hover:text-text-primary hover:bg-dark-800'}`}>
              <span className="text-base">{mode.icon}</span>
              <div className="text-left">
                <div className="font-medium text-xs">{mode.label}</div>
                <div className="text-xs opacity-60">{mode.desc}</div>
              </div>
              {mode.id === current.id && <span className="ml-auto text-xs">✓</span>}
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
