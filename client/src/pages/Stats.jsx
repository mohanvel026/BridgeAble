// client/src/pages/Stats.jsx
import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/stores';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import api from '../lib/api';
import Navbar from '../components/Navbar';

const CHART_COLORS = ['#2dd4bf', '#a78bfa', '#fbbf24', '#fb7185', '#38bdf8'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900/90 border border-white/10 rounded-2xl px-4 py-3 backdrop-blur-xl shadow-2xl">
      <p className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-3 mb-1 last:mb-0">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <p className="text-sm text-zinc-300 font-medium">
            {p.name}: <span className="font-bold text-white ml-1">{p.value}</span>
          </p>
        </div>
      ))}
    </div>
  );
};

export default function Stats() {
  const { user } = useAuthStore();
  const [range, setRange] = useState(30);
  const [healthData, setHealthData] = useState([]);
  const [loading, setLoading] = useState(true);

  // Mock call stats (real data from MongoDB aggregation in full build)
  const callStats = {
    total: 12, avgDuration: 340, mostCalled: 'Dr. Sharma',
    modesUsed: [
      { name: 'Voice', value: 5 },
      { name: 'Blink', value: 4 },
      { name: 'Gesture', value: 2 },
      { name: 'Symbol', value: 1 },
    ],
  };

  const topPhrases = [
    { phrase: 'YES', count: 47 }, { phrase: 'HELP', count: 31 },
    { phrase: 'Water', count: 28 }, { phrase: 'WAIT', count: 22 },
    { phrase: 'Medicine', count: 19 }, { phrase: 'PAIN', count: 15 },
    { phrase: 'Food', count: 14 }, { phrase: 'Doctor', count: 11 },
  ];

  useEffect(() => { fetchHealth(); }, [range]);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/health/me?days=${range}`);
      const logs = res.data.logs || [];
      setHealthData(logs.map(l => ({
        date: new Date(l.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sleep: l.sleepQuality || 0,
        pain: l.painLevel || 0,
        ear: l.blinkEAR ? parseFloat(l.blinkEAR.toFixed(3)) : null,
        mood: ['terrible', 'bad', 'okay', 'good', 'great'].indexOf(l.mood) + 1 || 3,
      })));
    } catch { }
    finally { setLoading(false); }
  };

  const isParalyzed = user?.disabilityType === 'paralyzed';

  // NEW FEATURE: Export to CSV for medical sharing
  const exportToCSV = () => {
    if (healthData.length === 0) return;
    const headers = ['Date', 'Sleep Quality (1-5)', 'Pain Level (1-10)', 'Mood (1-5)', 'EAR Value'];
    const rows = healthData.map(d => [d.date, d.sleep, d.pain, d.mood, d.ear || 'N/A']);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bridgeable_health_report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#020808] bg-[radial-gradient(ellipse_at_top_right,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans selection:bg-teal-500/30 selection:text-teal-200">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8 lg:py-12">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-zinc-500 mb-3">
              Analytics & Telemetry
            </h1>
            <p className="text-zinc-400 text-sm md:text-base max-w-xl">
              Track your communication efficiency and monitor vital health markers. 
              Securely export this data for your neurologist or primary care physician.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
            <button onClick={exportToCSV} disabled={healthData.length === 0}
              className="px-5 py-2.5 bg-zinc-900/60 hover:bg-zinc-800 border border-white/10 text-white font-bold text-sm rounded-xl transition-all backdrop-blur-sm shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              <span>📥</span> Export CSV Report
            </button>
            <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/5 backdrop-blur-xl">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setRange(d)}
                  className={`flex-1 sm:flex-none px-6 py-2 rounded-xl text-sm font-bold transition-all duration-300
                    ${range === d ? 'bg-teal-500/20 text-teal-300 shadow-inner border border-teal-500/30' : 'text-zinc-500 hover:text-zinc-300 border border-transparent'}`}>
                  {d} Days
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Call Stats Row ─────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Sessions', value: callStats.total, icon: '📹', color: 'text-teal-400', bg: 'bg-teal-500/10' },
            { label: 'Avg Duration', value: `${Math.floor(callStats.avgDuration / 60)}m ${callStats.avgDuration % 60}s`, icon: '⏱', color: 'text-sky-400', bg: 'bg-sky-500/10' },
            { label: 'Primary Contact', value: callStats.mostCalled, icon: '⭐', color: 'text-violet-400', bg: 'bg-violet-500/10' },
            { label: 'Health Logs', value: healthData.length, icon: '❤️', color: 'text-rose-400', bg: 'bg-rose-500/10' },
          ].map((stat, i) => (
            <div key={i} className="group relative bg-zinc-900/40 hover:bg-zinc-900/80 border border-white/5 hover:border-white/20 rounded-3xl p-6 transition-all duration-300 backdrop-blur-md overflow-hidden">
              <div className={`absolute top-0 right-0 w-24 h-24 ${stat.bg} blur-3xl rounded-full opacity-50 group-hover:opacity-100 transition-opacity`} />
              <div className="relative z-10">
                <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center text-2xl mb-4 border border-white/5 shadow-inner`}>
                  {stat.icon}
                </div>
                <p className={`font-black text-2xl tracking-tight mb-1 ${stat.color}`}>{stat.value}</p>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* ── Input modes pie ─────────────────────── */}
          <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-md shadow-2xl">
            <div className="mb-6">
              <h3 className="text-lg font-bold text-white">Input Modalities</h3>
              <p className="text-xs text-zinc-500">Distribution of your accessibility methods</p>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={callStats.modesUsed} cx="50%" cy="50%" innerRadius={60} outerRadius={90}
                  dataKey="value" stroke="none" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {callStats.modesUsed.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* ── Top phrases bar ─────────────────────── */}
          <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-md shadow-2xl">
            <div className="mb-6">
              <h3 className="text-lg font-bold text-white">High-Frequency Syntax</h3>
              <p className="text-xs text-zinc-500">Most utilized quick-phrases during active sessions</p>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topPhrases} layout="vertical" margin={{ left: 10, right: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="phrase" tick={{ fill: '#a1a1aa', fontSize: 12, fontWeight: 600 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Bar dataKey="count" fill="#2dd4bf" radius={[0, 8, 8, 0]} barSize={16}>
                  {topPhrases.map((_, i) => (
                    <Cell key={i} fill={`hsl(172, 66%, ${50 - i * 3}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Health trends ─────────────────────────── */}
        {loading ? (
          <div className="h-64 rounded-3xl bg-zinc-900/40 border border-white/5 animate-pulse" />
        ) : healthData.length > 0 ? (
          <div className="space-y-6">
            {/* Sleep + Pain line chart */}
            <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-md shadow-2xl">
              <div className="mb-6">
                <h3 className="text-lg font-bold text-white">Biometric Overview (Sleep & Pain)</h3>
                <p className="text-xs text-zinc-500">Self-reported telemetry over the last {range} days</p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={healthData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} dy={10} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px', color: '#a1a1aa', paddingTop: '20px' }} iconType="circle" />
                  <Line type="monotone" dataKey="sleep" name="Sleep Quality (1-5)" stroke="#38bdf8" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#38bdf8', stroke: '#020808', strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="pain" name="Pain Level (1-10)" stroke="#fb7185" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: '#fb7185', stroke: '#020808', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Mood trend */}
              <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-md shadow-2xl">
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-white">Mental State Trajectory</h3>
                  <p className="text-xs text-zinc-500">Daily mood logs quantified (1-5 scale)</p>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={healthData} margin={{ left: -25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} dy={10} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 5]} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                    <Bar dataKey="mood" name="Mood" fill="#a78bfa" radius={[6, 6, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* ALS Blink strength tracker */}
              {isParalyzed && healthData.some(d => d.ear !== null) && (
                <div className="bg-zinc-900/40 border border-white/5 hover:border-violet-500/30 transition-colors rounded-3xl p-6 backdrop-blur-md shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/5 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="relative z-10 mb-6">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-bold text-white">Neurological Decline Marker (EAR)</h3>
                      <span className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-300 text-[10px] font-black tracking-widest uppercase border border-violet-500/30">ALS Telemetry</span>
                    </div>
                    <p className="text-xs text-zinc-400">Eye Aspect Ratio (EAR). Lower values trend towards disease progression. Please share with physician.</p>
                  </div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={healthData.filter(d => d.ear !== null)} margin={{ left: -25 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} dy={10} />
                      <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line type="monotone" dataKey="ear" name="EAR Value" stroke="#a78bfa" strokeWidth={3} dot={{ fill: '#18181b', stroke: '#a78bfa', strokeWidth: 2, r: 4 }} activeDot={{ r: 7, fill: '#a78bfa' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900/20 border border-white/5 rounded-3xl p-16 text-center backdrop-blur-sm shadow-xl">
            <div className="w-24 h-24 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center text-4xl mb-6 mx-auto shadow-inner">📊</div>
            <h3 className="text-2xl font-black text-white mb-3">Insufficient Telemetry Data</h3>
            <p className="text-zinc-500 text-sm max-w-sm mx-auto">
              Please log your daily health metrics from the main dashboard to generate predictive analytics and visual trends.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
