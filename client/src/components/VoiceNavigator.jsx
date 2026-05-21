// client/src/components/VoiceNavigator.jsx
// Global voice command navigator for blind users.
// Commands: "next" / "previous" — move focus
//           "click" / "select" / "open" — activate focused element
//           "go back" — browser back
//           "dashboard" / "connect" / "profile" — navigate pages
// Only active when user.disabilityType === 'blind'

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const ROUTES = {
  dashboard: '/dashboard',
  home: '/dashboard',
  connect: '/connect',
  community: '/community',
  profile: '/profile',
  history: '/history',
  stats: '/stats',
  pricing: '/pricing',
  circles: '/circles',
};

function speak(text, rate = 1.1) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  window.speechSynthesis.speak(u);
}

export default function VoiceNavigator() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const recognitionRef = useRef(null);
  const focusedIndexRef = useRef(-1);
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [lastCommand, setLastCommand] = useState('');

  const isBlind = user?.disabilityType === 'blind';

  const getFocusableElements = useCallback(() => {
    return Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
    );
  }, []);

  const readElement = useCallback((el) => {
    if (!el) return;
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.innerText?.trim() ||
      el.placeholder ||
      el.tagName.toLowerCase();
    speak(label.substring(0, 150));
  }, []);

  const moveFocus = useCallback((delta = 1) => {
    const elements = getFocusableElements();
    if (!elements.length) return;
    const next = ((focusedIndexRef.current + delta) + elements.length) % elements.length;
    focusedIndexRef.current = next;
    const el = elements[next];
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    readElement(el);
  }, [getFocusableElements, readElement]);

  const clickFocused = useCallback(() => {
    const elements = getFocusableElements();
    const el = elements[focusedIndexRef.current];
    if (!el) { speak('Nothing focused. Say next to move.'); return; }
    speak('Selected');
    setTimeout(() => el.click(), 300);
  }, [getFocusableElements]);

  const handleCommand = useCallback((transcript) => {
    const cmd = transcript.toLowerCase().trim();
    setLastCommand(cmd);

    if (cmd.includes('next') || cmd.includes('forward')) {
      moveFocus(1);
    } else if (cmd.includes('previous') || cmd.includes('back item') || cmd.includes('go back')) {
      if (cmd.includes('go back')) {
        navigate(-1);
        speak('Going back');
      } else {
        moveFocus(-1);
      }
    } else if (cmd.includes('click') || cmd.includes('select') || cmd.includes('open') || cmd.includes('press')) {
      clickFocused();
    } else if (cmd.includes('read page') || cmd.includes('where am i')) {
      const h1 = document.querySelector('h1')?.innerText?.trim();
      speak(h1 ? `You are on: ${h1}` : 'Current page');
    } else if (cmd.includes('read') || cmd.includes('what is this')) {
      const elements = getFocusableElements();
      readElement(elements[focusedIndexRef.current]);
    } else if (cmd.includes('stop') || cmd.includes('quiet')) {
      window.speechSynthesis.cancel();
    } else if (cmd.includes('help')) {
      speak('Say: next, previous, click, go back, dashboard, connect, profile, read page, or stop.');
    } else {
      // Check route commands
      for (const [keyword, path] of Object.entries(ROUTES)) {
        if (cmd.includes(keyword)) {
          speak(`Going to ${keyword}`);
          setTimeout(() => navigate(path), 600);
          return;
        }
      }
      speak(`Command not recognized: ${cmd}. Say help for a list of commands.`);
    }
  }, [moveFocus, clickFocused, navigate, getFocusableElements, readElement]);

  useEffect(() => {
    if (!isBlind) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('VoiceNavigator: SpeechRecognition not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = user?.preferences?.language === 'hi' ? 'hi-IN' : 'en-US';

    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) {
        handleCommand(result[0].transcript);
      }
    };

    recognition.onstart = () => { setListening(true); };
    recognition.onend = () => {
      setListening(false);
      // Auto-restart
      try { recognition.start(); } catch {}
    };
    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') console.warn('Voice navigator error:', e.error);
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setActive(true);
      speak('Voice navigation active. Say help for commands.');
    } catch (err) {
      console.error('VoiceNavigator start error:', err);
    }

    return () => {
      recognition.onend = null;
      recognition.abort();
      setActive(false);
      setListening(false);
    };
  }, [isBlind, handleCommand, user?.preferences?.language]);

  if (!isBlind) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-[9998] flex items-center gap-2 px-3 py-1.5
                 bg-dark-900/90 backdrop-blur border border-accent-teal/30 rounded-full
                 text-xs text-accent-teal shadow-lg pointer-events-none"
      aria-hidden="true"
    >
      <span className={`w-2 h-2 rounded-full ${listening ? 'bg-accent-rose animate-pulse' : 'bg-accent-teal animate-pulse'}`} />
      {listening ? `🎙 "${lastCommand || '...'}"` : 'Voice Nav Active'}
    </div>
  );
}
