// client/src/hooks/useMorseDecoder.js
// Converts blink dots/dashes → Morse → letters → words
// AI word prediction after 3 letters using common word lists

import { useState, useRef, useCallback, useEffect } from 'react';

// Full Morse code table
const MORSE_MAP = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D',
  '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H',
  '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
  '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P',
  '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
  '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
  '-.--': 'Y', '--..': 'Z',
  '.----': '1', '..---': '2', '...--': '3', '....-': '4',
  '.....': '5', '-....': '6', '--...': '7', '---..': '8',
  '----.': '9', '-----': '0',
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/',
};

// Common English words for prediction (top 500 — abbreviated here)
const WORD_LIST = [
  'able', 'about', 'above', 'after', 'again', 'all', 'also', 'and', 'any', 'are',
  'back', 'been', 'before', 'being', 'between', 'both', 'but', 'call', 'came', 'can',
  'come', 'could', 'day', 'did', 'does', 'done', 'down', 'each', 'even', 'every',
  'feel', 'few', 'find', 'first', 'for', 'from', 'get', 'give', 'good', 'got',
  'had', 'has', 'have', 'help', 'her', 'here', 'him', 'his', 'how', 'hurt',
  'into', 'its', 'just', 'know', 'last', 'like', 'little', 'long', 'look', 'made',
  'make', 'may', 'medicine', 'more', 'most', 'much', 'must', 'my', 'name', 'need',
  'never', 'new', 'next', 'no', 'not', 'now', 'off', 'old', 'one', 'only',
  'open', 'other', 'our', 'out', 'over', 'own', 'pain', 'part', 'people', 'place',
  'please', 'put', 'read', 'rest', 'right', 'said', 'same', 'see', 'she', 'sleep',
  'some', 'something', 'still', 'such', 'take', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'though', 'through', 'time', 'to',
  'told', 'too', 'took', 'two', 'under', 'until', 'upon', 'very', 'want', 'was',
  'water', 'way', 'well', 'went', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'will', 'with', 'work', 'would', 'write', 'year', 'yes', 'you', 'your',
];

const LETTER_GAP_MS = 1200;  // pause between letters
const WORD_GAP_MS = 2500;  // pause between words

export default function useMorseDecoder({ onWord, onLetter } = {}) {
  const [morseBuffer, setMorseBuffer] = useState('');   // current letter buffer e.g. ".-"
  const [currentWord, setCurrentWord] = useState('');   // building word e.g. "HE"
  const [predictions, setPredictions] = useState([]);   // AI word suggestions

  const letterTimerRef = useRef(null);
  const wordTimerRef = useRef(null);

  // Called by blink detector on each blink
  const addSymbol = useCallback((type) => {
    // type: 'dot' | 'dash'
    const symbol = type === 'dot' ? '.' : '-';

    setMorseBuffer(prev => {
      const next = prev + symbol;

      // Reset letter timer
      clearTimeout(letterTimerRef.current);
      letterTimerRef.current = setTimeout(() => {
        commitLetter(next);
      }, LETTER_GAP_MS);

      return next;
    });
  }, []);

  const commitLetter = useCallback((morse) => {
    const letter = MORSE_MAP[morse];
    if (!letter) {
      setMorseBuffer('');
      return;
    }

    setMorseBuffer('');
    onLetter?.(letter);

    setCurrentWord(prev => {
      const next = prev + letter;

      // AI word prediction after 3+ letters
      if (next.length >= 3) {
        const q = next.toLowerCase();
        const preds = WORD_LIST
          .filter(w => w.startsWith(q) && w.length > q.length)
          .slice(0, 5);
        setPredictions(preds);
      } else {
        setPredictions([]);
      }

      // Reset word gap timer
      clearTimeout(wordTimerRef.current);
      wordTimerRef.current = setTimeout(() => {
        commitWord(next);
      }, WORD_GAP_MS);

      return next;
    });
  }, [onLetter]);

  const commitWord = useCallback((word) => {
    if (!word?.trim()) return;
    onWord?.(word.trim());
    setCurrentWord('');
    setPredictions([]);
    clearTimeout(wordTimerRef.current);
  }, [onWord]);

  // Accept a prediction
  const acceptPrediction = useCallback((word) => {
    clearTimeout(wordTimerRef.current);
    clearTimeout(letterTimerRef.current);
    setMorseBuffer('');
    setCurrentWord('');
    setPredictions([]);
    onWord?.(word);
  }, [onWord]);

  // Manual confirm (double blink maps to this)
  const confirmWord = useCallback(() => {
    setCurrentWord(prev => {
      if (prev) commitWord(prev);
      return '';
    });
  }, [commitWord]);

  // Delete last symbol
  const deleteSymbol = useCallback(() => {
    clearTimeout(letterTimerRef.current);
    setMorseBuffer(prev => prev.slice(0, -1));
  }, []);

  // Delete last letter
  const deleteLetter = useCallback(() => {
    clearTimeout(wordTimerRef.current);
    setCurrentWord(prev => {
      const next = prev.slice(0, -1);
      if (next.length >= 3) {
        const q = next.toLowerCase();
        setPredictions(WORD_LIST.filter(w => w.startsWith(q) && w.length > q.length).slice(0, 5));
      } else {
        setPredictions([]);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    clearTimeout(letterTimerRef.current);
    clearTimeout(wordTimerRef.current);
    setMorseBuffer('');
    setCurrentWord('');
    setPredictions([]);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(letterTimerRef.current);
      clearTimeout(wordTimerRef.current);
    };
  }, []);

  return {
    morseBuffer,
    currentWord,
    predictions,
    addSymbol,
    acceptPrediction,
    confirmWord,
    deleteSymbol,
    deleteLetter,
    clear,
  };
}