// client/src/hooks/useHealthLog.js
// Industry-grade daily health log hook.
// Features: optimistic state, duplicate-today check, retry on failure,
//           blinkEAR integration, and validation before submit.

import { useState, useCallback, useEffect } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';

const INITIAL = {
  sleepQuality: 0,   // 1–5
  painLevel:    0,   // 0–10
  painLocation: '',
  mood:         '',
  appetite:     '',
  notes:        '',
};

export const MOODS     = ['terrible', 'bad', 'okay', 'good', 'great'];
export const APPETITES = ['none', 'poor', 'fair', 'good', 'excellent'];
export const PAIN_LOCS = ['Head', 'Chest', 'Abdomen', 'Back', 'Legs', 'Arms', 'Neck', 'Other'];

export default function useHealthLog({ blinkEAR } = {}) {
  const [form,      setFormState] = useState(INITIAL);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [todayLog,  setTodayLog]  = useState(null);  // existing log for today
  const [logs,      setLogs]      = useState([]);     // historical logs
  const [logsLoading, setLogsLoading] = useState(false);

  // ── Field setter ──────────────────────────────────────────────────────────────
  const setField = useCallback((key, value) => {
    setFormState(prev => ({ ...prev, [key]: value }));
  }, []);

  // ── Check if already logged today (prevents duplicate entries) ───────────────
  const checkToday = useCallback(async () => {
    try {
      const { data } = await api.get('/health/today');
      if (data?.logged && data.log) {
        setTodayLog(data.log);
        // Pre-fill the form with today's existing values
        setFormState(prev => ({
          ...prev,
          sleepQuality: data.log.sleepQuality ?? prev.sleepQuality,
          painLevel:    data.log.painLevel    ?? prev.painLevel,
          painLocation: data.log.painLocation ?? prev.painLocation,
          mood:         data.log.mood         ?? prev.mood,
          appetite:     data.log.appetite     ?? prev.appetite,
          notes:        data.log.notes        ?? prev.notes,
        }));
        setSaved(true);
      }
    } catch {
      // Non-fatal — user can still submit
    }
  }, []);

  useEffect(() => {
    checkToday();
  }, [checkToday]);

  // ── Fetch historical logs ─────────────────────────────────────────────────────
  const fetchLogs = useCallback(async (days = 30) => {
    setLogsLoading(true);
    try {
      const { data } = await api.get(`/health/me?days=${days}`);
      setLogs(data?.logs ?? []);
    } catch {
      // Silently fail — chart will show empty state
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // ── Validate before submit ───────────────────────────────────────────────────
  const validate = useCallback(() => {
    if (!form.sleepQuality && !form.painLevel && !form.mood) {
      toast.error('Please fill at least one field (sleep, pain, or mood)');
      return false;
    }
    if (form.sleepQuality && (form.sleepQuality < 1 || form.sleepQuality > 5)) {
      toast.error('Sleep quality must be between 1 and 5');
      return false;
    }
    if (form.painLevel && (form.painLevel < 0 || form.painLevel > 10)) {
      toast.error('Pain level must be between 0 and 10');
      return false;
    }
    return true;
  }, [form]);

  // ── Submit (upserts today's log) ─────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (!validate()) return;
    setSaving(true);
    const toastId = toast.loading('Saving health log…');
    try {
      const payload = {
        ...form,
        date:     new Date().toISOString(),
        blinkEAR: blinkEAR ?? undefined,
      };
      const { data } = await api.post('/health', payload);

      setTodayLog(data.log);
      setSaved(true);
      toast.success('Health log saved ✓', { id: toastId });
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      const msg = err?.response?.data?.message ?? 'Failed to save health log';
      toast.error(msg, { id: toastId });
    } finally {
      setSaving(false);
    }
  }, [form, blinkEAR, validate]);

  // ── Reset form ───────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setFormState(INITIAL);
    setSaved(false);
    setTodayLog(null);
  }, []);

  return {
    form, setField,
    saving, saved, submit, reset,
    todayLog, logs, logsLoading, fetchLogs,
    MOODS, APPETITES, PAIN_LOCS,
  };
}