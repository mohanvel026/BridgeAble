// client/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store/stores';
import { useEffect } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import useSocket from './hooks/useSocket';

import Register from './pages/Register';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import CallRoom from './pages/CallRoom';
import IncomingCall from './pages/IncomingCall';
import GroupCall from './pages/GroupCall';
import Send from './pages/Send';
import HelperDashboard from './pages/HelperDashboard';
import HelperSchedule from './pages/HelperSchedule';
import Connect from './pages/Connect';
import Community from './pages/Community';
import Circles from './pages/Circles';
import Profile from './pages/Profile';
import History from './pages/History';
import Stats from './pages/Stats';
import Pricing from './pages/Pricing';
import SOSButton from './components/SOSButton';
import IncomingCallModal from './components/call/IncomingCallModal';
import BlinkNavigator from './components/BlinkNavigator';
import VoiceNavigator from './components/VoiceNavigator';
import DiscreteNavigator from './components/DiscreteNavigator';

// Protected route wrapper
const Protected = ({ children }) => {
  const { user } = useAuthStore();
  return user ? children : <Navigate to="/login" replace />;
};

export default function App() {
  const { user, refreshMe } = useAuthStore();

  useEffect(() => {
    const theme = user?.preferences?.theme || 'dark';
    const fontSize = user?.preferences?.fontSize || 'medium';
    document.documentElement.className = theme;
    document.documentElement.style.fontSize =
      fontSize === 'small' ? '14px' : fontSize === 'large' ? '18px' : '16px';
    
    // Set global navigation mode for color-coded focus rings
    if (user?.inputMode) {
      document.body.dataset.navMode = user.inputMode;
    } else {
      delete document.body.dataset.navMode;
    }
  }, [user?.preferences, user?.inputMode]);

  useEffect(() => { if (user) refreshMe(); }, []);

  // Init socket connection for logged-in users
  useSocket();

  return (
    <BrowserRouter>
      {/* Global SOS button — visible on every protected page */}
      {user && <SOSButton />}
      {/* Incoming call modal — socket-driven */}
      {user && <IncomingCallModal />}
      {/* Global accessibility navigators — each auto-activates for the right disability type */}
      {user && <BlinkNavigator />}    {/* paralyzed: eye blink navigation */}
      {user && <VoiceNavigator />}    {/* blind: voice command navigation */}
      {user && <DiscreteNavigator />} {/* gesture: Apple TV style focus nav */}

      <ErrorBoundary>
        <Routes>
          {/* Public */}
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* Protected */}
          <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />
          <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/call/room/:roomCode" element={<Protected><CallRoom /></Protected>} />
          <Route path="/call/incoming" element={<Protected><IncomingCall /></Protected>} />
          <Route path="/call/group/:roomCode" element={<Protected><GroupCall /></Protected>} />
          <Route path="/send" element={<Protected><Send /></Protected>} />
          <Route path="/helper/dashboard" element={<Protected><HelperDashboard /></Protected>} />
          <Route path="/helper/schedule" element={<Protected><HelperSchedule /></Protected>} />
          <Route path="/connect" element={<Protected><Connect /></Protected>} />
          <Route path="/community" element={<Protected><Community /></Protected>} />
          <Route path="/circles" element={<Protected><Circles /></Protected>} />
          <Route path="/profile" element={<Protected><Profile /></Protected>} />
          <Route path="/history" element={<Protected><History /></Protected>} />
          <Route path="/stats" element={<Protected><Stats /></Protected>} />
          <Route path="/pricing" element={<Protected><Pricing /></Protected>} />

          <Route path="/" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>

      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0d2421',
            color: '#f0fdfb',
            border: '1px solid rgba(34,211,238,0.2)',
            borderRadius: '12px',
            fontFamily: 'DM Sans, sans-serif',
          },
          success: { iconTheme: { primary: '#22d3ee', secondary: '#040d0c' } },
          error: { iconTheme: { primary: '#fb7185', secondary: '#040d0c' } },
        }}
      />
    </BrowserRouter>
  );
}
