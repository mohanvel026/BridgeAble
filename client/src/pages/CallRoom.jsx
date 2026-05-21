// client/src/pages/CallRoom.jsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, useCallStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import toast from 'react-hot-toast';

import InputModeSwitcher from '../components/InputModeSwitcher';
import QuickPhrases from '../components/QuickPhrases';
import GesturePanel from '../components/call/GesturePanel';
import BlinkPanel from '../components/call/BlinkPanel';
import SymbolPanel from '../components/call/SymbolPanel';
import VoicePanel from '../components/call/VoicePanel';
import TypePanel from '../components/call/TypePanel';
import SubtitleOverlay from '../components/call/SubtitleOverlay';
import TranscriptPanel from '../components/call/TranscriptPanel';

const PARTICIPANT_COLORS = ['#22d3ee', '#a78bfa', '#fbbf24', '#fb7185'];
const INPUT_PANELS = {
  gesture: GesturePanel,
  blink: BlinkPanel,
  symbol: SymbolPanel,
  voice: VoicePanel,
  type: TypePanel,
};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ============================================================================
// HOOK: High-Performance WebRTC Media Transceiver
// Handles connection mapping, ICE states, and secure hardware stream tracking.
// ============================================================================
function useWebRTC(roomCode, socket, RTC_CONFIG, onRemoteParticipantUpdate) {
  const peerConnRef = useRef(null);
  const localStreamRef = useRef(null);
  const isNegotiatingRef = useRef(false);
  const [callState, setCallState] = useState('connecting'); // connecting | active | disconnected
  const [networkQuality, setNetworkQuality] = useState('good'); // good | poor | disconnected

  const closeConnections = useCallback(() => {
    if (peerConnRef.current) {
      peerConnRef.current.close();
      peerConnRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      localStreamRef.current = null;
    }
    isNegotiatingRef.current = false;
    setCallState('disconnected');
    setNetworkQuality('disconnected');
  }, []);

  const createPeerConnection = useCallback((targetUserId, remoteVideoElement) => {
    if (peerConnRef.current) return peerConnRef.current;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnRef.current = pc;
    isNegotiatingRef.current = false;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.ontrack = (event) => {
      if (remoteVideoElement && event.streams[0]) {
        remoteVideoElement.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc:ice', { to: targetUserId, candidate: event.candidate });
      }
    };

    // Advanced ICE State monitoring for Network Quality Indicator
    pc.oniceconnectionstatechange = () => {
      switch (pc.iceConnectionState) {
        case 'connected':
        case 'completed':
          setNetworkQuality('good');
          break;
        case 'checking':
          setNetworkQuality('poor');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          setNetworkQuality('disconnected');
          // Industry-Grade Automated WebRTC Recovery (ICE Restarts)
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            console.log('🔄 ICE Connection dropped. Initiating robust ICE restart payload...');
            if (typeof pc.restartIce === 'function') {
              pc.restartIce();
            } else {
              // Legacy ICE restart fallback
              pc.createOffer({ iceRestart: true })
                .then(offer => pc.setLocalDescription(offer))
                .then(() => socket && socket.emit('webrtc:offer', { to: targetUserId, offer: pc.localDescription, roomCode: 'implicit' }))
                .catch(err => console.error('ICE Restart failed:', err));
            }
          }
          break;
        default:
          break;
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        if (isNegotiatingRef.current) return;
        isNegotiatingRef.current = true;
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket?.emit('webrtc:offer', { to: targetUserId, offer, roomCode });
      } catch (err) {
        console.error('Signaling negotiation protocol pipeline failure:', err);
      } finally {
        isNegotiatingRef.current = false;
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setCallState('active');
      } else if (pc.connectionState === 'disconnected') {
        setCallState('connecting');
      } else if (pc.connectionState === 'failed') {
        setCallState('connecting');
        // Autonomous ICE Restart (Industry Grade Resilience)
        // If network drops and fails, aggressively restart ICE pathing
        console.warn('[WebRTC] Connection failed. Initiating ICE Restart...');
        pc.restartIce();
      } else if (pc.connectionState === 'closed') {
        setCallState('disconnected');
      }
    };

    return pc;
  }, [socket, roomCode, RTC_CONFIG]);

  return {
    peerConnRef,
    localStreamRef,
    callState,
    setCallState,
    networkQuality,
    createPeerConnection,
    closeConnections
  };
}

// ============================================================================
// COMPONENT: Main Call Room Architecture
// ============================================================================
export default function CallRoom() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const socket = getSocket();
  const { user } = useAuthStore();

  // Extract call initiation context from navigation state
  // callType is also persisted to sessionStorage so tunnel page-reloads don't lose it
  const isInitiator    = location.state?.isInitiator ?? false;
  const recipientId    = location.state?.recipientId ?? null;
  const recipientName  = location.state?.recipientName ?? 'Connecting...';
  const _stateCallType = location.state?.callType;
  const callType = useMemo(() => {
    if (_stateCallType) {
      sessionStorage.setItem(`bridgeable_calltype_${roomCode}`, _stateCallType);
      return _stateCallType;
    }
    return sessionStorage.getItem(`bridgeable_calltype_${roomCode}`) || 'video';
  }, [_stateCallType, roomCode]);
  const isVoiceOnly = callType === 'voice';
  
  const { 
    addSubtitle, subtitles, addParticipant, 
    inputMode, setRoom, endCall 
  } = useCallStore();

  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const ttsQueueRef = useRef([]);
  const isComponentLive = useRef(true);
  const ringTimerRef = useRef(null);
  // ── Stores peer join data that arrived before local camera was ready ──
  const pendingPeerJoinRef = useRef(null);
  // ── Resolves when local media stream is fully set up ──
  const mediaReadyResolversRef = useRef([]);

  // callPhase: 'ringing' = waiting for peer | 'active' = peer joined
  const [callPhase, setCallPhase] = useState(isInitiator ? 'ringing' : 'active');
  const [ringSecondsLeft, setRingSecondsLeft] = useState(35);
  const fallbackAudioCtxRef = useRef(null);

  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteParticipant, setRemoteParticipant] = useState(null);
  const [historicalTranscript, setHistoricalTranscript] = useState([]);
  
  // Real-world specific track states
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteCamOff, setRemoteCamOff] = useState(false);

  const myInputMode = useMemo(() => inputMode || user?.inputMode || 'voice', [inputMode, user]);

  const colorMap = useMemo(() => {
    const map = {};
    if (user?._id) map[user._id] = '#fff';
    if (remoteParticipant?.userId) map[remoteParticipant.userId] = PARTICIPANT_COLORS[0];
    return map;
  }, [user, remoteParticipant]);

  const {
    localStreamRef,
    callState,
    setCallState,
    networkQuality,
    createPeerConnection,
    closeConnections,
    peerConnRef
  } = useWebRTC(roomCode, socket, RTC_CONFIG, setRemoteParticipant);

  // ── Enterprise Text To Speech Queue Processor ──
  const processTtsExecutionQueue = useCallback(() => {
    if (!('speechSynthesis' in window) || window.speechSynthesis.speaking || ttsQueueRef.current.length === 0) return;

    const outputText = ttsQueueRef.current.shift();
    const utterance = new SpeechSynthesisUtterance(outputText);
    utterance.rate = 1.0;

    utterance.onend = () => processTtsExecutionQueue();
    utterance.onerror = () => processTtsExecutionQueue();

    window.speechSynthesis.speak(utterance);
  }, []);

  const pushToTtsQueue = useCallback((text) => {
    ttsQueueRef.current.push(text);
    processTtsExecutionQueue();
  }, [processTtsExecutionQueue]);

  // ── Call Transcript Exporter ──
  const handleExportTranscript = useCallback(() => {
    if (historicalTranscript.length === 0) {
      toast('Transcript is empty.', { icon: 'ℹ️', style: { borderRadius: '10px', background: '#333', color: '#fff' }});
      return;
    }
    const txtContent = historicalTranscript.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `[${time}] ${log.senderName} (${log.inputMode}): ${log.text}`;
    }).join('\n');
    
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Transcript_Room_${roomCode}_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [historicalTranscript, roomCode]);

  // ── Network Signaling Callbacks ──
  const handleIncomingSubtitle = useCallback((data) => {
    const defaultColor = PARTICIPANT_COLORS[0];
    const entry = { ...data, color: defaultColor, timestamp: Date.now(), id: `${data.senderId}-${Date.now()}` };
    addSubtitle(entry);
    setHistoricalTranscript(prev => [...prev, entry]);

    const isClientBlind = user?.disabilityType === 'blind';
    const isRemoteImpaired = remoteParticipant?.disabilityType === 'deaf' || remoteParticipant?.disabilityType === 'paralyzed';

    if (isClientBlind || isRemoteImpaired) {
      pushToTtsQueue(`${data.senderName} states: ${data.text}`);
    }
  }, [user, remoteParticipant, addSubtitle, pushToTtsQueue]);

  const sendSubtitle = useCallback((text, confidence = 1.0) => {
    if (!socket || !text?.trim()) return;

    const localLog = {
      senderId:   user?._id,
      senderName: user?.name || 'You',
      text:       text.trim(),
      inputMode:  myInputMode,
      confidence,
      color:      '#ffffff',
      timestamp:  Date.now(),
      id:         `local-${Date.now()}`,
    };

    // Show in overlay (right-aligned "You" bubble) AND in session log
    addSubtitle(localLog);
    setHistoricalTranscript(prev => [...prev, localLog]);

    socket.emit('subtitle:send', { roomCode, text: text.trim(), inputMode: myInputMode, confidence });

  }, [socket, roomCode, myInputMode]);

// Helper to create an industry-grade canvas animated video track fallback if webcam is locked/absent
function createDynamicVideoFallbackTrack(label = 'User', activeRef) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  let angle = 0;
  let pulse = 0;
  const initial = label ? label.trim()[0].toUpperCase() : '?';

  const animate = () => {
    if (!ctx || (activeRef && !activeRef.current.active)) return;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    pulse += 0.05;

    // Background — teal gradient (clearly not black)
    const bg = ctx.createRadialGradient(cx, cy, 30, cx, cy, 280);
    bg.addColorStop(0, '#0d3330');
    bg.addColorStop(1, '#040e0d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Outer pulse ring
    ctx.beginPath();
    ctx.arc(cx, cy, 115 + Math.sin(pulse) * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(34,211,238,${0.12 + Math.sin(pulse) * 0.06})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Avatar circle
    const avatarGrad = ctx.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, 80);
    avatarGrad.addColorStop(0, '#1a5c58');
    avatarGrad.addColorStop(1, '#0a3330');
    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, Math.PI * 2);
    ctx.fillStyle = avatarGrad;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 22 + Math.sin(pulse) * 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Cyan border ring
    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, Math.PI * 2);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Orbiting dot
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * 80, cy + Math.sin(angle) * 80, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#67e8f9';
    ctx.shadowColor = '#67e8f9';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Initial letter
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, cx, cy);

    // Name label
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(label.substring(0, 20), cx, cy + 108);

    // "Camera locked" badge
    ctx.fillStyle = 'rgba(251,191,36,0.18)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(cx - 90, cy + 124, 180, 26, 13);
    } else {
      ctx.rect(cx - 90, cy + 124, 180, 26);
    }
    ctx.fill();

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px "DM Sans", monospace';
    ctx.fillText('CAMERA LOCKED OR IN USE', cx, cy + 140);

    // Waveform bars
    for (let i = 0; i < 7; i++) {
      const h = 8 + Math.abs(Math.sin(pulse * 1.4 + i * 0.8)) * 16;
      ctx.fillStyle = `rgba(34,211,238,${0.35 + i * 0.05})`;
      ctx.fillRect(cx - 34 + i * 10, cy + 168 - h / 2, 7, h);
    }

    angle += 0.035;
    requestAnimationFrame(animate);
  };

  animate();
  const stream = canvas.captureStream(30);
  return stream.getVideoTracks()[0];
}

// ── Room Stream Setup ──
  const fallbackActiveRef = useRef({ active: true });

  useEffect(() => {
    isComponentLive.current = true;
    fallbackActiveRef.current.active = true;
    setRoom(roomCode);

    const runCallInitialization = async () => {
      try {
        // ── Step 1: Join the room immediately (don't wait for camera) ──
        socket?.emit('room:join', { roomCode });
        setCallState('active');

        // Start the call timer
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => {
          if (isComponentLive.current) {
            setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
          }
        }, 1000);

        // ── Step 2: Fetch room info (non-blocking) ──
        api.get(`/rooms/${roomCode}`).catch(() => {});

        if (!isComponentLive.current) return;

        // ── Step 3: Set up camera / audio (conditionally based on callType) ──
        let mediaStream;

        if (isVoiceOnly) {
          // ── Voice call: audio only, no camera permission needed ──
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              video: false,
            });
          } catch {
            // Silent audio fallback
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            fallbackAudioCtxRef.current = ctx;
            const dst = ctx.createMediaStreamDestination();
            const osc = ctx.createOscillator();
            osc.connect(dst); osc.start();
            mediaStream = dst.stream;
            setMuted(true);
          }
          setCamOff(true); // no camera for voice calls
        } else {
          // ── Video call: request camera + mic ──
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
          } catch (videoError) {
            console.warn('Camera locked/denied — using canvas avatar fallback:', videoError);
            let audioTrack;
            try {
              const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
              });
              audioTrack = audioStream.getAudioTracks()[0];
            } catch {
              const ctx = new (window.AudioContext || window.webkitAudioContext)();
              fallbackAudioCtxRef.current = ctx;
              const dst = ctx.createMediaStreamDestination();
              const osc = ctx.createOscillator();
              osc.connect(dst); osc.start();
              audioTrack = dst.stream.getAudioTracks()[0];
              setMuted(true);
            }
            const fallbackVideoTrack = createDynamicVideoFallbackTrack(user?.name || 'BridgeAble', fallbackActiveRef);
            mediaStream = new MediaStream([audioTrack, fallbackVideoTrack]);
            setCamOff(true);
          }
        }

        if (!isComponentLive.current) {
          mediaStream.getTracks().forEach(t => t.stop());
          return;
        }

        localStreamRef.current = mediaStream;
        if (localVideoRef.current) localVideoRef.current.srcObject = mediaStream;

        // ── Flush pending peer join (peer arrived before camera was ready) ──
        const hasPendingJoin = !!pendingPeerJoinRef.current;

        if (hasPendingJoin && peerConnRef.current) {
          // Peer connection created by incoming offer — add tracks, renegotiation fires automatically
          mediaStream.getTracks().forEach(track => {
            try { peerConnRef.current.addTrack(track, mediaStream); } catch {}
          });
        } else if (hasPendingJoin && !peerConnRef.current) {
          // Peer joined via room:user-joined but no connection yet — create now with tracks already in stream
          const { userId: peerId, videoEl } = pendingPeerJoinRef.current;
          createPeerConnection(peerId, videoEl);
        } else if (peerConnRef.current) {
          // Normal case: peer connection already exists (no pending join), just add tracks
          mediaStream.getTracks().forEach(track => {
            try { peerConnRef.current.addTrack(track, mediaStream); } catch {}
          });
        }

        // Unblock any onWebRtcOffer awaiting media
        mediaReadyResolversRef.current.forEach(resolve => resolve(mediaStream));
        mediaReadyResolversRef.current = [];
        pendingPeerJoinRef.current = null;


      } catch (err) {
        console.error('Call init error:', err);
      }
    };

    runCallInitialization();

    // ── beforeunload: hard close / tab refresh / browser crash ──
    // Uses sendBeacon as a last-resort fire-and-forget channel so the
    // socket:end-graceful event is still delivered even if the WS closes first.
    const onBeforeUnload = () => {
      if (socket?.connected) {
        socket.emit('room:leave', { roomCode });
        socket.emit('call:end-graceful', { roomCode });
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      fallbackActiveRef.current.active = false;
      if (fallbackAudioCtxRef.current && fallbackAudioCtxRef.current.state !== 'closed') {
        fallbackAudioCtxRef.current.close().catch(() => {});
        fallbackAudioCtxRef.current = null;
      }
      isComponentLive.current = false;
      clearInterval(timerRef.current);
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      // ── Always notify peer when this component unmounts (navigation, back-button, etc.) ──
      if (socket?.connected) {
        socket.emit('room:leave', { roomCode });
        socket.emit('call:end-graceful', { roomCode });
      }
      closeConnections();
      endCall();
    };
  }, [roomCode, setRoom, endCall, socket, closeConnections, localStreamRef, setCallState]);

  // ── Network Messaging Ingestion Mapping ──
  useEffect(() => {
    if (!socket) return;

    // Auto-rejoin room if socket reconnects after a drop (e.g. Wi-Fi switch)
    const onReconnect = () => {
      console.log('[Network] Socket reconnected. Re-joining room:', roomCode);
      socket.emit('room:join', { roomCode });
    };
    socket.on('connect', onReconnect);

    const onUserJoined = (data) => {
      if (!isComponentLive.current) return;
      // Peer joined — transition out of ringing phase
      clearInterval(ringTimerRef.current);
      setCallPhase('active');
      setRemoteParticipant(data);
      addParticipant({ userId: data.userId, ...data, color: PARTICIPANT_COLORS[0] });

      if (localStreamRef.current) {
        // Camera already ready — create peer connection immediately with tracks
        createPeerConnection(data.userId, remoteVideoRef.current);
      } else {
        // Camera not ready yet — queue the join; createPeerConnection will fire once media arrives
        console.log('[WebRTC] Peer joined before camera ready — queuing createPeerConnection');
        pendingPeerJoinRef.current = { userId: data.userId, videoEl: remoteVideoRef.current };
      }
    };

    const onWebRtcOffer = async ({ from, offer, fromDisability, fromInputMode }) => {
      if (!isComponentLive.current) return;
      setRemoteParticipant({ userId: from, disabilityType: fromDisability, inputMode: fromInputMode });

      // ── Wait for local media to be ready before creating the peer connection ──
      // This prevents the callee from sending an empty answer (no tracks) when
      // their camera takes time to initialise.
      if (!localStreamRef.current) {
        console.log('[WebRTC] Offer received before camera ready — waiting for media...');
        await new Promise(resolve => mediaReadyResolversRef.current.push(resolve));
      }

      const pc = createPeerConnection(from, remoteVideoRef.current);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { to: from, answer });
      } catch (err) {
        console.error('Failed processing inbound WebRTC remote session description payload:', err);
      }
    };

    const onWebRtcAnswer = async ({ answer }) => {
      if (peerConnRef.current) {
        try {
          await peerConnRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error('Failed aligning local WebRTC connection matrix descriptor:', err);
        }
      }
    };

    const onIceCandidateReceived = async ({ candidate }) => {
      if (peerConnRef.current && candidate) {
        try { await peerConnRef.current.addIceCandidate(new RTCIceCandidate(candidate)); } 
        catch { /* Absorb micro network jitter exceptions */ }
      }
    };

    const onModeSwitched = ({ newMode }) => {
      setRemoteParticipant(prev => prev ? { ...prev, inputMode: newMode } : null);
    };

    const onCallDeclined = ({ reason }) => {
      if (reason === 'busy') {
        toast.error('The user is currently busy on another call.');
      } else {
        toast.error('Call was declined.');
      }
      navigate('/dashboard');
    };

    socket.on('room:user-joined', onUserJoined);
    socket.on('webrtc:offer', onWebRtcOffer);
    socket.on('webrtc:answer', onWebRtcAnswer);
    socket.on('webrtc:ice', onIceCandidateReceived);
    socket.on('subtitle:receive', handleIncomingSubtitle);
    socket.on('mode:switched', onModeSwitched);
    const onCallEnded = () => navigate('/dashboard');
    socket.on('call:ended', onCallEnded);
    socket.on('call:declined', onCallDeclined);
    
    const onTrackStateChange = ({ audio, video }) => {
      setRemoteMuted(audio);
      setRemoteCamOff(video);
    };
    const onGracefulEnd = ({ reason } = {}) => {
      if (reason === 'disconnected') {
        toast('The other person lost connection.', { icon: '🔌', duration: 4000 });
      } else {
        toast('The other person ended the call.', { icon: '👋', duration: 3000 });
      }
      navigate('/dashboard');
    };
    
    socket.on('call:track-state', onTrackStateChange);
    socket.on('call:ended-graceful', onGracefulEnd);

    // ── Voice → Video upgrade request (peer wants to switch to video) ──
    const onUpgradeRequest = () => {
      toast(
        (t) => (
          <div className="flex flex-col gap-2">
            <p className="font-semibold text-white text-sm">📹 Video call requested</p>
            <p className="text-xs text-zinc-400">The other person wants to switch to a video call.</p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => {
                  socket.emit('call:upgrade-response', { roomCode, accepted: true });
                  // Reload page with video call type so camera starts
                  sessionStorage.setItem(`bridgeable_calltype_${roomCode}`, 'video');
                  window.location.reload();
                  toast.dismiss(t.id);
                }}
                className="flex-1 py-1.5 rounded-lg bg-teal-500/20 border border-teal-500/40 text-teal-300 text-xs font-bold"
              >Accept</button>
              <button
                onClick={() => {
                  socket.emit('call:upgrade-response', { roomCode, accepted: false });
                  toast.dismiss(t.id);
                }}
                className="flex-1 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-bold"
              >Decline</button>
            </div>
          </div>
        ),
        { duration: 30000 }
      );
    };
    const onUpgradeResponse = ({ accepted }) => {
      if (accepted) {
        toast.success('Video call accepted! Switching now...');
        sessionStorage.setItem(`bridgeable_calltype_${roomCode}`, 'video');
        window.location.reload();
      } else {
        toast.error('Video call request was declined.');
      }
    };
    socket.on('call:upgrade-request', onUpgradeRequest);
    socket.on('call:upgrade-response', onUpgradeResponse);

    // Callee cancelled from their modal before answering (caller sees this)
    const onCallCancelled = () => {
      if (!isComponentLive.current) return;
      clearInterval(ringTimerRef.current);
      toast('Call was cancelled.', { icon: '📵' });
      navigate('/connect');
    };
    // Callee accepted — clear ringing state on caller side
    const onCallAccepted = () => {
      clearInterval(ringTimerRef.current);
      setCallPhase('active');
    };
    socket.on('call:cancelled', onCallCancelled);
    socket.on('call:accepted', onCallAccepted);

    return () => {
      socket.off('connect', onReconnect);
      socket.off('room:user-joined', onUserJoined);
      socket.off('webrtc:offer', onWebRtcOffer);
      socket.off('webrtc:answer', onWebRtcAnswer);
      socket.off('webrtc:ice', onIceCandidateReceived);
      socket.off('subtitle:receive', handleIncomingSubtitle);
      socket.off('mode:switched', onModeSwitched);
      socket.off('call:track-state', onTrackStateChange);
      socket.off('call:ended-graceful', onGracefulEnd);
      socket.off('call:ended', onCallEnded);
      socket.off('call:declined', onCallDeclined);
      socket.off('call:cancelled', onCallCancelled);
      socket.off('call:accepted', onCallAccepted);
      socket.off('call:upgrade-request', onUpgradeRequest);
      socket.off('call:upgrade-response', onUpgradeResponse);
    };
  }, [socket, createPeerConnection, handleIncomingSubtitle, addParticipant, navigate, peerConnRef]);

  // ── Ringing phase auto-cancel timer (caller side only) ──
  useEffect(() => {
    if (!isInitiator || callPhase !== 'ringing') return;

    // Handle recipient-offline event from server
    const onRecipientOffline = () => {
      clearInterval(ringTimerRef.current);
      toast.error(`${recipientName} is currently offline or unavailable.`, { icon: '📵' });
      navigate('/connect');
    };
    window.addEventListener('bridgeable:recipient-offline', onRecipientOffline);

    setRingSecondsLeft(35);
    ringTimerRef.current = setInterval(() => {
      setRingSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(ringTimerRef.current);
          if (socket && recipientId) socket.emit('call:cancel', { recipientId });
          navigate('/connect');
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      clearInterval(ringTimerRef.current);
      window.removeEventListener('bridgeable:recipient-offline', onRecipientOffline);
    };
  }, [isInitiator, callPhase]);

  // ── Cancel outgoing call before peer answers ──
  const handleCancelCall = useCallback(() => {
    clearInterval(ringTimerRef.current);
    if (socket && recipientId) socket.emit('call:cancel', { recipientId });
    navigate('/connect');
  }, [socket, recipientId, navigate]);

  // ── Hardware Control Plane Handlers ──
  const toggleAudioMuteState = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMuted(!audioTrack.enabled);
      if (socket) socket.emit('call:track-state', { roomCode, audio: !audioTrack.enabled, video: camOff });
    }
  };

  const toggleCameraTrackState = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setCamOff(!videoTrack.enabled);
      if (socket) socket.emit('call:track-state', { roomCode, audio: muted, video: !videoTrack.enabled });
    }
  };

  const toggleScreenDisplayCapture = async () => {
    try {
      if (!screenSharing) {
        const captureStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const desktopTrack = captureStream.getVideoTracks()[0];
        const primaryVideoSender = peerConnRef.current?.getSenders().find(s => s.track?.kind === 'video');
        
        if (primaryVideoSender) {
          await primaryVideoSender.replaceTrack(desktopTrack);
          desktopTrack.onended = toggleScreenDisplayCapture;
          setScreenSharing(true);
        }
      } else {
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        const primaryVideoSender = peerConnRef.current?.getSenders().find(s => s.track?.kind === 'video');
        if (primaryVideoSender && cameraTrack) {
          await primaryVideoSender.replaceTrack(cameraTrack);
          setScreenSharing(false);
        }
      }
    } catch (err) {
      console.error('Display window sharing permission access process faulted:', err);
    }
  };

  const handleEndCall = useCallback(() => {
    clearInterval(timerRef.current);
    if (socket?.connected) {
      socket.emit('room:leave', { roomCode });
      socket.emit('call:end', { roomCode, durationSeconds: duration });
      socket.emit('call:end-graceful', { roomCode });
    }
    // Stop all tracks immediately so camera light goes off
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
    }
    closeConnections();
    navigate('/dashboard');
  }, [socket, roomCode, duration, localStreamRef, closeConnections, navigate]);

  const formatTemporalDuration = (timeInSeconds) => {
    const mins = String(Math.floor(timeInSeconds / 60)).padStart(2, '0');
    const secs = String(timeInSeconds % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const RenderedInputPanel = INPUT_PANELS[myInputMode] || VoicePanel;

  // ── Ringing overlay — shown while waiting for peer to answer ──
  if (isInitiator && callPhase === 'ringing') {
    const ringProgress = (ringSecondsLeft / 35) * 100;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center antialiased select-none relative overflow-hidden bg-[#020808]">
        {/* Animated ring pulses */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,184,166,0.1),transparent_70%)]" />
          {[1, 2, 3].map(i => (
            <div key={i} className="absolute rounded-full border border-teal-500/20"
              style={{
                width: `${i * 260}px`, height: `${i * 260}px`,
                animation: `ping ${1.2 + i * 0.4}s cubic-bezier(0, 0, 0.2, 1) infinite`,
                animationDelay: `${i * 0.3}s`,
              }} />
          ))}
        </div>

        <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-sm w-full">
          {/* Avatar */}
          <div className="relative mb-8">
            <div className="absolute inset-0 rounded-full border-2 border-teal-400/40 animate-ping" />
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-teal-500/20 to-teal-900/40 border border-teal-500/30 flex items-center justify-center shadow-[0_0_40px_rgba(20,184,166,0.3)] backdrop-blur-xl">
              <span className="text-6xl font-black text-teal-300 drop-shadow-md">
                {recipientName?.[0]?.toUpperCase() || '?'}
              </span>
            </div>
          </div>

          <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2 animate-pulse">Establishing Link</p>
          <h1 className="text-4xl font-black text-white mb-2 tracking-tight drop-shadow-md">{recipientName}</h1>
          <p className="text-zinc-400 text-sm font-medium mb-8 bg-zinc-900/50 px-4 py-1.5 rounded-full border border-white/5">
            {isVoiceOnly ? '🔊 Voice Call' : '📹 Video Call'} · Awaiting Response
          </p>

          {/* Ring countdown progress */}
          <div className="w-64 mb-10">
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden mb-3 border border-white/5 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-teal-500 to-sky-400 transition-all duration-1000 ease-linear rounded-full shadow-[0_0_10px_rgba(45,212,191,0.5)]"
                style={{ width: `${ringProgress}%` }}
              />
            </div>
            <p className={`text-[10px] font-black uppercase tracking-widest ${ringSecondsLeft <= 10 ? 'text-rose-400 animate-pulse' : 'text-zinc-500'}`}>
              Auto-cancel in {ringSecondsLeft}s
            </p>
          </div>

          {/* Cancel button */}
          <button
            onClick={handleCancelCall}
            className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 font-black text-sm hover:bg-rose-500/20 active:scale-95 transition-all shadow-[0_0_20px_rgba(244,63,94,0.15)] uppercase tracking-widest group"
          >
            <span className="text-xl group-hover:scale-110 transition-transform">📵</span>
            Abort Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col antialiased select-none font-sans text-white bg-[#020808] relative overflow-hidden">
      
      {/* Background Mesh */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(20,184,166,0.08),transparent_50%)] pointer-events-none" />

      {/* HUD Header Bar */}
      <header className="flex items-center justify-between px-6 py-4 bg-zinc-950/80 backdrop-blur-xl border-b border-white/5 z-20 relative shadow-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full transition-all ${callState === 'active' ? 'bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.8)] animate-pulse' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse'}`} />
            <h1 className="text-[10px] font-black tracking-[0.2em] uppercase text-zinc-400 hidden sm:block">
              {callState === 'active' ? 'Secure Tunnel Active' : 'Negotiating Network'}
            </h1>
          </div>

          <div className="h-4 w-px bg-white/10 hidden sm:block" />

          {/* Call type badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${
            isVoiceOnly
              ? 'bg-sky-500/10 border-sky-500/30 text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.15)]'
              : 'bg-teal-500/10 border-teal-500/30 text-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.15)]'
          }`}>
            <span className="text-xs">{isVoiceOnly ? '🔊' : '📹'}</span>
            <span>{isVoiceOnly ? 'Voice Session' : 'Video Session'}</span>
          </div>

          <div className="h-4 w-px bg-white/10 hidden sm:block" />

          {/* Network quality bars */}
          {callState === 'active' && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-900/50 border border-white/5 rounded-full">
              {[1,2,3].map(bar => (
                <div key={bar} className={`w-1 rounded-full transition-all duration-300 ${
                  networkQuality === 'good'         ? 'bg-teal-400 h-3 shadow-[0_0_5px_rgba(45,212,191,0.5)]' :
                  networkQuality === 'poor' && bar <= 2 ? 'bg-amber-400 h-2 shadow-[0_0_5px_rgba(251,191,36,0.5)]' :
                  networkQuality === 'poor' && bar === 3 ? 'bg-zinc-700 h-3' :
                  'bg-rose-500 h-1 shadow-[0_0_5px_rgba(244,63,94,0.5)]'
                }`} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="font-mono text-teal-400 text-sm font-bold tabular-nums tracking-wider bg-zinc-900/50 px-3 py-1 rounded-full border border-white/5 shadow-inner" aria-label="Call Duration Timer">
            {formatTemporalDuration(duration)}
          </div>
          <div className="hidden sm:block">
            <InputModeSwitcher compact roomCode={roomCode} />
          </div>
        </div>
      </header>

      {/* Main View Area Grid */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative z-10">
        
        {/* Stream Viewports */}
        <section className="flex-1 flex flex-col lg:flex-row gap-4 p-4 lg:p-6 relative">
          
          {/* Remote Feed */}
          <div className="flex-1 relative rounded-3xl border border-white/5 bg-zinc-900/40 backdrop-blur-sm overflow-hidden shadow-2xl flex items-center justify-center group transition-all">
            <video ref={remoteVideoRef} className={`w-full h-full object-cover transition-opacity duration-500 ${remoteCamOff ? 'opacity-0' : 'opacity-100'}`} autoPlay playsInline />
            
            {/* Inner shadow/gradient for better text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

            {/* System PiP Toggle */}
            {remoteParticipant && !remoteCamOff && (
              <button 
                onClick={async () => {
                  try {
                    if (document.pictureInPictureElement) {
                      await document.exitPictureInPicture();
                    } else if (remoteVideoRef.current && remoteVideoRef.current.readyState !== 0) {
                      await remoteVideoRef.current.requestPictureInPicture();
                    }
                  } catch (err) {
                    console.warn('PiP failed:', err);
                  }
                }}
                className="absolute top-6 left-6 bg-zinc-950/60 hover:bg-zinc-900 backdrop-blur-md border border-white/10 p-3 rounded-xl text-white opacity-0 group-hover:opacity-100 transition-all z-40 active:scale-95 shadow-lg"
                title="Pop out video (Picture-in-Picture)"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <rect x="12" y="12" width="7" height="5" rx="1" ry="1"></rect>
                  <path d="M12 12l-3-3"></path>
                </svg>
              </button>
            )}
            
            {/* Connecting placeholder — shown while WebRTC is negotiating (no remote stream yet) */}
            {!remoteParticipant && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/80 backdrop-blur-md z-10">
                <div className="relative mb-8">
                  {[1,2,3].map(i => (
                    <div key={i} className="absolute inset-0 rounded-full border border-teal-500/20"
                      style={{ transform: `scale(${1 + i * 0.35})`, animation: `ping ${1.5 + i * 0.5}s ease-out infinite`, animationDelay: `${i * 0.4}s`, opacity: 0.5 }} />
                  ))}
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-teal-500/20 to-teal-900/40 border border-teal-500/30 flex items-center justify-center shadow-[0_0_30px_rgba(20,184,166,0.2)] backdrop-blur-xl">
                    <span className="text-4xl font-black text-teal-300 drop-shadow-md">
                      {recipientName?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                </div>
                <p className="text-white font-black text-2xl mb-2 drop-shadow-md">{recipientName}</p>
                <p className="text-teal-400/70 text-[10px] font-black uppercase tracking-[0.2em] mb-6">Establishing Secure Link</p>
                <div className="flex items-center gap-2">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_5px_rgba(45,212,191,0.8)]"
                      style={{ animation: 'bounce 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Remote Camera Disabled Overlay */}
            {remoteCamOff && remoteParticipant && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-lg z-10">
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-teal-500/10 to-teal-900/20 flex items-center justify-center mb-6 border border-teal-500/20 shadow-[0_0_40px_rgba(20,184,166,0.1)]">
                  <span className="text-5xl font-black text-teal-400/80 drop-shadow-sm">
                    {remoteParticipant?.name?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
                <p className="font-black text-white text-2xl mb-2 drop-shadow-md">{remoteParticipant?.name}</p>
                <p className="font-black text-[10px] tracking-widest uppercase text-zinc-500 bg-zinc-900/50 px-3 py-1 rounded-full border border-white/5">Video Feed Disabled</p>
              </div>
            )}

            {/* Remote Muted Indicator Overlay */}
            {remoteMuted && (
              <div className="absolute top-6 right-6 bg-rose-500/20 backdrop-blur-xl border border-rose-500/40 px-4 py-2 rounded-xl flex items-center gap-2 shadow-[0_0_20px_rgba(244,63,94,0.3)] z-30 animate-fade-in">
                <span className="text-rose-400 animate-pulse text-lg">🔇</span>
                <span className="text-[10px] font-black text-rose-300 uppercase tracking-widest">Audio Muted</span>
              </div>
            )}
            
            {/* Real-time Accessibility Subtitles Overlay */}
            <SubtitleOverlay subtitles={subtitles} myId={user?._id} />
          </div>


          {/* Picture-in-Picture Local Node Feed — hidden for voice-only calls */}
          {!isVoiceOnly ? (
            <div className="w-full lg:w-72 relative rounded-3xl border border-white/10 bg-zinc-950 overflow-hidden shadow-2xl h-48 lg:h-auto lg:max-h-48 lg:absolute lg:bottom-6 lg:right-6 z-30 group transition-all hover:scale-105 hover:border-teal-500/30">
              <video
                ref={localVideoRef}
                className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-500 ${camOff ? 'opacity-0' : 'opacity-100'}`}
                autoPlay playsInline muted
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
              
              {camOff && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-md">
                  <span className="text-3xl mb-3 drop-shadow-md">🚫</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Camera Off</span>
                </div>
              )}
              
              <div className="absolute bottom-3 left-3 bg-zinc-950/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-[9px] text-teal-400 font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity border border-teal-500/20">
                Local Node
              </div>
            </div>
          ) : (
            // Voice call — show audio-only avatar in PiP position
            <div className="lg:absolute lg:bottom-6 lg:right-6 z-30 w-24 h-24 rounded-full border-2 border-teal-500/30 bg-gradient-to-br from-teal-900/60 to-zinc-900 flex flex-col items-center justify-center shadow-[0_0_30px_rgba(20,184,166,0.15)] cursor-default backdrop-blur-md">
              <span className="text-3xl font-black text-teal-300 drop-shadow-md">{user?.name?.[0]?.toUpperCase() || '?'}</span>
              <span className="text-[9px] font-black text-teal-500/80 uppercase tracking-widest mt-1">You</span>
              {/* Animated audio ring */}
              <div className="absolute inset-0 rounded-full border border-teal-400/20 animate-ping" />
            </div>
          )}
        </section>

        {/* Input Sidebar Control Panel */}
        <aside className="w-full lg:w-[380px] border-t lg:border-t-0 lg:border-l border-white/5 bg-zinc-950/80 backdrop-blur-xl p-6 flex flex-col gap-6 overflow-y-auto shadow-[-10px_0_30px_rgba(0,0,0,0.5)] z-20">
          
          {/* Mobile input switcher */}
          <div className="block sm:hidden mb-2">
            <InputModeSwitcher compact={false} roomCode={roomCode} />
          </div>

          <div className="bg-zinc-900/40 border border-white/5 rounded-2xl p-4 shadow-inner">
            <h2 className="text-[10px] font-black tracking-widest text-zinc-500 mb-4 uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.8)]"></span>
              Rapid Transmission
            </h2>
            <QuickPhrases compact={false} roomCode={roomCode} inCall={true} />
          </div>
          
          <div className="bg-zinc-900/40 border border-white/5 rounded-2xl p-4 shadow-inner flex-1 flex flex-col min-h-[300px]">
            <h2 className="text-[10px] font-black tracking-widest text-zinc-500 mb-4 uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_5px_rgba(45,212,191,0.8)]"></span>
              Input Stream: <span className="text-teal-400">{myInputMode}</span>
            </h2>
            <div className="flex-1 relative">
              <RenderedInputPanel onSend={sendSubtitle} autoStart={myInputMode === 'voice'} />
            </div>
          </div>

          {/* Subtitle Message History */}
          <div className="bg-zinc-900/40 border border-white/5 rounded-2xl p-4 shadow-inner flex-1 flex flex-col min-h-[250px] max-h-[350px]">
            <TranscriptPanel
              transcript={historicalTranscript}
              colorMap={colorMap}
              myId={user?._id}
              onClear={() => setHistoricalTranscript([])}
            />
          </div>
        </aside>
      </main>

      {/* Primary Hardware Controls Footer Bar */}
      <footer className="flex items-center justify-center gap-4 px-6 py-5 border-t border-white/5 bg-black/90 backdrop-blur-2xl z-30 relative shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <button
          onClick={toggleAudioMuteState}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl transition-all shadow-lg active:scale-95 focus:outline-none
            ${muted ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)]' : 'bg-zinc-900 border-white/10 text-white hover:bg-zinc-800 hover:border-white/20'}`}
        >
          {muted ? '🔇' : '🎙'}
        </button>

        {/* Camera + screen share only visible in video calls */}
        {!isVoiceOnly && (
          <>
            <button
              onClick={toggleCameraTrackState}
              aria-label={camOff ? "Enable camera" : "Disable camera"}
              className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl transition-all shadow-lg active:scale-95 focus:outline-none
                ${camOff ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)]' : 'bg-zinc-900 border-white/10 text-white hover:bg-zinc-800 hover:border-white/20'}`}
            >
              {camOff ? '🚫' : '📸'}
            </button>
            <button
              onClick={toggleScreenDisplayCapture}
              aria-label={screenSharing ? "Stop screen share" : "Share screen"}
              className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl transition-all shadow-lg active:scale-95 focus:outline-none
                ${screenSharing ? 'bg-sky-500/20 border-sky-500/50 text-sky-400 shadow-[0_0_15px_rgba(14,165,233,0.2)]' : 'bg-zinc-900 border-white/10 text-white hover:bg-zinc-800 hover:border-white/20'}`}
            >
              🖥
            </button>
          </>
        )}

        {/* Voice call: offer video upgrade */}
        {isVoiceOnly && (
          <button
            onClick={() => socket?.emit('call:upgrade-request', { roomCode })}
            title="Request to switch to video call"
            className="group relative h-14 px-6 rounded-2xl border-0 overflow-hidden flex items-center justify-center gap-3 transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_20px_rgba(20,184,166,0.3)] focus:outline-none"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-teal-600 via-emerald-500 to-teal-400 opacity-20 group-hover:opacity-40 transition-opacity" />
            <div className="absolute inset-0 bg-teal-500/10 backdrop-blur-sm" />
            <div className="absolute inset-0 rounded-2xl border-2 border-teal-400/30 group-hover:border-teal-300/60 transition-colors" />
            
            <span className="relative z-10 text-2xl group-hover:animate-bounce">📹</span>
            <span className="relative z-10 text-teal-100 font-bold tracking-widest uppercase text-xs">Request Video</span>
          </button>
        )}

        <div className="w-px h-10 bg-white/10 mx-2 hidden sm:block" />

        <button
          onClick={handleEndCall}
          className="flex-1 max-w-[220px] h-14 rounded-2xl bg-rose-600 hover:bg-rose-500 border border-rose-400/50 text-white font-black text-sm tracking-widest uppercase transition-all shadow-[0_0_20px_rgba(225,29,72,0.4)] active:scale-95 focus:outline-none flex items-center justify-center gap-3"
        >
          <span>Disconnect</span>
          <span className="text-xl">☎️</span>
        </button>
      </footer>
    </div>
  );
}