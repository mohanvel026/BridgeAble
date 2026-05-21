// client/src/pages/GroupCall.jsx
// Mesh WebRTC up to 4 peers — any disability mix — color-coded subtitles
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/stores';
import { getSocket } from '../lib/socket';
import api from '../lib/api';
import SubtitleOverlay from '../components/call/SubtitleOverlay';
import QuickPhrases from '../components/QuickPhrases';
import toast from 'react-hot-toast';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const COLORS = ['#2dd4bf', '#a855f7', '#fbbf24', '#f43f5e'];

const modeIcon = { gesture: '👋', blink: '👁', symbol: '🗂', voice: '🎙', type: '⌨️' };

export default function GroupCall() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const socket = getSocket();

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peersRef = useRef({});   // { userId: RTCPeerConnection }
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);

  const [participants, setParticipants] = useState([]);  // [{ userId, name, disabilityType, inputMode, color, videoRef }]
  const [subtitles, setSubtitles] = useState([]);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [inviteLink, setInviteLink] = useState('');

  useEffect(() => {
    initGroupCall();
    return () => cleanupGroupCall();
  }, []);

  const initGroupCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: user.disabilityType !== 'blind',
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      socket.emit('room:join', { roomCode });
      setInviteLink(`${window.location.origin}/call/group/${roomCode}`);

      // Timer
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Socket events
      socket.on('room:user-joined', handleUserJoined);
      socket.on('webrtc:offer', handleOffer);
      socket.on('webrtc:answer', handleAnswer);
      socket.on('webrtc:ice', handleICE);
      socket.on('subtitle:receive', handleSubtitle);
      socket.on('call:ended', () => { toast('Session terminated by host', { icon: '🚨' }); doEnd(); });

      // Check if host
      try {
        const res = await api.get(`/rooms/${roomCode}`);
        if (res.data.room.hostId === user._id) setIsHost(true);
      } catch { }

    } catch (err) {
      toast.error('Hardware access denied: ' + err.message);
      navigate('/dashboard');
    }
  };

  const createPeer = (userId) => {
    const peer = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[userId] = peer;

    localStreamRef.current?.getTracks().forEach(t => peer.addTrack(t, localStreamRef.current));

    peer.ontrack = (e) => {
      setParticipants(prev => prev.map(p => {
        if (p.userId === userId) {
          // Attach stream to video element via ref
          if (p.videoElement) p.videoElement.srcObject = e.streams[0];
          return { ...p, stream: e.streams[0] };
        }
        return p;
      }));
    };

    peer.onicecandidate = (e) => {
      if (e.candidate) socket.emit('webrtc:ice', { to: userId, candidate: e.candidate });
    };

    return peer;
  };

  const handleUserJoined = async (userData) => {
    const colorIdx = Object.keys(peersRef.current).length + 1;
    const color = COLORS[colorIdx % COLORS.length];

    setParticipants(prev => {
      if (prev.find(p => p.userId === userData.userId)) return prev;
      return [...prev, { ...userData, color, videoElement: null }];
    });

    // Create peer and send offer
    const peer = createPeer(userData.userId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('webrtc:offer', { to: userData.userId, offer, roomCode });

    toast.success(`${userData.name} established connection`);
    if (user.disabilityType === 'blind') {
      const u = new SpeechSynthesisUtterance(`${userData.name} joined`);
      window.speechSynthesis.speak(u);
    }
  };

  const handleOffer = async ({ from, offer, fromDisability, fromInputMode }) => {
    const color = COLORS[(Object.keys(peersRef.current).length) % COLORS.length];

    setParticipants(prev => {
      if (prev.find(p => p.userId === from)) return prev;
      return [...prev, { userId: from, name: 'User', disabilityType: fromDisability, inputMode: fromInputMode, color }];
    });

    const peer = createPeer(from);
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('webrtc:answer', { to: from, answer });
  };

  const handleAnswer = async ({ from, answer }) => {
    const peer = peersRef.current[from];
    if (peer) await peer.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const handleICE = async ({ from, candidate }) => {
    const peer = peersRef.current[from];
    if (peer && candidate) {
      try { await peer.addIceCandidate(new RTCIceCandidate(candidate)); } catch { }
    }
  };

  const handleSubtitle = ({ senderId, senderName, text, inputMode, confidence }) => {
    const sender = participants.find(p => p.userId === senderId);
    const color = sender?.color || COLORS[1];
    const sub = { senderId, senderName, text, inputMode, confidence, color, timestamp: new Date() };
    setSubtitles(prev => [...prev.slice(-30), sub]);

    // TTS for blind
    if (user.disabilityType === 'blind') {
      const u = new SpeechSynthesisUtterance(`${senderName}: ${text}`);
      window.speechSynthesis.speak(u);
    }
  };

  const sendSubtitle = useCallback((text, mode = user.inputMode, confidence = 1.0) => {
    if (!text?.trim()) return;
    socket.emit('subtitle:send', { roomCode, text, inputMode: mode, confidence });
    const myColor = COLORS[0];
    setSubtitles(prev => [...prev.slice(-30), {
      senderId: user._id, senderName: 'You', text, inputMode: mode, confidence, color: myColor, timestamp: new Date(),
    }]);
  }, [roomCode]);

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsMuted(p => !p); }
  };

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) { track.enabled = !track.enabled; setIsCameraOff(p => !p); }
  };

  const removeParticipant = (userId) => {
    if (!isHost) return;
    socket.emit('host:remove', { roomCode, userId });
    toast.success('Connection severed');
  };

  const muteAll = () => {
    if (!isHost) return;
    socket.emit('host:mute-all', { roomCode });
    toast.success('Global mute applied');
  };

  const doEnd = () => {
    const duration = Math.floor((Date.now() - (startTimeRef.current || Date.now())) / 1000);
    if (isHost) socket.emit('call:end', { roomCode, durationSeconds: duration });
    cleanupGroupCall();
    navigate('/dashboard');
  };

  const cleanupGroupCall = () => {
    clearInterval(timerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    Object.values(peersRef.current).forEach(p => p.close());
    peersRef.current = {};
    socket.off('room:user-joined');
    socket.off('webrtc:offer');
    socket.off('webrtc:answer');
    socket.off('webrtc:ice');
    socket.off('subtitle:receive');
    socket.off('call:ended');
  };

  const copyInvite = () => {
    navigator.clipboard.writeText(inviteLink);
    toast.success('Connection string copied to clipboard', { icon: '🔗' });
  };

  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="h-screen bg-[#020808] text-white font-sans overflow-hidden flex flex-col relative">
      {/* Background elements */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(20,184,166,0.05),transparent_70%)] pointer-events-none" />
      
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-zinc-950/80 backdrop-blur-xl border-b border-white/5 relative z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            <span className="font-mono text-sm font-bold text-white shadow-inner">{formatTime(callDuration)}</span>
          </div>
          <div className="h-4 w-px bg-white/10" />
          <span className="font-mono text-xs font-black tracking-widest text-zinc-500 uppercase flex items-center gap-2">
            Session: <span className="bg-zinc-900 px-2 py-1 rounded border border-white/5 text-zinc-300 select-all">{roomCode}</span>
          </span>
          <div className="h-4 w-px bg-white/10" />
          <span className="text-xs font-bold text-teal-400 uppercase tracking-widest flex items-center gap-1.5">
            <span className="text-sm">👥</span> {participants.length + 1}/4 Nodes
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={copyInvite}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-xs font-bold text-teal-400 hover:bg-teal-500/20 transition-all uppercase tracking-widest shadow-inner">
            <span>🔗</span> Copy Link
          </button>

          {isHost && (
            <button onClick={muteAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-bold text-amber-400 hover:bg-amber-500/20 transition-all uppercase tracking-widest shadow-inner">
              <span>🔇</span> Mute All
            </button>
          )}
        </div>
      </div>

      {/* Video grid */}
      <div className="flex-1 p-4 lg:p-6 relative z-10 overflow-hidden flex flex-col">
        <div className={`grid gap-4 lg:gap-6 h-full flex-1
          ${participants.length === 0 ? 'grid-cols-1 max-w-4xl mx-auto w-full' :
            participants.length === 1 ? 'grid-cols-1 md:grid-cols-2' :
              'grid-cols-2'}`}>

          {/* My video */}
          <div className="relative rounded-3xl overflow-hidden bg-zinc-900/40 border border-white/5 backdrop-blur-sm shadow-2xl group transition-all">
            <video ref={localVideoRef} autoPlay playsInline muted
              className="w-full h-full object-cover scale-x-[-1]" />
              
            {/* Inner shadow/gradient for better text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />
            
            {isCameraOff && (
              <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center backdrop-blur-md">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-500/20 to-teal-900/20 border-2 border-teal-500/30 flex items-center justify-center text-white text-3xl font-black shadow-[0_0_30px_rgba(20,184,166,0.15)] mb-3">
                  {user.name?.[0]?.toUpperCase()}
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Camera Disabled</span>
              </div>
            )}
            
            {/* Status indicators */}
            <div className="absolute top-4 left-4 flex gap-2">
              {isMuted && <span className="bg-rose-500/20 border border-rose-500/40 text-rose-400 w-8 h-8 rounded-full flex items-center justify-center text-xs backdrop-blur-md shadow-lg animate-pulse">🔇</span>}
            </div>
            
            {/* My info overlay */}
            <div className="absolute bottom-4 left-4 flex items-center gap-2.5 bg-zinc-950/60 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-2 shadow-xl">
              <span className="text-lg bg-zinc-800 rounded-lg p-1">{modeIcon[user.inputMode]}</span>
              <div className="flex flex-col">
                <span className="text-sm font-black tracking-wide" style={{ color: COLORS[0] }}>You</span>
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Local Node</span>
              </div>
              {isHost && <span className="ml-2 text-[9px] bg-amber-500/20 border border-amber-500/40 text-amber-400 px-2 py-0.5 rounded-full font-black uppercase tracking-widest shadow-inner">Host</span>}
            </div>
            
            {/* Subtitles on my tile */}
            <div className="absolute bottom-20 left-0 right-0 px-4 flex flex-col gap-1 items-center">
              {subtitles.filter(s => s.senderId === user._id).slice(-2).map((s, i) => (
                <div key={i} className="bg-zinc-950/80 border border-white/10 backdrop-blur-xl rounded-xl px-4 py-2 text-sm text-white font-medium shadow-2xl max-w-[90%] text-center transform transition-all animate-fade-in"
                  style={{ borderBottom: `2px solid ${s.color}` }}>
                  {s.text}
                </div>
              ))}
            </div>
          </div>

          {/* Remote participants */}
          {participants.map((p) => (
            <RemoteVideoTile key={p.userId} participant={p} subtitles={subtitles}
              isHost={isHost} onRemove={() => removeParticipant(p.userId)} />
          ))}

          {/* Empty slots */}
          {[...Array(Math.max(0, 3 - participants.length))].map((_, i) => (
            <div key={i} className="rounded-3xl bg-zinc-900/20 border-2 border-white/5 border-dashed flex flex-col items-center justify-center gap-4 min-h-[200px] hover:bg-zinc-900/40 hover:border-white/10 transition-colors group">
              <div className="w-16 h-16 rounded-full bg-zinc-950 border border-white/5 flex items-center justify-center text-3xl opacity-50 group-hover:opacity-100 transition-opacity shadow-inner">
                👤
              </div>
              <div className="text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Awaiting Connection</p>
                <button onClick={copyInvite} className="text-xs font-bold text-teal-400 hover:text-teal-300 transition-colors">Copy invite link →</button>
              </div>
            </div>
          ))}
        </div>

        {/* Global subtitle overlay across all tiles */}
        <SubtitleOverlay subtitles={subtitles} myId={user?._id} />
      </div>

      {/* Quick phrase panel */}
      <div className="bg-zinc-950/90 backdrop-blur-xl border-t border-white/5 p-4 relative z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <QuickPhrases roomCode={roomCode} inCall={true} />
      </div>

      {/* Controls */}
      <div className="bg-black border-t border-white/5 px-6 py-4 relative z-30">
        <div className="flex items-center justify-center gap-4 max-w-md mx-auto">
          <button onClick={toggleMute}
            className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl transition-all shadow-lg active:scale-95
              ${isMuted ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)]' : 'bg-zinc-900 border-white/10 text-white hover:bg-zinc-800 hover:border-white/20'}`}>
            {isMuted ? '🔇' : '🎙'}
          </button>
          
          <button onClick={toggleCamera}
            className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center text-2xl transition-all shadow-lg active:scale-95
              ${isCameraOff ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)]' : 'bg-zinc-900 border-white/10 text-white hover:bg-zinc-800 hover:border-white/20'}`}>
            {isCameraOff ? '📷' : '📸'}
          </button>
          
          <button onClick={doEnd}
            className="flex-1 max-w-[200px] h-14 rounded-2xl bg-rose-600 hover:bg-rose-500 border border-rose-400/50 text-white font-black text-sm uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(225,29,72,0.4)] active:scale-95 flex items-center justify-center gap-2">
            <span>{isHost ? 'Terminate All' : 'Leave Session'}</span>
            <span className="text-lg">🚪</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Remote video tile component
function RemoteVideoTile({ participant, subtitles, isHost, onRemove }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (participant.stream && videoRef.current) {
      videoRef.current.srcObject = participant.stream;
    }
  }, [participant.stream]);

  const mySubtitles = subtitles.filter(s => s.senderId === participant.userId).slice(-2);
  const modeIcon = { gesture: '👋', blink: '👁', symbol: '🗂', voice: '🎙', type: '⌨️' };

  return (
    <div className="relative rounded-3xl overflow-hidden bg-zinc-900/40 border border-white/5 backdrop-blur-sm shadow-2xl group transition-all min-h-[200px]">
      <video ref={videoRef} autoPlay playsInline
        className="w-full h-full object-cover" />

      {/* Inner shadow/gradient for better text readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />

      {!participant.stream && (
        <div className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center backdrop-blur-md">
          <div className="w-20 h-20 rounded-full flex items-center justify-center font-black text-3xl border-2 mb-3 shadow-[0_0_30px_currentColor] opacity-20"
            style={{ borderColor: participant.color, color: participant.color, background: `${participant.color}15` }}>
            {participant.name?.[0]?.toUpperCase()}
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 animate-pulse">Establishing Link...</p>
        </div>
      )}

      {/* Participant info */}
      <div className="absolute bottom-4 left-4 flex items-center gap-2.5 bg-zinc-950/60 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-2 shadow-xl">
        <span className="text-lg bg-zinc-800 rounded-lg p-1">{modeIcon[participant.inputMode] || '👤'}</span>
        <div className="flex flex-col">
          <span className="text-sm font-black tracking-wide" style={{ color: participant.color }}>{participant.name}</span>
          <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">{participant.disabilityType}</span>
        </div>
      </div>

      {/* Host remove button */}
      {isHost && (
        <button onClick={onRemove}
          className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-zinc-950/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-sm text-zinc-400 hover:text-rose-400 hover:border-rose-500/50 hover:bg-rose-500/10 transition-all opacity-0 group-hover:opacity-100 shadow-lg">
          ✕
        </button>
      )}

      {/* Subtitles */}
      <div className="absolute bottom-20 left-0 right-0 px-4 flex flex-col gap-1 items-center">
        {mySubtitles.map((s, i) => (
          <div key={i} className="bg-zinc-950/80 backdrop-blur-xl rounded-xl px-4 py-2 text-sm text-white font-medium shadow-2xl max-w-[90%] text-center transform transition-all animate-fade-in"
            style={{ background: `${s.color}15`, borderBottom: `2px solid ${s.color}`, borderTop: '1px solid rgba(255,255,255,0.05)', borderLeft: '1px solid rgba(255,255,255,0.05)', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );
}