// client/src/hooks/useTTS.js
// Reusable Text-To-Speech hook with queue management
// Prevents overlapping speech — queues messages in order
// Used by: BlinkPanel, IncomingCallModal, Dashboard, Community

import { useRef, useCallback, useEffect } from 'react';
import { useAuthStore } from '../store/stores';

export default function useTTS() {
  const { user } = useAuthStore();
  const queueRef = useRef([]);
  const speakingRef = useRef(false);
  const voicesRef = useRef([]);

  // Load voices asynchronously (required by many browsers)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    const updateVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    
    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  const processQueue = useCallback(() => {
    if (speakingRef.current || !queueRef.current.length || !window.speechSynthesis) return;

    const text = queueRef.current.shift();
    speakingRef.current = true;

    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = user?.preferences?.ttsSpeed || 1.0;
    utt.lang = user?.preferences?.language === 'hi' ? 'hi-IN' : 'en-US';

    // Apply voice gender preference
    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const gender = user?.preferences?.ttsVoiceGender || 'neutral';
    
    if (gender !== 'neutral' && voices.length) {
      const preferred = voices.find(v =>
        gender === 'female'
          ? v.name.toLowerCase().includes('female') || v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Zira')
          : v.name.toLowerCase().includes('male') || v.name.includes('Alex') || v.name.includes('Daniel') || v.name.includes('David')
      );
      if (preferred) utt.voice = preferred;
    }

    utt.onend = () => { 
      if (isMountedRef.current) {
        speakingRef.current = false; 
        processQueue(); 
      }
    };
    utt.onerror = (e) => { 
      console.warn('TTS Error:', e);
      if (isMountedRef.current) {
        speakingRef.current = false; 
        processQueue(); 
      }
    };

    window.speechSynthesis.speak(utt);
  }, [user]);

  // Keep track of mounted state
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      queueRef.current = [];
      speakingRef.current = false;
    };
  }, []);

  // Add to queue — non-blocking
  const speak = useCallback((text) => {
    if (!text?.trim() || typeof window === 'undefined' || !window.speechSynthesis) return;
    queueRef.current.push(text.trim());
    processQueue();
  }, [processQueue]);

  // Speak immediately — clears queue first
  const speakNow = useCallback((text) => {
    if (!text?.trim() || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    queueRef.current = [];
    speakingRef.current = false;
    queueRef.current.push(text.trim());
    processQueue();
  }, [processQueue]);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    queueRef.current = [];
    speakingRef.current = false;
  }, []);

  return { speak, speakNow, stop };
}