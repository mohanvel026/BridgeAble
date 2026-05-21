// client/src/components/Navbar.jsx
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import toast from 'react-hot-toast';

const NAV_LINKS = [
  { path: '/dashboard', label: 'Home', icon: '⌂' },
  { path: '/connect', label: 'Connect', icon: '🌐' },
  { path: '/community', label: 'Community', icon: '💬' },
  { path: '/helper/dashboard', label: 'Helper', icon: '🏥', roles: ['normal'] },
  { path: '/history', label: 'History', icon: '📋' },
  { path: '/stats', label: 'Stats', icon: '📊' },
];

export default function Navbar() {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState('dark');

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('light', next === 'light');
  };

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const visibleLinks = NAV_LINKS.filter(l => !l.roles || l.roles.includes(user?.disabilityType));

  return (
    <header className="sticky top-0 z-50 border-b"
      style={{ background: 'rgba(4,13,12,0.85)', borderColor: 'var(--border)', backdropFilter: 'blur(20px)' }}>
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link to="/dashboard" className="flex items-center gap-2.5 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-cyan to-accent-teal
                           flex items-center justify-center text-dark-950 font-bold text-sm shadow-glow-sm">
            B
          </div>
          <span className="font-display font-semibold hidden sm:block">BridgeAble</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {visibleLinks.map(link => (
            <Link key={link.path} to={link.path}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-all
                           ${location.pathname === link.path
                  ? 'bg-accent-cyan/10 text-accent-cyan'
                  : 'text-text-secondary hover:text-text-primary hover:bg-dark-800'}`}>
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <button onClick={toggleTheme}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary
                         hover:text-text-primary hover:bg-dark-800 transition-all">
            {theme === 'dark' ? '☀' : '🌙'}
          </button>

          {/* Notifications */}
          <Link to="/send"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary
                         hover:text-text-primary hover:bg-dark-800 transition-all relative">
            🔔
          </Link>

          {/* Profile */}
          <div className="relative">
            <button onClick={() => setMenuOpen(p => !p)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-dark-800 transition-all">
              {user?.avatar
                ? <img src={user.avatar} className="w-7 h-7 rounded-full object-cover" alt={user.name} />
                : <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent-cyan to-accent-teal
                                   flex items-center justify-center text-dark-950 text-xs font-bold">
                  {user?.name?.[0]}
                </div>
              }
              <span className="text-sm text-text-secondary hidden sm:block">{user?.name?.split(' ')[0]}</span>
              <span className="text-text-muted text-xs">▾</span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 card p-1 z-50 animate-slide-down">
                <Link to="/profile" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-dark-800 transition-all text-sm text-text-secondary hover:text-text-primary">
                  👤 Profile & Settings
                </Link>
                <Link to="/pricing" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-dark-800 transition-all text-sm text-text-secondary hover:text-text-primary">
                  ⚡ {user?.plan === 'pro' ? 'Pro Plan ✓' : 'Upgrade to Pro'}
                </Link>
                <hr className="my-1 border-dark-700" />
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-dark-800 transition-all text-sm text-accent-rose">
                  ↩ Logout
                </button>
              </div>
            )}
          </div>

          {/* Mobile menu */}
          <button onClick={() => setMenuOpen(p => !p)} className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center hover:bg-dark-800">
            ☰
          </button>
        </div>
      </div>

      {/* Mobile nav dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t px-4 py-3 space-y-1 animate-slide-down"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
          {visibleLinks.map(link => (
            <Link key={link.path} to={link.path} onClick={() => setMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all
                           ${location.pathname === link.path
                  ? 'bg-accent-cyan/10 text-accent-cyan'
                  : 'text-text-secondary hover:text-text-primary hover:bg-dark-800'}`}>
              <span>{link.icon}</span><span>{link.label}</span>
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}