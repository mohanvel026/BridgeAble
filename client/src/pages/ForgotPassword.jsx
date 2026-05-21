// client/src/pages/ForgotPassword.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';

export default function ForgotPassword() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const sendOTP = async () => {
    if (!email) { toast.error('Enter your email'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      toast.success('OTP sent to your email');
      setStep(2);
    } catch { toast.error('Failed to send OTP'); }
    finally { setLoading(false); }
  };

  const resetPassword = async () => {
    if (!otp || !newPassword) { toast.error('Fill all fields'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { email, otp, newPassword });
      toast.success('Password reset! Please login.');
      setStep(3);
    } catch { toast.error('Invalid or expired OTP'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-mesh-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-scale-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-cyan to-accent-teal
                             flex items-center justify-center text-dark-950 font-bold text-lg shadow-glow">B</div>
            <span className="font-display text-2xl font-semibold">BridgeAble</span>
          </div>
        </div>

        <div className="card p-8 space-y-5">
          {step === 1 && (
            <>
              <div>
                <h2 className="font-display text-2xl font-semibold mb-1">Reset Password</h2>
                <p className="text-text-secondary text-sm">We'll send a 6-digit OTP to your email</p>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Email address</label>
                <input className="input" type="email" placeholder="you@email.com" value={email}
                  onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendOTP()} />
              </div>
              <button className="btn-primary w-full py-3.5" onClick={sendOTP} disabled={loading}>
                {loading ? 'Sending...' : 'Send OTP →'}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <h2 className="font-display text-2xl font-semibold mb-1">Enter OTP</h2>
                <p className="text-text-secondary text-sm">Check your email — OTP expires in 10 minutes</p>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">6-digit OTP</label>
                <input className="input text-center text-2xl font-mono tracking-widest" placeholder="000000"
                  value={otp} maxLength={6} onChange={e => setOtp(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">New password</label>
                <input className="input" type="password" placeholder="Min 8 characters"
                  value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              </div>
              <button className="btn-primary w-full py-3.5" onClick={resetPassword} disabled={loading}>
                {loading ? 'Verifying...' : 'Reset Password →'}
              </button>
            </>
          )}

          {step === 3 && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="font-display text-xl font-semibold mb-2">Password Reset!</h2>
              <p className="text-text-secondary text-sm mb-6">You can now login with your new password</p>
              <Link to="/login" className="btn-primary px-8 py-3">Go to Login →</Link>
            </div>
          )}

          {step < 3 && (
            <p className="text-center text-text-muted text-sm">
              Remember it? <Link to="/login" className="text-accent-cyan hover:underline">Sign in</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}