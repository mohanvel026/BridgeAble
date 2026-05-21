// client/src/hooks/useMessages.js
// Industry-grade messaging hook:
//  • Inbox (latest 50, paginated)
//  • Conversation thread with a specific user
//  • Unread badge count (auto-polls every 30s)
//  • Send with optimistic update + rollback on failure
//  • Real-time: listens for message:new, message:read, messages:all-read
//  • Soft-delete, read-all, mark-single-read

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../lib/api';
import { getSocket } from '../lib/socket';
import toast from 'react-hot-toast';

// ── Hook: inbox ───────────────────────────────────────────────────────────────
export function useInbox() {
  const [messages,   setMessages]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [hasMore,    setHasMore]    = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef(null); // ISO date of oldest fetched message

  const fetchInbox = useCallback(async (reset = true) => {
    try {
      if (reset) setLoading(true);
      else       setLoadingMore(true);

      const before = reset ? new Date().toISOString() : cursorRef.current;
      const { data } = await api.get('/messages/inbox', { params: { limit: 50, before } });

      const msgs = data.messages || [];
      if (msgs.length > 0) cursorRef.current = msgs[msgs.length - 1].createdAt;

      setMessages(prev => reset ? msgs : [...prev, ...msgs]);
      setHasMore(data.hasMore);
    } catch {
      toast.error('Failed to load inbox');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Real-time: prepend new messages as they arrive
  useEffect(() => {
    fetchInbox(true);
    const socket = getSocket();
    if (!socket) return;

    const onNew = ({ message }) => {
      setMessages(prev => {
        // Avoid duplicates
        if (prev.some(m => m._id === message._id)) return prev;
        return [message, ...prev];
      });
    };
    const onRead = ({ messageId }) => {
      setMessages(prev => prev.map(m => m._id === messageId ? { ...m, isRead: true } : m));
    };

    socket.on('message:new',  onNew);
    socket.on('message:read', onRead);
    return () => { socket.off('message:new', onNew); socket.off('message:read', onRead); };
  }, [fetchInbox]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    fetchInbox(false);
  }, [hasMore, loadingMore, fetchInbox]);

  const markRead = useCallback(async (messageId) => {
    try {
      await api.patch(`/messages/${messageId}/read`);
      setMessages(prev => prev.map(m => m._id === messageId ? { ...m, isRead: true } : m));
    } catch { /* non-fatal */ }
  }, []);

  const deleteMessage = useCallback(async (messageId) => {
    setMessages(prev => prev.filter(m => m._id !== messageId)); // optimistic
    try {
      await api.delete(`/messages/${messageId}`);
    } catch {
      fetchInbox(true); // rollback
    }
  }, [fetchInbox]);

  return { messages, loading, hasMore, loadingMore, loadMore, markRead, deleteMessage, refresh: () => fetchInbox(true) };
}

// ── Hook: conversation ────────────────────────────────────────────────────────
export function useConversation(otherUserId) {
  const [messages,    setMessages]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [sending,     setSending]     = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef(null);

  const fetchThread = useCallback(async (reset = true) => {
    if (!otherUserId) return;
    try {
      if (reset) setLoading(true);
      else       setLoadingMore(true);

      const before = reset ? new Date().toISOString() : cursorRef.current;
      const { data } = await api.get(`/messages/conversation/${otherUserId}`, {
        params: { limit: 50, before },
      });

      const msgs = data.messages || [];
      if (msgs.length > 0) cursorRef.current = msgs[0].createdAt; // oldest in thread

      setMessages(prev => reset ? msgs : [...msgs, ...prev]); // prepend older messages
      setHasMore(data.hasMore);
    } catch {
      toast.error('Failed to load conversation');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [otherUserId]);

  // Real-time: append incoming messages in this conversation
  useEffect(() => {
    if (!otherUserId) return;
    fetchThread(true);
    const socket = getSocket();
    if (!socket) return;

    const onNew = ({ message, sender }) => {
      const sid = sender?._id || message.senderId;
      if (String(sid) !== String(otherUserId)) return; // not from this conversation
      setMessages(prev => {
        if (prev.some(m => m._id === message._id)) return prev;
        return [...prev, message];
      });
    };

    const onAllRead = ({ by }) => {
      setMessages(prev => prev.map(m => String(m.senderId?._id || m.senderId) !== String(by)
        ? m : { ...m, isRead: true }
      ));
    };

    socket.on('message:new',      onNew);
    socket.on('messages:all-read', onAllRead);
    return () => {
      socket.off('message:new',       onNew);
      socket.off('messages:all-read', onAllRead);
    };
  }, [otherUserId, fetchThread]);

  const send = useCallback(async (type, content) => {
    if (!otherUserId || !type || !content) return false;
    const optimisticId = `opt-${Date.now()}`;

    // Optimistic insert
    const optimistic = {
      _id:       optimisticId,
      senderId:  'me',
      receiverId: otherUserId,
      type, content,
      isRead:    false,
      createdAt: new Date().toISOString(),
      _pending:  true,
    };
    setMessages(prev => [...prev, optimistic]);
    setSending(true);

    try {
      const { data } = await api.post('/messages/send', { receiverId: otherUserId, type, content });
      // Replace optimistic with real message
      setMessages(prev => prev.map(m => m._id === optimisticId ? data.message : m));
      return true;
    } catch (err) {
      // Rollback
      setMessages(prev => prev.filter(m => m._id !== optimisticId));
      toast.error(err?.response?.data?.message || 'Failed to send message');
      return false;
    } finally {
      setSending(false);
    }
  }, [otherUserId]);

  const markAllRead = useCallback(async () => {
    if (!otherUserId) return;
    try {
      await api.patch(`/messages/read-all/${otherUserId}`);
      setMessages(prev => prev.map(m =>
        String(m.senderId?._id || m.senderId) === String(otherUserId) ? { ...m, isRead: true } : m
      ));
    } catch { /* non-fatal */ }
  }, [otherUserId]);

  return {
    messages, loading, sending, hasMore, loadingMore,
    send, markAllRead,
    loadMore: () => !loadingMore && hasMore && fetchThread(false),
    refresh:  () => fetchThread(true),
  };
}

// ── Hook: unread badge count ──────────────────────────────────────────────────
export function useUnreadCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetch = async () => {
      try {
        const { data } = await api.get('/messages/unread-count');
        setCount(data.count || 0);
      } catch { /* silent */ }
    };
    fetch();
    const interval = setInterval(fetch, 30_000); // poll every 30s

    // Also decrement on socket read event
    const socket = getSocket();
    if (socket) {
      const onRead = () => setCount(c => Math.max(0, c - 1));
      const onNew  = () => setCount(c => c + 1);
      socket.on('message:new',  onNew);
      socket.on('message:read', onRead);
      return () => {
        clearInterval(interval);
        socket.off('message:new',  onNew);
        socket.off('message:read', onRead);
      };
    }
    return () => clearInterval(interval);
  }, []);

  return count;
}
