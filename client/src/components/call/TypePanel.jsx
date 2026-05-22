// client/src/components/call/TypePanel.jsx
// Industry-Grade TTS Text Input Panel
// For users who prefer typing, with quick predictive phrases and TTS.

import { useState, useRef, useEffect } from 'react';

const QUICK_PHRASES = [
  "Hello", "Yes", "No", "Thanks", "I agree", "Hold on", "Could you repeat that?", "Goodbye"
];

export default function TypePanel({ onSend, onSendInterim }) {
  const [text, setText] = useState('');
  const [localAudioFeedback, setLocalAudioFeedback] = useState(true);
  const textareaRef = useRef(null);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const send = (overrideText = null) => {
    const msg = overrideText || text.trim();
    if (!msg) return;
    
    onSend(msg, 1.0);
    if (onSendInterim) {
      onSendInterim(''); // Clear interim when sent
    }
    
    // TTS (local feedback) - only play if feedback toggle is active
    if (localAudioFeedback) {
      try {
        const utter = new SpeechSynthesisUtterance(msg);
        // Try to find a good English voice
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) || voices[0];
        if (voice) utter.voice = voice;
        window.speechSynthesis.speak(utter);
      } catch(e) {}
    }
    
    setText('');
    textareaRef.current?.focus();
  };

  const handleQuickPhrase = (phrase) => {
    send(phrase);
  };

  return (
    <div className="space-y-4 relative" role="region" aria-label="Text-to-speech typing panel">
      
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-rose-500/10 blur-[60px] rounded-full pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)] animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            TTS Engine Ready
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setLocalAudioFeedback(prev => !prev)}
            className={`text-[9px] font-black uppercase tracking-widest border px-2.5 py-0.5 rounded-full transition-all duration-300 active:scale-95
              ${localAudioFeedback 
                ? 'border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20' 
                : 'border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700'}`}
          >
            {localAudioFeedback ? '🔊 Audio Feedback On' : '🔇 Audio Feedback Off'}
          </button>
          <span className="text-[9px] font-black text-rose-500/50 uppercase tracking-widest border border-rose-500/20 px-2 py-0.5 rounded-full">Keyboard Mode</span>
        </div>
      </div>

      {/* Input Area */}
      <div className="relative group z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-transparent rounded-2xl pointer-events-none opacity-0 group-focus-within:opacity-100 transition-opacity duration-300" />
        <textarea
          ref={textareaRef}
          className="w-full bg-zinc-950/60 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3.5 text-sm font-medium text-white resize-none 
                     focus:outline-none focus:border-rose-500/50 focus:shadow-[0_0_15px_rgba(244,63,94,0.15)] transition-all
                     placeholder:text-zinc-600 shadow-inner relative z-10"
          rows={4}
          placeholder="Type message to synthesize..."
          value={text}
          onChange={e => {
            setText(e.target.value);
            if (onSendInterim) {
              onSendInterim(e.target.value);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="absolute bottom-3 right-3 px-2 py-1 rounded bg-zinc-900 border border-white/5 text-[9px] font-black uppercase tracking-widest text-zinc-500 z-20">
          Enter to Send
        </div>
      </div>

      {/* Quick Phrases */}
      <div className="flex flex-wrap gap-2 relative z-10">
        {QUICK_PHRASES.map(phrase => (
          <button
            key={phrase}
            onClick={() => handleQuickPhrase(phrase)}
            className="px-3 py-1.5 rounded-xl bg-zinc-950/60 backdrop-blur-sm border border-white/5 text-zinc-400 text-[10px] font-black uppercase tracking-widest hover:border-rose-500/40 hover:text-rose-400 hover:shadow-[0_0_10px_rgba(244,63,94,0.15)] hover:bg-rose-500/10 transition-all active:scale-95"
          >
            {phrase}
          </button>
        ))}
      </div>

      {/* Action */}
      <button onClick={() => send()} disabled={!text.trim()}
        className="w-full py-4 rounded-2xl bg-rose-500/15 border border-rose-500/40
                   text-rose-400 text-[11px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3
                   hover:bg-rose-500/25 hover:shadow-[0_0_20px_rgba(244,63,94,0.25)] active:scale-95 transition-all disabled:opacity-30 disabled:hover:shadow-none disabled:cursor-not-allowed relative z-10 group overflow-hidden">
        <span className="text-xl group-hover:scale-110 transition-transform">⌨️</span>
        <span>Synthesize & Send</span>
      </button>

    </div>
  );
}
