// client/src/pages/HelperSchedule.jsx
import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/stores';
import api from '../lib/api';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const TASK_CATEGORIES = [
  { id: 'routine', label: 'Morning Routine', icon: '☀️' },
  { id: 'meal', label: 'Meal', icon: '🍽' },
  { id: 'physio', label: 'Physiotherapy', icon: '🏃' },
  { id: 'med', label: 'Medication', icon: '💊' },
  { id: 'other', label: 'Miscellaneous', icon: '📋' },
];

export default function HelperSchedule() {
  const { user } = useAuthStore();
  const [patients, setPatients] = useState([]);
  const [activeP, setActiveP] = useState(null);
  const [medicines, setMedicines] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState('medicine');
  const [showAddMed, setShowAddMed] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [saving, setSaving] = useState(false);

  const [medForm, setMedForm] = useState({ name: '', dosage: '', times: ['08:00'] });
  const [taskForm, setTaskForm] = useState({ title: '', notes: '', category: 'routine', scheduledFor: '' });

  useEffect(() => {
    fetchPatients();
  }, []);

  useEffect(() => {
    if (activeP) { fetchMedicines(); fetchTasks(); }
  }, [activeP]);

  const fetchPatients = async () => {
    try {
      const res = await api.get('/auth/me');
      const pts = res.data.user.patients || [];
      setPatients(pts);
      if (pts.length) setActiveP(pts[0]._id);
    } catch { }
  };

  const fetchMedicines = async () => {
    try {
      const res = await api.get(`/medicines/patient/${activeP}`);
      setMedicines(res.data.medicines || []);
    } catch { }
  };

  const fetchTasks = async () => {
    setTasks([]);
  };

  const addTime = () => setMedForm(p => ({ ...p, times: [...p.times, '12:00'] }));
  const removeTime = (i) => setMedForm(p => ({ ...p, times: p.times.filter((_, idx) => idx !== i) }));
  const updateTime = (i, val) => setMedForm(p => ({ ...p, times: p.times.map((t, idx) => idx === i ? val : t) }));

  const saveMedicine = async () => {
    if (!medForm.name || !medForm.dosage) { toast.error('Configuration incomplete: Name and dosage are required.'); return; }
    setSaving(true);
    try {
      await api.post('/medicines', { ...medForm, patientId: activeP });
      toast.success('Medication protocol synchronized');
      fetchMedicines();
      setShowAddMed(false);
      setMedForm({ name: '', dosage: '', times: ['08:00'] });
    } catch { toast.error('Synchronization failed'); }
    finally { setSaving(false); }
  };

  const deleteMedicine = async (id) => {
    try {
      await api.delete(`/medicines/${id}`);
      fetchMedicines();
      toast.success('Protocol archived');
    } catch { }
  };

  const saveTask = async () => {
    if (!taskForm.title) { toast.error('Task definition requires a title'); return; }
    setSaving(true);
    try {
      setTasks(p => [...p, { ...taskForm, _id: Date.now(), status: 'todo' }]);
      toast.success('Care objective scheduled');
      setShowAddTask(false);
      setTaskForm({ title: '', notes: '', category: 'routine', scheduledFor: '' });
    } catch { toast.error('Failed to schedule objective'); }
    finally { setSaving(false); }
  };

  const activePatient = patients.find(p => p._id === activeP);

  return (
    <div className="min-h-screen bg-[#020808] bg-[radial-gradient(circle_at_top_right,rgba(13,47,45,0.4),rgba(2,8,8,1))] text-white font-sans selection:bg-teal-500/30 selection:text-teal-200">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-8 lg:py-10">

        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6 mb-10">
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-white via-white to-zinc-500 mb-3">
              Care Scheduling
            </h1>
            <p className="text-zinc-400 text-sm md:text-base">
              Establish rigorous medication and objective protocols for your network.
            </p>
          </div>
        </div>

        {patients.length === 0 ? (
          <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-16 text-center backdrop-blur-md shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 blur-3xl rounded-full pointer-events-none" />
            <div className="text-6xl mb-6 relative z-10">👥</div>
            <h3 className="text-2xl font-black text-white mb-4 relative z-10">Network Unavailable</h3>
            <p className="text-zinc-400 max-w-md mx-auto relative z-10">
              No patients are currently linked to your caregiver account.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

            {/* Patient selector */}
            <div className="lg:col-span-3 space-y-4">
              <div className="flex items-center justify-between px-2 mb-2">
                <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest">Active Patients</h2>
                <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse shadow-[0_0_8px_rgba(20,184,166,0.8)]" />
              </div>
              
              <div className="space-y-3 max-h-[800px] overflow-y-auto pr-2 custom-scrollbar">
                {patients.map(pt => (
                  <button key={pt._id} onClick={() => setActiveP(pt._id)}
                    className={`w-full text-left p-4 rounded-3xl border transition-all duration-300 relative overflow-hidden group flex items-center gap-4
                      ${activeP === pt._id
                        ? 'bg-teal-500/15 border-teal-500/30 shadow-lg'
                        : 'bg-zinc-900/40 border-white/5 hover:bg-white/5 hover:border-white/20'}`}>
                    
                    {activeP === pt._id && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.8)]" />}
                    
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500/20 to-zinc-800 border border-teal-500/20 flex items-center justify-center text-white font-black text-lg flex-shrink-0 relative z-10">
                      {pt.name?.[0]?.toUpperCase()}
                    </div>
                    
                    <div className="flex-1 min-w-0 relative z-10">
                      <p className={`text-sm font-bold truncate ${activeP === pt._id ? 'text-teal-300' : 'text-white'}`}>{pt.name}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-0.5">{pt.disabilityType}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Main content */}
            <div className="lg:col-span-9 space-y-6">
              
              {/* Header Card */}
              {activePatient && (
                <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-4 relative overflow-hidden">
                  <div className="absolute -top-20 -right-20 w-64 h-64 bg-teal-500/5 blur-[60px] rounded-full pointer-events-none" />
                  
                  <div className="flex items-center gap-4 relative z-10">
                    <div className="w-14 h-14 rounded-2xl bg-zinc-800 border border-white/10 flex items-center justify-center text-2xl">
                      📅
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-white mb-1">Schedule Matrix: <span className="text-teal-400">{activePatient.name}</span></h2>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Active Schedule</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                {[
                  { id: 'medicine', icon: '💊', label: 'Medication Protocols' },
                  { id: 'tasks', icon: '📋', label: 'Care Tasks' },
                  { id: 'log', icon: '📊', label: 'Adherence Logs' },
                ].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 px-5 py-3 rounded-2xl border text-sm font-bold transition-all flex-shrink-0
                      ${tab === t.id
                        ? 'bg-teal-500/15 border-teal-500/30 text-teal-300 shadow-inner'
                        : 'bg-zinc-900/40 border-white/5 text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
                    <span className="text-xl">{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>

              {/* ── MEDICINE TAB ───────────────────────── */}
              {tab === 'medicine' && (
                <div className="space-y-6 animate-fade-in relative z-10">
                  <div className="flex justify-between items-center bg-zinc-900/20 px-6 py-4 rounded-3xl border border-white/5">
                    <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
                      <span className="text-white">{medicines.length}</span> Active Medication{medicines.length !== 1 ? 's' : ''}
                    </p>
                    <button onClick={() => setShowAddMed(p => !p)}
                      className="px-5 py-2.5 bg-teal-500/10 text-teal-400 hover:bg-teal-500 hover:text-teal-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all border border-teal-500/30">
                      + Add Medication
                    </button>
                  </div>

                  {/* Add medicine form */}
                  {showAddMed && (
                    <div className="bg-zinc-900/60 border border-teal-500/20 rounded-3xl p-6 md:p-8 backdrop-blur-md shadow-2xl relative overflow-hidden animate-slide-down">
                      <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/5 blur-[80px] rounded-full pointer-events-none" />
                      
                      <h3 className="text-lg font-black text-white mb-6 relative z-10 flex items-center gap-2">
                        <span className="text-teal-400">💊</span> Add New Medication
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                        <div>
                          <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Medication Name</label>
                          <input className="w-full bg-zinc-950 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-all text-sm font-medium shadow-inner" placeholder="e.g. Donepezil"
                            value={medForm.name} onChange={e => setMedForm(p => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div>
                          <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Prescribed Dosage</label>
                          <input className="w-full bg-zinc-950 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-all text-sm font-medium shadow-inner" placeholder="e.g. 10mg"
                            value={medForm.dosage} onChange={e => setMedForm(p => ({ ...p, dosage: e.target.value }))} />
                        </div>
                      </div>

                      <div className="mt-8 relative z-10">
                        <div className="flex items-center justify-between mb-4">
                          <label className="text-xs font-black text-zinc-500 uppercase tracking-widest">Scheduled Times</label>
                          <button onClick={addTime} className="text-xs font-bold text-teal-400 hover:text-teal-300 transition-colors">+ Add Time</button>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {medForm.times.map((t, i) => (
                            <div key={i} className="flex items-center gap-2 bg-zinc-950 border border-white/10 rounded-xl px-3 py-2 shadow-inner group">
                              <span className="text-zinc-500 text-sm">⏰</span>
                              <input type="time" className="bg-transparent text-sm text-white font-mono font-bold outline-none"
                                value={t} onChange={e => updateTime(i, e.target.value)} />
                              {medForm.times.length > 1 && (
                                <button onClick={() => removeTime(i)} className="text-zinc-600 hover:text-rose-400 text-sm ml-2 transition-colors">✕</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-8 flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 relative z-10">
                        <span className="text-2xl mt-0.5">⚠️</span>
                        <div>
                          <p className="text-sm text-amber-400 font-bold mb-1">Automated Reminders Active</p>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            Patient receives TTS and visual prompts at scheduled intervals. Failure to confirm administration within 3 minutes triggers automated email alerts to all caregivers.
                          </p>
                        </div>
                      </div>

                      <div className="mt-8 flex gap-3 relative z-10">
                        <button onClick={() => setShowAddMed(false)}
                          className="flex-1 py-3.5 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm rounded-xl transition-all shadow-md">Cancel</button>
                        <button onClick={saveMedicine} disabled={saving}
                          className="flex-[2] py-3.5 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black tracking-wide rounded-xl transition-all shadow-lg active:scale-95 disabled:opacity-50">
                          {saving ? 'Saving...' : 'Save Medication'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Medicine list */}
                  {medicines.length === 0 && !showAddMed && (
                    <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-16 text-center shadow-xl">
                      <div className="text-6xl mb-4 opacity-50">💊</div>
                      <p className="text-zinc-400 font-bold uppercase tracking-widest text-sm">No medications added</p>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-1 gap-4">
                    {medicines.map(med => (
                      <div key={med._id} className="bg-zinc-900/40 border border-white/5 p-6 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 hover:border-white/10 transition-colors shadow-lg group">
                        <div className="flex items-start gap-5">
                          <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-3xl flex-shrink-0 shadow-inner group-hover:bg-teal-500/20 transition-colors">
                            💊
                          </div>
                          <div>
                            <p className="text-xl font-black text-white mb-1">{med.name}</p>
                            <p className="text-sm font-bold text-teal-400 mb-3">{med.dosage}</p>
                            <div className="flex flex-wrap gap-2">
                              {med.times?.map((t, i) => (
                                <span key={i} className="px-3 py-1 rounded-lg bg-zinc-950 border border-white/5 text-xs font-mono font-bold text-zinc-300 shadow-sm flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" /> {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-start md:items-end gap-3 w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t border-white/5 md:border-0">
                          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-black uppercase tracking-widest">
                            <span>📊</span> {med.confirmations?.filter(c => c.confirmed).length || 0} Doses Taken
                          </div>
                          <button onClick={() => deleteMedicine(med._id)}
                            className="text-xs font-bold text-rose-400 hover:text-white hover:bg-rose-500 px-4 py-2 rounded-xl transition-all">Delete Medication</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── TASKS TAB ──────────────────────────── */}
              {tab === 'tasks' && (
                <div className="space-y-6 animate-fade-in relative z-10">
                  <div className="flex justify-between items-center bg-zinc-900/20 px-6 py-4 rounded-3xl border border-white/5">
                    <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
                      <span className="text-white">{tasks.length}</span> Total Task{tasks.length !== 1 ? 's' : ''}
                    </p>
                    <button onClick={() => setShowAddTask(p => !p)}
                      className="px-5 py-2.5 bg-teal-500/10 text-teal-400 hover:bg-teal-500 hover:text-teal-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all border border-teal-500/30">
                      + Add Task
                    </button>
                  </div>

                  {showAddTask && (
                    <div className="bg-zinc-900/60 border border-teal-500/20 rounded-3xl p-6 md:p-8 backdrop-blur-md shadow-2xl relative overflow-hidden animate-slide-down">
                      <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/5 blur-[80px] rounded-full pointer-events-none" />
                      
                      <h3 className="text-lg font-black text-white mb-6 relative z-10 flex items-center gap-2">
                        <span className="text-teal-400">📋</span> Add New Task
                      </h3>
                      
                      <div className="space-y-6 relative z-10">
                        <div>
                          <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Task Title</label>
                          <input className="w-full bg-zinc-950 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-all text-sm font-medium shadow-inner" placeholder="e.g. Morning stretching routine"
                            value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} />
                        </div>
                        
                        <div>
                          <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-3">Classification</label>
                          <div className="flex flex-wrap gap-2">
                            {TASK_CATEGORIES.map(c => (
                              <button key={c.id} onClick={() => setTaskForm(p => ({ ...p, category: c.id }))}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all
                                  ${taskForm.category === c.id
                                    ? 'bg-teal-500/20 border-teal-500/40 text-teal-300 shadow-inner'
                                    : 'bg-zinc-950 border-white/5 text-zinc-400 hover:bg-zinc-900'}`}>
                                <span className="text-base">{c.icon}</span> {c.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Scheduled Time</label>
                            <input type="datetime-local" className="w-full bg-zinc-950 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-all text-sm font-medium font-mono shadow-inner"
                              value={taskForm.scheduledFor} onChange={e => setTaskForm(p => ({ ...p, scheduledFor: e.target.value }))} />
                          </div>
                          <div>
                            <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Notes</label>
                            <textarea className="w-full bg-zinc-950 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 transition-all text-sm font-medium shadow-inner resize-none" rows={2}
                              placeholder="e.g. Take with food..."
                              value={taskForm.notes} onChange={e => setTaskForm(p => ({ ...p, notes: e.target.value }))} />
                          </div>
                        </div>

                        <div className="flex gap-3 pt-4 border-t border-white/5">
                          <button onClick={() => setShowAddTask(false)} className="flex-1 py-3.5 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm rounded-xl transition-all shadow-md">Cancel</button>
                          <button onClick={saveTask} disabled={saving} className="flex-[2] py-3.5 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black tracking-wide rounded-xl transition-all shadow-lg active:scale-95 disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Task'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Kanban columns */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {['todo', 'done', 'skip'].map(status => (
                      <div key={status} className="bg-zinc-900/40 border border-white/5 rounded-3xl p-5 shadow-xl flex flex-col h-[600px]">
                        <div className={`text-xs font-black tracking-widest uppercase px-4 py-2.5 rounded-xl mb-4 text-center border shadow-inner flex items-center justify-between
                          ${status === 'todo' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' :
                            status === 'done' ? 'bg-teal-500/10 text-teal-400 border-teal-500/20' :
                              'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                          <span>{status === 'todo' ? 'Pending' : status === 'done' ? 'Completed' : 'Skipped'}</span>
                          <span className="w-6 h-6 rounded-full bg-zinc-950 flex items-center justify-center text-[10px]">{tasks.filter(t => t.status === status).length}</span>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                          {tasks.filter(t => t.status === status).map(task => (
                            <div key={task._id} className="p-4 rounded-2xl bg-zinc-950/80 border border-white/5 shadow-md hover:border-white/20 transition-all group">
                              <div className="flex items-start gap-3 mb-2">
                                <span className="text-xl bg-zinc-900 p-2 rounded-xl shadow-inner flex-shrink-0">{TASK_CATEGORIES.find(c => c.id === task.category)?.icon || '📋'}</span>
                                <div className="pt-1">
                                  <p className="text-sm font-bold text-white leading-tight">{task.title}</p>
                                </div>
                              </div>
                              {task.notes && <p className="text-xs text-zinc-400 leading-relaxed mb-3 bg-zinc-900/50 p-2 rounded-lg">{task.notes}</p>}
                              
                              <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-white/5">
                                {['todo', 'done', 'skip'].filter(s => s !== status).map(s => (
                                  <button key={s} onClick={() => setTasks(p => p.map(t => t._id === task._id ? { ...t, status: s } : t))}
                                    className="flex-1 py-1.5 rounded-lg bg-zinc-900 border border-white/5 text-[10px] font-bold text-zinc-400 hover:text-white hover:border-teal-500/50 transition-all uppercase tracking-widest">
                                    Move to {s}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                          {tasks.filter(t => t.status === status).length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center opacity-50">
                              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">No Tasks</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── LOG TAB ────────────────────────────── */}
              {tab === 'log' && (
                <div className="space-y-6 animate-fade-in relative z-10">
                  <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-8 shadow-xl">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-xl">📊</div>
                      <div>
                        <h3 className="text-xl font-black text-white">Adherence Logs</h3>
                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mt-1">Track patient medication history</p>
                      </div>
                    </div>

                    {medicines.length === 0 ? (
                      <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-2xl">
                        <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">No history available</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {medicines.map(med => {
                          const confCount = med.confirmations?.filter(c => c.confirmed).length || 0;
                          const totalCount = med.confirmations?.length || 0;
                          const rate = totalCount ? Math.round((confCount / totalCount) * 100) : 0;
                          
                          return (
                            <div key={med._id} className="bg-zinc-950/50 border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors">
                              <div className="flex items-start justify-between mb-5">
                                <div>
                                  <p className="text-lg font-black text-white">{med.name}</p>
                                  <p className="text-xs text-teal-400 font-bold">{med.dosage}</p>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                  <div className="relative w-12 h-12 flex items-center justify-center">
                                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                                      <path className="text-zinc-800" strokeWidth="4" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                      <path className={`${rate >= 80 ? 'text-teal-400' : rate >= 50 ? 'text-amber-400' : 'text-rose-400'}`} strokeDasharray={`${rate}, 100`} strokeWidth="4" strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                    </svg>
                                    <div className="absolute flex items-center justify-center text-[10px] font-black text-white">{rate}%</div>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar border-t border-white/5 pt-4">
                                {(med.confirmations || []).slice(-10).reverse().map((c, i) => (
                                  <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900 border border-white/5">
                                    <span className="text-[10px] text-zinc-400 font-mono font-bold tracking-wider">
                                      {new Date(c.time).toLocaleDateString()} · {new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md border
                                      ${c.confirmed ? 'bg-teal-500/10 text-teal-400 border-teal-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                                      {c.confirmed ? 'Confirmed' : 'Missed'}
                                    </span>
                                  </div>
                                ))}
                                {(!med.confirmations || med.confirmations.length === 0) && (
                                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-center py-4">No events logged</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}