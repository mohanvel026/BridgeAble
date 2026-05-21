// client/src/pages/Connect.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

// ── Utilities ─────────────────────────────────────────────
function timeAgo(date) {
  if (!date) return 'Unknown';
  const diff = Math.floor((Date.now() - new Date(date)) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function compatScore(a, b) {
  if (!a || !b) return 60;
  if (a === b) return 72;
  const caregiverPairs = ['deaf-normal','paralyzed-normal','speech-normal','blind-normal'];
  const key = `${a}-${b}`;
  const rev = `${b}-${a}`;
  if (caregiverPairs.includes(key) || caregiverPairs.includes(rev)) return 98;
  return 84;
}

function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debouncedValue;
}

const DISABILITY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'deaf', label: '👋 Deaf' },
  { value: 'paralyzed', label: '👁 Paralyzed' },
  { value: 'speech', label: '🗂 Speech' },
  { value: 'blind', label: '🔊 Blind' },
  { value: 'normal', label: '🤝 Helper' },
];

const DISABILITY_COLORS = {
  deaf: { ring: 'border-cyan-500/40', text: 'text-cyan-400', bg: 'bg-cyan-500/10', glow: 'bg-cyan-500' },
  paralyzed: { ring: 'border-violet-500/40', text: 'text-violet-400', bg: 'bg-violet-500/10', glow: 'bg-violet-500' },
  speech: { ring: 'border-amber-500/40', text: 'text-amber-400', bg: 'bg-amber-500/10', glow: 'bg-amber-500' },
  blind: { ring: 'border-rose-500/40', text: 'text-rose-400', bg: 'bg-rose-500/10', glow: 'bg-rose-500' },
  normal: { ring: 'border-teal-500/40', text: 'text-teal-400', bg: 'bg-teal-500/10', glow: 'bg-teal-500' },
};

const MODE_ICON = { gesture: '👋', blink: '👁', symbol: '🗂', voice: '🎙', type: '⌨️' };

function getCompatBridge(a, b) {
  const map = {
    'deaf-normal': 'Gesture + Voice bridge', 'paralyzed-normal': 'Blink + Voice bridge',
    'speech-normal': 'Symbol + Voice bridge', 'blind-normal': 'Voice + TTS bridge',
    'deaf-paralyzed': 'Gesture + Blink bridge', 'deaf-speech': 'Gesture + Symbol bridge',
    'paralyzed-speech': 'Blink + Symbol bridge',
  };
  return map[`${a}-${b}`] || map[`${b}-${a}`] || '🔗 Full bridge active';
}

// ── Send Note Modal ──────────────────────────────────────
function SendNoteModal({ targetUser, onSend, onClose }) {
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0d1f1c] p-6 shadow-2xl">
        <h3 className="font-semibold text-white mb-1">Connect with {targetUser.name}</h3>
        <p className="text-zinc-500 text-xs mb-4">Add a short note (optional)</p>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={120}
          rows={3}
          placeholder="Hi! I'd love to connect..."
          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/40 resize-none mb-3"
        />
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-zinc-400 text-sm hover:text-white transition-all">
            Cancel
          </button>
          <button onClick={() => onSend(note)}
            className="flex-1 py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-sm font-bold hover:bg-cyan-500/25 transition-all">
            Send Request
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Action Panel shown after connection is accepted ──────
function ConnectionActionPanel({ user: targetUser, onClose, onCall, onMessage, onRemove }) {
  const dc = DISABILITY_COLORS[targetUser.disabilityType] || DISABILITY_COLORS.normal;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0d1f1c] p-6 shadow-2xl animate-scale-in">
        {/* Profile */}
        <div className="flex flex-col items-center mb-6">
          <div className={`relative w-20 h-20 rounded-full border-2 ${dc.ring} flex items-center justify-center ${dc.bg} text-3xl font-bold ${dc.text} mb-3`}>
            {targetUser.avatar
              ? <img src={targetUser.avatar} className="w-full h-full rounded-full object-cover" alt={targetUser.name} />
              : targetUser.name?.[0]}
            {targetUser.isOnline && (
              <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-teal-400 border-2 border-[#0d1f1c] animate-pulse" />
            )}
          </div>
          <h3 className="font-semibold text-lg text-white">{targetUser.name}</h3>
          <span className={`text-xs mt-0.5 ${dc.text}`}>{targetUser.disabilityType} · {MODE_ICON[targetUser.inputMode]} {targetUser.inputMode}</span>
          <span className={`text-xs mt-1 ${targetUser.isOnline ? 'text-teal-400' : 'text-zinc-500'}`}>
            {targetUser.isOnline ? '● Online now' : 'Offline'}
          </span>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <button
            onClick={() => targetUser.isOnline ? onCall(targetUser, 'video') : toast.error('User is offline')}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all
              ${targetUser.isOnline
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20 hover:shadow-lg'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
            <span className="text-2xl">📹</span>
            <span className="text-xs font-bold tracking-wide">Video Call</span>
          </button>

          <button
            onClick={() => targetUser.isOnline ? onCall(targetUser, 'voice') : toast.error('User is offline')}
            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all
              ${targetUser.isOnline
                ? 'bg-teal-500/10 border-teal-500/30 text-teal-400 hover:bg-teal-500/20'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-500 cursor-not-allowed'}`}>
            <span className="text-2xl">📞</span>
            <span className="text-xs font-bold tracking-wide">Voice Call</span>
          </button>

          <button
            onClick={() => onMessage(targetUser)}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border bg-violet-500/10 border-violet-500/30 text-violet-400 hover:bg-violet-500/20 transition-all">
            <span className="text-2xl">💬</span>
            <span className="text-xs font-bold tracking-wide">Message</span>
          </button>

          <button
            onClick={() => { onRemove(targetUser._id); onClose(); }}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-rose-500/30 hover:text-rose-400 transition-all">
            <span className="text-2xl">🔗</span>
            <span className="text-xs font-bold tracking-wide">Disconnect</span>
          </button>
        </div>

        <button onClick={onClose} className="w-full py-2.5 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 transition-all">
          Close
        </button>
      </div>
    </div>
  );
}

// ── User Card ─────────────────────────────────────────────
function UserCard({ user: u, myDisabilityType, onAction, onOpenPanel }) {
  const dc = DISABILITY_COLORS[u.disabilityType] || DISABILITY_COLORS.normal;
  const compat = getCompatBridge(myDisabilityType, u.disabilityType);
  const score = compatScore(myDisabilityType, u.disabilityType);
  const [localStatus, setLocalStatus] = useState(u.connectionStatus);
  const [showNote, setShowNote] = useState(false);

  const handleConnect = () => setShowNote(true);

  const handleSendRequest = async (note) => {
    setShowNote(false);
    setLocalStatus('pending_sent');
    try {
      await api.post(`/users/connect-request/${u._id}`, { note });
      toast.success(`Request sent to ${u.name}!`);
    } catch (err) {
      setLocalStatus('none');
      toast.error(err.response?.data?.message || 'Failed to send request');
    }
  };

  return (
    <>
    {showNote && <SendNoteModal targetUser={u} onSend={handleSendRequest} onClose={() => setShowNote(false)} />}
    <div className="relative rounded-2xl border border-white/8 bg-gradient-to-br from-[#0d1f1c] to-[#070f0e] p-5 hover:border-white/15 hover:translate-y-[-2px] transition-all duration-300 group overflow-hidden">
      {/* Background glow */}
      <div className={`absolute top-0 right-0 w-20 h-20 blur-2xl opacity-10 pointer-events-none rounded-full ${dc.glow}`} />

      {/* Avatar + Info */}
      <div className="flex items-start gap-3 mb-3">
        <div className="relative flex-shrink-0">
          <div className={`w-12 h-12 rounded-full border-2 ${dc.ring} ${dc.bg} flex items-center justify-center font-bold text-lg ${dc.text}`}>
            {u.avatar ? <img src={u.avatar} className="w-full h-full rounded-full object-cover" alt={u.name} /> : u.name?.[0]}
          </div>
          {u.isOnline
            ? <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-teal-400 border-2 border-[#070f0e] animate-pulse" />
            : <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-zinc-600 border-2 border-[#070f0e]" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm truncate">{u.name}</p>
          <p className={`text-xs capitalize ${dc.text} mt-0.5`}>{u.disabilityType}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{MODE_ICON[u.inputMode]} {u.inputMode}</p>
          <p className={`text-xs mt-1 font-medium ${u.isOnline ? 'text-teal-400' : 'text-zinc-600'}`}>
            {u.isOnline ? '● Online now' : `Last seen ${timeAgo(u.lastSeen)}`}
          </p>
        </div>
        {/* Compatibility score badge */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <div className={`text-sm font-black ${score >= 95 ? 'text-teal-400' : score >= 80 ? 'text-cyan-400' : 'text-zinc-400'}`}>
            {score}%
          </div>
          <div className="text-[9px] text-zinc-600 uppercase tracking-wider">match</div>
        </div>
      </div>

      {/* Compat bridge + score bar */}
      <div className="px-3 py-2 rounded-xl bg-white/4 border border-white/6 mb-3 space-y-1.5">
        <p className="text-xs text-zinc-400 text-center">🔗 {compat}</p>
        <div className="w-full h-1 bg-white/8 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${score >= 95 ? 'bg-teal-400' : score >= 80 ? 'bg-cyan-400' : 'bg-zinc-500'}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      {/* Action button based on connection state */}
      {localStatus === 'connected' ? (
        <button
          onClick={() => onOpenPanel(u)}
          className="w-full py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-xs font-bold hover:bg-cyan-500/25 transition-all">
          ✅ Connected — View Options
        </button>
      ) : localStatus === 'pending_sent' ? (
        <button disabled className="w-full py-2.5 rounded-xl bg-zinc-800/60 border border-zinc-700 text-zinc-500 text-xs font-medium cursor-not-allowed">
          ⏳ Request Sent
        </button>
      ) : localStatus === 'pending_received' ? (
        <div className="flex gap-2">
          <button
            onClick={() => onAction('accept', u)}
            className="flex-1 py-2.5 rounded-xl bg-teal-500/15 border border-teal-500/30 text-teal-400 text-xs font-bold hover:bg-teal-500/25 transition-all">
            ✓ Accept
          </button>
          <button
            onClick={() => onAction('decline', u)}
            className="flex-1 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold hover:bg-rose-500/20 transition-all">
            ✕ Decline
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-semibold hover:border-cyan-500/30 hover:text-cyan-400 hover:bg-cyan-500/8 transition-all">
          ➕ Connect
        </button>
      )}
    </div>
    </>
  );
}

// ── Main Connect Page ─────────────────────────────────────
export default function Connect() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState('discover'); // discover | connections | requests
  const [users, setUsers] = useState([]);
  const [connections, setConnections] = useState([]);
  const [requests, setRequests] = useState([]);
  const [filters, setFilters] = useState({ disabilityType: '', online: false });
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null); // for action panel
  const [requestBadge, setRequestBadge] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.disabilityType) params.set('disabilityType', filters.disabilityType);
      if (filters.online) params.set('online', 'true');

      const [discoverRes, connRes, reqRes] = await Promise.all([
        api.get(`/users/discover?${params}`),
        api.get('/users/connections'),
        api.get('/users/connection-requests'),
      ]);

      setUsers(discoverRes.data.users || []);
      setConnections(connRes.data.connections || []);
      setRequests(reqRes.data.requests || []);
      setRequestBadge(reqRes.data.requests?.length || 0);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Real-time socket events
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onRequest = (data) => {
      toast(`📨 ${data.fromUser.name} sent you a connection request!`, { icon: '🔔' });
      setRequestBadge(b => b + 1);
      setRequests(prev => [...prev, data.fromUser]);
    };

    const onAccepted = (data) => {
      toast.success(`🎉 ${data.byUser.name} accepted your request!`);
      fetchAll();
    };

    const onStatus = ({ userId, status }) => {
      const online = status === 'online';
      setUsers(p => p.map(u => u._id === userId ? { ...u, isOnline: online } : u));
      setConnections(p => p.map(u => u._id === userId ? { ...u, isOnline: online } : u));
    };

    socket.on('connection:request', onRequest);
    socket.on('connection:accepted', onAccepted);
    socket.on('user:status', onStatus);

    return () => {
      socket.off('connection:request', onRequest);
      socket.off('connection:accepted', onAccepted);
      socket.off('user:status', onStatus);
    };
  }, [fetchAll]);

  const handleAccept = async (targetUser) => {
    try {
      await api.post(`/users/connect-accept/${targetUser._id}`);
      toast.success(`Connected with ${targetUser.name}!`);
      setRequests(p => p.filter(r => r._id !== targetUser._id));
      setRequestBadge(b => Math.max(0, b - 1));
      fetchAll();
    } catch {
      toast.error('Failed to accept request');
    }
  };

  const handleDecline = async (targetUser) => {
    try {
      await api.post(`/users/connect-decline/${targetUser._id}`);
      setRequests(p => p.filter(r => r._id !== targetUser._id));
      setRequestBadge(b => Math.max(0, b - 1));
      toast('Request declined');
    } catch {
      toast.error('Failed to decline request');
    }
  };

  const handleAction = (type, targetUser) => {
    if (type === 'accept') handleAccept(targetUser);
    else if (type === 'decline') handleDecline(targetUser);
  };

  const handleCall = async (targetUser, callType) => {
    try {
      const res = await api.post('/rooms/create', { type: '1-1', callType });
      const roomCode = res.data.roomCode;
      const socket = getSocket();

      // Emit to server with full caller context so IncomingCallModal gets the right data
      socket?.emit('call:initiate', {
        recipientId: targetUser._id,
        roomCode,
        type: callType,
        fromUser: {
          _id: user._id,
          name: user.name,
          avatar: user.avatar,
          disabilityType: user.disabilityType,
          inputMode: user.inputMode,
        },
      });

      // Navigate to room with ringing context
      navigate(`/call/room/${roomCode}`, {
        state: {
          isInitiator: true,
          recipientId: targetUser._id,
          recipientName: targetUser.name,
          callType,
        },
      });
    } catch {
      toast.error('Could not start call. Please try again.');
    }
  };

  const handleMessage = (targetUser) => {
    navigate('/send', { state: { recipientId: targetUser._id, recipientName: targetUser.name } });
  };

  const handleRemove = async (userId) => {
    try {
      await api.delete(`/users/connect-remove/${userId}`);
      setConnections(p => p.filter(u => u._id !== userId));
      toast('Connection removed');
    } catch {
      toast.error('Failed to remove connection');
    }
  };

  const filteredSearch = (list) =>
    list.filter(u => u.name?.toLowerCase().includes(debouncedSearch.toLowerCase()));

  const TABS = [
    { id: 'discover', label: 'Discover', icon: '🌐' },
    { id: 'connections', label: 'Connections', icon: '✅', count: connections.length },
    { id: 'requests', label: 'Requests', icon: '📨', count: requestBadge },
  ];

  return (
    <div className="min-h-screen bg-[#040d0c]">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Pending requests notification banner */}
        {requestBadge > 0 && tab !== 'requests' && (
          <button
            onClick={() => setTab('requests')}
            className="w-full mb-5 flex items-center gap-3 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-400 text-sm hover:bg-amber-500/15 transition-all">
            <span className="text-lg">📨</span>
            <span className="flex-1 text-left">
              <span className="font-semibold">{requestBadge} pending connection request{requestBadge > 1 ? 's' : ''}</span>
              <span className="text-amber-500/70 ml-2 text-xs">Tap to review →</span>
            </span>
          </button>
        )}

        {/* Header */}
        <div className="mb-6">
          <h1 className="font-semibold text-2xl text-white mb-1">Connect</h1>
          <p className="text-zinc-500 text-sm">Build your care & communication network</p>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">🔍</span>
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-white/5 border border-white/8 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-cyan-500/40"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-xs">
              ✕
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium transition-all whitespace-nowrap
                ${tab === t.id
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                  : 'bg-white/4 border-white/8 text-zinc-400 hover:border-white/15'}`}>
              {t.icon} {t.label}
              {t.count > 0 && (
                <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center
                  ${tab === t.id ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-300'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Discover filters */}
        {tab === 'discover' && (
          <div className="flex flex-wrap gap-2 mb-5">
            {DISABILITY_FILTERS.map(f => (
              <button key={f.value}
                onClick={() => setFilters(p => ({ ...p, disabilityType: f.value }))}
                className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all
                  ${filters.disabilityType === f.value
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                    : 'bg-white/4 border-white/8 text-zinc-400 hover:border-white/15'}`}>
                {f.label}
              </button>
            ))}
            <button
              onClick={() => setFilters(p => ({ ...p, online: !p.online }))}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ml-auto
                ${filters.online
                  ? 'bg-teal-500/10 border-teal-500/30 text-teal-400'
                  : 'bg-white/4 border-white/8 text-zinc-400 hover:border-white/15'}`}>
              {filters.online ? '● Online only' : 'Online only'}
            </button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-2xl border border-white/8 bg-white/3 p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-white/8" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-white/8 rounded w-24" />
                    <div className="h-2 bg-white/5 rounded w-16" />
                  </div>
                </div>
                <div className="h-7 bg-white/8 rounded-xl" />
              </div>
            ))}
          </div>

        ) : tab === 'requests' ? (
          requests.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">📭</div>
              <p className="text-zinc-500">No pending connection requests</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSearch(requests).map(u => (
                <UserCard key={u._id} user={{ ...u, connectionStatus: 'pending_received' }}
                  myDisabilityType={user?.disabilityType}
                  onAction={handleAction}
                  onOpenPanel={setSelectedUser} />
              ))}
            </div>
          )

        ) : tab === 'connections' ? (
          connections.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🤝</div>
              <p className="text-zinc-500 mb-2">No connections yet</p>
              <button onClick={() => setTab('discover')}
                className="mt-2 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm hover:bg-cyan-500/20 transition-all">
                Discover people →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSearch(connections).map(u => (
                <UserCard key={u._id} user={{ ...u, connectionStatus: 'connected' }}
                  myDisabilityType={user?.disabilityType}
                  onAction={handleAction}
                  onOpenPanel={setSelectedUser} />
              ))}
            </div>
          )

        ) : (
          filteredSearch(users).length === 0 ? (
            <div className="text-center py-20">
              <div className="text-5xl mb-4">🔍</div>
              <p className="text-zinc-500">No users found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSearch(users).map(u => (
                <UserCard key={u._id} user={u}
                  myDisabilityType={user?.disabilityType}
                  onAction={handleAction}
                  onOpenPanel={setSelectedUser} />
              ))}
            </div>
          )
        )}
      </main>

      {/* Connection Action Panel */}
      {selectedUser && (
        <ConnectionActionPanel
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onCall={handleCall}
          onMessage={handleMessage}
          onRemove={handleRemove}
        />
      )}
    </div>
  );
}