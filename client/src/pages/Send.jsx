// client/src/pages/Send.jsx
// Patient → Helper adaptive messaging — clear, accessible, compassionate UX
import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import Navbar from '../components/Navbar';
import api from '../lib/api';
import { getSocket } from '../lib/socket';
import toast from 'react-hot-toast';

const QUICK_NEEDS = [
  { id: 'water',    label: 'Water',    emoji: '💧' },
  { id: 'food',     label: 'Food',     emoji: '🍽️' },
  { id: 'medicine', label: 'Medicine', emoji: '💊' },
  { id: 'toilet',   label: 'Toilet',   emoji: '🚻' },
  { id: 'cold',     label: 'Too Cold', emoji: '🥶' },
  { id: 'hot',      label: 'Too Hot',  emoji: '🔥' },
  { id: 'tv',       label: 'TV Help',  emoji: '📺' },
  { id: 'light',    label: 'Light',    emoji: '💡' },
  { id: 'sleep',    label: 'Sleep',    emoji: '😴' },
  { id: 'doctor',   label: 'Doctor',   emoji: '👨‍⚕️' },
  { id: 'phone',    label: 'Phone',    emoji: '📱' },
  { id: 'repeat',   label: 'Repeat',   emoji: '🔁' },
];

const EMOTIONS = [
  { id: 'happy',   label: 'Happy',   emoji: '😊' },
  { id: 'sad',     label: 'Sad',     emoji: '😢' },
  { id: 'scared',  label: 'Scared',  emoji: '😰' },
  { id: 'anxious', label: 'Anxious', emoji: '😟' },
  { id: 'angry',   label: 'Angry',   emoji: '😠' },
  { id: 'loved',   label: 'Loved',   emoji: '🥰' },
  { id: 'bored',   label: 'Bored',   emoji: '😑' },
  { id: 'tired',   label: 'Tired',   emoji: '😩' },
];

const PAIN_TYPES  = ['Sharp', 'Dull', 'Burning', 'Pressure'];
const BODY_PARTS  = ['Head', 'Chest', 'Stomach', 'Back', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg', 'Neck', 'Hip'];

const TABS = [
  { id: 'need',    label: 'I Need',    emoji: '🙋' },
  { id: 'yes-no',  label: 'Yes / No',  emoji: '✅' },
  { id: 'pain',    label: 'Pain',      emoji: '😣' },
  { id: 'emotion', label: 'Feelings',  emoji: '😊' },
  { id: 'custom',  label: 'Message',   emoji: '✍️' },
  { id: 'sos',     label: 'Emergency', emoji: '🚨' },
];

const TYPING_DEBOUNCE_MS = 1500;

export default function Send() {
  const { user }   = useAuthStore();
  const location   = useLocation();
  const [activeTab, setActiveTab]       = useState('need');
  const [sending, setSending]           = useState(false);
  const [lastSentType, setLastSentType] = useState(null);
  const [deliveryStatus, setDeliveryStatus] = useState(null); // 'sent' | 'delivered' | 'read'

  // Pain state
  const [painLocation, setPainLocation]   = useState('');
  const [painIntensity, setPainIntensity] = useState(5);
  const [painType, setPainType]           = useState('');

  // Custom message
  const [customText, setCustomText] = useState('');
  const [isTyping, setIsTyping]     = useState(false);
  const typingTimerRef = useRef(null);

  // SOS two-step confirmation
  const [sosConfirmed, setSosConfirmed] = useState(false);
  const sosTimerRef = useRef(null);

  // Resolve recipient — DM state takes priority over linked helper
  const dmRecipientId   = location.state?.recipientId;
  const dmRecipientName = location.state?.recipientName;
  const helperId        = user?.helpers?.[0]?._id || user?.helpers?.[0];
  const receiverId      = dmRecipientId || helperId;
  const recipientLabel  = dmRecipientName || 'your helper';

  // Socket: listen for delivery/read receipts
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onDelivered = () => setDeliveryStatus('delivered');
    const onRead      = () => setDeliveryStatus('read');
    socket.on('message:delivered', onDelivered);
    socket.on('message:read', onRead);
    return () => {
      socket.off('message:delivered', onDelivered);
      socket.off('message:read', onRead);
    };
  }, []);

  // Cleanup timers on unmount
  useEffect(() => () => {
    clearTimeout(sosTimerRef.current);
    clearTimeout(typingTimerRef.current);
  }, []);

  // Typing indicator — emits socket event with debounce
  const handleTypingChange = (val) => {
    setCustomText(val);
    const socket = getSocket();
    if (!socket || !receiverId) return;
    if (!isTyping) {
      setIsTyping(true);
      socket.emit('message:typing', { receiverId, isTyping: true });
    }
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('message:typing', { receiverId, isTyping: false });
    }, TYPING_DEBOUNCE_MS);
  };

  const send = async (type, content) => {
    if (!receiverId) {
      toast.error(
        dmRecipientId
          ? 'Recipient not found.'
          : 'No helper linked. Add one in your Profile.',
      );
      return;
    }
    setSending(true);
    setDeliveryStatus(null);
    try {
      const res = await api.post('/messages/send', { receiverId, type, content });
      setLastSentType(type);
      setDeliveryStatus(res.data.delivered ? 'delivered' : 'sent');
      toast.success(`Message sent to ${recipientLabel} ✓`);
      setTimeout(() => setLastSentType(null), 2500);
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to send. Please try again.';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  // SOS two-step confirmation
  const handleSOS = () => {
    if (!sosConfirmed) {
      setSosConfirmed(true);
      sosTimerRef.current = setTimeout(() => setSosConfirmed(false), 5000);
      return;
    }
    setSosConfirmed(false);
    clearTimeout(sosTimerRef.current);
    send('sos', { emergencyType: 'emergency' });
  };

  // Delivery status badge
  const deliveryConfig = {
    sent:      { icon: '✓',  text: 'Sent',      color: 'text-zinc-400' },
    delivered: { icon: '✓✓', text: 'Delivered', color: 'text-teal-400' },
    read:      { icon: '✓✓', text: 'Read',      color: 'text-blue-400' },
  }[deliveryStatus];

  return (
    <div className="min-h-screen bg-[#020808] bg-[radial-gradient(ellipse_at_top,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans">
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-8 lg:py-12 flex flex-col gap-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white mb-2">
              {dmRecipientName
                ? <>Message <span className="text-teal-400">{dmRecipientName}</span></>
                : <>Message <span className="text-teal-400">Your Helper</span></>
              }
            </h1>
            <p className="text-zinc-400 text-sm font-medium">
              {dmRecipientName
                ? `Sending directly to ${dmRecipientName}.`
                : 'Choose how you want to communicate with your helper.'}
            </p>
          </div>
          {/* Delivery status badge */}
          {deliveryConfig && (
            <div className={`flex items-center gap-1 text-xs font-bold shrink-0 mt-1 ${deliveryConfig.color}`}>
              <span>{deliveryConfig.icon}</span>
              <span>{deliveryConfig.text}</span>
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar" role="tablist" aria-label="Message types">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-label={tab.label}
              onClick={() => { setActiveTab(tab.id); setSosConfirmed(false); }}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold transition-all whitespace-nowrap flex-shrink-0 relative overflow-hidden border
                ${activeTab === tab.id
                  ? tab.id === 'sos'
                    ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                    : 'bg-teal-500/15 border-teal-500/30 text-teal-300'
                  : 'bg-zinc-900/40 border-white/5 text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                }`}
            >
              {activeTab === tab.id && (
                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r-full ${tab.id === 'sos' ? 'bg-rose-400' : 'bg-teal-400'}`} />
              )}
              <span className="text-xl">{tab.emoji}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Panel */}
        <div
          role="tabpanel"
          className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden min-h-[480px] flex flex-col justify-center"
        >
          <div className={`absolute -bottom-20 -right-20 w-80 h-80 blur-[80px] rounded-full pointer-events-none transition-colors duration-700
            ${activeTab === 'sos'    ? 'bg-rose-500/10'  :
              activeTab === 'pain'   ? 'bg-amber-500/5'  :
              activeTab === 'yes-no' ? 'bg-sky-500/5'    : 'bg-teal-500/5'}`}
          />

          {/* ── I Need ─────────────────────────────────────────── */}
          {activeTab === 'need' && (
            <div className="animate-fade-in relative z-10 w-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-white">What do you need?</h3>
                <span className="px-3 py-1 bg-teal-500/10 border border-teal-500/20 rounded-lg text-teal-400 text-[10px] font-black uppercase tracking-widest">
                  One Tap
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                {QUICK_NEEDS.map(n => (
                  <button
                    key={n.id}
                    onClick={() => send('need', { item: n.id })}
                    disabled={sending}
                    aria-label={`I need ${n.label}`}
                    className={`flex flex-col items-center justify-center gap-3 p-4 rounded-2xl border transition-all duration-300
                      ${lastSentType === 'need'
                        ? 'bg-teal-500/20 border-teal-500/40 text-white shadow-[0_0_15px_rgba(45,212,191,0.3)] scale-95'
                        : 'bg-zinc-950 border-white/5 text-zinc-400 hover:bg-zinc-900 hover:border-teal-500/30 hover:text-white active:scale-95'}`}
                  >
                    <span className="text-4xl">{n.emoji}</span>
                    <span className="text-[10px] font-black uppercase tracking-widest">{n.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Yes / No ───────────────────────────────────────── */}
          {activeTab === 'yes-no' && (
            <div className="animate-fade-in relative z-10 w-full flex flex-col justify-center">
              <div className="text-center mb-8">
                <h3 className="text-2xl font-black text-white mb-2">Quick Answer</h3>
                <p className="text-sm font-medium text-zinc-400">Tap YES or NO to reply instantly.</p>
              </div>
              <div className="grid grid-cols-2 gap-6 w-full max-w-lg mx-auto">
                <button
                  onClick={() => send('yes-no', { answer: 'yes' })}
                  disabled={sending}
                  aria-label="Answer Yes"
                  className="flex flex-col items-center justify-center gap-4 py-16 rounded-3xl bg-teal-500/10 border-2 border-teal-500/30 text-teal-400 hover:bg-teal-500/20 hover:border-teal-400 transition-all active:scale-95 shadow-lg shadow-teal-500/10"
                >
                  <span className="text-7xl">✅</span>
                  <span className="font-black text-4xl tracking-tight text-white">YES</span>
                </button>
                <button
                  onClick={() => send('yes-no', { answer: 'no' })}
                  disabled={sending}
                  aria-label="Answer No"
                  className="flex flex-col items-center justify-center gap-4 py-16 rounded-3xl bg-rose-500/10 border-2 border-rose-500/30 text-rose-400 hover:bg-rose-500/20 hover:border-rose-400 transition-all active:scale-95 shadow-lg shadow-rose-500/10"
                >
                  <span className="text-7xl">❌</span>
                  <span className="font-black text-4xl tracking-tight text-white">NO</span>
                </button>
              </div>
            </div>
          )}

          {/* ── Pain Report ─────────────────────────────────────── */}
          {activeTab === 'pain' && (
            <div className="animate-fade-in relative z-10 w-full space-y-8">
              <div className="flex items-center gap-3">
                <span className="text-2xl">😣</span>
                <h3 className="text-lg font-black text-white">Pain Report</h3>
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">
                  Where does it hurt?
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {BODY_PARTS.map(part => (
                    <button
                      key={part}
                      onClick={() => setPainLocation(part)}
                      aria-pressed={painLocation === part}
                      className={`py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all
                        ${painLocation === part
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-inner scale-105'
                          : 'bg-zinc-950 border-white/5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}
                    >
                      {part}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-end mb-3">
                  <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Pain Level</label>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-3xl font-black leading-none ${
                      painIntensity >= 8 ? 'text-rose-400' :
                      painIntensity >= 5 ? 'text-amber-400' : 'text-teal-400'
                    }`}>{painIntensity}</span>
                    <span className="text-zinc-500 text-sm font-bold">/10</span>
                  </div>
                </div>
                <input
                  type="range" min={1} max={10} value={painIntensity}
                  onChange={e => setPainIntensity(Number(e.target.value))}
                  aria-label="Pain level from 1 to 10"
                  className="w-full h-3 bg-zinc-950 rounded-lg appearance-none cursor-pointer accent-amber-500 border border-white/5 shadow-inner"
                />
                <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-2">
                  <span>Mild (1)</span><span>Moderate (5)</span><span>Severe (10)</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">
                  Type of Pain
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {PAIN_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setPainType(t)}
                      aria-pressed={painType === t}
                      className={`py-3 rounded-xl border text-xs font-bold transition-all
                        ${painType === t
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-inner'
                          : 'bg-zinc-950 border-white/5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => send('pain', { location: painLocation, intensity: painIntensity, painType })}
                  disabled={!painLocation || !painType || sending}
                  className="w-full py-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-black text-sm uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {sending ? 'Sending...' : 'Send Pain Report'}
                </button>
                {(!painLocation || !painType) && (
                  <p className="text-center text-xs text-zinc-500 mt-3">
                    Please select a location and pain type to continue.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Feelings ───────────────────────────────────────── */}
          {activeTab === 'emotion' && (
            <div className="animate-fade-in relative z-10 w-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-black text-white">How are you feeling?</h3>
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Tap to share</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {EMOTIONS.map(e => (
                  <button
                    key={e.id}
                    onClick={() => send('emotion', { emotion: e.id })}
                    disabled={sending}
                    aria-label={`I feel ${e.label}`}
                    className="flex flex-col items-center justify-center gap-3 py-6 rounded-2xl bg-zinc-950 border border-white/5 text-zinc-400 hover:bg-zinc-900 hover:border-sky-500/30 hover:text-sky-300 transition-all active:scale-95 shadow-sm group"
                  >
                    <span className="text-5xl group-hover:scale-110 transition-transform drop-shadow-md">{e.emoji}</span>
                    <span className="text-xs font-black uppercase tracking-widest">{e.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Write a Message ─────────────────────────────────── */}
          {activeTab === 'custom' && (
            <div className="animate-fade-in relative z-10 w-full space-y-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-black text-white flex items-center gap-2">
                  <span className="text-teal-400">✍️</span> Write a Message
                </h3>
                <span className={`text-xs font-bold tabular-nums ${customText.length > 450 ? 'text-rose-400' : 'text-zinc-500'}`}>
                  {customText.length}/500
                </span>
              </div>
              <textarea
                className="w-full bg-zinc-950 border border-white/10 text-white rounded-2xl p-5 focus:outline-none focus:border-teal-500/50 transition-all text-base font-medium shadow-inner resize-none"
                rows={5}
                maxLength={500}
                placeholder="Type your message here..."
                value={customText}
                onChange={e => handleTypingChange(e.target.value)}
                aria-label="Message to helper"
              />
              <button
                onClick={() => { send('custom', { text: customText }); setCustomText(''); }}
                disabled={!customText.trim() || sending}
                className="w-full py-4 rounded-xl bg-white hover:bg-teal-400 text-zinc-950 font-black text-sm uppercase tracking-widest transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          )}

          {/* ── Emergency ───────────────────────────────────────── */}
          {activeTab === 'sos' && (
            <div className="animate-fade-in relative z-10 w-full flex flex-col items-center justify-center text-center">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-rose-500/30 blur-3xl rounded-full animate-pulse" />
                <div className="text-8xl relative z-10 drop-shadow-[0_0_15px_rgba(251,113,133,0.5)] animate-bounce">🚨</div>
              </div>

              <h3 className="text-3xl font-black text-white mb-3">Emergency Alert</h3>
              <p className="text-rose-200 text-sm font-medium mb-10 max-w-sm mx-auto leading-relaxed">
                This will immediately alert your helper with an emergency notification and share your location.
                Only use in a genuine emergency.
              </p>

              {!sosConfirmed ? (
                <button
                  onClick={handleSOS}
                  disabled={sending}
                  className="w-full max-w-sm py-5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-lg tracking-widest transition-all shadow-[0_0_30px_rgba(225,29,72,0.5)] active:scale-95 border border-rose-400/50"
                >
                  Send Emergency Alert
                </button>
              ) : (
                <div className="w-full max-w-sm space-y-4">
                  <p className="text-rose-300 font-bold text-sm animate-pulse">
                    ⚠️ Are you sure? Tap the button again to confirm.
                  </p>
                  <button
                    onClick={handleSOS}
                    disabled={sending}
                    className="w-full py-5 rounded-2xl bg-rose-500 text-white font-black text-lg tracking-widest transition-all shadow-[0_0_40px_rgba(225,29,72,0.8)] active:scale-95 border-2 border-rose-300/60 animate-pulse"
                  >
                    {sending ? 'Alerting your helper...' : '✓ Confirm Emergency Alert'}
                  </button>
                  <button
                    onClick={() => { setSosConfirmed(false); clearTimeout(sosTimerRef.current); }}
                    className="w-full py-3 rounded-xl border border-white/10 text-zinc-400 text-sm font-bold hover:bg-white/5 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}