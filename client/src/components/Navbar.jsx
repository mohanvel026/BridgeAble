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
  const [scrolled, setScrolled] = useState(false);

  // Add scroll listener for dynamic navbar styling
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out securely');
    navigate('/login');
  };

  const visibleLinks = NAV_LINKS.filter(l => !l.roles || l.roles.includes(user?.disabilityType));

  return (
    <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-black/80 backdrop-blur-2xl border-b border-white/5 shadow-2xl py-0' : 'bg-transparent py-2'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link to="/dashboard" className="flex items-center gap-3 flex-shrink-0 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-sky-500 flex items-center justify-center text-white font-black text-lg shadow-[0_0_20px_rgba(20,184,166,0.3)] group-hover:scale-105 transition-transform">
            B
          </div>
          <span className="font-sans font-black tracking-tight text-white text-xl hidden sm:block drop-shadow-md group-hover:text-teal-300 transition-colors">BridgeAble</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1.5 p-1.5 rounded-2xl bg-white/5 backdrop-blur-md border border-white/5">
          {visibleLinks.map(link => {
            const isActive = location.pathname.startsWith(link.path);
            return (
              <Link key={link.path} to={link.path}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all relative
                             ${isActive ? 'text-white shadow-md' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                {isActive && <div className="absolute inset-0 bg-gradient-to-b from-teal-500/20 to-transparent rounded-xl border border-teal-500/30" />}
                <span className="relative z-10">{link.icon}</span>
                <span className="relative z-10">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          
          <Link to="/send" title="Notifications"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-400 hover:text-teal-400 hover:bg-teal-500/10 transition-all border border-transparent hover:border-teal-500/20">
            <span className="text-lg drop-shadow-sm">🔔</span>
          </Link>

          {/* Profile Dropdown */}
          <div className="relative">
            <button onClick={() => setMenuOpen(p => !p)}
              className="flex items-center gap-3 p-1.5 pr-3 rounded-full hover:bg-white/5 border border-transparent hover:border-white/10 transition-all focus:outline-none">
              {user?.avatar
                ? <img src={user.avatar} className="w-8 h-8 rounded-full object-cover shadow-md" alt={user.name} />
                : <div className="w-8 h-8 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 border border-zinc-600 flex items-center justify-center text-white text-xs font-black shadow-inner">
                    {user?.name?.[0]?.toUpperCase()}
                  </div>
              }
              <span className="text-sm font-bold text-zinc-300 hidden sm:block">{user?.name?.split(' ')[0]}</span>
              <span className="text-zinc-500 text-xs hidden sm:block">▾</span>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-3 w-64 rounded-2xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)] backdrop-blur-3xl bg-zinc-950/95 p-2 z-50 animate-slide-down overflow-hidden">
                  <div className="px-4 py-3 mb-2 bg-white/5 rounded-xl border border-white/5">
                    <p className="text-white font-black truncate">{user?.name}</p>
                    <p className="text-[10px] text-teal-400 font-bold uppercase tracking-widest">{user?.disabilityType} User</p>
                  </div>
                  <Link to="/profile" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-white/5 transition-all text-sm font-bold text-zinc-300 hover:text-white group">
                    <span className="group-hover:scale-110 transition-transform">👤</span> Profile & Settings
                  </Link>
                  <Link to="/pricing" onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-amber-500/10 transition-all text-sm font-bold text-amber-500/80 hover:text-amber-400 group">
                    <span className="group-hover:scale-110 transition-transform">⚡</span> Upgrade to Pro
                  </Link>
                  <div className="h-px w-full bg-white/5 my-2" />
                  <button onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-rose-500/10 transition-all text-sm font-bold text-rose-500/80 hover:text-rose-400 group">
                    <span className="group-hover:-translate-x-1 transition-transform">↩</span> Secure Logout
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button onClick={() => setMenuOpen(p => !p)} className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center text-zinc-300 bg-white/5 border border-white/10 active:scale-95 focus:outline-none">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
        </div>
      </div>

      {/* Mobile nav dropdown drawer */}
      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 w-full border-t border-white/5 bg-zinc-950/95 backdrop-blur-2xl p-4 shadow-2xl animate-slide-down">
          <div className="space-y-2">
            {visibleLinks.map(link => {
              const isActive = location.pathname.startsWith(link.path);
              return (
                <Link key={link.path} to={link.path} onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-base font-bold transition-all relative overflow-hidden
                               ${isActive ? 'text-teal-300 bg-teal-500/10 border border-teal-500/20' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                  {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-400 shadow-[0_0_10px_#2dd4bf]" />}
                  <span className="text-xl relative z-10">{link.icon}</span>
                  <span className="relative z-10 tracking-wide">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}