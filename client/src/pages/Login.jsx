// client/src/pages/Login.jsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import toast from 'react-hot-toast';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [fontSize, setFontSize] = useState('medium');
  const [highContrast, setHighContrast] = useState(false);

  const fontSizeMap = { small: 'text-sm', medium: 'text-base', large: 'text-lg' };

  const handleLogin = async () => {
    if (!form.email || !form.password) { toast.error('Please fill all fields'); return; }
    setLoading(true);
    try {
      const res = await login(form.email, form.password);
      toast.success(`Welcome back, ${res.user.name}!`);
      if (res.needsCalibration) navigate('/onboarding');
      else navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen bg-mesh-dark flex items-center justify-center p-4
                     ${highContrast ? 'contrast-125 brightness-110' : ''} ${fontSizeMap[fontSize]}`}>
      {/* Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-accent-cyan/4 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 bg-accent-teal/4 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md animate-scale-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-cyan to-accent-teal
                            flex items-center justify-center text-dark-950 font-bold text-lg shadow-glow">
              B
            </div>
            <span className="font-display text-2xl font-semibold">BridgeAble</span>
          </div>
          <p className="text-text-secondary text-sm">Sign in to continue</p>
        </div>

        {/* Accessibility bar */}
        <div className="flex items-center justify-between mb-4 px-1">
          <span className="text-xs text-text-muted">Accessibility</span>
          <div className="flex items-center gap-3">
            {/* Font size */}
            <div className="flex items-center gap-1">
              {['small', 'medium', 'large'].map((s, i) => (
                <button key={s} onClick={() => setFontSize(s)}
                  className={`w-6 h-6 rounded flex items-center justify-center transition-all
                               ${fontSize === s ? 'bg-accent-cyan/20 text-accent-cyan' : 'text-text-muted hover:text-text-secondary'}`}>
                  <span style={{ fontSize: [10, 13, 16][i] }}>A</span>
                </button>
              ))}
            </div>
            {/* High contrast */}
            <button onClick={() => setHighContrast(p => !p)}
              className={`px-2 py-1 rounded text-xs transition-all
                           ${highContrast ? 'bg-accent-amber/20 text-accent-amber' : 'text-text-muted hover:text-text-secondary'}`}>
              Contrast
            </button>
          </div>
        </div>

        <div className="card p-8 space-y-5">
          <div>
            <h2 className="font-display text-2xl font-semibold mb-1">Welcome back</h2>
            <p className="text-text-secondary text-sm">Every voice deserves to be heard</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1.5">Email</label>
              <input className="input" type="email" placeholder="you@email.com"
                value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-sm text-text-secondary">Password</label>
                <Link to="/forgot-password" className="text-xs text-accent-cyan hover:underline">Forgot?</Link>
              </div>
              <input className="input" type="password" placeholder="Your password"
                value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleLogin()} />
            </div>
          </div>

          {/* Remember me */}
          <label className="flex items-center gap-2.5 cursor-pointer group">
            <div onClick={() => setRememberMe(p => !p)}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all
                           ${rememberMe ? 'bg-accent-cyan border-accent-cyan' : 'border-dark-500 group-hover:border-dark-400'}`}>
              {rememberMe && <svg className="w-3 h-3 text-dark-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>}
            </div>
            <span className="text-sm text-text-secondary">Remember me for 30 days</span>
          </label>

          <button className="btn-primary w-full py-3.5 font-semibold" onClick={handleLogin} disabled={loading}>
            {loading ? (
              <span className="flex items-center gap-2 justify-center">
                <span className="w-4 h-4 border-2 border-dark-950/30 border-t-dark-950 rounded-full animate-spin" />
                Signing in...
              </span>
            ) : 'Sign In →'}
          </button>

          {/* Blink login hint */}
          <div className="p-3 rounded-xl bg-accent-violet/5 border border-accent-violet/20">
            <p className="text-xs text-accent-violet font-medium mb-0.5">🫦 Paralyzed / ALS users</p>
            <p className="text-xs text-text-muted">
              Use blink PIN login — available after first setup in Settings
            </p>
          </div>

          <p className="text-center text-text-muted text-sm">
            New here?{' '}
            <Link to="/register" className="text-accent-cyan hover:underline">Create account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}