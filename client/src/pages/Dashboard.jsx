// client/src/pages/Dashboard.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import { useSocketStore } from '../store/stores';
import { createSocket } from '../lib/socket';
import api from '../lib/api';
import Navbar from '../components/Navbar';
import InputModeSwitcher from '../components/InputModeSwitcher';
import QuickPhrases from '../components/QuickPhrases';

const DISABILITY_CONFIG = {
  deaf: {
    color: 'sky',
    icon: '👋',
    greeting: 'Ready to sign?',
    buttons: [
      { label: 'Call Helper', sublabel: 'Tap to start video call', icon: '📹', action: 'call-helper', color: 'sky' },
      { label: 'Connect', sublabel: 'Find someone to talk to', icon: '🌐', action: 'connect', color: 'teal' },
      { label: 'Send Message', sublabel: 'Send without calling', icon: '💬', action: 'send', color: 'violet' },
    ],
  },
  paralyzed: {
    color: 'violet',
    icon: '👁',
    greeting: 'Ready to blink?',
    buttons: [
      { label: 'CALL HELPER', sublabel: 'Double blink to call', icon: '📹', action: 'call-helper', color: 'violet', giant: true },
      { label: 'CONNECT', sublabel: 'Blink to find others', icon: '🌐', action: 'connect', color: 'sky', giant: true },
      { label: 'SEND', sublabel: 'Blink to message', icon: '💬', action: 'send', color: 'teal', giant: true },
    ],
  },
  speech: {
    color: 'amber',
    icon: '🗂',
    greeting: 'Ready to communicate?',
    buttons: [
      { label: 'Call Helper', sublabel: 'Start a call', icon: '📹', action: 'call-helper', color: 'amber' },
      { label: 'Connect', sublabel: 'Meet others', icon: '🌐', action: 'connect', color: 'teal' },
      { label: 'Send Symbols', sublabel: 'Symbol board message', icon: '💬', action: 'send', color: 'sky' },
    ],
  },
  blind: {
    color: 'rose',
    icon: '🔊',
    greeting: 'Everything is read aloud',
    buttons: [
      { label: 'Call Helper', sublabel: 'Press to call caregiver', icon: '📹', action: 'call-helper', color: 'rose' },
      { label: 'Connect', sublabel: 'Press to find others', icon: '🌐', action: 'connect', color: 'teal' },
      { label: 'Send Message', sublabel: 'Press to send', icon: '💬', action: 'send', color: 'violet' },
    ],
  },
  normal: {
    color: 'teal',
    icon: '🤝',
    greeting: 'Welcome Back',
    buttons: [
      { label: 'Call Patient', sublabel: 'Start a care call', icon: '📹', action: 'call-helper', color: 'teal' },
      { label: 'Connect', sublabel: 'Meet other BridgeAble users', icon: '🌐', action: 'connect', color: 'sky' },
      { label: 'Helper Dashboard', sublabel: 'Monitor your patients', icon: '🏥', action: 'helper', color: 'violet' },
    ],
  },
};

const colorStyles = {
  sky: 'bg-sky-500/10 border-sky-500/30 hover:bg-sky-500/20 hover:border-sky-400 hover:shadow-[0_0_30px_rgba(14,165,233,0.3)] group-hover:scale-105',
  teal: 'bg-teal-500/10 border-teal-500/30 hover:bg-teal-500/20 hover:border-teal-400 hover:shadow-[0_0_30px_rgba(20,184,166,0.3)] group-hover:scale-105',
  violet: 'bg-violet-500/10 border-violet-500/30 hover:bg-violet-500/20 hover:border-violet-400 hover:shadow-[0_0_30px_rgba(139,92,246,0.3)] group-hover:scale-105',
  amber: 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-400 hover:shadow-[0_0_30px_rgba(245,158,11,0.3)] group-hover:scale-105',
  rose: 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-400 hover:shadow-[0_0_30px_rgba(244,63,94,0.3)] group-hover:scale-105',
};

const textColors = {
  sky: 'text-sky-400', teal: 'text-teal-400',
  violet: 'text-violet-400', amber: 'text-amber-400', rose: 'text-rose-400',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, token } = useAuthStore();
  const { setSocket, setIncomingCall, setUserOnline } = useSocketStore();

  const [helpers, setHelpers] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextReminder, setNextReminder] = useState(null);

  const config = DISABILITY_CONFIG[user?.disabilityType] || DISABILITY_CONFIG.normal;
  const isParalyzed = user?.disabilityType === 'paralyzed';
  const isBlind = user?.disabilityType === 'blind';

  // Init socket and fetch data
  useEffect(() => {
    const socket = createSocket(token);
    setSocket(socket);

    socket.on('call:incoming', (data) => setIncomingCall(data));
    socket.on('presence:update', ({ userId, isOnline }) => setUserOnline(userId, isOnline));
    socket.on('message:new', () => setUnreadCount(c => c + 1));
    socket.on('checkin:prompt', () => {
      // Show check-in prompt for paralyzed/blind users
    });

    fetchData();

    // Blind users — announce dashboard via TTS
    if (isBlind) {
      const msg = new SpeechSynthesisUtterance(`Dashboard loaded. ${config.greeting}. Press Call Helper to call your caregiver.`);
      window.speechSynthesis.speak(msg);
    }

    return () => {
      socket.off('call:incoming');
      socket.off('presence:update');
      socket.off('message:new');
    };
  }, []);

  const fetchData = async () => {
    try {
      const [meRes, inboxRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/messages/inbox'),
      ]);
      setHelpers(meRes.data.user.helpers || []);
      const unread = inboxRes.data.messages.filter(m => !m.isRead).length;
      setUnreadCount(unread);
    } catch { }
  };

  const handleAction = async (action) => {
    if (action === 'call-helper') {
      if (!helpers.length) { navigate('/profile'); return; }
      // Create room and call first helper
      const res = await api.post('/rooms/create', { type: '1-1' });
      const { getSocket } = await import('../lib/socket');
      const socket = getSocket();
      socket.emit('call:initiate', { recipientId: helpers[0]._id, roomCode: res.data.roomCode });
      navigate(`/call/room/${res.data.roomCode}`);
    } else if (action === 'connect') navigate('/connect');
    else if (action === 'send') navigate('/send');
    else if (action === 'helper') navigate('/helper/dashboard');
  };

  return (
    <div className="min-h-screen bg-[#020808] bg-[radial-gradient(ellipse_at_top_right,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans selection:bg-teal-500/30 selection:text-teal-200">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 py-8 lg:py-12">
        {/* Greeting Section */}
        <div className="mb-10 animate-fade-in relative z-50">
          <div className="absolute top-0 right-10 w-64 h-64 bg-teal-500/10 blur-[80px] rounded-full pointer-events-none" />
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-50">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-inner border
                ${config.color === 'sky' ? 'bg-sky-500/20 border-sky-500/40 text-sky-400' :
                  config.color === 'violet' ? 'bg-violet-500/20 border-violet-500/40 text-violet-400' :
                  config.color === 'amber' ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' :
                  config.color === 'rose' ? 'bg-rose-500/20 border-rose-500/40 text-rose-400' :
                  'bg-teal-500/20 border-teal-500/40 text-teal-400'}`}>
                {config.icon}
              </div>
              <div>
                <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-2 drop-shadow-md">
                  {config.greeting}, <span className={textColors[config.color]}>{user?.name?.split(' ')[0]}</span>
                </h1>
                <p className="text-zinc-400 text-sm font-medium uppercase tracking-widest">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </p>
              </div>
            </div>
            
            {/* Mode indicator */}
            <div className="bg-zinc-900/60 backdrop-blur-md border border-white/10 rounded-2xl p-2 shadow-xl">
              <InputModeSwitcher compact />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          <div className="lg:col-span-8 flex flex-col gap-8">
            {/* Main action buttons */}
            <div className={`grid gap-6 animate-slide-up
                              ${isParalyzed ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
              {config.buttons.map((btn, i) => (
                <button key={i} onClick={() => handleAction(btn.action)}
                  className={`group relative overflow-hidden rounded-[2rem] border-0 text-left transition-all duration-500 shadow-[0_10px_40px_rgba(0,0,0,0.5)] hover:shadow-[0_20px_60px_rgba(0,0,0,0.8)] hover:-translate-y-2 active:scale-95
                               ${isParalyzed ? 'p-10 min-h-[250px]' : 'p-8 min-h-[200px]'}
                               ${i === 2 && !isParalyzed ? 'sm:col-span-2' : ''}`}
                  style={{ animationDelay: `${i * 100}ms` }}>
                  
                  {/* Glass Background layers */}
                  <div className="absolute inset-0 bg-zinc-900/40 backdrop-blur-3xl" />
                  <div className={`absolute inset-0 opacity-20 group-hover:opacity-40 transition-opacity duration-500
                    ${btn.color === 'sky' ? 'bg-gradient-to-br from-sky-500 to-transparent' :
                      btn.color === 'violet' ? 'bg-gradient-to-br from-violet-500 to-transparent' :
                      btn.color === 'amber' ? 'bg-gradient-to-br from-amber-500 to-transparent' :
                      btn.color === 'rose' ? 'bg-gradient-to-br from-rose-500 to-transparent' : 'bg-gradient-to-br from-teal-500 to-transparent'}`} />
                  
                  {/* Glowing Border */}
                  <div className={`absolute inset-0 rounded-[2rem] border-2 border-white/5 group-hover:border-white/20 transition-colors z-10`} />

                  {/* Giant ambient glow orb */}
                  <div className={`absolute -bottom-10 -right-10 w-48 h-48 blur-[50px] rounded-full transition-all duration-700 opacity-40 group-hover:opacity-100 group-hover:scale-150
                    ${btn.color === 'sky' ? 'bg-sky-500/40' :
                      btn.color === 'violet' ? 'bg-violet-500/40' :
                      btn.color === 'amber' ? 'bg-amber-500/40' :
                      btn.color === 'rose' ? 'bg-rose-500/40' : 'bg-teal-500/40'}`} />

                  <div className="relative z-20 flex flex-col h-full justify-between">
                    <span className={`${isParalyzed ? 'text-[5rem] mb-6' : 'text-5xl mb-4'} block drop-shadow-2xl transition-transform duration-500 group-hover:-translate-y-3 group-hover:scale-110`}>{btn.icon}</span>
                    <div>
                      <h3 className={`font-black tracking-tight ${isParalyzed ? 'text-4xl md:text-5xl' : 'text-2xl'} mb-2 ${textColors[btn.color]} drop-shadow-md`}>
                        {btn.label}
                      </h3>
                      <p className={`font-bold text-white/60 ${isParalyzed ? 'text-lg' : 'text-sm'} uppercase tracking-widest`}>
                        {btn.sublabel}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Quick phrases */}
            <div className="bg-zinc-900/60 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-6 lg:p-8 shadow-2xl relative overflow-hidden animate-slide-up" style={{ animationDelay: '300ms' }}>
              <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 blur-[80px] rounded-full pointer-events-none" />
              <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.8)]" />
                Quick Communication
              </h2>
              <div className="relative z-10">
                <QuickPhrases compact />
              </div>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="lg:col-span-4 flex flex-col gap-6 animate-slide-up" style={{ animationDelay: '400ms' }}>
            
            {/* Helper online status */}
            <div className="bg-zinc-900/60 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-6 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-full h-32 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
              <div className="flex items-center justify-between mb-6 relative z-10">
                <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                  Network Status
                </h2>
                <span className="text-[10px] text-zinc-600 font-black uppercase tracking-widest bg-zinc-950 px-2 py-1 rounded-md border border-white/5">Live</span>
              </div>
              
              {helpers.length > 0 ? (
                <div className="space-y-3 relative z-10">
                  {helpers.map(h => (
                    <div key={h._id} className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-950/80 border border-white/5 shadow-lg hover:border-white/20 transition-all group hover:-translate-y-1">
                      <div className="relative">
                        {h.avatar
                          ? <img src={h.avatar} className="w-14 h-14 rounded-xl object-cover shadow-[0_0_15px_rgba(0,0,0,0.5)] border border-white/10 group-hover:border-teal-500/50 transition-colors" alt={h.name} />
                          : <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-teal-500/20 to-zinc-800 border border-teal-500/20 flex items-center justify-center text-white font-black shadow-[0_0_15px_rgba(0,0,0,0.5)] text-xl">{h.name[0]?.toUpperCase()}</div>
                        }
                        <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-zinc-950
                                          ${h.isOnline ? 'bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.8)] animate-pulse' : 'bg-zinc-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-black text-white text-base truncate group-hover:text-teal-300 transition-colors">{h.name}</p>
                        <p className={`text-[10px] font-black uppercase tracking-[0.2em] mt-1 ${h.isOnline ? 'text-teal-400' : 'text-zinc-500'}`}>
                          {h.isOnline ? 'Online Now' : 'Offline'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10 relative z-10">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-white/5 flex items-center justify-center mb-4 border border-white/10">
                    <p className="text-3xl opacity-50">👥</p>
                  </div>
                  <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">No helpers connected</p>
                </div>
              )}
            </div>

            {/* Unread messages badge */}
            {unreadCount > 0 && (
              <button onClick={() => navigate('/send')}
                className="w-full p-6 rounded-3xl bg-teal-500/10 border border-teal-500/30 hover:bg-teal-500/20 hover:border-teal-400 transition-all shadow-lg shadow-teal-500/5 group text-left relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-teal-400/20 blur-2xl rounded-full" />
                <div className="flex items-start justify-between relative z-10">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-xl shadow-inner">
                      💬
                    </div>
                    <div>
                      <p className="font-black text-white">Unread Messages</p>
                      <p className="text-xs font-medium text-teal-400 mt-1">Check transmission log</p>
                    </div>
                  </div>
                  <span className="bg-teal-400 text-teal-950 font-black px-3 py-1 rounded-full text-sm shadow-[0_0_15px_rgba(45,212,191,0.5)]">
                    {unreadCount}
                  </span>
                </div>
              </button>
            )}

            {/* Next reminder card */}
            {nextReminder && (
              <div className="p-6 rounded-3xl bg-amber-500/10 border border-amber-500/30 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-400/10 blur-2xl rounded-full" />
                <div className="flex items-start gap-4 relative z-10">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xl shadow-inner">
                    💊
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1">Upcoming Protocol</p>
                    <p className="font-bold text-white">{nextReminder}</p>
                  </div>
                </div>
              </div>
            )}
            
          </div>
        </div>
      </main>
    </div>
  );
}