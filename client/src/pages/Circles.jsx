// client/src/pages/Circles.jsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import api from '../lib/api';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const REPEAT_OPTIONS = [
  { value: 'weekly', label: 'Every week' },
  { value: 'bi-weekly', label: 'Every 2 weeks' },
];

export default function Circles() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [circles, setCircles] = useState([]);
  const [tab, setTab] = useState('browse');   // browse | mine | create
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', topic: '', day: 'Monday',
    time: '18:00', repeat: 'weekly', isPublic: true,
  });

  useEffect(() => { fetchCircles(); }, []);

  const fetchCircles = async () => {
    setLoading(true);
    try {
      const res = await api.get('/circles');
      setCircles(res.data.circles || []);
    } catch { toast.error('Failed to load circles'); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!form.name || !form.topic) { toast.error('Fill name and topic'); return; }
    setCreating(true);
    try {
      await api.post('/circles', {
        name: form.name,
        topic: form.topic,
        schedule: { day: form.day, time: form.time },
        isPublic: form.isPublic
      });
      toast.success('Circle created! Reminders will be sent 30 min before each session.');
      setTab('mine');
      setSearchQuery('');
      fetchCircles();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to create circle'); }
    finally { setCreating(false); }
  };

  const joinCircle = async (circleId) => {
    try {
      await api.post(`/circles/${circleId}/join`);
      toast.success('Joined! You\'ll get an email reminder 30 min before each session.');
      fetchCircles();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to join'); }
  };

  const startSession = (circle) => {
    const roomCode = `CIRCLE-${circle._id}-${Date.now()}`;
    navigate(`/call/group/${roomCode}`);
  };

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const filteredCircles = useMemo(() => {
    if (tab === 'browse') {
      return circles.filter(c => 
        (c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
         c.topic.toLowerCase().includes(searchQuery.toLowerCase())) &&
        (!c.members?.includes(user?._id))
      );
    }
    if (tab === 'mine') {
      return circles.filter(c => c.members?.includes(user?._id) || c.creator === user?._id);
    }
    return [];
  }, [circles, tab, searchQuery, user]);

  return (
    <div className="min-h-screen bg-[#020808] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans selection:bg-teal-500/30 selection:text-teal-200">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-8 lg:py-12">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-zinc-500 mb-3">
              Peer Support Circles
            </h1>
            <p className="text-zinc-400 text-sm md:text-base max-w-xl leading-relaxed">
              Recurring group calls organized by topic. Designed with absolute privacy and automatic 30-minute automated email reminders. Limited to 4 members for intimate support.
            </p>
          </div>
          
          {/* Dynamic Action Tabs */}
          <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/5 backdrop-blur-xl shadow-2xl">
            {[
              { id: 'browse', icon: '🔍', label: 'Explore' },
              { id: 'mine', icon: '⭐', label: 'My Circles' },
              { id: 'create', icon: '➕', label: 'New Circle' },
            ].map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setSearchQuery(''); }}
                className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300
                  ${tab === t.id
                    ? 'text-white shadow-lg bg-white/10'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}>
                {tab === t.id && (
                  <span className="absolute inset-0 rounded-xl bg-gradient-to-b from-teal-500/20 to-transparent border border-teal-500/30" />
                )}
                <span className="relative z-10">{t.icon}</span>
                <span className="relative z-10">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── BROWSE & MINE TABS ──────────────────────────────── */}
        {(tab === 'browse' || tab === 'mine') && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Search Bar */}
            {tab === 'browse' && (
              <div className="relative group max-w-md mb-8">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                  <span className="text-zinc-500 group-focus-within:text-teal-400 transition-colors">🔍</span>
                </div>
                <input 
                  type="text" 
                  placeholder="Search by name or topic..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-900/60 border border-white/10 text-white rounded-2xl pl-12 pr-4 py-3.5 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/50 transition-all shadow-inner backdrop-blur-sm"
                />
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-40 rounded-3xl bg-zinc-900/40 border border-white/5 animate-pulse" />
                ))}
              </div>
            ) : filteredCircles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-zinc-900/20 border border-white/5 rounded-3xl backdrop-blur-sm">
                <div className="w-20 h-20 bg-zinc-900 border border-white/10 rounded-full flex items-center justify-center text-3xl mb-4 shadow-xl">
                  {tab === 'mine' ? '⭐' : '🌐'}
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {tab === 'mine' ? 'No circles joined yet' : 'No circles found'}
                </h3>
                <p className="text-zinc-500 text-sm max-w-sm mx-auto mb-6">
                  {tab === 'mine' 
                    ? "You haven't joined any support circles yet. Browse the network to find your community." 
                    : "Try adjusting your search terms or create a brand new circle for your topic."}
                </p>
                {tab === 'mine' && (
                  <button onClick={() => setTab('browse')} className="px-6 py-2.5 bg-teal-500 hover:bg-teal-400 text-teal-950 font-bold rounded-xl transition-all shadow-lg shadow-teal-500/25 active:scale-95">
                    Explore Circles
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {filteredCircles.map((circle, i) => (
                  <div key={circle._id || i} className="group relative bg-zinc-900/40 hover:bg-zinc-900/80 border border-white/5 hover:border-teal-500/30 rounded-3xl p-6 transition-all duration-300 backdrop-blur-md overflow-hidden">
                    {/* Background glow on hover */}
                    <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    
                    <div className="relative z-10 flex flex-col h-full justify-between gap-6">
                      
                      {/* Top Row: Meta */}
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <h3 className="text-lg font-bold text-white leading-tight group-hover:text-teal-300 transition-colors">{circle.name}</h3>
                            {circle.isPublic && <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-400 border border-zinc-700 tracking-wide uppercase">Public</span>}
                          </div>
                          <p className="text-sm text-zinc-400 font-medium">{circle.topic}</p>
                        </div>
                        <div className="flex -space-x-2">
                          {Array.from({ length: Math.min(circle.members?.length || 1, 4) }).map((_, j) => (
                            <div key={j} className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-800 to-zinc-800 border-2 border-zinc-900 flex items-center justify-center shadow-sm">
                              <span className="text-[10px] text-teal-200 font-bold">👤</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Bottom Row: Tags & Actions */}
                      <div className="flex items-end justify-between gap-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2 text-xs font-mono text-zinc-300">
                            <span className="p-1 rounded bg-zinc-800 border border-zinc-700">📅</span>
                            {circle.schedule?.day || circle.day}s at {circle.schedule?.time || circle.time}
                          </div>
                          <div className="flex items-center gap-2 text-xs font-mono text-teal-400/80">
                            <span className="p-1 rounded bg-teal-900/30 border border-teal-500/20">🔔</span>
                            30m auto-reminders
                          </div>
                        </div>

                        <div className="flex gap-2">
                          {tab === 'browse' ? (
                            <button onClick={() => joinCircle(circle._id)} className="px-5 py-2.5 bg-white/5 hover:bg-teal-500 border border-white/10 hover:border-teal-400 text-white hover:text-teal-950 font-bold text-sm rounded-xl transition-all shadow-lg active:scale-95">
                              Join
                            </button>
                          ) : (
                            <button onClick={() => startSession(circle)} className="px-5 py-2.5 bg-teal-500 hover:bg-teal-400 text-teal-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-teal-500/25 active:scale-95 flex items-center gap-2">
                              <span>Enter</span>
                              <span>→</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CREATE TAB ──────────────────────────────── */}
        {tab === 'create' && (
          <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="bg-zinc-900/60 border border-white/10 rounded-3xl p-6 md:p-10 shadow-2xl backdrop-blur-xl relative overflow-hidden">
              {/* Decorative background element */}
              <div className="absolute -top-40 -right-40 w-96 h-96 bg-teal-500/10 blur-[100px] rounded-full pointer-events-none" />

              <div className="relative z-10 mb-8">
                <h2 className="text-2xl font-black text-white mb-2">Initialize New Circle</h2>
                <p className="text-zinc-400 text-sm">Configure your support group. Members will receive automated email invites and 30-minute pre-call calendar alerts.</p>
              </div>

              <div className="relative z-10 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Circle Identity</label>
                    <input className="w-full bg-zinc-950 border border-white/5 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-colors text-sm font-medium" 
                      placeholder="e.g. Stroke Recovery Group"
                      value={form.name} onChange={e => setF('name', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Core Topic</label>
                    <input className="w-full bg-zinc-950 border border-white/5 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-colors text-sm font-medium" 
                      placeholder="e.g. Physical Therapy"
                      value={form.topic} onChange={e => setF('topic', e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Schedule Day</label>
                    <select className="w-full bg-zinc-950 border border-white/5 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-colors text-sm font-medium appearance-none" 
                      value={form.day} onChange={e => setF('day', e.target.value)}>
                      {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Time (Local)</label>
                    <input type="time" className="w-full bg-zinc-950 border border-white/5 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-colors text-sm font-medium" 
                      value={form.time} onChange={e => setF('time', e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Frequency</label>
                    <div className="flex gap-2">
                      {REPEAT_OPTIONS.map(r => (
                        <button key={r.value} onClick={() => setF('repeat', r.value)}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-bold transition-all
                            ${form.repeat === r.value ? 'bg-teal-500/20 border-teal-500/40 text-teal-300 shadow-inner' : 'bg-zinc-950 border-white/5 text-zinc-500 hover:bg-zinc-900'}`}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Visibility</label>
                    <div className="flex gap-2">
                      {[
                        { v: true, label: 'Public' },
                        { v: false, label: 'Private' },
                      ].map(opt => (
                        <button key={String(opt.v)} onClick={() => setF('isPublic', opt.v)}
                          className={`flex-1 py-2.5 rounded-xl border text-sm font-bold transition-all
                            ${form.isPublic === opt.v ? 'bg-teal-500/20 border-teal-500/40 text-teal-300 shadow-inner' : 'bg-zinc-950 border-white/5 text-zinc-500 hover:bg-zinc-900'}`}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button onClick={handleCreate} disabled={creating}
                  className="w-full mt-6 py-4 bg-white text-black hover:bg-teal-400 hover:text-teal-950 font-black text-lg tracking-wide rounded-xl transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(45,212,191,0.4)] active:scale-[0.98]">
                  {creating ? 'Initializing Infrastructure...' : 'Deploy Support Circle'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}