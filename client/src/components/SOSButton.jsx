// client/src/components/SOSButton.jsx
import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import toast from 'react-hot-toast';

const EMERGENCY_TYPES = [
  { id: 'medical', label: 'Medical', emoji: '🏥' },
  { id: 'fall', label: 'Fall', emoji: '⬇' },
  { id: 'breathing', label: 'Breathing', emoji: '😮‍💨' },
  { id: 'fire', label: 'Fire', emoji: '🔥' },
  { id: 'pain', label: 'Pain', emoji: '😣' },
  { id: 'help', label: 'Need Help', emoji: '🆘' },
];

export default function SOSButton() {
  const { user } = useAuthStore();
  const [phase, setPhase] = useState('idle'); // idle | confirm | type | sent
  const [selectedType, setSelectedType] = useState(null);
  const [countdown, setCountdown] = useState(3);
  const [geoPermission, setGeoPermission] = useState('prompt'); // prompt | granted | denied
  const countdownRef = useRef(null);

  useEffect(() => {
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(status => {
        setGeoPermission(status.state);
        status.onchange = () => setGeoPermission(status.state);
      });
    }
  }, []);

  // 3-second confirmation countdown
  useEffect(() => {
    if (phase === 'confirm') {
      setCountdown(3);
      countdownRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(countdownRef.current);
            setPhase('type');
            return 3;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => clearInterval(countdownRef.current);
  }, [phase]);

  const triggerSOS = () => setPhase('confirm');

  const cancelSOS = () => {
    clearInterval(countdownRef.current);
    setPhase('idle');
  };

  const fireAlert = async (emergencyType, silent = false) => {
    setPhase('sent');

    // Get GPS
    let gps = null;
    if (navigator.geolocation) {
      await new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
          pos => { gps = { lat: pos.coords.latitude, lng: pos.coords.longitude }; resolve(); },
          () => resolve(), { timeout: 3000 }
        );
      });
    }

    const battery = navigator?.getBattery
      ? Math.round((await navigator.getBattery()).level * 100)
      : null;

    // Fire via socket
    const socket = getSocket();
    socket?.emit('sos:trigger', { emergencyType, gps, battery, silent });

    // Auto-call first helper
    if (user?.helpers?.length) {
      try {
        const res = await api.post('/rooms/create', { type: '1-1' });
        socket?.emit('call:initiate', {
          recipientId: user.helpers[0]._id || user.helpers[0],
          roomCode: res.data.roomCode,
          callType: 'sos',
        });
      } catch { }
    }

    if (!silent) {
      toast.error('🚨 SOS Alert sent to all helpers!', { duration: 5000 });
    }

    setTimeout(() => setPhase('idle'), 3000);
  };

  if (phase === 'idle') return (
    <button onClick={triggerSOS}
      className="fixed bottom-6 right-6 z-50 btn-sos rounded-2xl px-5 py-3 text-sm font-bold
                   flex items-center gap-2 shadow-glow-rose">
      🚨 SOS
    </button>
  );

  if (phase === 'confirm') return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-6 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm card border-accent-rose/40 p-6 animate-slide-up">
        <div className="text-center mb-4">
          <div className="text-5xl mb-2">🚨</div>
          <h3 className="font-display text-xl font-semibold text-accent-rose">Send SOS Alert?</h3>
          <p className="text-text-secondary text-sm mt-1">
            All linked helpers will be alerted immediately
          </p>
        </div>

        {/* Countdown */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-full border-4 border-accent-rose flex items-center justify-center">
            <span className="font-display text-2xl font-bold text-accent-rose">{countdown}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-text-secondary text-sm">Auto-sending in {countdown}s</span>
            {geoPermission === 'denied' && (
              <span className="text-[10px] text-accent-amber">⚠️ Location disabled</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={cancelSOS}
            className="btn-secondary py-3 text-sm">
            Cancel
          </button>
          <button onClick={() => { clearInterval(countdownRef.current); setPhase('type'); }}
            className="btn-danger py-3 text-sm font-bold">
            Send Now →
          </button>
        </div>

        {/* Silent mode */}
        <button onClick={() => { clearInterval(countdownRef.current); fireAlert('help', true); }}
          className="w-full mt-3 py-2.5 text-xs text-text-muted hover:text-text-secondary transition-all">
          🔕 Send silently (no screen change)
        </button>
      </div>
    </div>
  );

  if (phase === 'type') return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-6 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm card border-accent-rose/40 p-6 animate-slide-up">
        <h3 className="font-display text-lg font-semibold text-accent-rose mb-4">What's happening?</h3>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {EMERGENCY_TYPES.map(t => (
            <button key={t.id} onClick={() => setSelectedType(t.id)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs transition-all
                           ${selectedType === t.id
                  ? 'bg-accent-rose/15 border-accent-rose/40 text-accent-rose'
                  : 'bg-dark-800 border-dark-600 text-text-secondary hover:border-dark-500'}`}>
              <span className="text-2xl">{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <button onClick={() => fireAlert(selectedType || 'help')}
          className="btn-danger w-full py-3.5 font-bold text-sm">
          🚨 Send Alert Now
        </button>
      </div>
    </div>
  );

  if (phase === 'sent') return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3
                     px-5 py-3 rounded-2xl bg-accent-rose/20 border border-accent-rose/40
                     text-accent-rose font-semibold text-sm animate-scale-in">
      <span className="w-4 h-4 border-2 border-accent-rose/40 border-t-accent-rose rounded-full animate-spin" />
      Alerting helpers...
    </div>
  );

  return null;
}