import React, { useEffect, useRef, useState, useMemo, useCallback, memo } from 'react';
import { Search, Copy, Download, Trash2, MessageSquare, Filter, X, ArrowDown, Check, MoreVertical } from 'lucide-react';
import toast from 'react-hot-toast';

// --- Configuration & Constants ---
const UI_CONFIG = {
  debounceMs: 300,
  consecutiveThresholdMs: 60000, // 1 minute grouping
  scrollFrictionPx: 100, // Distance from bottom to trigger auto-scroll
};

const MODE_META = {
  gesture: { icon: '👋', color: '#a78bfa', label: 'Gesture' },
  blink:   { icon: '👁', color: '#fb7185', label: 'Blink' },
  symbol:  { icon: '🗂', color: '#fbbf24', label: 'Symbol' },
  voice:   { icon: '🎙', color: '#2dd4bf', label: 'Voice' },
  type:    { icon: '⌨️', color: '#38bdf8', label: 'Text' },
  default: { icon: '💬', color: '#94a3b8', label: 'Message' }
};

const REACTIONS = ['👍', '❤️', '😂', '🙏', '👏'];

// --- Utility Functions ---
const escapeRegExp = (str) => str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');

// Highly optimized formatters using Intl API
const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const isSameDay = (d1, d2) => {
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  return date1.getDate() === date2.getDate() && 
         date1.getMonth() === date2.getMonth() && 
         date1.getFullYear() === date2.getFullYear();
};

const getRelativeDayName = (timestamp) => {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return dateFormatter.format(date);
};

// --- Subcomponents ---

const DateDivider = memo(({ dateStr }) => (
  <div className="flex items-center justify-center my-6 sticky top-2 z-20">
    <div className="px-4 py-1.5 rounded-full bg-[#040404]/80 border border-white/10 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400 backdrop-blur-2xl shadow-[0_5px_15px_rgba(0,0,0,0.5)]">
      {dateStr}
    </div>
  </div>
));
DateDivider.displayName = 'DateDivider';

const MessageBubble = memo(({ log, isMe, searchQuery, isConsecutive }) => {
  const [reacted, setReacted] = useState(null);
  
  const timeStr = useMemo(() => timeFormatter.format(new Date(log.timestamp)), [log.timestamp]);
  const meta = MODE_META[log.inputMode] || MODE_META.default;

  const renderText = useCallback((text) => {
    if (!searchQuery?.trim()) return text;
    const safeQuery = escapeRegExp(searchQuery.trim());
    const parts = text.split(new RegExp(`(${safeQuery})`, 'gi'));
    
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="bg-teal-500/40 text-white rounded-[3px] px-1 shadow-[0_0_10px_rgba(45,212,191,0.5)] font-black">
          {part}
        </mark>
      ) : part
    );
  }, [searchQuery]);

  return (
    <div 
      className={`flex gap-3 group animate-slide-up px-2 -mx-2 rounded-xl transition-colors ${
        isMe ? 'flex-row-reverse' : 'flex-row'
      } ${isConsecutive ? 'mt-1' : 'mt-5'}`}
      role="article"
      aria-label={`Message from ${isMe ? 'You' : log.senderName} at ${timeStr}`}
    >
      {/* Avatar Space */}
      <div className="flex-shrink-0 w-8 flex justify-center select-none">
        {!isConsecutive && (
          <div 
            className="w-9 h-9 rounded-full flex items-center justify-center text-lg shadow-[0_5px_15px_rgba(0,0,0,0.5)] relative mt-1 border border-white/5 transition-transform group-hover:scale-110"
            style={{ 
              background: `linear-gradient(135deg, ${meta.color}30, #040404)`, 
              color: meta.color, 
            }}
            title={meta.label}
          >
            {meta.icon}
          </div>
        )}
      </div>

      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
        {/* Header */}
        {!isConsecutive && (
          <div className="flex items-baseline gap-2 px-1">
            <span className="text-[10px] font-black uppercase tracking-[0.15em] drop-shadow-md" style={{ color: meta.color }}>
              {isMe ? 'YOU' : log.senderName}
            </span>
            <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest tabular-nums">
              {timeStr}
            </span>
          </div>
        )}

        {/* Payload */}
        <div 
          className="relative px-5 py-3 text-sm font-medium leading-relaxed text-zinc-100 break-words shadow-[0_5px_15px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all duration-300"
          style={{
            background: isMe ? `linear-gradient(135deg, ${meta.color}20, ${meta.color}05)` : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isMe ? meta.color + '40' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: isMe 
              ? (isConsecutive ? '20px 6px 6px 20px' : '20px 6px 20px 20px') 
              : (isConsecutive ? '6px 20px 20px 6px' : '6px 20px 20px 20px'),
          }}
        >
          {renderText(log.text)}

          {/* Active Reaction */}
          {reacted && (
            <div className="absolute -bottom-3 right-2 text-sm bg-[#040404] border border-white/10 rounded-full px-2 py-0.5 shadow-[0_5px_15px_rgba(0,0,0,0.8)] animate-scale-in z-10 cursor-pointer hover:bg-zinc-900 transition-colors"
                 onClick={() => setReacted(null)}>
              {reacted}
            </div>
          )}
        </div>

        {/* Hover Actions */}
        <div className={`flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
          {REACTIONS.map(emoji => (
            <button 
              key={emoji} 
              onClick={() => setReacted(p => p === emoji ? null : emoji)}
              className={`text-sm px-1.5 py-1 rounded-lg transition-all duration-300 hover:scale-125 hover:-translate-y-1 focus:outline-none ${
                reacted === emoji ? 'scale-125 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]' : 'opacity-60 hover:opacity-100'
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';


// --- Main Component ---

export default function TranscriptPanel({ transcript = [], onClear, myId }) {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({ mode: 'all', sender: 'all' });
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  const viewportRef = useRef(null);
  const scrollAnchorRef = useRef(null);
  
  const [autoScroll, setAutoScroll] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  // 1. Debounced Search
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), UI_CONFIG.debounceMs);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // 2. Smart Auto-Scroll & Unread Tracking
  useEffect(() => {
    if (autoScroll && scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      setUnreadCount(0);
    } else if (!autoScroll && transcript.length > 0) {
      setUnreadCount(prev => prev + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript.length]); // Only trigger on new messages

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < UI_CONFIG.scrollFrictionPx;
    
    if (isNearBottom !== autoScroll) {
      setAutoScroll(isNearBottom);
      if (isNearBottom) setUnreadCount(0);
    }
  }, [autoScroll]);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    setUnreadCount(0);
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  // 3. Complex Data Pipeline: Filter -> Sort -> Group -> Inject Dividers
  const senders = useMemo(() => {
    const map = new Map();
    transcript.forEach(l => { if (l.senderId) map.set(l.senderId, l.senderName); });
    return Array.from(map.entries());
  }, [transcript]);

  const processedData = useMemo(() => {
    if (!transcript.length) return [];

    const filtered = transcript.filter(log => {
      const matchSearch = !searchQuery.trim() || log.text.toLowerCase().includes(searchQuery.toLowerCase());
      const matchMode = filters.mode === 'all' || log.inputMode === filters.mode;
      const matchSender = filters.sender === 'all' || String(log.senderId) === filters.sender;
      return matchSearch && matchMode && matchSender;
    });

    const result = [];
    let lastDate = null;

    filtered.forEach((log, index) => {
      const currentDay = getRelativeDayName(log.timestamp);
      
      if (currentDay !== lastDate) {
        result.push({ type: 'divider', id: `div-${log.timestamp}`, label: currentDay });
        lastDate = currentDay;
      }

      const prevLog = filtered[index - 1];
      const isConsecutive = prevLog && 
                            prevLog.senderId === log.senderId && 
                            (log.timestamp - prevLog.timestamp < UI_CONFIG.consecutiveThresholdMs);

      result.push({ type: 'message', data: log, isConsecutive });
    });

    return result;
  }, [transcript, searchQuery, filters]);

  // 4. Enterprise Export Logic
  const handleExport = useCallback(async () => {
    if (!transcript.length) return toast.error('No data to export');
    setIsExporting(true);
    
    try {
      const header = `=== BridgeAble Session Log ===\nGenerated: ${new Date().toLocaleString()}\nTotal Records: ${transcript.length}\n============================\n\n`;
      const body = transcript.map(l => {
        const t = new Date(l.timestamp).toISOString();
        return `[${t}] [Mode: ${l.inputMode || 'unknown'}] ${l.senderName}: ${l.text}`;
      }).join('\n');

      const blob = new Blob([header + body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Session_Transcript_${new Date().getTime()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Log exported successfully');
    } catch (err) {
      toast.error('Export failed');
    } finally {
      setIsExporting(false);
    }
  }, [transcript]);

  return (
    <div className="flex flex-col h-full rounded-[2rem] overflow-hidden bg-[#040404]/90 backdrop-blur-3xl border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8)] relative isolate font-sans">
      
      {/* Dynamic Background Glow based on active filter */}
      <div 
        className="absolute inset-0 opacity-10 pointer-events-none transition-colors duration-700 blur-[80px]" 
        style={{ 
          background: `radial-gradient(circle at top right, ${filters.mode === 'all' ? '#2dd4bf' : MODE_META[filters.mode]?.color || '#2dd4bf'}, transparent 60%)` 
        }} 
      />

      {/* --- HEADER --- */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-black/40 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 shadow-[0_0_15px_rgba(45,212,191,0.2)]">
            <MessageSquare size={16} />
          </div>
          <div>
            <h2 className="text-sm font-black tracking-widest uppercase text-zinc-100 leading-tight">Session Log</h2>
            <p className="text-[9px] font-bold text-teal-400 uppercase tracking-[0.2em] mt-1">
              {transcript.length} {transcript.length === 1 ? 'Entry' : 'Entries'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowFilters(p => !p)} 
            className={`p-2.5 rounded-xl transition-all focus:outline-none ${showFilters ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30 shadow-[0_0_15px_rgba(45,212,191,0.2)]' : 'text-zinc-400 hover:text-white hover:bg-white/10 border border-transparent'}`}
            title="Toggle filters"
          >
            <Filter size={16} />
          </button>
          
          <div className="w-px h-6 bg-white/10 mx-1" />

          <button onClick={handleExport} disabled={isExporting} className="p-2.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all focus:outline-none group relative border border-transparent">
            {isExporting ? <Check size={16} className="text-teal-400" /> : <Download size={16} />}
            <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2.5 py-1.5 bg-[#020808] border border-white/10 shadow-[0_10px_20px_rgba(0,0,0,0.5)] text-white font-bold tracking-widest uppercase text-[9px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">Export Log</span>
          </button>
          
          {onClear && (
            <button onClick={onClear} className="p-2.5 rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all border border-transparent focus:outline-none" title="Clear transcript">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </header>

      {/* --- SEARCH & FILTERS --- */}
      <div className="flex-shrink-0 z-10 bg-black/20 border-b border-white/5 relative">
        <div className="px-5 py-3">
          <div className="relative group flex items-center">
            <Search size={16} className="absolute left-4 text-zinc-500 group-focus-within:text-teal-400 transition-colors" />
            <input
              type="text" 
              placeholder="Search transcript..." 
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full text-[13px] font-semibold bg-black/40 border border-white/5 text-white rounded-[1rem] pl-11 pr-10 py-3 outline-none focus:border-teal-500/40 focus:shadow-[0_0_15px_rgba(45,212,191,0.15)] transition-all placeholder:text-zinc-600"
            />
            {searchInput && (
              <button 
                onClick={() => setSearchInput('')} 
                className="absolute right-3 p-1.5 rounded-full text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Expandable Filters Tray */}
        <div className={`overflow-hidden transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] px-5 ${showFilters ? 'max-h-24 opacity-100 pb-3' : 'max-h-0 opacity-0'}`}>
          <div className="flex gap-3 p-3 bg-white/5 border border-white/5 rounded-2xl">
            <select 
              value={filters.mode} 
              onChange={e => setFilters(p => ({ ...p, mode: e.target.value }))}
              className="flex-1 text-[10px] font-black uppercase tracking-[0.2em] bg-black/60 border border-white/10 text-zinc-300 rounded-xl px-4 py-2.5 outline-none focus:border-teal-500/40 focus:text-teal-400 cursor-pointer appearance-none transition-colors"
            >
              <option value="all">All Modes</option>
              {Object.entries(MODE_META).filter(([k]) => k !== 'default').map(([key, meta]) => (
                <option key={key} value={key}>{meta.icon} {meta.label}</option>
              ))}
            </select>
            <select 
              value={filters.sender} 
              onChange={e => setFilters(p => ({ ...p, sender: e.target.value }))}
              className="flex-1 text-[10px] font-black uppercase tracking-[0.2em] bg-black/60 border border-white/10 text-zinc-300 rounded-xl px-4 py-2.5 outline-none focus:border-teal-500/40 focus:text-teal-400 cursor-pointer appearance-none transition-colors"
            >
              <option value="all">All Speakers</option>
              {senders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* --- MESSAGE VIEWPORT --- */}
      <div 
        ref={viewportRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 pb-6 pt-2 relative z-0 scroll-smooth custom-scrollbar"
        role="log"
        aria-live="polite"
      >
        {processedData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center animate-fade-in py-10">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-5 text-zinc-600 shadow-inner">
              <MessageSquare size={24} />
            </div>
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">
              {searchQuery || filters.mode !== 'all' ? 'No Matches Found' : 'Session is Empty'}
            </h3>
            <p className="text-[11px] font-medium text-zinc-600 mt-2 max-w-[220px] leading-relaxed">
              {searchQuery ? 'Try adjusting your search terms or clearing filters.' : 'Live interactions, commands, and chat logs will appear here.'}
            </p>
          </div>
        ) : (
          processedData.map((item) => {
            if (item.type === 'divider') {
              return <DateDivider key={item.id} dateStr={item.label} />;
            }
            return (
              <MessageBubble
                key={item.data.id || item.data.timestamp}
                log={item.data}
                isMe={String(item.data.senderId) === String(myId)}
                searchQuery={searchQuery}
                isConsecutive={item.isConsecutive}
              />
            );
          })
        )}
        
        {/* Invisible Anchor for Auto-Scroll */}
        <div ref={scrollAnchorRef} className="h-4" aria-hidden="true" />
      </div>

      {/* --- SMART FAB (Floating Action Button) --- */}
      {(!autoScroll && unreadCount > 0) && (
        <button
          onClick={scrollToBottom}
          aria-label={`Scroll to ${unreadCount} new messages`}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-black bg-teal-400 border border-teal-300 rounded-full shadow-[0_10px_30px_rgba(45,212,191,0.4)] hover:bg-teal-300 hover:scale-105 active:scale-95 transition-all duration-300 flex items-center gap-2 z-30 animate-bounce"
        >
          <ArrowDown size={14} />
          {unreadCount} New Message{unreadCount > 1 ? 's' : ''}
        </button>
      )}
      
      {/* Return to bottom FAB when user is scrolled up but there are NO new messages */}
      {(!autoScroll && unreadCount === 0 && transcript.length > 5) && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-6 right-6 p-3.5 text-zinc-400 bg-black/80 backdrop-blur-md border border-white/10 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:text-white hover:border-white/30 hover:scale-110 active:scale-95 transition-all duration-300 z-30"
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}