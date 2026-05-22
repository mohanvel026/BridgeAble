// client/src/components/call/IncomingCallModal.jsx
// Industry-grade incoming call UI — ring timer, animated rings, blind/paralyzed accessible
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocketStore, useAuthStore } from '../../store/stores';
import { getSocket } from '../../lib/socket';
import useBlinkDetector from '../../hooks/useBlinkDetector';

const RING_TIMEOUT_MS = 35000; // 35 seconds before auto-decline

const DISABILITY_LABELS = {
  deaf:      { icon: '👋', label: 'Deaf — Sign Language' },
  paralyzed: { icon: '👁', label: 'Paralyzed — Eye Blink' },
  speech:    { icon: '🗂', label: 'Speech Impaired — Symbols' },
  blind:     { icon: '🔊', label: 'Blind — Voice + TTS' },
  normal:    { icon: '🤝', label: 'Helper / Normal' },
};

const MODE_BRIDGE = {
  'deaf-normal':      '👋 Gesture ↔ 🎙 Voice',
  'paralyzed-normal': '👁 Blink ↔ 🎙 Voice',
  'speech-normal':    '🗂 Symbol ↔ 🎙 Voice',
  'blind-normal':     '🔊 TTS ↔ 🎙 Voice',
};

export default function IncomingCallModal() {
  const navigate = useNavigate();
  const { incomingCall, clearIncomingCall } = useSocketStore();
  const { user } = useAuthStore();
  const timeoutRef = useRef(null);
  const announcedRef = useRef(false);
  const videoRef = useRef(null);
  const [blinkCount, setBlinkCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(RING_TIMEOUT_MS / 1000));
  const timerIntervalRef = useRef(null);

  const isParalyzed = user?.disabilityType === 'paralyzed';
  const isBlind     = user?.disabilityType === 'blind';

  const bridgeKey = `${incomingCall?.disabilityType}-${user?.disabilityType}`;
  const bridgeReverse = `${user?.disabilityType}-${incomingCall?.disabilityType}`;
  const bridgeLabel = MODE_BRIDGE[bridgeKey] || MODE_BRIDGE[bridgeReverse] || '🔗 Adaptive Bridge';

  // ── Auto-decline after timeout ───────────────────────────
  const decline = useCallback(() => {
    clearTimeout(timeoutRef.current);
    clearInterval(timerIntervalRef.current);
    const socket = getSocket();
    if (incomingCall?.callerId) {
      socket?.emit('call:decline', { callerId: incomingCall.callerId, reason: 'no_answer' });
    }
    clearIncomingCall();
    setBlinkCount(0);
  }, [incomingCall, clearIncomingCall]);

  const accept = useCallback(async () => {
    clearTimeout(timeoutRef.current);
    clearInterval(timerIntervalRef.current);
    const socket = getSocket();
    // Notify caller that we accepted
    if (incomingCall?.callerId) {
      socket?.emit('call:accept', {
        callerId: incomingCall.callerId,
        roomCode: incomingCall.roomCode,
      });
    }
    clearIncomingCall();
    setBlinkCount(0);
    
    // 300ms hardware guard-band to allow webcam drivers to fully release prior to call room connection
    setTimeout(() => {
      navigate(`/call/room/${incomingCall.roomCode}`, {
        state: {
          isInitiator: false,
          callType: incomingCall.type || 'video',
          recipientName: incomingCall.name,
        },
      });
    }, 300);
  }, [incomingCall, clearIncomingCall, navigate]);

  useEffect(() => {
    if (!incomingCall) {
      announcedRef.current = false;
      setSecondsLeft(Math.floor(RING_TIMEOUT_MS / 1000));
      return;
    }

    // Auto-decline if already in a call room (busy)
    if (window.location.pathname.includes('/call/room')) {
      const socket = getSocket();
      socket?.emit('call:decline', { callerId: incomingCall.callerId, reason: 'busy' });
      clearIncomingCall();
      return;
    }

    // TTS announce for blind users
    if (isBlind && !announcedRef.current) {
      announcedRef.current = true;
      const msg = new SpeechSynthesisUtterance(
        `Incoming ${incomingCall.type === 'voice' ? 'voice' : 'video'} call from ${incomingCall.name}. Double tap to accept or swipe left to decline.`
      );
      msg.rate = 1.1;
      window.speechSynthesis.speak(msg);
    }

    // Countdown timer
    setSecondsLeft(Math.floor(RING_TIMEOUT_MS / 1000));
    timerIntervalRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(timerIntervalRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    // Auto-decline at end
    timeoutRef.current = setTimeout(() => decline(), RING_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutRef.current);
      clearInterval(timerIntervalRef.current);
    };
  }, [incomingCall]);

  // Handle blink for paralyzed users
  const handleBlink = useCallback(({ type }) => {
    if (type === 'dash') decline();
    else setBlinkCount(p => p + 1);
  }, [decline]);

  useEffect(() => {
    if (blinkCount >= 2) accept();
  }, [blinkCount, accept]);

  useBlinkDetector(videoRef, {
    onBlink: handleBlink,
    enabled: isParalyzed && !!incomingCall,
  });

  // Listen for caller cancelling before we answer
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onCancelled = () => {
      clearTimeout(timeoutRef.current);
      clearInterval(timerIntervalRef.current);
      clearIncomingCall();
    };
    socket.on('call:cancelled', onCancelled);
    return () => socket.off('call:cancelled', onCancelled);
  }, [clearIncomingCall]);

  if (!incomingCall) return null;

  const callerInfo = DISABILITY_LABELS[incomingCall.disabilityType] || DISABILITY_LABELS.normal;
  const ringProgress = (secondsLeft / Math.floor(RING_TIMEOUT_MS / 1000)) * 100;
  const callTypeIcon = incomingCall.type === 'voice' ? '📞' : '📹';

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-[#020808]/90 backdrop-blur-2xl">
      <video ref={videoRef} className="hidden" />

      {/* Animated ring pulses */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,184,166,0.1),transparent_70%)]" />
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="absolute rounded-full border border-teal-500/20"
            style={{
              width: `${i * 260}px`,
              height: `${i * 260}px`,
              animation: `ping ${1.2 + i * 0.4}s cubic-bezier(0, 0, 0.2, 1) infinite`,
              animationDelay: `${i * 0.3}s`,
            }}
          />
        ))}
      </div>

      {/* Modal card */}
      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-scale-in">
        
        {/* Ring countdown progress bar at top */}
        <div className="h-1.5 w-full bg-zinc-900 border-b border-white/5">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-sky-400 transition-all duration-1000 ease-linear shadow-[0_0_10px_rgba(45,212,191,0.5)]"
            style={{ width: `${ringProgress}%` }}
          />
        </div>

        <div className="p-8 text-center relative">
          {/* Background mesh */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,184,166,0.1),transparent_50%)] pointer-events-none" />

          {/* Call type badge */}
          <div className="relative inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-zinc-900/80 border border-white/10 shadow-inner mb-6 z-10">
            <span className="text-teal-400 drop-shadow-md">{callTypeIcon}</span>
            <span className="text-[10px] text-teal-100 font-black uppercase tracking-widest">{incomingCall.type || 'video'} Session</span>
            <div className="w-px h-3 bg-white/10" />
            <span className={`text-[10px] font-black uppercase tracking-widest ${secondsLeft <= 10 ? 'text-rose-400 animate-pulse' : 'text-zinc-400'}`}>
              {secondsLeft}s
            </span>
          </div>

          {/* Caller avatar */}
          <div className="relative inline-block mb-6 z-10">
            {/* Outer pulsing ring */}
            <div className="absolute inset-0 rounded-full border-2 border-teal-400/40 animate-ping" />
            <div className="w-28 h-28 rounded-full overflow-hidden border border-teal-500/40 shadow-[0_0_30px_rgba(20,184,166,0.3)] mx-auto relative backdrop-blur-md bg-zinc-900/50">
              {incomingCall.avatar
                ? <img src={incomingCall.avatar} className="w-full h-full object-cover" alt={incomingCall.name} />
                : (
                  <div className="w-full h-full bg-gradient-to-br from-teal-500/20 to-teal-900/40 flex items-center justify-center">
                    <span className="text-5xl font-black text-teal-300 drop-shadow-md">{incomingCall.name?.[0]?.toUpperCase()}</span>
                  </div>
                )
              }
            </div>
            {/* Call icon badge */}
            <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center border-4 border-zinc-950 text-lg shadow-[0_0_15px_rgba(20,184,166,0.5)]">
              {callTypeIcon}
            </div>
          </div>

          <p className="text-teal-400/70 text-[10px] font-black uppercase tracking-[0.2em] mb-2 animate-pulse relative z-10">Incoming Transmission</p>
          <h2 className="text-3xl font-black text-white mb-3 tracking-tight drop-shadow-md relative z-10">{incomingCall.name}</h2>

          {/* Caller disability */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900/60 border border-white/5 mb-3 shadow-inner relative z-10">
            <span className="text-lg">{callerInfo.icon}</span>
            <span className="text-[10px] text-zinc-300 font-black uppercase tracking-widest">{callerInfo.label}</span>
          </div>

          {/* Adaptive bridge label */}
          <div className="mb-8 relative z-10">
            <p className="text-[9px] font-black text-teal-500 uppercase tracking-widest bg-teal-500/10 inline-block px-3 py-1 rounded-full border border-teal-500/20">{bridgeLabel}</p>
          </div>

          {/* Blink hint for paralyzed users */}
          {isParalyzed && (
            <div className="mb-6 p-4 rounded-2xl bg-violet-500/10 border border-violet-500/30 text-violet-300 relative z-10 shadow-inner">
              <span className="block text-[10px] font-black uppercase tracking-widest mb-1 text-violet-400">👁 Blink Protocol Active</span>
              <p className="text-xs font-medium">Double-blink = Accept <span className="mx-2 opacity-50">·</span> Long blink = Decline</p>
              {blinkCount > 0 && (
                <div className="flex justify-center gap-2 mt-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all ${i < blinkCount ? 'bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.8)]' : 'bg-violet-900/50'}`} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-4 relative z-10">
            <button
              onClick={decline}
              className="flex flex-col items-center gap-2 py-5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-black text-[10px] uppercase tracking-widest hover:bg-rose-500/20 active:scale-95 transition-all shadow-[0_0_15px_rgba(244,63,94,0.1)] group"
            >
              <span className="text-3xl group-hover:scale-110 transition-transform">📵</span>
              Decline
            </button>
            <button
              onClick={accept}
              className="flex flex-col items-center gap-2 py-5 rounded-2xl bg-teal-500/15 border border-teal-500/40 text-teal-300 font-black text-[10px] uppercase tracking-widest hover:bg-teal-500/25 active:scale-95 transition-all shadow-[0_0_20px_rgba(20,184,166,0.15)] group"
            >
              <span className="text-3xl group-hover:scale-110 transition-transform">{callTypeIcon}</span>
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}