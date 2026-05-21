// client/src/pages/History.jsx
import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/stores';
import api from '../lib/api';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const TABS = [
  { id: 'calls', icon: '📹', label: 'Calls' },
  { id: 'messages', icon: '💬', label: 'Messages' },
  { id: 'health', icon: '❤️', label: 'Health Log' },
];

const modeIcon = { gesture: '👋', blink: '👁', symbol: '🗂', voice: '🎙', type: '⌨️' };
const msgIcon = { need: '🙋', pain: '😣', emotion: '😊', sos: '🚨', 'yes-no': '✅❌', custom: '💬' };

export default function History() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState('calls');
  const [calls, setCalls] = useState([]);
  const [messages, setMessages] = useState([]);
  const [healthLogs, setHealth] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [transcript, setTranscript] = useState([]);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [msgsRes, healthRes, callsRes] = await Promise.all([
        api.get('/messages/inbox'),
        api.get('/health/me?days=90'),
        api.get('/rooms/history/me'),
      ]);
      setMessages(msgsRes.data.messages || []);
      setHealth(healthRes.data.logs || []);
      setCalls(callsRes.data.calls || []);
    } catch { toast.error('Failed to load history'); }
    finally { setLoading(false); }
  };

  const fetchTranscript = async (roomCode) => {
    try {
      const res = await api.get(`/rooms/${roomCode}/transcript`);
      setTranscript(res.data.transcripts || []);
    } catch { }
  };

  const filterByDate = (items, dateKey = 'createdAt') => {
    return items.filter(item => {
      const d = new Date(item[dateKey]);
      if (dateFrom && d < new Date(dateFrom)) return false;
      if (dateTo && d > new Date(dateTo + 'T23:59:59')) return false;
      return true;
    });
  };

  const filterBySearch = (items, fields) => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(item => fields.some(f => String(item[f] || '').toLowerCase().includes(q)));
  };

  const exportPDF = async () => {
    if (tab === 'health') {
      toast.loading('Generating health report...', { id: 'export' });
      try {
        const res = await api.get(`/export/health/${user._id}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `BridgeAble-Health-${user.name.replace(/\s/g, '-')}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success('Health report downloaded', { id: 'export' });
      } catch { toast.error('Failed to export health report', { id: 'export' }); }
    } else if (tab === 'calls' && expanded) {
      const call = calls.find(c => c._id === expanded);
      if (!call) return;
      toast.loading('Generating transcript...', { id: 'export' });
      try {
        const res = await api.get(`/export/transcript/${call.roomCode}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `Transcript-${call.roomCode}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success('Transcript downloaded', { id: 'export' });
      } catch { toast.error('Failed to export transcript', { id: 'export' }); }
    } else {
      toast.info('Select Health tab or expand a Call to export PDF');
    }
  };

  const filteredMessages = filterByDate(
    filterBySearch(messages, ['type']), 'createdAt'
  );
  const filteredHealth = filterByDate(healthLogs, 'date');

  const formatDuration = (s) => {
    if (!s) return '—';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  };

  return (
    <div className="min-h-screen bg-mesh-dark">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-semibold mb-1">Communication History</h1>
            <p className="text-text-secondary text-sm">All calls, messages, and health logs in one place</p>
          </div>
          <button onClick={exportPDF} className="btn-secondary text-sm px-4 py-2 flex items-center gap-1.5">
            📄 Export PDF
          </button>
        </div>

        {/* Search + date filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input className="input flex-1 min-w-48 text-sm py-2"
            placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          <input type="date" className="input text-sm py-2 w-40"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <input type="date" className="input text-sm py-2 w-40"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />
          {(dateFrom || dateTo || search) && (
            <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); }}
              className="btn-ghost text-xs px-3 py-2">Clear filters</button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium transition-all
                           ${tab === t.id
                  ? 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan'
                  : 'bg-dark-800 border-dark-600 text-text-secondary hover:border-dark-500'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── CALLS TAB ──────────────────────────────── */}
            {tab === 'calls' && (
              <div className="space-y-3 animate-fade-in">
                {calls.length === 0 ? (
                  <div className="card p-12 text-center">
                    <div className="text-5xl mb-4">📹</div>
                    <p className="font-display text-lg font-semibold mb-2">No calls yet</p>
                    <p className="text-text-secondary text-sm">Your call history will appear here after your first call</p>
                  </div>
                ) : calls.map(call => (
                  <div key={call._id} className="card p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-dark-800 border border-dark-600
                                         flex items-center justify-center text-xl">
                          {call.isGroup ? '👥' : '📹'}
                        </div>
                        <div>
                          <p className="font-medium text-text-primary text-sm">
                            {call.participants?.map(p => p.name).join(', ') || 'Unknown'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-text-muted">
                              {new Date(call.startedAt).toLocaleDateString()} {new Date(call.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-xs text-text-muted">·</span>
                            <span className="text-xs text-text-muted">{formatDuration(call.durationSeconds)}</span>
                          </div>
                          <div className="flex gap-1.5 mt-1">
                            {call.participants?.map(p => (
                              <span key={p._id} className="text-xs px-2 py-0.5 rounded-full bg-dark-800 border border-dark-600 text-text-muted">
                                {modeIcon[p.inputMode]} {p.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => {
                        setExpanded(expanded === call._id ? null : call._id);
                        if (expanded !== call._id) fetchTranscript(call.roomCode);
                      }}
                        className="text-xs text-accent-cyan hover:underline flex-shrink-0">
                        {expanded === call._id ? 'Hide' : 'View'} transcript
                      </button>
                    </div>

                    {expanded === call._id && (
                      <div className="mt-4 border-t border-dark-700 pt-4 animate-slide-down">
                        {transcript.length === 0 ? (
                          <p className="text-xs text-text-muted text-center py-3">No transcript saved</p>
                        ) : (
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {transcript.map((t, i) => (
                              <div key={i} className="flex gap-2 items-start">
                                <span className="text-xs mt-0.5 flex-shrink-0">{modeIcon[t.inputMode]}</span>
                                <div>
                                  <span className="text-xs text-accent-cyan font-medium">{t.senderId?.name}</span>
                                  <span className="text-xs text-text-muted ml-1.5">
                                    {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <p className="text-xs text-text-primary mt-0.5">{t.text}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── MESSAGES TAB ───────────────────────────── */}
            {tab === 'messages' && (
              <div className="space-y-2 animate-fade-in">
                {filteredMessages.length === 0 ? (
                  <div className="card p-12 text-center">
                    <div className="text-5xl mb-4">💬</div>
                    <p className="text-text-secondary text-sm">No messages yet</p>
                  </div>
                ) : filteredMessages.map((msg, i) => (
                  <div key={i} className="card p-4 flex items-start gap-3">
                    <span className="text-xl flex-shrink-0">{msgIcon[msg.type] || '💬'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium capitalize px-2 py-0.5 rounded-full
                            ${msg.type === 'sos' ? 'bg-accent-rose/20 text-accent-rose' :
                              msg.type === 'pain' ? 'bg-accent-amber/20 text-accent-amber' :
                                'bg-dark-800 text-text-muted'}`}>
                            {msg.type}
                          </span>
                          <span className="text-xs text-text-muted">
                            from {msg.senderId?.name || 'You'}
                          </span>
                        </div>
                        <span className="text-xs text-text-muted flex-shrink-0">
                          {new Date(msg.createdAt).toLocaleDateString()} {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-xs text-text-primary">
                        {msg.type === 'pain' ? `Where: ${msg.content?.location} · Pain Level: ${msg.content?.intensity}/10 · ${msg.content?.painType}` :
                          msg.type === 'need' ? `Requested: ${msg.content?.item}` :
                            msg.type === 'emotion' ? `Feeling: ${msg.content?.emotion}` :
                              msg.type === 'sos' ? `Emergency Alert: ${msg.content?.emergencyType}` :
                                msg.type === 'yes-no' ? `Response: ${msg.content?.answer}` :
                                  msg.content?.text || JSON.stringify(msg.content)}
                      </p>
                    </div>
                    {!msg.isRead && (
                      <span className="w-2 h-2 rounded-full bg-accent-cyan flex-shrink-0 mt-1" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── HEALTH LOG TAB ─────────────────────────── */}
            {tab === 'health' && (
              <div className="space-y-3 animate-fade-in">
                {filteredHealth.length === 0 ? (
                  <div className="card p-12 text-center">
                    <div className="text-5xl mb-4">❤️</div>
                    <p className="text-text-secondary text-sm">No health logs yet. Check in from your dashboard daily.</p>
                  </div>
                ) : (
                  <>
                    {/* Summary row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                      {[
                        { label: 'Avg Sleep', value: (filteredHealth.reduce((s, l) => s + (l.sleepQuality || 0), 0) / filteredHealth.length).toFixed(1) + '/5', icon: '😴' },
                        { label: 'Avg Pain', value: (filteredHealth.reduce((s, l) => s + (l.painLevel || 0), 0) / filteredHealth.length).toFixed(1) + '/10', icon: '🤕' },
                        { label: 'Logs Total', value: filteredHealth.length, icon: '📋' },
                        { label: 'Days Logged', value: new Set(filteredHealth.map(l => new Date(l.date).toDateString())).size, icon: '📅' },
                      ].map(stat => (
                        <div key={stat.label} className="card p-4 text-center">
                          <p className="text-2xl mb-1">{stat.icon}</p>
                          <p className="font-mono font-bold text-accent-cyan text-lg">{stat.value}</p>
                          <p className="text-xs text-text-muted">{stat.label}</p>
                        </div>
                      ))}
                    </div>

                    {filteredHealth.map((log, i) => (
                      <div key={i} className="card p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="font-medium text-sm text-text-primary">
                            {new Date(log.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                          </p>
                          {log.blinkEAR && (
                            <span className="text-xs text-accent-violet px-2 py-0.5 rounded-full bg-accent-violet/10 border border-accent-violet/20 font-mono">
                              EAR: {log.blinkEAR?.toFixed(3)}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { label: 'Sleep', value: log.sleepQuality ? `${log.sleepQuality}/5` : '—', icon: '😴' },
                            { label: 'Pain', value: log.painLevel ? `${log.painLevel}/10` : '—', icon: '🤕' },
                            { label: 'Mood', value: log.mood || '—', icon: '😊' },
                            { label: 'Appetite', value: log.appetite || '—', icon: '🍽' },
                          ].map(item => (
                            <div key={item.label} className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-dark-900 border border-dark-700">
                              <span className="text-sm">{item.icon}</span>
                              <div>
                                <p className="text-xs text-text-muted">{item.label}</p>
                                <p className="text-xs font-medium text-text-primary capitalize">{item.value}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {log.painLocation && (
                          <p className="text-xs text-text-muted mt-2">Pain location: {log.painLocation}</p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}