// client/src/pages/Profile.jsx
import { useState, useRef } from 'react';
import { useAuthStore } from '../store/stores';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const SECTION_TABS = [
  { id: 'profile', icon: '👤', label: 'Identity' },
  { id: 'accessibility', icon: '♿', label: 'Accessibility' },
  { id: 'helpers', icon: '🤝', label: 'Care Network' },
  { id: 'privacy', icon: '🔒', label: 'Security' },
  { id: 'notifications', icon: '🔔', label: 'Alerts' },
];

const INTERESTS = ['Music', 'Sports', 'Cooking', 'Travel', 'Books', 'Tech', 'Art', 'Movies', 'Gaming', 'Fitness', 'Nature', 'Science'];

export default function Profile() {
  const { user, updateUser } = useAuthStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [helperEmail, setHelperEmail] = useState('');
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    name: user?.name || '',
    disabilityType: user?.disabilityType || '',
    inputMode: user?.inputMode || 'voice',
    interests: user?.interests || [],
    preferences: user?.preferences || {},
    privacySettings: user?.privacySettings || {},
    notificationPrefs: user?.notificationPrefs || {},
  });

  const setField = (key, val) => setForm(p => ({ ...p, [key]: val }));
  const setPref = (key, val) => setForm(p => ({ ...p, preferences: { ...p.preferences, [key]: val } }));
  const setPriv = (key, val) => setForm(p => ({ ...p, privacySettings: { ...p.privacySettings, [key]: val } }));
  const setNotif = (key, val) => setForm(p => ({ ...p, notificationPrefs: { ...p.notificationPrefs, [key]: val } }));

  const toggleInterest = (i) => {
    setForm(p => ({
      ...p,
      interests: p.interests.includes(i) ? p.interests.filter(x => x !== i) : [...p.interests, i],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put('/users/profile', form);
      updateUser(res.data.user);
      toast.success('Configuration synchronized');
    } catch { toast.error('Synchronization failed'); }
    finally { setSaving(false); }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.append('avatar', file);
    const toastId = toast.loading('Uploading avatar...');
    try {
      const res = await api.put('/users/profile', data, { headers: { 'Content-Type': 'multipart/form-data' } });
      updateUser({ avatar: res.data.user.avatar });
      toast.success('Avatar updated', { id: toastId });
    } catch { toast.error('Upload failed', { id: toastId }); }
  };

  const handleLinkHelper = async () => {
    if (!helperEmail.trim()) return;
    try {
      await api.post('/users/link-helper', { helperEmail });
      toast.success('Care network updated');
      setHelperEmail('');
    } catch { toast.error('User not found in system'); }
  };

  const handleUnlinkHelper = async (helperId) => {
    try {
      await api.delete(`/users/unlink-helper/${helperId}`);
      updateUser({ helpers: user.helpers.filter(h => h._id !== helperId) });
      toast.success('Helper disconnected');
    } catch { toast.error('Disconnection failed'); }
  };

  const fontSize = form.preferences.fontSize || 'medium';
  const fontSizeClass = { small: 'text-sm', medium: 'text-base', large: 'text-lg' }[fontSize];

  return (
    <div className={`min-h-screen bg-[#020808] bg-[radial-gradient(circle_at_50%_0%,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans ${form.preferences.highContrast ? 'contrast-125 saturate-150' : ''}`}>
      <Navbar />
      <main className={`max-w-6xl mx-auto px-4 py-8 lg:py-12 flex flex-col lg:flex-row gap-8 ${fontSizeClass}`}>

        {/* Desktop Sidebar Navigation */}
        <aside className="w-full lg:w-72 flex-shrink-0">
          <div className="sticky top-24">
            <h1 className="text-3xl font-black tracking-tight text-white mb-6">Settings</h1>
            <div className="flex lg:flex-col gap-2 overflow-x-auto pb-4 lg:pb-0 custom-scrollbar">
              {SECTION_TABS.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={`flex-shrink-0 lg:w-full flex items-center gap-3 px-5 py-3.5 rounded-2xl text-sm font-bold transition-all duration-300 relative overflow-hidden group
                    ${activeTab === t.id
                      ? 'bg-teal-500/15 border border-teal-500/30 text-teal-300 shadow-inner'
                      : 'bg-zinc-900/40 border border-white/5 text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
                  {activeTab === t.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-400 rounded-r-full shadow-[0_0_10px_rgba(45,212,191,0.5)]" />}
                  <span className="text-xl group-hover:scale-110 transition-transform">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            
            <div className="hidden lg:block mt-8 pt-8 border-t border-white/5">
              <button onClick={handleSave} disabled={saving}
                className="w-full py-4 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black tracking-wide rounded-2xl transition-all shadow-lg shadow-teal-500/25 active:scale-95 disabled:opacity-50">
                {saving ? 'Synchronizing...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 md:p-10 backdrop-blur-xl shadow-2xl relative overflow-hidden">
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-teal-500/5 blur-[100px] rounded-full pointer-events-none" />

            {/* ── PROFILE TAB ─────────────────────────────── */}
            {activeTab === 'profile' && (
              <div className="space-y-8 animate-fade-in relative z-10">
                {/* Avatar Module */}
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 pb-8 border-b border-white/5">
                  <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                    <div className="absolute inset-0 bg-teal-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                    {user?.avatar
                      ? <img src={user.avatar} className="w-28 h-28 rounded-3xl object-cover border-2 border-white/10 relative z-10 shadow-xl group-hover:border-teal-500/50 transition-colors" alt={user.name} />
                      : <div className="w-28 h-28 rounded-3xl bg-gradient-to-br from-teal-500/20 to-zinc-800 border-2 border-white/10 relative z-10 shadow-xl flex items-center justify-center text-4xl font-black text-white group-hover:border-teal-500/50 transition-colors">
                        {user?.name?.[0]?.toUpperCase()}
                      </div>
                    }
                    <div className="absolute -bottom-3 -right-3 w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-600 flex items-center justify-center text-sm shadow-xl z-20 group-hover:bg-teal-500 group-hover:text-teal-950 group-hover:border-teal-400 transition-all">
                      ✏️
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                  </div>
                  <div className="text-center sm:text-left pt-2">
                    <h2 className="text-2xl font-black text-white">{user?.name}</h2>
                    <p className="text-zinc-400 text-sm font-mono mt-1">{user?.email}</p>
                    <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-white/10 text-xs font-bold tracking-widest uppercase">
                      <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                      System Access: <span className={user?.plan === 'pro' ? 'text-amber-400' : 'text-teal-400'}>{user?.plan || 'Free'}</span>
                    </div>
                  </div>
                </div>

                {/* Identity & Localization */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Display Name</label>
                    <input className="w-full bg-zinc-950 border border-white/5 text-white rounded-xl px-4 py-3.5 focus:outline-none focus:border-teal-500/50 transition-colors text-sm font-medium" 
                      value={form.name} onChange={e => setField('name', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">Interface Language</label>
                    <select className="w-full bg-zinc-950 border border-white/5 text-white rounded-xl px-4 py-3.5 focus:outline-none focus:border-teal-500/50 transition-colors text-sm font-medium appearance-none" 
                      value={form.preferences.language || 'en'} onChange={e => setPref('language', e.target.value)}>
                      <option value="en">English (US)</option>
                      <option value="hi">Hindi (India)</option>
                      <option value="es">Spanish (ES)</option>
                    </select>
                  </div>
                </div>

                {/* Input Modality */}
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Primary Neural Modality</label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                      { id: 'gesture', icon: '👋', label: 'Sign' },
                      { id: 'blink', icon: '👁', label: 'Blink' },
                      { id: 'symbol', icon: '🗂', label: 'AAC' },
                      { id: 'voice', icon: '🎙', label: 'Voice' },
                      { id: 'type', icon: '⌨️', label: 'Type' },
                    ].map(m => (
                      <button key={m.id} onClick={() => setField('inputMode', m.id)}
                        className={`flex flex-col items-center justify-center gap-2 py-4 rounded-2xl border transition-all duration-300
                          ${form.inputMode === m.id
                            ? 'bg-teal-500/20 border-teal-500/40 text-teal-300 shadow-inner scale-105'
                            : 'bg-zinc-950 border-white/5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'}`}>
                        <span className="text-2xl">{m.icon}</span>
                        <span className="text-[10px] font-black uppercase tracking-wider">{m.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cognitive Interests */}
                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Cognitive Interests</label>
                  <div className="flex flex-wrap gap-2">
                    {INTERESTS.map(i => (
                      <button key={i} onClick={() => toggleInterest(i)}
                        className={`px-4 py-2 rounded-full border text-xs font-bold transition-all
                          ${form.interests.includes(i)
                            ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                            : 'bg-zinc-950 border-white/5 text-zinc-500 hover:bg-zinc-900'}`}>
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── ACCESSIBILITY TAB ──────────────────────── */}
            {activeTab === 'accessibility' && (
              <div className="space-y-8 animate-fade-in relative z-10">
                <div className="pb-6 border-b border-white/5">
                  <h2 className="text-2xl font-black text-white mb-2">Display & Audio</h2>
                  <p className="text-zinc-400 text-sm">Tune the application engine to your exact sensory requirements.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Font Scaling */}
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Typography Scaling</label>
                    <div className="flex gap-2 p-1.5 bg-zinc-950 rounded-2xl border border-white/5">
                      {['small', 'medium', 'large'].map((s, i) => (
                        <button key={s} onClick={() => setPref('fontSize', s)}
                          className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all capitalize
                            ${form.preferences.fontSize === s ? 'bg-teal-500/20 text-teal-300 shadow-inner' : 'text-zinc-500 hover:text-zinc-300'}`}
                          style={{ fontSize: [12, 14, 18][i] }}>
                          Aa
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Engine Theme */}
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Engine Theme</label>
                    <div className="flex gap-2 p-1.5 bg-zinc-950 rounded-2xl border border-white/5">
                      {['dark', 'light'].map(t => (
                        <button key={t} onClick={() => setPref('theme', t)}
                          className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all capitalize flex items-center justify-center gap-2
                            ${form.preferences.theme === t ? 'bg-teal-500/20 text-teal-300 shadow-inner' : 'text-zinc-500 hover:text-zinc-300'}`}>
                          <span>{t === 'dark' ? '🌙' : '☀️'}</span> {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  <Toggle label="High Contrast Rendering" desc="Forces extreme contrast ratios for severe visual impairments" value={form.preferences.highContrast} onChange={v => setPref('highContrast', v)} />
                </div>

                <div className="pt-6 border-t border-white/5">
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">
                    TTS Synthesis Speed <span className="text-teal-400 ml-2 font-mono">[{form.preferences.ttsSpeed || 1.0}x]</span>
                  </label>
                  <input type="range" min="0.5" max="2.5" step="0.1" value={form.preferences.ttsSpeed || 1.0} onChange={e => setPref('ttsSpeed', parseFloat(e.target.value))} className="w-full h-2 bg-zinc-950 rounded-lg appearance-none cursor-pointer accent-teal-500" />
                  <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-3">
                    <span>Lethargic (0.5x)</span><span>Baseline (1x)</span><span>Rapid (2.5x)</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── HELPERS TAB ────────────────────────────── */}
            {activeTab === 'helpers' && (
              <div className="space-y-6 animate-fade-in relative z-10">
                <div className="pb-6 border-b border-white/5">
                  <h2 className="text-2xl font-black text-white mb-2">Emergency Care Network</h2>
                  <p className="text-zinc-400 text-sm">Linked accounts will receive immediate email and SMS alerts when you trigger SOS or miss critical medication.</p>
                </div>

                <div className="space-y-3">
                  {user?.helpers?.length === 0 ? (
                    <div className="p-8 text-center bg-zinc-950/50 rounded-2xl border border-white/5 border-dashed">
                      <p className="text-4xl mb-3">🤝</p>
                      <p className="text-zinc-400 text-sm font-medium">Your care network is currently empty.</p>
                    </div>
                  ) : user?.helpers?.map(h => (
                    <div key={h._id} className="flex items-center justify-between p-4 bg-zinc-950/50 rounded-2xl border border-white/5 group hover:border-teal-500/30 transition-all">
                      <div className="flex items-center gap-4">
                        {h.avatar ? <img src={h.avatar} className="w-12 h-12 rounded-xl object-cover" /> : <div className="w-12 h-12 rounded-xl bg-teal-500/20 flex items-center justify-center text-teal-300 font-black text-lg">{h.name?.[0]}</div>}
                        <div>
                          <p className="text-base font-bold text-white group-hover:text-teal-300 transition-colors">{h.name}</p>
                          <p className="text-xs text-zinc-500 font-mono">{h.email}</p>
                        </div>
                      </div>
                      <button onClick={() => handleUnlinkHelper(h._id)} className="px-4 py-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-xl text-xs font-bold transition-all active:scale-95">Disconnect</button>
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-8 border-t border-white/5">
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Authorize New Caregiver</label>
                  <div className="flex gap-3">
                    <input className="flex-1 bg-zinc-950 border border-white/5 text-white rounded-xl px-4 py-3.5 focus:outline-none focus:border-teal-500/50 transition-colors text-sm font-medium" placeholder="Caregiver's Email Address" value={helperEmail} onChange={e => setHelperEmail(e.target.value)} />
                    <button onClick={handleLinkHelper} disabled={!helperEmail} className="px-6 py-3.5 bg-white text-zinc-950 font-black text-sm rounded-xl hover:bg-teal-400 transition-all shadow-lg active:scale-95 disabled:opacity-50">Authorize</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── SECURITY / PRIVACY TAB ──────────────────────── */}
            {activeTab === 'privacy' && (
              <div className="space-y-8 animate-fade-in relative z-10">
                <div className="pb-6 border-b border-white/5">
                  <h2 className="text-2xl font-black text-white mb-2">Security Matrix</h2>
                  <p className="text-zinc-400 text-sm">Control your digital footprint and incoming connection rules.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Inbound Call Firewall</label>
                  <div className="flex gap-2 p-1.5 bg-zinc-950 rounded-2xl border border-white/5">
                    {['everyone', 'friends', 'nobody'].map(v => (
                      <button key={v} onClick={() => setPriv('whoCanCall', v)}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all capitalize
                          ${form.privacySettings.whoCanCall === v ? 'bg-teal-500/20 text-teal-300 shadow-inner' : 'text-zinc-500 hover:text-zinc-300'}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <Toggle label="Ghost Mode (Community)" desc="Mask your identity as 'Anonymous' in public network hubs" value={form.privacySettings.anonymousCommunity} onChange={v => setPriv('anonymousCommunity', v)} />
                </div>
              </div>
            )}

            {/* ── NOTIFICATIONS TAB ──────────────────────── */}
            {activeTab === 'notifications' && (
              <div className="space-y-8 animate-fade-in relative z-10">
                <div className="pb-6 border-b border-white/5">
                  <h2 className="text-2xl font-black text-white mb-2">Telemetry Alerts</h2>
                  <p className="text-zinc-400 text-sm">Configure event triggers for automated external communication.</p>
                </div>

                <div className="space-y-6">
                  {[
                    { key: 'emailSOS', label: 'Level-1 SOS Overrides', desc: 'Blast emails to Care Network upon emergency trigger' },
                    { key: 'emailMedicineMiss', label: 'Medication Adherence', desc: 'Alert network when scheduled medication is missed' },
                    { key: 'emailCircleReminder', label: 'Peer Group Sync', desc: '30-minute automated email prior to circle session' },
                    { key: 'emailHealthSummary', label: 'Weekly Diagnostics', desc: 'Aggregate health report emailed every Sunday' },
                  ].map(item => (
                    <div key={item.key} className="p-4 bg-zinc-950/40 rounded-2xl border border-white/5">
                      <Toggle label={item.label} desc={item.desc} value={form.notificationPrefs[item.key] !== false} onChange={v => setNotif(item.key, v)} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mobile Save Button */}
            <div className="block lg:hidden mt-8 pt-6 border-t border-white/5">
              <button onClick={handleSave} disabled={saving}
                className="w-full py-4 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black tracking-wide rounded-2xl transition-all shadow-lg active:scale-95 disabled:opacity-50">
                {saving ? 'Synchronizing...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }) {
  return (
    <div className="flex items-center justify-between group cursor-pointer" onClick={() => onChange(!value)}>
      <div className="pr-4">
        <p className="text-sm text-white font-bold mb-1 group-hover:text-teal-300 transition-colors">{label}</p>
        {desc && <p className="text-xs text-zinc-500">{desc}</p>}
      </div>
      <div className={`w-14 h-8 rounded-full border-2 transition-all relative flex-shrink-0 shadow-inner
        ${value ? 'bg-teal-500 border-teal-500' : 'bg-zinc-800 border-zinc-700'}`}>
        <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all shadow-md
          ${value ? 'left-7' : 'left-1'}`} />
      </div>
    </div>
  );
}
