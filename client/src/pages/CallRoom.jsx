// client/src/pages/CallRoom.jsx
// ─────────────────────────────────────────────────────────────
// Industry-Grade WebRTC 1-on-1 Call Room
// Perfect Negotiation pattern · Clean media flow · No AI camera conflicts
// ─────────────────────────────────────────────────────────────
import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, useCallStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import toast from 'react-hot-toast';

// Communication Panels (mic-only or keyboard — no camera conflicts)
import VoicePanel    from '../components/call/VoicePanel';
import TypePanel     from '../components/call/TypePanel';
import SubtitleOverlay from '../components/call/SubtitleOverlay';
import TranscriptPanel from '../components/call/TranscriptPanel';
import QuickPhrases  from '../components/QuickPhrases';

// ─── Constants ────────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // TURN fallback — required for symmetric NAT (corporate, mobile hotspot)
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};


const RING_SECONDS = 40;

const fmt = (s) => {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};

const chime = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [[523, 0], [659, 0.12], [784, 0.24]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + d);
      g.gain.linearRampToValueAtTime(0.13, ctx.currentTime + d + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.45);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + d);
      o.stop(ctx.currentTime + d + 0.5);
    });
  } catch {}
};

// ─── Small reusable control button ────────────────────────────
function CtrlBtn({ onClick, active, danger, label, children, className = '' }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`
        relative flex flex-col items-center justify-center gap-1 rounded-2xl
        transition-all duration-200 active:scale-95 focus:outline-none
        ${danger
          ? 'bg-red-600 hover:bg-red-500 border border-red-400/50 shadow-[0_0_20px_rgba(239,68,68,0.4)] text-white'
          : active
          ? 'bg-rose-500/20 border border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
          : 'bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 hover:border-white/20 hover:text-white'}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

// ─── Avatar placeholder for video-off / voice-only ────────────
function AvatarView({ name, size = 'lg', subtitle, pulse = false }) {
  const initial = name?.[0]?.toUpperCase() || '?';
  const sz = size === 'sm' ? 'w-12 h-12 text-lg' : 'w-28 h-28 text-4xl';
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`relative ${sz} rounded-full bg-gradient-to-br from-teal-600/30 to-slate-800 border-2 border-teal-500/40 flex items-center justify-center font-black text-teal-200 shadow-[0_0_40px_rgba(20,184,166,0.25)]`}>
        {initial}
        {pulse && (
          <div className="absolute inset-0 rounded-full border-2 border-teal-400/30 animate-ping" />
        )}
      </div>
      {subtitle && <p className="text-zinc-400 text-sm font-medium">{subtitle}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function CallRoom() {
  const { roomCode }  = useParams();
  const navigate      = useNavigate();
  const location      = useLocation();
  const socket        = getSocket();
  const { user }      = useAuthStore();
  const { addSubtitle, subtitles, addParticipant, inputMode, setRoom, endCall } = useCallStore();

  // ── Call context from nav state ───────────────────────────
  const isInitiator   = location.state?.isInitiator ?? false;
  const recipientId   = location.state?.recipientId ?? null;
  const recipientName = location.state?.recipientName ?? 'Participant';

  // Persist call type across page reloads
  const callType = useMemo(() => {
    const fromState = location.state?.callType;
    if (fromState) {
      sessionStorage.setItem(`ba_ct_${roomCode}`, fromState);
      return fromState;
    }
    return sessionStorage.getItem(`ba_ct_${roomCode}`) || 'video';
  }, [location.state?.callType, roomCode]);

  const isVoiceOnly = callType === 'voice';

  // Default communication panel based on user's mode
  const defaultPanel = useMemo(() => {
    const m = inputMode || user?.inputMode || 'type';
    return m === 'voice' ? 'voice' : 'type';
  }, [inputMode, user?.inputMode]);

  // ── Refs ──────────────────────────────────────────────────
  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef        = useRef(null);
  const localStreamRef = useRef(null);
  const timerRef       = useRef(null);
  const ringTimerRef   = useRef(null);
  const isLive         = useRef(true);
  // Perfect Negotiation flags
  const makingOffer    = useRef(false);
  const ignoreOffer    = useRef(false);
  const isPolite       = useRef(!isInitiator); // callee is polite
  const peerDisconnectTimer = useRef(null);    // auto-exit when peer drops
  // Ref so createPC can call handleEnd without stale-closure issues
  const handleEndRef   = useRef(null);

  // ── State ─────────────────────────────────────────────────
  const [callPhase,        setCallPhase]        = useState(isInitiator ? 'ringing' : 'joining');
  const [ringLeft,         setRingLeft]          = useState(RING_SECONDS);
  const [remoteStream,     setRemoteStream]      = useState(null);
  const [remoteParticipant,setRemoteParticipant] = useState(null);
  const [muted,            setMuted]             = useState(false);
  const [camOff,           setCamOff]            = useState(isVoiceOnly);
  const [screenSharing,    setScreenSharing]     = useState(false);
  const [duration,         setDuration]          = useState(0);
  const [netQuality,       setNetQuality]        = useState('connecting');
  const [remoteMuted,      setRemoteMuted]       = useState(false);
  const [remoteCamOff,     setRemoteCamOff]      = useState(false);
  const [remoteInterim,    setRemoteInterim]     = useState(null);
  const [transcript,       setTranscript]        = useState([]);
  const [panel,            setPanel]             = useState(defaultPanel);
  const [mediaReady,       setMediaReady]        = useState(false);
  const [showControls,     setShowControls]      = useState(true);
  const controlHideTimer   = useRef(null);

  // ── Auto-hide controls on hover/inactivity ───────────────
  const resetControlHide = useCallback(() => {
    setShowControls(true);
    clearTimeout(controlHideTimer.current);
    controlHideTimer.current = setTimeout(() => setShowControls(false), 4000);
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', resetControlHide);
    document.addEventListener('touchstart', resetControlHide);
    resetControlHide();
    return () => {
      document.removeEventListener('mousemove', resetControlHide);
      document.removeEventListener('touchstart', resetControlHide);
      clearTimeout(controlHideTimer.current);
    };
  }, [resetControlHide]);

  // ── Auto-clear remote interim ────────────────────────────
  useEffect(() => {
    if (!remoteInterim) return;
    const t = setTimeout(() => setRemoteInterim(null), 4000);
    return () => clearTimeout(t);
  }, [remoteInterim]);

  // ── Bind stream to <video> safely ────────────────────────
  const bindStream = useCallback((el, stream) => {
    if (!el || !stream) return;
    if (el.srcObject === stream) return;
    el.srcObject = stream;
    const tryPlay = () => el.play().catch(() => {
      const resume = () => { el.play().catch(() => {}); document.removeEventListener('click', resume); };
      document.addEventListener('click', resume, { once: true });
    });
    if (el.readyState >= 1) tryPlay();
    else el.onloadedmetadata = tryPlay;
  }, []);

  // ── Sync streams to video elements ───────────────────────
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) bindStream(remoteVideoRef.current, remoteStream);
  }, [remoteStream, bindStream]);

  useEffect(() => {
    if (mediaReady && localStreamRef.current && localVideoRef.current && !isVoiceOnly) {
      bindStream(localVideoRef.current, localStreamRef.current);
    }
  }, [mediaReady, isVoiceOnly, bindStream]);

  // ── Create RTCPeerConnection with proper guards ───────────
  const createPC = useCallback((targetId) => {
    if (peerRef.current) return peerRef.current;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerRef.current = pc;

    // Add local tracks immediately
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => {
        pc.addTrack(t, localStreamRef.current);
      });
    }

    // Remote track received → update state
    pc.ontrack = ({ streams }) => {
      if (streams?.[0]) setRemoteStream(streams[0]);
    };

    // ICE candidates → relay via socket
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socket) {
        socket.emit('webrtc:ice', { to: targetId, candidate, roomCode });
      }
    };

    // ICE connection state → network quality badge
    pc.oniceconnectionstatechange = () => {
      switch (pc.iceConnectionState) {
        case 'connected':
        case 'completed':
          setNetQuality('good'); break;
        case 'checking':
        case 'new':
          setNetQuality('connecting'); break;
        case 'disconnected':
          setNetQuality('poor'); break;
        case 'failed':
        case 'closed':
          setNetQuality('disconnected');
          pc.restartIce?.();
          break;
        default: break;
      }
    };

    // Connection state → call phase + chime + timer + peer-drop guard
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === 'connected') {
        // Peer reconnected — cancel any pending auto-exit
        clearTimeout(peerDisconnectTimer.current);
        peerDisconnectTimer.current = null;

        setCallPhase('active');
        setNetQuality('good');
        chime();
        clearInterval(timerRef.current);
        const start = Date.now();
        timerRef.current = setInterval(() => {
          if (isLive.current) setDuration(Math.floor((Date.now() - start) / 1000));
        }, 1000);

      } else if (state === 'disconnected') {
        // WebRTC transport dropped — may recover on its own (network hiccup).
        // Give peer 10 seconds to reconnect before ending the call.
        setNetQuality('poor');
        clearTimeout(peerDisconnectTimer.current);
        peerDisconnectTimer.current = setTimeout(() => {
          if (!isLive.current) return;
          if (peerRef.current?.connectionState === 'connected') return; // recovered
          toast('The other person lost connection. Ending call.', { icon: '🔌', duration: 3000 });
          handleEndRef.current?.();
        }, 10_000);

      } else if (state === 'failed') {
        // Unrecoverable — end immediately
        clearTimeout(peerDisconnectTimer.current);
        toast('Connection failed. The call has ended.', { icon: '🔌', duration: 3000 });
        handleEndRef.current?.();

      } else if (state === 'closed') {
        clearTimeout(peerDisconnectTimer.current);
      }
    };

    // Perfect Negotiation: handle renegotiation (e.g. screen share)
    pc.onnegotiationneeded = async () => {
      try {
        makingOffer.current = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        socket?.emit('webrtc:offer', { to: targetId, offer: pc.localDescription, roomCode });
      } catch (e) {
        console.warn('[WebRTC] Negotiation error:', e);
      } finally {
        makingOffer.current = false;
      }
    };

    return pc;
  }, [socket, roomCode]);

  // ── Full cleanup ─────────────────────────────────────────
  const cleanup = useCallback(() => {
    isLive.current = false;
    clearTimeout(peerDisconnectTimer.current);
    clearInterval(timerRef.current);
    clearInterval(ringTimerRef.current);
    clearTimeout(controlHideTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
  }, []);

  // ── Media setup + room join ───────────────────────────────
  useEffect(() => {
    isLive.current = true;
    setRoom(roomCode);

    const init = async () => {
      // ── Step 1: Acquire media FIRST ──
      try {
        let stream;

        if (isVoiceOnly) {
          // VOICE CALL → audio ONLY, never request camera
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              video: false,
            });
          } catch (e) {
            toast.error('Microphone access denied. Voice call may not work.');
            stream = new MediaStream();
            setMuted(true);
          }
          setCamOff(true);

        } else {
          // VIDEO CALL → camera + mic
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: 'user',
                width:  { ideal: 1280 },
                height: { ideal: 720 },
              },
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl:  true,
              },
            });
          } catch {
            // Camera denied → try audio-only gracefully
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              toast('Camera denied. Continuing audio-only.', { icon: '🎙️' });
            } catch {
              toast.error('Mic & camera denied. Call may have issues.');
              stream = new MediaStream();
              setMuted(true);
            }
            setCamOff(true);
          }
        }

        if (!isLive.current) { stream.getTracks().forEach(t => t.stop()); return; }

        localStreamRef.current = stream;
        setMediaReady(true);

      } catch (e) {
        console.error('[CallRoom] Media init failed:', e);
      }

      // ── Step 2: Join the signaling room ──
      socket?.emit('room:join', { roomCode });

      if (!isInitiator) {
        setCallPhase('active');
      }
    };

    init();

    // Hard close on tab/browser crash
    const onUnload = () => {
      socket?.emit('room:leave', { roomCode });
      socket?.emit('call:end-graceful', { roomCode });
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      window.removeEventListener('beforeunload', onUnload);
      if (socket?.connected) {
        socket.emit('room:leave', { roomCode });
        socket.emit('call:end-graceful', { roomCode });
      }
      cleanup();
      endCall();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ── Socket signaling handlers ─────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // Reconnect handling
    const onReconnect = () => socket.emit('room:join', { roomCode });
    socket.on('connect', onReconnect);

    // Peer joined → we are the existing user → create offer
    const onUserJoined = async (data) => {
      if (!isLive.current) return;
      clearInterval(ringTimerRef.current);
      setCallPhase('active');
      setRemoteParticipant(data);
      addParticipant({ userId: data.userId, ...data });

      // Wait for local media to be ready (max 8s)
      let waited = 0;
      while (!localStreamRef.current && waited < 32) {
        await new Promise(r => setTimeout(r, 250));
        waited++;
      }

      // Create PC (tracks added inside createPC)
      const pc = createPC(data.userId);

      // Manually create offer (reliable cross-browser)
      try {
        makingOffer.current = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { to: data.userId, offer: pc.localDescription, roomCode });
      } catch (e) {
        console.error('[WebRTC] Offer creation failed:', e);
      } finally {
        makingOffer.current = false;
      }
    };

    // Received SDP offer → create answer
    const onOffer = async ({ from, offer, fromDisability, fromInputMode, fromName }) => {
      if (!isLive.current) return;
      setRemoteParticipant(prev => prev ?? {
        userId: from,
        disabilityType: fromDisability,
        inputMode: fromInputMode,
        name: fromName || recipientName,
      });

      const offerCollision = makingOffer.current || peerRef.current?.signalingState !== 'stable';
      ignoreOffer.current  = !isPolite.current && offerCollision;
      if (ignoreOffer.current) return;

      // Wait for local media
      let waited = 0;
      while (!localStreamRef.current && waited < 32) {
        await new Promise(r => setTimeout(r, 250));
        waited++;
      }

      const pc = createPC(from);

      try {
        // Polite peer rolls back on collision
        if (offerCollision && isPolite.current) {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(offer);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: from, answer: pc.localDescription });
      } catch (e) {
        console.error('[WebRTC] Offer handling error:', e);
      }
    };

    // Received SDP answer
    const onAnswer = async ({ answer }) => {
      const pc = peerRef.current;
      if (!pc || pc.signalingState === 'stable') return;
      try {
        await pc.setRemoteDescription(answer);
      } catch (e) {
        if (!ignoreOffer.current) console.error('[WebRTC] Answer error:', e);
      }
    };

    // ICE candidate from peer
    const onIce = async ({ candidate }) => {
      const pc = peerRef.current;
      if (!pc || !candidate) return;
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        if (!ignoreOffer.current) console.warn('[WebRTC] ICE error:', e);
      }
    };

    // Call end events
    const onEnded      = ()          => navigate('/dashboard');
    const onEndGrace   = ({ reason } = {}) => {
      if (reason === 'disconnected') {
        toast('Connection interrupted. Attempting to reconnect...', { icon: '🔄', duration: 3000 });
        return;
      }
      toast('The call has ended.', { icon: '👋', duration: 3000 });
      navigate('/dashboard');
    };
    const onDeclined   = ()          => { toast.error('Call declined.'); navigate('/dashboard'); };
    const onCancelled  = ()          => { toast('Call cancelled.', { icon: '📵' }); navigate('/connect'); };
    const onAccepted   = ()          => { clearInterval(ringTimerRef.current); setCallPhase('active'); };

    // Subtitle events
    const onSubtitle = (data) => {
      const entry = {
        ...data,
        color: '#22d3ee',
        timestamp: Date.now(),
        id: `${data.senderId}-${Date.now()}`,
      };
      addSubtitle(entry);
      setTranscript(p => [...p, entry]);
      setRemoteInterim(null);
    };
    const onInterim = (data) => setRemoteInterim(data);

    // Track mute/cam state from peer
    const onTrackState = ({ audio, video }) => {
      setRemoteMuted(!!audio);
      setRemoteCamOff(!!video);
    };

    // Mode switch notification
    const onModeSwitched = ({ newMode }) => {
      setRemoteParticipant(p => p ? { ...p, inputMode: newMode } : null);
    };

    socket.on('room:user-joined',        onUserJoined);
    socket.on('webrtc:offer',            onOffer);
    socket.on('webrtc:answer',           onAnswer);
    socket.on('webrtc:ice',              onIce);
    socket.on('call:ended',              onEnded);
    socket.on('call:ended-graceful',     onEndGrace);
    socket.on('call:declined',           onDeclined);
    socket.on('call:cancelled',          onCancelled);
    socket.on('call:accepted',           onAccepted);
    socket.on('subtitle:receive',        onSubtitle);
    socket.on('subtitle:interim-receive',onInterim);
    socket.on('call:track-state',        onTrackState);
    socket.on('mode:switched',           onModeSwitched);

    return () => {
      socket.off('connect',                onReconnect);
      socket.off('room:user-joined',       onUserJoined);
      socket.off('webrtc:offer',           onOffer);
      socket.off('webrtc:answer',          onAnswer);
      socket.off('webrtc:ice',             onIce);
      socket.off('call:ended',             onEnded);
      socket.off('call:ended-graceful',    onEndGrace);
      socket.off('call:declined',          onDeclined);
      socket.off('call:cancelled',         onCancelled);
      socket.off('call:accepted',          onAccepted);
      socket.off('subtitle:receive',       onSubtitle);
      socket.off('subtitle:interim-receive',onInterim);
      socket.off('call:track-state',       onTrackState);
      socket.off('mode:switched',          onModeSwitched);
    };
  }, [socket, roomCode, createPC, addSubtitle, addParticipant, navigate, recipientName]);

  // ── Ringing auto-cancel countdown ────────────────────────
  useEffect(() => {
    if (!isInitiator || callPhase !== 'ringing') return;
    ringTimerRef.current = setInterval(() => {
      setRingLeft(s => {
        if (s <= 1) {
          clearInterval(ringTimerRef.current);
          socket?.emit('call:cancel', { recipientId });
          navigate('/connect');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(ringTimerRef.current);
  }, [isInitiator, callPhase]);

  // ── Control handlers ──────────────────────────────────────
  const toggleMute = () => {
    const t = localStreamRef.current?.getAudioTracks()[0];
    if (t) {
      t.enabled = !t.enabled;
      const nowMuted = !t.enabled;
      setMuted(nowMuted);
      socket?.emit('call:track-state', { roomCode, audio: nowMuted, video: camOff });
    }
  };

  const toggleCam = () => {
    const t = localStreamRef.current?.getVideoTracks()[0];
    if (!t) { toast('No camera available.', { icon: '📷' }); return; }
    t.enabled = !t.enabled;
    const nowOff = !t.enabled;
    setCamOff(nowOff);
    socket?.emit('call:track-state', { roomCode, audio: muted, video: nowOff });
  };

  const toggleScreen = async () => {
    try {
      if (!screenSharing) {
        const disp = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = disp.getVideoTracks()[0];
        const sender = peerRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack);
          screenTrack.onended = toggleScreen;
          setScreenSharing(true);
          toast('Screen sharing started.', { icon: '🖥️', duration: 2000 });
        } else {
          toast.error('No video sender found. Start a video call first.');
        }
      } else {
        const camTrack = localStreamRef.current?.getVideoTracks()[0];
        const sender = peerRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (sender && camTrack) {
          await sender.replaceTrack(camTrack);
          setScreenSharing(false);
          toast('Screen sharing stopped.', { icon: '📷', duration: 2000 });
        }
      }
    } catch (e) {
      if (e.name !== 'NotAllowedError') console.error('Screen share error:', e);
    }
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (remoteVideoRef.current?.readyState > 0) {
        await remoteVideoRef.current.requestPictureInPicture();
      }
    } catch {}
  };

  const handleEnd = useCallback(() => {
    socket?.emit('room:leave', { roomCode });
    socket?.emit('call:end', { roomCode, durationSeconds: duration });
    socket?.emit('call:end-graceful', { roomCode });
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    api.post(`/rooms/${roomCode}/end`, { durationSeconds: duration }).catch(err => {
      console.error('Failed to end room on DB:', err);
    });
    cleanup();
    navigate('/dashboard');
  }, [socket, roomCode, duration, cleanup, navigate]);

  // Keep ref always pointing to the latest handleEnd (avoids stale closure in createPC timers)
  handleEndRef.current = handleEnd;


  const handleCancel = () => {
    clearInterval(ringTimerRef.current);
    socket?.emit('call:cancel', { recipientId });
    navigate('/connect');
  };

  // ── Subtitle send ─────────────────────────────────────────
  const sendSubtitle = useCallback((text, confidence = 1.0) => {
    if (!socket || !text?.trim()) return;
    const entry = {
      senderId:   user?._id,
      senderName: user?.name || 'You',
      text:       text.trim(),
      inputMode:  inputMode || user?.inputMode || 'type',
      confidence,
      color:      '#ffffff',
      timestamp:  Date.now(),
      id:         `local-${Date.now()}`,
    };
    addSubtitle(entry);
    setTranscript(p => [...p, entry]);
    socket.emit('subtitle:send', {
      roomCode,
      text: text.trim(),
      inputMode: inputMode || user?.inputMode || 'type',
      confidence,
    });
  }, [socket, roomCode, inputMode, addSubtitle, user]);

  const sendInterim = useCallback((text) => {
    socket?.emit('subtitle:interim-send', {
      roomCode,
      text: (text || '').trim(),
      inputMode: inputMode || user?.inputMode || 'type',
    });
  }, [socket, roomCode, inputMode, user?.inputMode]);

  // ── Network quality badge ─────────────────────────────────
  const qualityColor = {
    good:         'bg-emerald-500',
    connecting:   'bg-amber-500',
    poor:         'bg-orange-500',
    disconnected: 'bg-red-500',
  }[netQuality] ?? 'bg-zinc-500';

  const qualityLabel = {
    good:         '● Connected',
    connecting:   '● Connecting…',
    poor:         '● Poor signal',
    disconnected: '● Reconnecting…',
  }[netQuality] ?? '● …';

  // ═══════════════════════════════════════════════════════════
  // RINGING SCREEN
  // ═══════════════════════════════════════════════════════════
  if (isInitiator && callPhase === 'ringing') {
    const progress = (ringLeft / RING_SECONDS) * 100;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#090f0f] text-white select-none overflow-hidden relative">
        {/* Ambient gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,184,166,0.12)_0%,transparent_70%)] pointer-events-none" />

        {/* Animated ring pulses */}
        {[260, 360, 480].map((size, i) => (
          <div
            key={i}
            className="absolute rounded-full border border-teal-500/15"
            style={{
              width: size, height: size,
              animation: `ping ${1.4 + i * 0.5}s cubic-bezier(0,0,0.2,1) infinite`,
              animationDelay: `${i * 0.4}s`,
            }}
          />
        ))}

        <div className="relative z-10 flex flex-col items-center text-center gap-6 px-6 max-w-sm w-full">
          {/* Avatar */}
          <div className="relative">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-teal-500/20 to-slate-900 border-2 border-teal-500/40 flex items-center justify-center shadow-[0_0_50px_rgba(20,184,166,0.3)]">
              <span className="text-5xl font-black text-teal-200">
                {recipientName?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
            <div className="absolute inset-0 rounded-full border-2 border-teal-400/30 animate-ping" />
          </div>

          <div>
            <p className="text-teal-400 text-[10px] font-black uppercase tracking-[0.3em] mb-2 animate-pulse">
              {isVoiceOnly ? '🔊 Voice Call' : '📹 Video Call'} · Calling
            </p>
            <h1 className="text-3xl font-black text-white tracking-tight">{recipientName}</h1>
            <p className="text-zinc-500 text-sm mt-1">Waiting for them to answer…</p>
          </div>

          {/* Countdown bar */}
          <div className="w-full max-w-xs">
            <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className={`text-[10px] font-bold uppercase tracking-widest text-center ${ringLeft <= 8 ? 'text-rose-400 animate-pulse' : 'text-zinc-600'}`}>
              Cancelling in {ringLeft}s
            </p>
          </div>

          {/* Cancel button */}
          <button
            onClick={handleCancel}
            className="w-full max-w-xs py-4 rounded-2xl bg-red-600/90 hover:bg-red-500 border border-red-400/40 text-white font-black text-sm tracking-widest uppercase transition-all active:scale-95 shadow-[0_0_25px_rgba(239,68,68,0.3)] flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Cancel Call
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN CALL UI
  // ═══════════════════════════════════════════════════════════
  const remoteName = remoteParticipant?.name || recipientName;

  return (
    <div
      className="min-h-screen max-h-screen flex flex-col bg-[#0a0a0a] text-white select-none overflow-hidden font-sans"
      onMouseMove={resetControlHide}
      onTouchStart={resetControlHide}
    >
      {/* ─── TOP HEADER ─────────────────────────────────────── */}
      <header
        className={`flex-none flex items-center justify-between px-4 py-2.5 bg-black/60 backdrop-blur-xl border-b border-white/5 z-30 transition-all duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* Left: status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${qualityColor} transition-colors`} />
            <span className="text-xs font-semibold text-zinc-400 hidden sm:inline">{qualityLabel}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${isVoiceOnly ? 'bg-sky-500/10 border-sky-500/30 text-sky-400' : 'bg-teal-500/10 border-teal-500/30 text-teal-400'}`}>
            {isVoiceOnly ? '🔊 Voice' : '📹 Video'}
          </div>
          {remoteName && (
            <span className="hidden sm:inline text-sm text-zinc-400 font-medium">
              with <span className="text-white font-semibold">{remoteName}</span>
            </span>
          )}
        </div>

        {/* Right: timer */}
        <div className="flex items-center gap-3">
          {callPhase === 'active' && (
            <div className="font-mono text-teal-400 text-sm font-bold tabular-nums bg-zinc-900/60 px-3 py-1 rounded-full border border-teal-500/20">
              {fmt(duration)}
            </div>
          )}
          {callPhase === 'active' && (
            <span className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider hidden md:inline">
              {fmt(duration)} · Room {roomCode}
            </span>
          )}
        </div>
      </header>

      {/* ─── MAIN CONTENT ───────────────────────────────────── */}
      <main className="flex-1 flex overflow-hidden min-h-0">

        {/* VIDEO AREA ─────────────────────────────────────── */}
        <section className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">

          {/* ── Remote video (main / dominant feed) ── */}
          {!isVoiceOnly ? (
            <>
              <video
                ref={remoteVideoRef}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${remoteCamOff ? 'opacity-0' : 'opacity-100'}`}
                autoPlay
                playsInline
                onDoubleClick={togglePiP}
                title="Double-click for Picture-in-Picture"
              />
              {/* Remote camera-off overlay */}
              {remoteCamOff && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950">
                  <AvatarView name={remoteName} subtitle="Camera is off" />
                </div>
              )}
            </>
          ) : (
            /* VOICE CALL — show avatar + audio visualizer */
            <div className="flex flex-col items-center justify-center gap-6">
              <AvatarView
                name={remoteName}
                size="lg"
                subtitle={remoteStream ? 'Connected · Audio Call' : 'Waiting…'}
                pulse={!!remoteStream}
              />
              {remoteStream && !remoteMuted && (
                <div className="flex items-end gap-1 h-8">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-1.5 rounded-full bg-teal-400 opacity-80"
                      style={{
                        height: `${20 + Math.random() * 50}%`,
                        animation: `waveform 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Gradient overlay (readability) ── */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20 pointer-events-none" />

          {/* ── Waiting overlay (no remote stream yet) ── */}
          {!remoteStream && callPhase === 'active' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
              <AvatarView
                name={remoteName}
                subtitle="Connecting…"
                pulse
              />
              <p className="text-teal-400/60 text-xs font-semibold uppercase tracking-widest mt-4 animate-pulse">
                Establishing peer connection
              </p>
            </div>
          )}

          {/* ── Remote muted badge ── */}
          {remoteMuted && (
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-red-900/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-red-500/40">
              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8" />
              </svg>
              <span className="text-red-300 text-[10px] font-bold uppercase tracking-wider">Muted</span>
            </div>
          )}

          {/* ── Subtitle overlay ── */}
          <SubtitleOverlay
            subtitles={subtitles}
            myId={user?._id}
            isCentral={user?.disabilityType === 'paralyzed'}
          />

          {/* ── Remote interim (typing/speaking indicator) ── */}
          {remoteInterim?.text && (
            <div className="absolute bottom-4 left-4 z-20 max-w-xs">
              <div className="bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-xl">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold mb-1">
                  {remoteName} is {remoteInterim.inputMode === 'voice' ? 'speaking' : 'typing'}…
                </p>
                <p className="text-white text-sm font-medium italic leading-snug">
                  {remoteInterim.text}
                  <span className="inline-block w-0.5 h-3 bg-teal-400 ml-1 animate-pulse align-middle" />
                </p>
              </div>
            </div>
          )}

          {/* ── PiP button (hover) ── */}
          {remoteStream && !isVoiceOnly && (
            <button
              onClick={togglePiP}
              className="absolute top-4 right-4 z-20 opacity-0 hover:opacity-100 bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 p-2 rounded-xl transition-all"
              title="Picture-in-Picture"
            >
              <svg className="w-4 h-4 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <rect x="12" y="13" width="7" height="5" rx="1" />
              </svg>
            </button>
          )}

          {/* ── Local PiP feed (bottom-right corner) ── */}
          {!isVoiceOnly && (
            <div className="absolute bottom-4 right-4 z-20 w-28 h-20 sm:w-44 sm:h-28 lg:w-52 lg:h-36 rounded-2xl overflow-hidden border border-white/15 bg-zinc-900 shadow-[0_8px_32px_rgba(0,0,0,0.8)] group transition-all hover:scale-105 hover:border-teal-500/30">
              <video
                ref={localVideoRef}
                className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-300 ${camOff ? 'opacity-0' : 'opacity-100'}`}
                autoPlay
                playsInline
                muted
              />
              {camOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <AvatarView name={user?.name} size="sm" />
                </div>
              )}
              <div className="absolute bottom-1.5 left-2 text-[9px] text-teal-300/70 font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                You
              </div>
            </div>
          )}
        </section>

        {/* ── COMMUNICATION SIDEBAR ────────────────────────── */}
        <aside className="flex-none w-[300px] lg:w-[340px] bg-[#111111] border-l border-white/5 flex flex-col overflow-hidden">

          {/* Panel tabs */}
          <div className="flex-none flex border-b border-white/5 bg-[#0d0d0d]">
            {[
              { id: 'voice', icon: '🎙️', label: 'Voice' },
              { id: 'type',  icon: '⌨️',  label: 'Type'  },
              { id: 'chat',  icon: '💬',  label: 'Quick' },
              { id: 'log',   icon: '📋',  label: 'Log'   },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setPanel(tab.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[9px] font-black uppercase tracking-wider transition-all border-b-2 ${
                  panel === tab.id
                    ? 'border-teal-500 text-teal-400 bg-teal-500/5'
                    : 'border-transparent text-zinc-600 hover:text-zinc-400'
                }`}
              >
                <span className="text-base">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">

            {/* ── Quick phrases always visible at top ── */}
            <div className="mb-4 pb-4 border-b border-white/5">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-3">Quick Phrases</p>
              <QuickPhrases compact inCall roomCode={roomCode} />
            </div>

            {/* ── Active panel ── */}
            {panel === 'voice' && (
              <VoicePanel
                onSend={sendSubtitle}
                onSendInterim={sendInterim}
                subtitles={subtitles}
                remoteInterim={remoteInterim}
                autoStart
              />
            )}

            {panel === 'type' && (
              <TypePanel
                onSend={sendSubtitle}
                onSendInterim={sendInterim}
              />
            )}

            {panel === 'chat' && (
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-3">Common Phrases</p>
                {[
                  'Hello!', 'Can you hear me?', 'Yes', 'No',
                  'Please repeat that', 'Hold on a moment',
                  'I understand', 'Thank you', 'Goodbye',
                  'I need help', 'I am in pain', 'Call someone',
                  'Yes, I agree', 'No, I disagree',
                ].map(phrase => (
                  <button
                    key={phrase}
                    onClick={() => sendSubtitle(phrase, 1.0)}
                    className="w-full text-left px-3 py-2.5 rounded-xl bg-white/5 border border-white/5 text-zinc-300 text-sm hover:bg-teal-500/10 hover:border-teal-500/30 hover:text-teal-300 transition-all active:scale-[0.98]"
                  >
                    {phrase}
                  </button>
                ))}
              </div>
            )}

            {panel === 'log' && (
              <TranscriptPanel
                transcript={transcript}
                myId={user?._id}
                colorMap={{ [user?._id]: '#ffffff' }}
                onClear={() => setTranscript([])}
              />
            )}
          </div>

          {/* Remote participant info strip */}
          {remoteParticipant && (
            <div className="flex-none px-4 py-2.5 border-t border-white/5 bg-[#0d0d0d] flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-xs font-black text-teal-300">
                {remoteName?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate">{remoteName}</p>
                <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-semibold">
                  {remoteParticipant.disabilityType} · {remoteParticipant.inputMode}
                </p>
              </div>
              <div className={`w-2 h-2 rounded-full ${remoteStream ? 'bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-zinc-600'} animate-pulse`} />
            </div>
          )}
        </aside>
      </main>

      {/* ─── BOTTOM CONTROLS ────────────────────────────────── */}
      <footer
        className={`flex-none flex items-center justify-center gap-3 px-6 py-4 bg-black/80 backdrop-blur-xl border-t border-white/5 z-30 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      >
        {/* Mute */}
        <CtrlBtn
          onClick={toggleMute}
          active={muted}
          label={muted ? 'Unmute' : 'Mute'}
          className="w-14 h-14"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            {muted
              ? <><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/></>
              : <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>
            }
          </svg>
          <span className="text-[8px] font-bold uppercase tracking-wider">{muted ? 'Unmute' : 'Mute'}</span>
        </CtrlBtn>

        {/* Camera (video calls only) */}
        {!isVoiceOnly && (
          <CtrlBtn
            onClick={toggleCam}
            active={camOff}
            label={camOff ? 'Start Camera' : 'Stop Camera'}
            className="w-14 h-14"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              {camOff
                ? <><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/></>
                : <><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></>
              }
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider">{camOff ? 'Camera' : 'Camera'}</span>
          </CtrlBtn>
        )}

        {/* Screen share (video calls only) */}
        {!isVoiceOnly && (
          <CtrlBtn
            onClick={toggleScreen}
            active={false}
            label={screenSharing ? 'Stop Sharing' : 'Share Screen'}
            className={`w-14 h-14 ${screenSharing ? '!bg-sky-500/20 !border-sky-500/50 !text-sky-400' : ''}`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider">{screenSharing ? 'Stop' : 'Share'}</span>
          </CtrlBtn>
        )}

        <div className="w-px h-10 bg-white/10 mx-2" />

        {/* End Call */}
        <CtrlBtn
          onClick={handleEnd}
          danger
          label="End Call"
          className="w-40 h-14 !rounded-2xl"
        >
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 8.25v1.5a.75.75 0 01-.75.75h-1.5M7.5 8.25v1.5a.75.75 0 00.75.75h1.5m9.75-2.25a9 9 0 00-12.75 0m12.75 0l.75.75m-14.25-.75l-.75.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-black text-sm uppercase tracking-wider">End Call</span>
          </div>
        </CtrlBtn>
      </footer>
    </div>
  );
}