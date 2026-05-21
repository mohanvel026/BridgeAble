// client/src/components/call/TranscriptPanel.jsx
// Industry-grade real-time call transcript with search, filter, reactions & export

import { useEffect, useRef, useState, useMemo } from 'react';
import { Search, Copy, Download, Trash2, MessageSquare, Filter } from 'lucide-react';
import toast from 'react-hot-toast';

const MODE_ICON = { gesture: '👋', blink: '👁', symbol: '🗂', voice: '🎙', type: '⌨️' };
const MODE_COLOR = {
  gesture: '#a78bfa', blink: '#fb7185', symbol: '#fbbf24',
  voice: '#2dd4bf', type: '#2dd4bf',
};

function MessageBubble({ log, isMe, searchQuery }) {
  const [reacted, setReacted] = useState(null);
  const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const modeColor = MODE_COLOR[log.inputMode] || '#2dd4bf';
  const modeIcon  = MODE_ICON[log.inputMode] || '💬';

  // Highlight search matches
  const renderText = (text) => {
    if (!searchQuery.trim()) return text;
    const parts = text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase()
        ? <mark key={i} style={{ background: 'rgba(45,212,191,0.35)', color: '#fff', borderRadius: 3, padding: '0 2px' }}>{part}</mark>
        : part
    );
  };

  const REACTIONS = ['👍', '❤️', '😂', '🙏', '👏'];

  return (
    <div className={`flex gap-3 group animate-slide-up ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar dot */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold mt-1 shadow-inner relative"
        style={{ background: `${modeColor}15`, border: `1px solid ${modeColor}40`, color: modeColor, boxShadow: `0 0 10px ${modeColor}20` }}>
        {modeIcon}
      </div>

      <div className={`flex flex-col gap-1 max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
        {/* Sender label */}
        <div className="flex items-center gap-2 px-1.5">
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: modeColor }}>
            {isMe ? 'You' : log.senderName}
          </span>
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{time}</span>
        </div>

        {/* Bubble */}
        <div className="relative px-4 py-3 rounded-2xl text-sm font-medium leading-relaxed text-white/95 break-words backdrop-blur-md shadow-sm"
          style={{
            background: isMe ? `${modeColor}15` : 'rgba(255,255,255,0.05)',
            border: `1px solid ${isMe ? modeColor + '30' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: isMe ? '20px 4px 20px 20px' : '4px 20px 20px 20px',
            boxShadow: isMe ? `0 4px 15px -5px ${modeColor}20` : '0 4px 15px -5px rgba(0,0,0,0.3)'
          }}>
          {renderText(log.text)}

          {/* Reaction badge */}
          {reacted && (
            <div className="absolute -bottom-3 right-2 text-sm bg-zinc-900 border border-white/10 rounded-full px-2 py-0.5 shadow-lg animate-fade-in">
              {reacted}
            </div>
          )}
        </div>

        {/* Quick reactions (hover) */}
        <div className={`flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mt-1 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
          {REACTIONS.map(emoji => (
            <button key={emoji} onClick={() => setReacted(p => p === emoji ? null : emoji)}
              className={`text-sm px-1.5 py-1 rounded-xl transition-all ${reacted === emoji ? 'bg-teal-500/20 scale-110' : 'hover:bg-white/10 hover:scale-110 active:scale-95'}`}>
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TranscriptPanel({ transcript = [], colorMap = {}, onClear, myId }) {
  const [searchQuery, setSearchQuery]   = useState('');
  const [filterMode, setFilterMode]     = useState('all');
  const [filterSender, setFilterSender] = useState('all');
  const [showFilters, setShowFilters]   = useState(false);
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll only when user is near bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(nearBottom);
  };

  // Unique senders for filter
  const senders = useMemo(() => {
    const map = {};
    transcript.forEach(l => { if (l.senderId) map[l.senderId] = l.senderName; });
    return Object.entries(map);
  }, [transcript]);

  // Filtered messages
  const filtered = useMemo(() => {
    return transcript.filter(log => {
      const matchSearch = !searchQuery.trim() || log.text.toLowerCase().includes(searchQuery.toLowerCase());
      const matchMode   = filterMode === 'all' || log.inputMode === filterMode;
      const matchSender = filterSender === 'all' || log.senderId === filterSender;
      return matchSearch && matchMode && matchSender;
    });
  }, [transcript, searchQuery, filterMode, filterSender]);

  const handleExport = () => {
    if (!transcript.length) { toast.error('No messages to export'); return; }
    const lines = transcript.map(l => {
      const t = new Date(l.timestamp).toLocaleTimeString();
      return `[${t}] ${l.senderName} (${l.inputMode?.toUpperCase()}): ${l.text}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `BridgeAble_Transcript_${Date.now()}.txt`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Transcript exported!');
  };

  const handleCopy = () => {
    if (!transcript.length) { toast.error('Nothing to copy'); return; }
    const text = transcript.map(l => `${l.senderName}: ${l.text}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toast.success('Copied!')).catch(() => toast.error('Copy failed'));
  };

  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden border border-white/10 bg-zinc-950/80 backdrop-blur-xl shadow-2xl relative">
      <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-rose-500/5 pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0 relative z-10 bg-black/20">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20">
            <MessageSquare size={14} className="text-teal-400" />
          </div>
          <span className="text-xs font-black tracking-widest text-zinc-300 uppercase">Session Log</span>
          {transcript.length > 0 && (
            <span className="text-[10px] font-black bg-teal-500/15 text-teal-400 border border-teal-500/30 px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.2)]">
              {transcript.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowFilters(p => !p)} title="Filters"
            className={`p-2 rounded-xl transition-all ${showFilters ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30' : 'text-zinc-400 hover:text-white hover:bg-white/10 border border-transparent'}`}>
            <Filter size={14} />
          </button>
          <button onClick={handleCopy} title="Copy all" className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all border border-transparent">
            <Copy size={14} />
          </button>
          <button onClick={handleExport} title="Export .txt" className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all border border-transparent">
            <Download size={14} />
          </button>
          {onClear && (
            <button onClick={onClear} title="Clear" className="p-2 rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all border border-transparent hover:border-rose-500/30">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/5 flex-shrink-0 relative z-10 bg-black/10">
        <div className="relative group">
          <Search size={14} className="absolute left-3 top-2.5 text-zinc-500 group-focus-within:text-teal-400 transition-colors" />
          <input
            type="text" placeholder="Search messages…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full text-xs font-medium bg-black/40 border border-white/5 text-white rounded-xl pl-9 pr-8 py-2.5 outline-none focus:border-teal-500/40 focus:bg-black/60 focus:shadow-[0_0_15px_rgba(45,212,191,0.1)] transition-all placeholder-zinc-600"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 text-sm">✕</button>
          )}
        </div>
      </div>

      {/* Collapsible filters */}
      {showFilters && (
        <div className="px-3 py-3 border-b border-white/5 flex gap-3 flex-shrink-0 relative z-10 bg-black/20 animate-slide-down">
          <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
            className="flex-1 text-[11px] font-black uppercase tracking-widest bg-black/40 border border-white/10 text-zinc-400 rounded-xl px-3 py-2 outline-none focus:border-teal-500/40 focus:text-teal-400 transition-colors cursor-pointer">
            <option value="all">All Modes</option>
            {Object.keys(MODE_ICON).map(m => <option key={m} value={m}>{MODE_ICON[m]} {m}</option>)}
          </select>
          <select value={filterSender} onChange={e => setFilterSender(e.target.value)}
            className="flex-1 text-[11px] font-black uppercase tracking-widest bg-black/40 border border-white/10 text-zinc-400 rounded-xl px-3 py-2 outline-none focus:border-teal-500/40 focus:text-teal-400 transition-colors cursor-pointer">
            <option value="all">All Speakers</option>
            {senders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      )}

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0 relative z-10"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(45,212,191,0.2) transparent' }}>

        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center py-8">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-3">
              <MessageSquare size={20} className="text-zinc-600" />
            </div>
            <p className="text-xs font-black uppercase tracking-widest text-zinc-500">
              {searchQuery ? 'No Matches Found' : 'Session is Empty'}
            </p>
            {!searchQuery && (
              <p className="text-[10px] text-zinc-600 mt-2 font-medium">Messages will appear here in real-time</p>
            )}
          </div>
        ) : (
          filtered.map((log, i) => (
            <MessageBubble
              key={log.id || i}
              log={log}
              isMe={log.senderId?.toString() === myId?.toString()}
              searchQuery={searchQuery}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Auto-scroll nudge */}
      {!autoScroll && transcript.length > 0 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center z-20 pointer-events-none">
          <button
            onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
            className="pointer-events-auto px-4 py-2 text-[10px] font-black uppercase tracking-widest text-teal-300 bg-teal-500/20 border border-teal-500/40 rounded-full shadow-[0_0_15px_rgba(45,212,191,0.2)] transition-all hover:bg-teal-500/30 hover:scale-105 active:scale-95 flex items-center gap-2 backdrop-blur-md">
            <span>↓</span> Jump to latest
          </button>
        </div>
      )}
    </div>
  );
}