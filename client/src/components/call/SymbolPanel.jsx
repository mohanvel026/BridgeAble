// client/src/components/call/SymbolPanel.jsx
// AAC Pictogram Board for users with cognitive or speech impairments
// Constructs sentences via symbolic grid, reads aloud via TTS, and sends to call room.
import { useState } from 'react';

const SYMBOL_CATEGORIES = {
  'Basic': [
    { id: 'yes', label: 'Yes', emoji: '✅' },
    { id: 'no', label: 'No', emoji: '❌' },
    { id: 'help', label: 'Help', emoji: '🆘' },
    { id: 'stop', label: 'Stop', emoji: '🛑' },
    { id: 'more', label: 'More', emoji: '➕' },
    { id: 'finish', label: 'Finished', emoji: '✔' },
  ],
  'Needs': [
    { id: 'water', label: 'Water', emoji: '💧' },
    { id: 'food', label: 'Food', emoji: '🍽' },
    { id: 'medicine', label: 'Medicine', emoji: '💊' },
    { id: 'toilet', label: 'Toilet', emoji: '🚻' },
    { id: 'sleep', label: 'Sleep', emoji: '😴' },
    { id: 'cold', label: 'Cold', emoji: '🥶' },
  ],
  'Feelings': [
    { id: 'pain', label: 'Pain', emoji: '😣' },
    { id: 'happy', label: 'Happy', emoji: '😊' },
    { id: 'sad', label: 'Sad', emoji: '😢' },
    { id: 'scared', label: 'Scared', emoji: '😰' },
    { id: 'tired', label: 'Tired', emoji: '😩' },
    { id: 'good', label: 'Good', emoji: '👍' },
  ],
  'Medical': [
    { id: 'doctor', label: 'Doctor', emoji: '👨‍⚕️' },
    { id: 'hospital', label: 'Hospital', emoji: '🏥' },
    { id: 'call', label: 'Call', emoji: '📞' },
    { id: 'emergency', label: 'Emergency', emoji: '🚨' },
    { id: 'breath', label: 'Breathe', emoji: '😮‍💨' },
    { id: 'fall', label: 'Fell', emoji: '⬇' },
  ],
};

export default function SymbolPanel({ onSend }) {
  const [activeCategory, setActiveCategory] = useState('Basic');
  const [sentence, setSentence] = useState([]);

  const addSymbol = (sym) => setSentence(s => [...s, sym]);
  const removeLastSymbol = () => setSentence(s => s.slice(0, -1));

  const sendSentence = () => {
    if (!sentence.length) return;
    const text = sentence.map(s => s.label).join(' ');
    onSend(text, 1.0);
    
    // TTS feedback
    try {
      const utter = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utter);
    } catch(e) {}

    setSentence([]);
  };

  return (
    <div className="space-y-4 relative" role="region" aria-label="AAC Symbol Communication Board">
      
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-amber-500/10 blur-[60px] rounded-full pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
            AAC Grid Active
          </span>
        </div>
        <span className="text-[9px] font-black text-amber-500/50 uppercase tracking-widest border border-amber-500/20 px-2 py-0.5 rounded-full">Pictogram Mode</span>
      </div>

      {/* Sentence builder */}
      <div className="min-h-[5rem] px-4 py-3 rounded-2xl bg-zinc-950/80 backdrop-blur-md border border-white/5 flex flex-wrap gap-2 items-start shadow-inner relative z-10 transition-all duration-300">
        {sentence.length === 0
          ? <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest absolute top-1/2 left-4 -translate-y-1/2">Tap symbols to construct sequence...</span>
          : sentence.map((s, i) => (
            <span key={i} className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.15)] animate-scale-in">
              <span className="text-xl drop-shadow-md">{s.emoji}</span>
              <span className="text-[9px] font-black text-amber-300 uppercase tracking-widest mt-1">{s.label}</span>
            </span>
          ))
        }
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide relative z-10">
        {Object.keys(SYMBOL_CATEGORIES).map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all active:scale-95
                         ${activeCategory === cat
                ? 'bg-amber-500/20 border border-amber-500/50 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                : 'bg-zinc-950/60 border border-white/5 text-zinc-500 hover:text-amber-400 hover:border-amber-500/30'}`}>
            {cat}
          </button>
        ))}
      </div>

      {/* Symbol grid */}
      <div className="grid grid-cols-3 gap-3 relative z-10">
        {SYMBOL_CATEGORIES[activeCategory].map(sym => (
          <button key={sym.id} onClick={() => addSymbol(sym)}
            className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-zinc-950/60 backdrop-blur-sm border border-white/5
                         hover:bg-amber-500/15 hover:border-amber-500/40 hover:shadow-[0_0_20px_rgba(245,158,11,0.15)] transition-all duration-300 active:scale-[0.95] group">
            <span className="text-4xl filter drop-shadow-lg group-hover:scale-110 transition-transform">{sym.emoji}</span>
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest group-hover:text-amber-400 transition-colors">{sym.label}</span>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-4 gap-3 pt-2 relative z-10">
        <button onClick={removeLastSymbol} disabled={!sentence.length}
          className="col-span-1 py-3 rounded-2xl bg-zinc-950/60 border border-white/10 text-zinc-400 text-lg font-black
                       hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30 transition-all disabled:opacity-30 disabled:hover:border-white/10 active:scale-95 shadow-sm">
          ←
        </button>
        <button onClick={() => setSentence([])} disabled={!sentence.length}
          className="col-span-1 py-3 rounded-2xl bg-zinc-950/60 border border-white/10 text-rose-400 text-lg font-black
                       hover:bg-rose-500/10 hover:border-rose-500/30 transition-all disabled:opacity-30 disabled:hover:border-white/10 active:scale-95 shadow-sm">
          ✕
        </button>
        <button onClick={sendSentence} disabled={!sentence.length}
          className="col-span-2 py-3 rounded-2xl bg-amber-500/20 border border-amber-500/40
                       text-amber-400 text-[10px] uppercase tracking-widest font-black hover:bg-amber-500/30 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all disabled:opacity-30 disabled:hover:shadow-none active:scale-95 flex items-center justify-center gap-3">
          <span className="text-xl">🗣</span>
          <span>Speak & Send</span>
        </button>
      </div>
    </div>
  );
}