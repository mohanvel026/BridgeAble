// client/src/pages/Register.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import toast from 'react-hot-toast';

const DISABILITY_CARDS = [
  {
    type: 'deaf',
    icon: '👋',
    label: 'Deaf / Mute',
    desc: 'Communicate using sign language gestures detected by your camera',
    color: 'cyan',
    inputMode: 'gesture',
  },
  {
    type: 'paralyzed',
    icon: '👁',
    label: 'Paralyzed / ALS',
    desc: 'Control the app entirely with eye blinks using Morse code',
    color: 'violet',
    inputMode: 'blink',
  },
  {
    type: 'speech',
    icon: '🗂',
    label: 'Speech Impaired',
    desc: 'Build sentences using a visual symbol board, no voice needed',
    color: 'amber',
    inputMode: 'symbol',
  },
  {
    type: 'blind',
    icon: '🔊',
    label: 'Blind / Low Vision',
    desc: 'Speak naturally — all screen content is read aloud for you',
    color: 'rose',
    inputMode: 'voice',
  },
  {
    type: 'normal',
    icon: '🤝',
    label: 'Helper / Normal',
    desc: 'Support someone you care for — see their messages in real time',
    color: 'teal',
    inputMode: 'voice',
  },
];

const colorMap = {
  cyan: { border: 'border-accent-cyan/40', bg: 'bg-accent-cyan/10', text: 'text-accent-cyan', glow: 'shadow-glow' },
  violet: { border: 'border-accent-violet/40', bg: 'bg-accent-violet/10', text: 'text-accent-violet', glow: 'shadow-[0_0_20px_rgba(167,139,250,0.4)]' },
  amber: { border: 'border-accent-amber/40', bg: 'bg-accent-amber/10', text: 'text-accent-amber', glow: 'shadow-[0_0_20px_rgba(251,191,36,0.4)]' },
  rose: { border: 'border-accent-rose/40', bg: 'bg-accent-rose/10', text: 'text-accent-rose', glow: 'shadow-glow-rose' },
  teal: { border: 'border-accent-teal/40', bg: 'bg-accent-teal/10', text: 'text-accent-teal', glow: 'shadow-[0_0_20px_rgba(45,212,191,0.4)]' },
};

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuthStore();

  const [step, setStep] = useState(1); // 1=account, 2=disability, 3=prefs
  const [form, setForm] = useState({
    name: '', email: '', password: '',
    disabilityType: '', inputMode: '',
    helperEmail: '', language: 'en', speed: 'normal',
  });
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleCardSelect = (card) => {
    setForm(p => ({ ...p, disabilityType: card.type, inputMode: card.inputMode }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const result = await register(form);
      toast.success('Welcome to BridgeAble!');
      if (result.needsCalibration) navigate('/onboarding');
      else navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-mesh-dark flex items-center justify-center p-4">
      {/* Background glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-accent-cyan/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-accent-teal/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-2xl animate-scale-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-cyan to-accent-teal
                            flex items-center justify-center text-dark-950 font-bold text-lg shadow-glow">
              B
            </div>
            <span className="font-display text-2xl font-semibold text-text-primary">BridgeAble</span>
          </div>
          <p className="text-text-secondary text-sm">Communication without barriers</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                              transition-all duration-300 ${step >= s
                  ? 'bg-gradient-to-br from-accent-cyan to-accent-teal text-dark-950'
                  : 'bg-dark-800 text-text-muted border border-dark-600'
                }`}>
                {s}
              </div>
              {s < 3 && <div className={`w-12 h-px transition-all duration-300 ${step > s ? 'bg-accent-cyan' : 'bg-dark-700'}`} />}
            </div>
          ))}
        </div>

        <div className="card p-8">

          {/* ── STEP 1 — Account ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5 animate-slide-up">
              <div>
                <h2 className="font-display text-2xl font-semibold mb-1">Create your account</h2>
                <p className="text-text-secondary text-sm">Start communicating without barriers</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-text-secondary mb-1.5">Full name</label>
                  <input className="input" placeholder="Your name" value={form.name}
                    onChange={e => set('name', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1.5">Email address</label>
                  <input className="input" type="email" placeholder="you@email.com" value={form.email}
                    onChange={e => set('email', e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1.5">Password</label>
                  <input className="input" type="password" placeholder="Min 8 characters" value={form.password}
                    onChange={e => set('password', e.target.value)} />
                </div>
              </div>

              <button className="btn-primary w-full text-sm font-semibold py-3.5"
                onClick={() => {
                  if (!form.name || !form.email || !form.password) {
                    toast.error('Please fill all fields'); return;
                  }
                  setStep(2);
                }}>
                Continue →
              </button>

              <p className="text-center text-text-muted text-sm">
                Already have an account?{' '}
                <Link to="/login" className="text-accent-cyan hover:underline">Sign in</Link>
              </p>
            </div>
          )}

          {/* ── STEP 2 — Disability type ──────────────────────── */}
          {step === 2 && (
            <div className="animate-slide-up">
              <div className="mb-6">
                <h2 className="font-display text-2xl font-semibold mb-1">How do you communicate?</h2>
                <p className="text-text-secondary text-sm">
                  BridgeAble adapts completely to your needs. Choose your type.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 mb-6">
                {DISABILITY_CARDS.map(card => {
                  const c = colorMap[card.color];
                  const selected = form.disabilityType === card.type;
                  return (
                    <button key={card.type}
                      onClick={() => handleCardSelect(card)}
                      className={`w-full text-left p-4 rounded-xl border transition-all duration-200
                                  flex items-center gap-4 group
                                  ${selected
                          ? `${c.bg} ${c.border} ${c.glow}`
                          : 'bg-dark-800 border-dark-600 hover:border-dark-500'
                        }`}>
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0
                                       transition-all ${selected ? c.bg : 'bg-dark-700'}`}>
                        {card.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`font-semibold text-sm mb-0.5 ${selected ? c.text : 'text-text-primary'}`}>
                          {card.label}
                        </div>
                        <div className="text-text-muted text-xs leading-relaxed">{card.desc}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                                       transition-all ${selected ? `${c.border} ${c.bg}` : 'border-dark-500'}`}>
                        {selected && <div className={`w-2.5 h-2.5 rounded-full ${c.bg} ${c.text}`} style={{ background: 'currentColor' }} />}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button className="btn-secondary flex-1" onClick={() => setStep(1)}>← Back</button>
                <button className="btn-primary flex-1"
                  onClick={() => {
                    if (!form.disabilityType) { toast.error('Please select your type'); return; }
                    setStep(3);
                  }}>
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3 — Preferences ─────────────────────────── */}
          {step === 3 && (
            <div className="animate-slide-up space-y-5">
              <div>
                <h2 className="font-display text-2xl font-semibold mb-1">Final setup</h2>
                <p className="text-text-secondary text-sm">Link a helper and set your preferences</p>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">
                  Helper's email <span className="text-text-muted">(optional)</span>
                </label>
                <input className="input" type="email" placeholder="caregiver@email.com"
                  value={form.helperEmail} onChange={e => set('helperEmail', e.target.value)} />
                <p className="text-xs text-text-muted mt-1">
                  They'll be notified and linked automatically
                </p>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Language</label>
                <select className="input" value={form.language} onChange={e => set('language', e.target.value)}>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="ta">Tamil</option>
                  <option value="te">Telugu</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Communication speed</label>
                <div className="flex gap-3">
                  {['slow', 'normal', 'fast'].map(s => (
                    <button key={s} onClick={() => set('speed', s)}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-medium capitalize transition-all
                                  ${form.speed === s
                          ? 'bg-accent-cyan/10 border-accent-cyan/40 text-accent-cyan'
                          : 'bg-dark-800 border-dark-600 text-text-secondary hover:border-dark-500'
                        }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button className="btn-secondary flex-1" onClick={() => setStep(2)}>← Back</button>
                <button className="btn-primary flex-1" onClick={handleSubmit} disabled={loading}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-dark-950/30 border-t-dark-950 rounded-full animate-spin" />
                      Creating...
                    </span>
                  ) : 'Create Account ✓'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}