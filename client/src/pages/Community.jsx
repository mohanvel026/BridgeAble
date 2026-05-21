// client/src/pages/Community.jsx
import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const ROOMS = [
  { id: 'health', name: 'Health Tips', icon: '🏥', desc: 'Medical advice and wellness' },
  { id: 'daily', name: 'Daily Life', icon: '☀️', desc: 'Everyday tips and stories' },
  { id: 'sports', name: 'Sports', icon: '⚽', desc: 'Games and sports discussion' },
  { id: 'movies', name: 'Movies', icon: '🎬', desc: 'Films and entertainment' },
  { id: 'career', name: 'Career', icon: '💼', desc: 'Jobs and professional advice' },
  { id: 'general', name: 'General', icon: '💬', desc: 'Open chat for everything' },
];

const SYMBOL_SHORTCUTS = [
  { emoji: '👍', text: 'Good' }, { emoji: '❤️', text: 'Love' },
  { emoji: '😊', text: 'Happy' }, { emoji: '🙏', text: 'Thanks' },
  { emoji: '👋', text: 'Hello' }, { emoji: '✅', text: 'Yes' },
  { emoji: '❌', text: 'No' }, { emoji: '🆘', text: 'Help' },
];

const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '🎉'];

export default function Community() {
  const { user } = useAuthStore();
  const [activeRoom, setActiveRoom] = useState('general');
  const [messages, setMessages] = useState({});   // { roomId: [msgs] }
  const [onlineCounts, setOnlineCounts] = useState({});
  const [input, setInput] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(user?.disabilityType === 'blind' || user?.disabilityType === 'paralyzed');
  const [reactions, setReactions] = useState({});  // { msgIndex: { emoji: count } }
  const [reportedMsgs, setReportedMsgs] = useState(new Set());
  const bottomRef = useRef(null);
  const socket = getSocket();

  useEffect(() => {
    if (!socket) return;
    // Join all rooms to receive online counts
    ROOMS.forEach(r => socket.emit('community:join', { roomId: r.id }));
    socket.on('community:message', handleIncoming);
    socket.on('community:online', ({ roomId, count }) => setOnlineCounts(p => ({ ...p, [roomId]: count })));
    socket.on('community:reaction', handleReaction);

    return () => {
      socket.off('community:message');
      socket.off('community:online');
      socket.off('community:reaction');
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages[activeRoom]]);

  const handleIncoming = ({ roomId, message }) => {
    setMessages(p => ({
      ...p,
      [roomId]: [...(p[roomId] || []).slice(-100), message],
    }));
    // TTS for blind/paralyzed
    if (ttsEnabled && roomId === activeRoom && message.senderId !== user._id) {
      const utt = new SpeechSynthesisUtterance(`${message.senderName} says: ${message.text}`);
      utt.rate = user.preferences?.ttsSpeed || 1.0;
      window.speechSynthesis.speak(utt);
    }
  };

  const handleReaction = ({ roomId, msgIndex, emoji }) => {
    setReactions(p => {
      const key = `${roomId}-${msgIndex}`;
      const curr = p[key] || {};
      return { ...p, [key]: { ...curr, [emoji]: (curr[emoji] || 0) + 1 } };
    });
  };

  const sendMessage = (text) => {
    if (!text.trim() || !socket) return;
    const message = {
      roomId: activeRoom,
      text: text.trim(),
      senderId: user._id,
      senderName: user.preferences?.anonymousCommunity ? 'Anonymous' : user.name,
      senderDisability: user.disabilityType,
      inputMode: user.inputMode,
      timestamp: new Date(),
    };
    socket.emit('community:message', message);
    // Optimistic add
    setMessages(p => ({
      ...p,
      [activeRoom]: [...(p[activeRoom] || []), { ...message, isOwn: true }],
    }));
    setInput('');
  };

  const sendReaction = (msgIndex, emoji) => {
    socket?.emit('community:reaction', { roomId: activeRoom, msgIndex, emoji });
  };

  const reportMessage = (msgIndex) => {
    setReportedMsgs(p => new Set([...p, `${activeRoom}-${msgIndex}`]));
    toast.success('Message reported — thank you');
  };

  const [searchQuery, setSearchQuery] = useState('');

  const currentMessages = (messages[activeRoom] || []).filter(msg => 
    !searchQuery.trim() || msg.text.toLowerCase().includes(searchQuery.toLowerCase()) || msg.senderName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const disabilityColor = {
    deaf: 'text-teal-400 border-teal-500/30 bg-teal-500/10', 
    paralyzed: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
    speech: 'text-amber-400 border-amber-500/30 bg-amber-500/10', 
    blind: 'text-rose-400 border-rose-500/30 bg-rose-500/10', 
    normal: 'text-zinc-300 border-zinc-500/30 bg-zinc-500/10',
  };

  return (
    <div className="min-h-screen bg-[#020808] bg-[radial-gradient(circle_at_20%_30%,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans selection:bg-teal-500/30 selection:text-teal-200 flex flex-col">
      <Navbar />

      <div className="flex-1 flex overflow-hidden max-w-[1400px] mx-auto w-full p-4 md:p-6 gap-6">

        {/* Room list — sidebar */}
        <div className="w-64 flex-shrink-0 flex flex-col bg-zinc-900/40 border border-white/5 rounded-3xl p-4 backdrop-blur-xl shadow-2xl relative overflow-hidden">
          <div className="absolute -top-32 -left-32 w-64 h-64 bg-teal-500/10 blur-[80px] rounded-full pointer-events-none" />
          
          <h2 className="text-[10px] font-black text-zinc-500 tracking-[0.2em] uppercase mb-4 px-2">Network Hubs</h2>
          
          <div className="flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
            {ROOMS.map(room => (
              <button key={room.id}
                onClick={() => { setActiveRoom(room.id); setSearchQuery(''); }}
                className={`w-full text-left px-4 py-3 rounded-2xl transition-all duration-300 flex items-center justify-between group relative overflow-hidden
                  ${activeRoom === room.id
                    ? 'bg-teal-500/15 border-teal-500/30 text-teal-300 shadow-inner'
                    : 'bg-transparent border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
                
                {activeRoom === room.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-400 rounded-r-full shadow-[0_0_10px_rgba(45,212,191,0.5)]" />}
                
                <div className="flex items-center gap-3 relative z-10">
                  <span className={`text-xl transition-transform duration-300 ${activeRoom === room.id ? 'scale-110' : 'group-hover:scale-110'}`}>{room.icon}</span>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold tracking-wide">{room.name}</span>
                    <span className="text-[10px] text-zinc-500 hidden md:block truncate max-w-[120px]">{room.desc}</span>
                  </div>
                </div>
                {onlineCounts[room.id] > 0 && (
                  <div className="flex items-center gap-1.5 relative z-10 bg-zinc-950/50 px-2 py-1 rounded-full border border-white/5">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_5px_rgba(45,212,191,0.8)]" />
                    <span className="text-[10px] font-mono font-bold text-teal-400">{onlineCounts[room.id]}</span>
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-white/5 px-2 relative z-10">
            <label className="flex items-center justify-between cursor-pointer group p-2 rounded-xl hover:bg-white/5 transition-all">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-zinc-300 group-hover:text-white transition-colors">Screen Reader TTS</span>
                <span className="text-[10px] text-zinc-600">Auto-speak incoming texts</span>
              </div>
              <div onClick={() => setTtsEnabled(p => !p)}
                className={`w-10 h-5 rounded-full border-2 transition-all relative shadow-inner
                  ${ttsEnabled ? 'bg-teal-500 border-teal-500' : 'bg-zinc-800 border-zinc-700'}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-md
                  ${ttsEnabled ? 'left-5' : 'left-1'}`} />
              </div>
            </label>
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col bg-zinc-900/40 border border-white/5 rounded-3xl backdrop-blur-xl shadow-2xl relative overflow-hidden">
          
          {/* Room header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-zinc-950/30">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500/20 to-zinc-800 border border-teal-500/20 flex items-center justify-center text-2xl shadow-lg">
                {ROOMS.find(r => r.id === activeRoom)?.icon}
              </div>
              <div>
                <h1 className="font-black text-xl text-white tracking-wide">{ROOMS.find(r => r.id === activeRoom)?.name}</h1>
                <p className="text-xs text-zinc-400 font-medium">{ROOMS.find(r => r.id === activeRoom)?.desc}</p>
              </div>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-500">🔍</span>
              <input 
                type="text" 
                placeholder="Search transcript..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-zinc-950 border border-white/10 text-white text-xs rounded-xl pl-9 pr-4 py-2 w-48 focus:outline-none focus:border-teal-500/50 transition-all"
              />
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 custom-scrollbar">
            {messages[activeRoom]?.length === 0 && !searchQuery ? (
              <div className="h-full flex flex-col items-center justify-center text-center animate-fade-in opacity-60">
                <div className="w-24 h-24 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center text-4xl mb-6 shadow-2xl">
                  {ROOMS.find(r => r.id === activeRoom)?.icon}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">The room is quiet</h3>
                <p className="text-sm text-zinc-500 max-w-xs">Be the first to say something or use the quick-reply accessibility tokens below.</p>
              </div>
            ) : currentMessages.length === 0 && searchQuery ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                <p className="text-4xl mb-4">🔍</p>
                <p className="text-sm text-zinc-500">No messages found matching "{searchQuery}"</p>
              </div>
            ) : (
              currentMessages.map((msg, i) => {
                const isOwn = msg.isOwn || msg.senderId === user._id;
                const reactionKey = `${activeRoom}-${i}`;
                const msgReactions = reactions[reactionKey] || {};
                const isReported = reportedMsgs.has(reactionKey);

                if (isReported) return (
                  <div key={i} className="text-xs font-mono text-zinc-600/50 italic text-center py-2 bg-zinc-950/30 rounded-lg border border-white/5">
                    [ Content obscured due to community flags ]
                  </div>
                );

                return (
                  <div key={i} className={`group flex gap-4 animate-fade-in ${isOwn ? 'flex-row-reverse' : ''}`}>
                    {/* Avatar */}
                    {!isOwn && (
                      <div className={`w-10 h-10 rounded-2xl flex-shrink-0 flex flex-col items-center justify-center border shadow-lg ${disabilityColor[msg.senderDisability] || 'text-white border-white/20 bg-white/5'}`}>
                        <span className="text-sm font-black">{msg.senderName?.[0]?.toUpperCase()}</span>
                      </div>
                    )}

                    <div className={`max-w-[75%] flex flex-col gap-1.5 ${isOwn ? 'items-end' : 'items-start'}`}>
                      {!isOwn && (
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-xs font-bold text-zinc-300">{msg.senderName}</span>
                          <span className={`text-[9px] font-mono font-bold tracking-widest uppercase px-1.5 py-0.5 rounded-full border ${disabilityColor[msg.senderDisability]}`}>
                            {msg.senderDisability}
                          </span>
                        </div>
                      )}
                      
                      <div className={`px-4 py-3 text-sm leading-relaxed shadow-xl
                        ${isOwn
                          ? 'bg-gradient-to-br from-teal-500/20 to-teal-900/40 border border-teal-500/30 text-white rounded-2xl rounded-tr-sm'
                          : 'bg-zinc-950/80 border border-white/10 text-zinc-200 rounded-2xl rounded-tl-sm'}`}>
                        {msg.text}
                      </div>

                      {/* Reactions & Actions */}
                      <div className={`flex items-center gap-1.5 flex-wrap ${isOwn ? 'flex-row-reverse' : ''}`}>
                        {Object.entries(msgReactions).map(([emoji, count]) => (
                          <button key={emoji} onClick={() => sendReaction(i, emoji)}
                            className="flex items-center gap-1 px-2 py-1 rounded-full bg-zinc-900 border border-white/5 hover:border-teal-500/30 transition-all text-[11px]">
                            <span>{emoji}</span>
                            <span className="font-bold text-zinc-400">{count}</span>
                          </button>
                        ))}

                        <div className={`opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                          <div className="flex bg-zinc-900 border border-white/5 rounded-full p-0.5 shadow-lg">
                            {REACTIONS.map(emoji => (
                              <button key={emoji} onClick={() => sendReaction(i, emoji)}
                                className="w-7 h-7 text-sm rounded-full hover:bg-zinc-800 flex items-center justify-center transition-all hover:scale-110">
                                {emoji}
                              </button>
                            ))}
                          </div>
                          {!isOwn && (
                            <button onClick={() => reportMessage(i)} title="Report this message"
                              className="w-8 h-8 text-[11px] rounded-full bg-zinc-900 border border-white/5 hover:bg-rose-500/20 hover:border-rose-500/40 hover:text-rose-400 flex items-center justify-center transition-all text-zinc-600">
                              🚩
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} className="h-1" />
          </div>

          {/* Input area */}
          <div className="p-4 border-t border-white/5 bg-zinc-950/50 space-y-3">
            {/* Symbol shortcuts for speech-impaired */}
            {user?.disabilityType === 'speech' && (
              <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                {SYMBOL_SHORTCUTS.map(s => (
                  <button key={s.text} onClick={() => sendMessage(s.text)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/5 text-xs font-bold text-zinc-300 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-400 transition-all shadow-sm active:scale-95">
                    <span className="text-sm">{s.emoji}</span> {s.text}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <input 
                className="flex-1 bg-zinc-900/80 border border-white/10 text-white rounded-xl px-4 py-3.5 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/50 transition-all shadow-inner text-sm"
                placeholder={`Type a message to #${ROOMS.find(r => r.id === activeRoom)?.name}... (Press Enter to send)`}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }} 
              />
              <button onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="px-6 py-3.5 bg-teal-500 hover:bg-teal-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-teal-950 font-black text-sm tracking-wide rounded-xl transition-all shadow-lg shadow-teal-500/25 active:scale-95 disabled:shadow-none disabled:active:scale-100 flex items-center gap-2">
                <span>Send</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"></path><path d="M22 2l-7 20-4-9-9-4 20-7z"></path></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}