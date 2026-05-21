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
    
    try {
      const utter = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utter);
    } catch(e) {}

    setSentence([]);
  };

  return (
    <div className="space-y-4 relative w-full h-full flex flex-col" role="region" aria-label="AAC Symbol Communication Board">
      
      {/* Dynamic Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-amber-500/10 blur-[80px] rounded-full pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between relative z-10 px-2">
        <div className="flex items-center gap-2 bg-[#020808] px-3 py-1.5 rounded-full border border-white/5 shadow-inner">
          <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)] animate-pulse" />
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-300">
            AAC Grid Active
          </span>
        </div>
        <span className="text-[9px] font-black text-amber-500/80 uppercase tracking-widest border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 rounded-full shadow-[0_0_10px_rgba(251,191,36,0.1)]">Pictogram Mode</span>
      </div>

      {/* Sentence Builder Display */}
      <div className="min-h-[5.5rem] p-4 rounded-3xl bg-[#040404] border border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_2px_10px_rgba(255,255,255,0.02)] flex flex-wrap gap-2 items-start relative z-10 transition-all duration-300">
        {sentence.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[11px] text-zinc-600 font-black uppercase tracking-[0.2em] opacity-60">Tap symbols to construct sequence...</span>
          </div>
        ) : (
          sentence.map((s, i) => (
            <span key={i} className="flex flex-col items-center px-4 py-2 rounded-2xl bg-gradient-to-b from-amber-500/20 to-amber-500/5 border border-amber-500/40 shadow-[0_5px_15px_rgba(245,158,11,0.15)] animate-scale-in transform transition-transform hover:-translate-y-1">
              <span className="text-2xl drop-shadow-lg">{s.emoji}</span>
              <span className="text-[10px] font-black text-amber-300 uppercase tracking-widest mt-1.5">{s.label}</span>
            </span>
          ))
        )}
      </div>

      {/* Category Navigation Pills */}
      <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar relative z-10 px-1">
        {Object.keys(SYMBOL_CATEGORIES).map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            className={`px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap transition-all duration-300 active:scale-95
                         ${activeCategory === cat
                ? 'bg-amber-500 border border-amber-400 text-black shadow-[0_0_20px_rgba(245,158,11,0.4)]'
                : 'bg-[#0a0a0a] border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 hover:bg-white/5'}`}>
            {cat}
          </button>
        ))}
      </div>

      {/* Primary Symbol Grid */}
      <div className="flex-1 grid grid-cols-3 sm:grid-cols-3 gap-3 sm:gap-4 relative z-10 overflow-y-auto custom-scrollbar pr-1 pb-2">
        {SYMBOL_CATEGORIES[activeCategory].map(sym => (
          <button key={sym.id} onClick={() => addSymbol(sym)}
            className="group relative flex flex-col items-center justify-center gap-3 aspect-square rounded-[2rem] bg-[#060606] border border-white/5 shadow-[0_5px_20px_rgba(0,0,0,0.5)]
                         hover:bg-[#0a0a0a] hover:border-amber-500/30 hover:shadow-[0_10px_30px_rgba(245,158,11,0.15)] transition-all duration-300 hover:-translate-y-1 active:scale-[0.92] active:translate-y-1 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <span className="text-4xl sm:text-5xl filter drop-shadow-[0_5px_10px_rgba(0,0,0,0.5)] group-hover:scale-110 transition-transform duration-300 relative z-10">{sym.emoji}</span>
            <span className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.15em] group-hover:text-amber-400 transition-colors relative z-10">{sym.label}</span>
          </button>
        ))}
      </div>

      {/* Control Actions Row */}
      <div className="grid grid-cols-4 gap-3 relative z-10 mt-auto pt-2">
        <button onClick={removeLastSymbol} disabled={!sentence.length}
          className="col-span-1 h-14 rounded-2xl bg-[#060606] border border-white/10 text-zinc-400 text-xl font-black
                       hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30 transition-all duration-300 disabled:opacity-30 disabled:hover:border-white/10 active:scale-95 shadow-lg flex items-center justify-center">
          ←
        </button>
        <button onClick={() => setSentence([])} disabled={!sentence.length}
          className="col-span-1 h-14 rounded-2xl bg-[#060606] border border-white/10 text-rose-400 text-xl font-black
                       hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 transition-all duration-300 disabled:opacity-30 disabled:hover:border-white/10 active:scale-95 shadow-lg flex items-center justify-center">
          ✕
        </button>
        <button onClick={sendSentence} disabled={!sentence.length}
          className="col-span-2 h-14 rounded-2xl bg-amber-500 hover:bg-amber-400 border border-amber-300 text-black text-[11px] uppercase tracking-widest font-black shadow-[0_5px_25px_rgba(245,158,11,0.4)] transition-all duration-300 disabled:opacity-30 disabled:hover:bg-amber-500 disabled:hover:shadow-none active:scale-95 flex items-center justify-center gap-3 overflow-hidden relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-[150%] group-hover:translate-x-[150%] transition-transform duration-1000 ease-in-out" />
          <span className="text-xl relative z-10">🗣</span>
          <span className="relative z-10">Speak & Send</span>
        </button>
      </div>
    </div>
  );
}