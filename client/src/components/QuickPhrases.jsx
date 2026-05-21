// client/src/components/QuickPhrases.jsx
import { useState } from 'react';
import { useAuthStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import toast from 'react-hot-toast';

const PHRASES = [
  { label: 'YES', emoji: '✅', color: 'teal' },
  { label: 'NO', emoji: '❌', color: 'rose' },
  { label: 'HELP', emoji: '🆘', color: 'amber' },
  { label: 'WAIT', emoji: '✋', color: 'cyan' },
  { label: 'PAIN', emoji: '😣', color: 'violet' },
];

const btnColor = {
  teal: 'bg-accent-teal/10 border-accent-teal/30 text-accent-teal hover:bg-accent-teal/20',
  rose: 'bg-accent-rose/10 border-accent-rose/30 text-accent-rose hover:bg-accent-rose/20',
  amber: 'bg-accent-amber/10 border-accent-amber/30 text-accent-amber hover:bg-accent-amber/20',
  cyan: 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/20',
  violet: 'bg-accent-violet/10 border-accent-violet/30 text-accent-violet hover:bg-accent-violet/20',
};

export default function QuickPhrases({ compact = false, roomCode = null, inCall = false }) {
  const { user } = useAuthStore();
  const [sent, setSent] = useState(null);

  const sendPhrase = async (phrase) => {
    setSent(phrase.label);
    setTimeout(() => setSent(null), 1500);

    if (inCall && roomCode) {
      // Send as subtitle in call
      const socket = getSocket();
      socket?.emit('subtitle:send', {
        roomCode,
        text: phrase.label,
        inputMode: 'type',
        confidence: 1.0,
      });
    } else {
      // Send as yes-no or custom message to helper
      try {
        if (!user?.helpers?.length) return;
        await api.post('/messages/send', {
          receiverId: user.helpers[0]._id || user.helpers[0],
          type: phrase.label === 'YES' || phrase.label === 'NO' ? 'yes-no' : 'custom',
          content: phrase.label === 'YES' || phrase.label === 'NO'
            ? { answer: phrase.label.toLowerCase() }
            : { text: phrase.label },
        });
        toast.success(`Sent: ${phrase.label}`);
      } catch { }
    }
  };

  if (compact) return (
    <div className="flex items-center gap-1.5">
      {PHRASES.map(p => (
        <button key={p.label} onClick={() => sendPhrase(p)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-bold
                       transition-all active:scale-95 ${btnColor[p.color]}
                       ${sent === p.label ? 'scale-110 shadow-glow' : ''}`}>
          <span>{p.emoji}</span>
          <span className="hidden sm:block">{p.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="grid grid-cols-5 gap-2">
      {PHRASES.map(p => (
        <button key={p.label} onClick={() => sendPhrase(p)}
          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-bold
                       transition-all active:scale-95 ${btnColor[p.color]}
                       ${sent === p.label ? 'scale-110 shadow-glow' : ''}`}>
          <span className="text-2xl">{p.emoji}</span>
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}
