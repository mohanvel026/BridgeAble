// client/src/pages/IncomingCall.jsx
// Dedicated incoming call page — also handled globally by IncomingCallModal
// This page handles direct URL navigation to /call/incoming

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import { useSocketStore } from '../store/stores';
import IncomingCallModal from '../components/call/IncomingCallModal';

export default function IncomingCall() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { incomingCall } = useSocketStore();

  useEffect(() => {
    // If no incoming call in store, go back to dashboard
    if (!incomingCall) {
      const timeout = setTimeout(() => navigate('/dashboard'), 2000);
      return () => clearTimeout(timeout);
    }
  }, [incomingCall]);

  if (!incomingCall) {
    return (
      <div className="min-h-screen bg-mesh-dark flex items-center justify-center">
        <div className="card p-8 text-center max-w-sm">
          <div className="text-5xl mb-4">📞</div>
          <p className="text-text-secondary text-sm">No incoming call</p>
          <p className="text-text-muted text-xs mt-2">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  // IncomingCallModal handles the actual UI
  return (
    <div className="min-h-screen bg-mesh-dark">
      <IncomingCallModal />
    </div>
  );
}