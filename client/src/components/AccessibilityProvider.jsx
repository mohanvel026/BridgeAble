// client/src/components/AccessibilityProvider.jsx
// Week 10 — WCAG 2.1 AA compliance wrapper
// Handles: skip links, focus management, live regions, keyboard shortcuts

import { useEffect, createContext, useContext, useState, useRef } from 'react';
import { useAuthStore } from '../store/stores';
import useTTS from '../hooks/useTTS';

const A11yContext = createContext({});

export function useA11y() {
  return useContext(A11yContext);
}

export default function AccessibilityProvider({ children }) {
  const { user } = useAuthStore();
  const { speak } = useTTS();
  const [announcements, setAnnouncements] = useState('');
  const skipRef = useRef(null);

  const announce = (message) => {
    setAnnouncements(message);
    // Also TTS for blind/paralyzed
    if (['blind', 'paralyzed'].includes(user?.disabilityType)) {
      speak(message);
    }
  };

  // ── Keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    const handleKey = (e) => {
      // Skip to main content: Alt+M
      if (e.altKey && e.key === 'm') {
        document.getElementById('main-content')?.focus();
        announce('Skipped to main content');
      }
      // Skip to nav: Alt+N
      if (e.altKey && e.key === 'n') {
        document.getElementById('main-nav')?.focus();
      }
      // Trigger SOS: Alt+S (emergency shortcut)
      if (e.altKey && e.key === 's') {
        window.dispatchEvent(new CustomEvent('bridgeable:sos-keyboard'));
        announce('SOS triggered via keyboard');
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [user]);

  // ── Apply font size from preferences ─────────────────
  useEffect(() => {
    if (!user?.preferences) return;
    const { fontSize, highContrast, theme } = user.preferences;
    const root = document.documentElement;

    root.style.fontSize = fontSize === 'large' ? '18px' : fontSize === 'small' ? '14px' : '16px';
    root.classList.toggle('high-contrast', !!highContrast);
    root.className = theme === 'light' ? 'light' : 'dark';
  }, [user?.preferences]);

  return (
    <A11yContext.Provider value={{ announce }}>
      {/* Skip navigation link — WCAG 2.4.1 */}
      <a
        ref={skipRef}
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4
                   focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-xl
                   focus:bg-accent-cyan focus:text-dark-950 focus:font-semibold"
        aria-label="Skip to main content">
        Skip to main content
      </a>

      {/* Live region for screen reader announcements — WCAG 4.1.3 */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status">
        {announcements}
      </div>

      {/* Alert region for urgent messages (SOS, errors) */}
      <div
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        role="alert"
        id="urgent-announcements" />

      {children}
    </A11yContext.Provider>
  );
}