// client/src/pages/HelperDashboard.jsx
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const TASK_CATEGORIES = ['routine', 'meal', 'physio', 'med', 'other'];
const QUICK_RESPONSES = ['Coming soon', 'Medicine ready', 'Called doctor', 'Rest now', 'On my way', 'Call me'];

const priorityMap = { sos: 0, emergency: 1, pain: 2, need: 3, emotion: 4, 'yes-no': 5, custom: 6 };

export default function HelperDashboard() {
  const { user, token } = useAuthStore();
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [messages, setMessages] = useState({});
  const [tasks, setTasks] = useState({});
  const [activePatient, setActivePatient] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState({});
  const alarmRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    fetchPatients();
    setupSocket();
    return () => {
      const s = getSocket();
      if (s) { s.off('message:new'); s.off('sos:alert'); s.off('medicine:confirmed'); s.off('presence:update'); }
    };
  }, []);

  const fetchPatients = async () => {
    try {
      const [authRes, msgRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/messages/inbox')
      ]);
      
      const pts = authRes.data.user.patients || [];
      setPatients(pts);
      if (pts.length) setActivePatient(pts[0]._id);

      // Group messages by patient
      const allMsgs = msgRes.data.messages || [];
      const grouped = {};
      pts.forEach(p => grouped[p._id] = []);
      
      allMsgs.forEach(m => {
        const partnerId = (m.senderId._id || m.senderId) === authRes.data.user._id 
          ? (m.receiverId._id || m.receiverId) 
          : (m.senderId._id || m.senderId);
        if (grouped[partnerId]) grouped[partnerId].push(m);
      });
      // Oldest first for chat UI
      Object.keys(grouped).forEach(k => grouped[k].reverse());
      setMessages(grouped);

      for (const p of pts) {
        fetchPatientTasks(p._id);
      }
    } catch (e) { toast.error('Failed to load dashboard data'); }
    finally { setLoading(false); }
  };

  const fetchPatientTasks = async (patientId) => {
    try {
      // Placeholder for future task fetching
      setTasks(p => ({ ...p, [patientId]: [] }));
    } catch { }
  };

  useEffect(() => {
    if (activePatient && messages[activePatient]) {
      const unread = messages[activePatient].filter(m => !m.isRead && (m.receiverId._id || m.receiverId) === user._id);
      if (unread.length > 0) {
        unread.forEach(m => markAsRead(m._id, activePatient));
      }
    }
  }, [activePatient, messages, user._id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, activePatient]);

  const markAsRead = async (messageId, patientId) => {
    try {
      await api.patch(`/messages/${messageId}/read`);
      setMessages(prev => ({
        ...prev,
        [patientId]: prev[patientId].map(m => m._id === messageId ? { ...m, isRead: true } : m)
      }));
    } catch { }
  };

  const setupSocket = () => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('message:new', ({ message, sender }) => {
      const pid = (message.senderId._id || message.senderId) === user._id 
        ? (message.receiverId._id || message.receiverId) 
        : (sender._id || message.senderId);
        
      setMessages(p => ({ ...p, [pid]: [...(p[pid] || []), message] }));

      if (message.type === 'sos') {
        setPatients(p => {
          const idx = p.findIndex(pt => pt._id === pid);
          if (idx < 0) return p;
          const pt = { ...p[idx], hasSOS: true };
          return [pt, ...p.filter((_, i) => i !== idx)];
        });
        playAlarm();
        toast.error(`🚨 SOS ALERT: ${sender.name} requires immediate assistance!`, { duration: 15000, style: { background: '#ef4444', color: '#fff', fontWeight: 'bold' } });
      } else {
        toast.success(`New message from ${sender.name}`);
      }
    });

    socket.on('sos:alert', (data) => {
      toast.error(`🚨 Emergency: ${data.patientName || 'Your patient'} needs help — ${data.emergencyType || 'Please respond immediately'}`, { duration: 20000, style: { background: '#ef4444', color: '#fff', fontWeight: 'bold' } });
      playAlarm();
    });

    socket.on('medicine:confirmed', ({ patientName, medicineId }) => {
      toast.success(`✅ ${patientName} took their medication.`);
    });

    socket.on('presence:update', ({ userId, isOnline }) => {
      setPatients(p => p.map(pt => pt._id === userId ? { ...pt, isOnline } : pt));
    });

    socket.on('message:delivered', ({ messageId, receiverId }) => {
      setMessages(prev => {
        const pMsgs = prev[receiverId] || [];
        return { ...prev, [receiverId]: pMsgs.map(m => m._id === messageId ? { ...m, deliveredAt: new Date() } : m) };
      });
    });

    socket.on('message:read', ({ messageId, receiverId }) => {
      setMessages(prev => {
        const pMsgs = prev[receiverId] || [];
        return { ...prev, [receiverId]: pMsgs.map(m => m._id === messageId ? { ...m, isRead: true } : m) };
      });
    });

    socket.on('message:typing', ({ fromUserId, isTyping: typingStatus }) => {
      setIsTyping(p => ({ ...p, [fromUserId]: typingStatus }));
    });
  };

  const playAlarm = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.3;
      osc.start(); osc.stop(ctx.currentTime + 0.5);
    } catch { }
  };

  const callPatient = async (patientId) => {
    try {
      const res = await api.post('/rooms/create', { type: '1-1' });
      const socket = getSocket();
      socket?.emit('call:initiate', { recipientId: patientId, roomCode: res.data.roomCode });
      navigate(`/call/room/${res.data.roomCode}`);
    } catch { toast.error('Connection failed. Please retry.'); }
  };

  const sendReply = async (patientId, text) => {
    if (!text.trim()) return;
    const optimisticMsg = {
      _id: `temp-${Date.now()}`,
      senderId: user,
      receiverId: patientId,
      type: 'custom',
      content: { text },
      createdAt: new Date().toISOString(),
      isRead: false,
    };
    
    setMessages(p => ({ ...p, [patientId]: [...(p[patientId] || []), optimisticMsg] }));
    setReplyText('');
    
    const socket = getSocket();
    socket?.emit('message:typing', { receiverId: patientId, isTyping: false });

    try {
      const res = await api.post('/messages/send', { receiverId: patientId, type: 'custom', content: { text } });
      setMessages(p => ({
        ...p,
        [patientId]: p[patientId].map(m => m._id === optimisticMsg._id ? res.data.message : m)
      }));
    } catch { 
      toast.error('Failed to send reply. Try again.'); 
      setMessages(p => ({
        ...p,
        [patientId]: p[patientId].filter(m => m._id !== optimisticMsg._id)
      }));
    }
  };

  const handleTyping = (e) => {
    setReplyText(e.target.value);
    const socket = getSocket();
    if (socket && activePatient) {
      socket.emit('message:typing', { receiverId: activePatient, isTyping: e.target.value.length > 0 });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('message:typing', { receiverId: activePatient, isTyping: false });
      }, 3000);
    }
  };

  const getLastMessage = (patientId) => {
    const msgs = messages[patientId] || [];
    return msgs[msgs.length - 1];
  };

  const getUnreadCount = (patientId) => {
    return (messages[patientId] || []).filter(m => !m.isRead).length;
  };

  const activePatientData = patients.find(p => p._id === activePatient);
  const activeMessages = messages[activePatient] || [];
  const activeTasks = tasks[activePatient] || [];

  if (loading) return (
    <div className="min-h-screen bg-[#020808] text-white flex flex-col">
      <Navbar />
      <div className="flex-1 flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020808] bg-[radial-gradient(ellipse_at_bottom_left,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans selection:bg-teal-500/30 selection:text-teal-200">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8 lg:py-10">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-zinc-500 mb-3">
              Care Dashboard
            </h1>
            <p className="text-zinc-400 text-sm md:text-base">
              Monitoring <span className="font-bold text-white">{patients.length}</span> patient{patients.length !== 1 ? 's' : ''}.
            </p>
          </div>
          <button onClick={() => navigate('/helper/schedule')}
            className="px-6 py-3 bg-zinc-900/60 hover:bg-zinc-800 border border-white/10 text-white font-bold text-sm rounded-xl transition-all backdrop-blur-sm shadow-lg flex items-center gap-2">
            <span>💊</span> Medication Schedules
          </button>
        </div>

        {patients.length === 0 ? (
          <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-16 text-center backdrop-blur-md shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 blur-3xl rounded-full pointer-events-none" />
            <div className="text-6xl mb-6 relative z-10">👥</div>
            <h3 className="text-2xl font-black text-white mb-4 relative z-10">No Active Patients</h3>
            <p className="text-zinc-400 max-w-md mx-auto mb-6 relative z-10">
              Provide your registration email to a patient so they can authorize you as their primary caregiver in their settings.
            </p>
            <div className="inline-block px-4 py-2 rounded-xl bg-zinc-950 border border-white/10 font-mono text-teal-400 text-sm relative z-10 shadow-inner">
              {user?.email}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

            {/* Patient list — left column */}
            <div className="lg:col-span-4 space-y-4">
              <div className="flex items-center justify-between px-2 mb-2">
                <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Your Patients</h2>
                <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse shadow-[0_0_8px_rgba(20,184,166,0.8)]" />
              </div>
              
              <div className="space-y-3 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar">
                {patients.map(pt => {
                  const lastMsg = getLastMessage(pt._id);
                  const unread = getUnreadCount(pt._id);
                  const hasSOS = pt.hasSOS;

                  return (
                    <button key={pt._id} onClick={() => setActivePatient(pt._id)}
                      className={`w-full text-left p-5 rounded-3xl border transition-all duration-300 relative overflow-hidden group
                        ${activePatient === pt._id
                          ? 'bg-teal-500/15 border-teal-500/30 shadow-lg'
                          : hasSOS
                            ? 'bg-rose-500/20 border-rose-500/50 animate-pulse shadow-[0_0_20px_rgba(244,63,94,0.3)]'
                            : 'bg-zinc-900/40 border-white/5 hover:bg-white/5 hover:border-white/20'}`}>
                      
                      {activePatient === pt._id && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.8)]" />}
                      {hasSOS && <div className="absolute inset-0 bg-rose-500/10 blur-xl pointer-events-none" />}

                      <div className="flex items-start gap-4 relative z-10">
                        <div className="relative flex-shrink-0">
                          {pt.avatar
                            ? <img src={pt.avatar} className="w-12 h-12 rounded-2xl object-cover border border-white/10" alt={pt.name} />
                            : <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500/20 to-zinc-800 border border-teal-500/20 flex items-center justify-center text-white font-black text-lg">
                              {pt.name?.[0]?.toUpperCase()}
                            </div>
                          }
                          <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-zinc-900 shadow-sm
                            ${pt.isOnline ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]' : 'bg-zinc-600'}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <p className={`text-base font-bold truncate ${activePatient === pt._id ? 'text-teal-300' : 'text-white'}`}>{pt.name}</p>
                            {unread > 0 && (
                              <span className="w-5 h-5 rounded-full bg-teal-500 text-teal-950 text-[10px] font-black flex items-center justify-center shadow-lg animate-bounce">
                                {unread}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md border
                              ${pt.disabilityType === 'deaf' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' :
                                pt.disabilityType === 'paralyzed' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' :
                                pt.disabilityType === 'speech' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                              {pt.disabilityType}
                            </span>
                          </div>
                          
                          {lastMsg && (
                            <p className="text-xs text-zinc-400 truncate font-medium">
                              {lastMsg.type === 'pain' ? '😣 Pain reported' :
                               lastMsg.type === 'sos' ? '🚨 EMERGENCY TRIGGERED' :
                               lastMsg.type === 'need' ? `Requires: ${lastMsg.content?.item}` :
                               lastMsg.content?.text || lastMsg.type}
                            </p>
                          )}
                          {hasSOS && <p className="text-[10px] text-rose-400 font-black tracking-widest uppercase mt-2 animate-pulse">Needs immediate help</p>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Patient detail — right 2 columns */}
            {activePatientData && (
              <div className="lg:col-span-8 space-y-6">

                {/* Patient header */}
                <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/5 blur-[80px] rounded-full pointer-events-none" />
                  
                  <div className="flex items-center gap-5 relative z-10">
                    <div className="relative">
                      {activePatientData.avatar
                        ? <img src={activePatientData.avatar} className="w-16 h-16 rounded-2xl object-cover shadow-lg border border-white/10" alt={activePatientData.name} />
                        : <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500/20 to-zinc-800 border border-teal-500/30 flex items-center justify-center text-white font-black text-2xl shadow-lg">
                          {activePatientData.name?.[0]?.toUpperCase()}
                        </div>
                      }
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-white mb-1">{activePatientData.name}</h2>
                      <div className="flex items-center gap-3 text-xs font-bold text-zinc-400 uppercase tracking-wider">
                        <span>{activePatientData.disabilityType}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span className="text-teal-400">Primary: {activePatientData.inputMode}</span>
                      </div>
                    </div>
                  </div>
                  
                  <button onClick={() => callPatient(activePatient)}
                    className="w-full sm:w-auto px-6 py-3.5 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black tracking-wide rounded-xl transition-all shadow-lg shadow-teal-500/25 active:scale-95 flex items-center justify-center gap-2 relative z-10">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    <span>Video Call</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Messages from patient */}
                  <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl shadow-2xl flex flex-col h-[500px]">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-black text-white uppercase tracking-widest">Messages</h3>
                      <span className="text-xs text-zinc-500 font-mono">{activeMessages.length} total</span>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 custom-scrollbar">
                      {activeMessages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                          <p className="text-4xl mb-2">💬</p>
                          <p className="text-xs text-zinc-400 font-bold uppercase">No messages yet</p>
                        </div>
                      )}
                      {activeMessages.map((msg, i) => {
                        const isMine = (msg.senderId._id || msg.senderId) === user._id;
                        return (
                          <div key={msg._id || i} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`flex gap-3 max-w-[85%] ${isMine ? 'flex-row-reverse' : ''}`}>
                              {!isMine && (
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-inner flex-shrink-0 mt-auto
                                  ${msg.type === 'sos' ? 'bg-rose-500/20' : msg.type === 'pain' ? 'bg-amber-500/20' : 'bg-zinc-800'}`}>
                                  {msg.type === 'pain' ? '😣' : msg.type === 'sos' ? '🚨' :
                                    msg.type === 'emotion' ? '😊' : msg.type === 'need' ? '🙋' : '💬'}
                                </div>
                              )}
                              
                              <div className={`p-3.5 rounded-2xl ${isMine ? 'bg-teal-500/20 border border-teal-500/30 text-teal-50 rounded-br-sm' : 
                                msg.type === 'sos' ? 'bg-rose-500/10 border border-rose-500/30 rounded-bl-sm' : 
                                msg.type === 'pain' ? 'bg-amber-500/10 border border-amber-500/30 rounded-bl-sm' : 
                                'bg-zinc-900 border border-white/5 rounded-bl-sm'}`}>
                                
                                {!isMine && msg.type !== 'custom' && (
                                  <div className={`text-[10px] font-black uppercase tracking-widest mb-1
                                    ${msg.type === 'sos' ? 'text-rose-400' :
                                      msg.type === 'pain' ? 'text-amber-400' : 'text-teal-400'}`}>
                                    {msg.type === 'sos' ? 'Emergency' : msg.type === 'yes-no' ? 'Response' : msg.type}
                                  </div>
                                )}
                                
                                <p className="text-sm font-medium leading-relaxed">
                                  {msg.type === 'pain' ? <><span className="opacity-70">Loc:</span> {msg.content?.location} <br/><span className="opacity-70">Lvl:</span> {msg.content?.intensity}/10</> :
                                    msg.type === 'need' ? <><span className="opacity-70">Requires:</span> {msg.content?.item}</> :
                                      msg.type === 'emotion' ? <><span className="opacity-70">Status:</span> {msg.content?.emotion}</> :
                                        msg.type === 'sos' ? <span className="font-bold text-rose-300">CRITICAL: {msg.content?.emergencyType}</span> :
                                          msg.content?.text || JSON.stringify(msg.content)}
                                </p>
                                
                                <div className={`flex items-center gap-1.5 mt-1.5 text-[9px] font-mono font-bold ${isMine ? 'text-teal-500/70 justify-end' : 'text-zinc-500'}`}>
                                  <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  {isMine && (
                                    <span className="text-xs tracking-tighter ml-1">
                                      {msg.isRead ? <span className="text-teal-400">✓✓</span> : msg.deliveredAt ? '✓✓' : '✓'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {isTyping[activePatient] && (
                        <div className="flex justify-start">
                          <div className="flex gap-2 max-w-[85%] items-end">
                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm shadow-inner flex-shrink-0">💬</div>
                            <div className="bg-zinc-900 border border-white/5 rounded-2xl rounded-bl-sm p-4 flex gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay: '150ms'}} />
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{animationDelay: '300ms'}} />
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Quick reply */}
                    <div className="pt-4 border-t border-white/5">
                      <div className="flex gap-2 overflow-x-auto pb-3 custom-scrollbar">
                        {QUICK_RESPONSES.map(r => (
                          <button key={r} onClick={() => sendReply(activePatient, r)}
                            className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/10 text-xs font-bold text-zinc-300 hover:border-teal-500/50 hover:bg-teal-500/10 hover:text-teal-300 transition-all shadow-sm">
                            {r}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-3">
                        <input className="flex-1 bg-zinc-950 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-all text-sm shadow-inner"
                          placeholder="Type a reply..."
                          value={replyText}
                          onChange={handleTyping}
                          onKeyDown={e => e.key === 'Enter' && sendReply(activePatient, replyText)} />
                        <button onClick={() => sendReply(activePatient, replyText)} disabled={!replyText.trim()}
                          className="px-5 py-3 bg-white hover:bg-teal-400 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-600 font-black text-sm rounded-xl transition-all shadow-lg active:scale-95">
                          Send
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Kanban task board */}
                  <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl shadow-2xl h-[500px] flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-sm font-black text-white uppercase tracking-widest">Care Tasks</h3>
                      <button className="px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400 text-xs font-bold hover:bg-teal-500/20 transition-colors">+ Add Task</button>
                    </div>
                    
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 overflow-y-auto pr-1">
                      {['todo', 'done', 'skip'].map(status => (
                        <div key={status} className="flex flex-col gap-3">
                          <div className={`text-[10px] font-black tracking-widest uppercase px-3 py-1.5 rounded-lg text-center border
                            ${status === 'todo' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' :
                              status === 'done' ? 'bg-teal-500/10 text-teal-400 border-teal-500/20' :
                                'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                            {status === 'todo' ? 'Pending' : status === 'done' ? 'Complete' : 'Skipped'}
                          </div>
                          
                          <div className="flex-1 space-y-2">
                            {activeTasks.filter(t => t.status === status).map(task => (
                              <div key={task._id} className="p-3 rounded-xl bg-zinc-950/80 border border-white/5 text-xs text-zinc-300 font-medium shadow-sm hover:border-white/20 transition-colors cursor-pointer">
                                {task.title}
                              </div>
                            ))}
                            {activeTasks.filter(t => t.status === status).length === 0 && (
                              <div className="h-20 rounded-xl border-2 border-dashed border-white/5 flex items-center justify-center">
                                <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Empty</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
