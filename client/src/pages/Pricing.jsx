// client/src/pages/Pricing.jsx
import { useState } from 'react';
import { useAuthStore } from '../store/stores';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const FREE_FEATURES = [
  '1 helper link',
  '30 minutes calls per day',
  'Basic needs board (6 message types)',
  'Community chat rooms',
  'SOS emergency system',
  'Blink calibration',
  'Pain body map',
];

const PRO_FEATURES = [
  'Unlimited helper links',
  'Unlimited call duration',
  'Group calls (up to 4 people)',
  'Peer support circles',
  'Full communication history',
  'Health PDF export (doctor-ready)',
  'Priority SOS routing',
  'Personal analytics + charts',
  'ALS blink strength tracker',
  'Everything in Free',
];

export default function Pricing() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(null);

  const handleStripe = async () => {
    setLoading('stripe');
    await new Promise(r => setTimeout(r, 1000));
    toast.success('Stripe test mode — no real payment. Plan upgraded!');
    setLoading(null);
  };

  const handleRazorpay = async () => {
    setLoading('razorpay');
    await new Promise(r => setTimeout(r, 1000));
    toast.success('Razorpay test mode — UPI simulation. Plan upgraded!');
    setLoading(null);
  };

  const isPro = user?.plan === 'pro';

  return (
    <div className="min-h-screen bg-mesh-dark">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">

        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-semibold mb-2">Simple, honest pricing</h1>
          <p className="text-text-secondary">BridgeAble is free for everyone. Pro unlocks more.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">

          {/* Free */}
          <div className="card p-6">
            <div className="mb-5">
              <h2 className="font-display text-xl font-semibold mb-1">Free</h2>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-text-primary">₹0</span>
                <span className="text-text-muted text-sm">forever</span>
              </div>
            </div>
            <ul className="space-y-2.5 mb-6">
              {FREE_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
                  <span className="text-accent-teal mt-0.5 flex-shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <div className={`w-full py-3 rounded-xl text-center text-sm font-medium
              ${!isPro ? 'bg-accent-teal/10 border border-accent-teal/30 text-accent-teal' : 'bg-dark-800 border border-dark-600 text-text-muted'}`}>
              {!isPro ? '✓ Current plan' : 'Free tier'}
            </div>
          </div>

          {/* Pro */}
          <div className="card p-6 border-accent-cyan/30 relative overflow-hidden">
            {/* Popular badge */}
            <div className="absolute top-4 right-4">
              <span className="badge badge-amber text-xs font-semibold">⭐ Most popular</span>
            </div>

            {/* Glow */}
            <div className="absolute inset-0 bg-gradient-radial from-accent-cyan/5 to-transparent pointer-events-none" />

            <div className="relative mb-5">
              <h2 className="font-display text-xl font-semibold mb-1">Pro</h2>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-accent-cyan">₹299</span>
                <span className="text-text-muted text-sm">/ month</span>
              </div>
              <p className="text-xs text-text-muted mt-1">$9.99 USD · Billed monthly</p>
            </div>

            <ul className="space-y-2.5 mb-6 relative">
              {PRO_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm text-text-secondary">
                  <span className="text-accent-cyan mt-0.5 flex-shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {isPro ? (
              <div className="w-full py-3 rounded-xl text-center text-sm font-medium
                               bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan">
                ✓ Active — Pro Plan
              </div>
            ) : (
              <div className="space-y-2 relative">
                <button onClick={handleStripe} disabled={!!loading}
                  className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-60">
                  {loading === 'stripe' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-dark-950/30 border-t-dark-950 rounded-full animate-spin" />
                      Processing...
                    </span>
                  ) : '💳 Pay with Stripe (International)'}
                </button>
                <button onClick={handleRazorpay} disabled={!!loading}
                  className="w-full py-3 rounded-xl border border-accent-violet/30 bg-accent-violet/10
                               text-accent-violet text-sm font-semibold hover:bg-accent-violet/20
                               transition-all disabled:opacity-60">
                  {loading === 'razorpay' ? 'Processing...' : '🇮🇳 Pay with Razorpay (UPI / India)'}
                </button>
                <p className="text-xs text-text-muted text-center">
                  Test mode — no real payment charged
                </p>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-text-muted text-xs mt-8">
          BridgeAble will never show ads. Your communication is private. Always.
        </p>
      </main>
    </div>
  );
}