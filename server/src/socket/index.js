// server/src/socket/index.js
// Industry-grade Socket.io server.
// Users are auto-registered in onlineUsers on connect via JWT middleware.
// The 'auth' event is kept as a post-connect confirmation fallback.

const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const jwt        = require('jsonwebtoken');
const { initCommunitySocket } = require('./community');

let ioInstance = null;
const onlineUsers = new Map(); // userId (string) -> socketId
const sosCooldown = new Map(); // userId -> last SOS timestamp (rate limit)
const SOS_COOLDOWN_MS = 60_000; // 60 seconds between SOS triggers

// ── Helper: register user in onlineUsers & update DB ─────────────────────────
async function registerOnlineUser(socket, userId) {
  if (!userId) return;
  const uid = userId.toString();
  socket.userId = uid;
  onlineUsers.set(uid, socket.id);

  // Join a named personal room so cron jobs can push directly via io.to(`user:${uid}`)
  socket.join(`user:${uid}`);

  if (mongoose.connection.readyState === 1) {
    try {
      const user = await mongoose.model('User').findByIdAndUpdate(
        uid,
        { isOnline: true, lastSeen: new Date() },
        { new: true }
      );
      if (user) {
        socket.disabilityType = user.disabilityType;
        socket.inputMode = user.inputMode;
      }
    } catch (e) {}
  }

  ioInstance.emit('user:status', { userId: uid, status: 'online' });
  console.log(`✅ User registered: ${uid} → socket ${socket.id}`);
}

// ── JWT Socket Middleware ─────────────────────────────────────────────────────
// Extracts userId from handshake token at connection time —
// so onlineUsers is populated BEFORE any events are emitted.
function jwtSocketMiddleware(socket, next) {
  const { token, userId } = socket.handshake.auth || {};

  // Try decoding JWT first (most secure)
  if (token) {
    try {
      const secret = process.env.JWT_SECRET || 'bridgeable-secret-key';
      const decoded = jwt.verify(token, secret);
      socket._preUserId = (decoded.id || decoded._id || decoded.userId || '').toString();
      return next();
    } catch (err) {
      // Token invalid — fallback to plain userId from handshake
    }
  }

  // Fallback: accept plain userId from handshake (dev/offline mode)
  if (userId) {
    socket._preUserId = userId.toString();
  }

  next();
}

// ── Main socket initializer ───────────────────────────────────────────────────
exports.initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: '*', // Allow all origins for LAN dev testing
      credentials: true,
    },
  });
  ioInstance = io;

  // Apply JWT middleware before connection handler
  io.use(jwtSocketMiddleware);

  io.on('connection', async (socket) => {
    console.log(`🔌 Socket connected: ${socket.id} | preUserId: ${socket._preUserId || 'none'}`);

    // Auto-register immediately using the JWT-extracted userId
    if (socket._preUserId) {
      await registerOnlineUser(socket, socket._preUserId);
    }

    // ── 'auth' event — fallback for cases where handshake didn't carry userId ──
    socket.on('auth', async (userId) => {
      if (!userId) return;
      // Don't re-register if already registered for same user
      if (socket.userId === userId.toString()) return;
      await registerOnlineUser(socket, userId);
    });

    // ── Call Signaling ────────────────────────────────────────────────────────
    socket.on('call:initiate', async ({ recipientId, toUserId, fromUser, roomCode, type }) => {
      const targetId = (recipientId || toUserId || '').toString();
      if (!targetId) return;

      const targetSocketId = onlineUsers.get(targetId);
      console.log(`📞 call:initiate → target ${targetId}, socket: ${targetSocketId || 'OFFLINE'}`);

      // Build sender info
      let sender = fromUser;
      if (!sender && mongoose.connection.readyState === 1 && socket.userId) {
        try { sender = await mongoose.model('User').findById(socket.userId); } catch (e) {}
      }
      sender = sender || {
        _id: socket.userId || 'anon',
        name: 'BridgeAble User',
        disabilityType: 'normal',
        inputMode: 'voice',
        avatar: '',
      };

      if (targetSocketId) {
        io.to(targetSocketId).emit('call:incoming', {
          callerId:      String(sender._id || socket.userId),
          id:            String(sender._id || socket.userId),
          name:          sender.name,
          avatar:        sender.avatar || '',
          disabilityType: sender.disabilityType || 'normal',
          inputMode:     sender.inputMode || 'voice',
          roomCode,
          type:          type || '1-1',
        });
      } else {
        // Recipient offline — notify caller
        socket.emit('call:recipient-offline', { recipientId: targetId });
        console.warn(`⚠️ Recipient ${targetId} is offline or not registered`);
      }
    });

    // ── Room join / WebRTC signaling ──────────────────────────────────────────
    socket.on('call:join', ({ roomCode, userId }) => {
      socket.join(roomCode);
      socket.to(roomCode).emit('peer:joined', { userId });
    });

    socket.on('room:join', async ({ roomCode }) => {
      socket.join(roomCode);
      socket.roomCode = roomCode;

      let userDetails = {
        userId: socket.userId || 'anon-' + socket.id,
        name: 'Participant',
        disabilityType: socket.disabilityType || 'normal',
        inputMode: socket.inputMode || 'voice',
      };

      if (mongoose.connection.readyState === 1 && socket.userId) {
        try {
          const user = await mongoose.model('User').findById(socket.userId);
          if (user) {
            userDetails = {
              userId:        String(user._id),
              name:          user.name,
              avatar:        user.avatar || '',
              disabilityType: user.disabilityType,
              inputMode:     user.inputMode,
              blinkProfile:  user.blinkProfile,
            };
          }
        } catch (e) {}
      }

      socket.to(roomCode).emit('room:user-joined', userDetails);

      console.log(`🏠 ${socket.userId || socket.id} joined room ${roomCode}`);
    });

    // ── Explicit room leave (navigation, back-button, manual end) ─────────────
    // Client emits this immediately before navigating away. This is faster
    // and more reliable than waiting for the socket disconnect timeout.
    socket.on('room:leave', ({ roomCode: rc }) => {
      const leaveRoom = rc || socket.roomCode;
      if (!leaveRoom) return;
      socket.to(leaveRoom).emit('call:ended-graceful', {
        userId: socket.userId,
        reason: 'left',
      });
      socket.leave(leaveRoom);
      if (socket.roomCode === leaveRoom) socket.roomCode = null;
      console.log(`🚪 ${socket.userId || socket.id} left room ${leaveRoom}`);
    });

    socket.on('webrtc:signal', ({ toUserId, signal, fromUserId, roomCode }) => {
      const sid = onlineUsers.get(toUserId);
      if (sid) {
        io.to(sid).emit('webrtc:signal', { signal, fromUserId });
      } else {
        socket.to(roomCode).emit('webrtc:signal', { signal, fromUserId });
      }
    });

    socket.on('webrtc:offer', ({ to, offer, roomCode }) => {
      const sid = onlineUsers.get(to);
      const payload = {
        from:           socket.userId || socket.id,
        offer,
        fromDisability: socket.disabilityType || 'normal',
        fromInputMode:  socket.inputMode || 'voice',
      };
      if (sid) {
        io.to(sid).emit('webrtc:offer', payload);
      } else {
        socket.to(roomCode).emit('webrtc:offer', payload);
      }
    });

    socket.on('webrtc:answer', ({ to, answer }) => {
      const sid = onlineUsers.get(to);
      if (sid) {
        io.to(sid).emit('webrtc:answer', { answer });
      } else if (socket.roomCode) {
        socket.to(socket.roomCode).emit('webrtc:answer', { answer });
      }
    });

    socket.on('webrtc:ice', ({ to, candidate }) => {
      const sid = onlineUsers.get(to);
      if (sid) {
        io.to(sid).emit('webrtc:ice', { candidate });
      } else if (socket.roomCode) {
        socket.to(socket.roomCode).emit('webrtc:ice', { candidate });
      }
    });

    // ── Call state management ─────────────────────────────────────────────────
    socket.on('call:accept', ({ callerId, roomCode }) => {
      const sid = onlineUsers.get(callerId?.toString());
      if (sid) io.to(sid).emit('call:accepted', { roomCode, by: socket.userId });
    });

    socket.on('call:decline', ({ callerId, reason }) => {
      const sid = onlineUsers.get(callerId?.toString());
      if (sid) io.to(sid).emit('call:declined', { reason: reason || 'declined' });
    });

    socket.on('call:cancel', ({ recipientId }) => {
      const sid = onlineUsers.get(recipientId?.toString());
      if (sid) io.to(sid).emit('call:cancelled', { by: socket.userId });
    });

    socket.on('call:track-state', ({ roomCode, audio, video }) => {
      socket.to(roomCode).emit('call:track-state', { userId: socket.userId, audio, video });
    });

    socket.on('mode:switch', ({ roomCode, newMode }) => {
      socket.to(roomCode).emit('mode:switched', { userId: socket.userId, newMode });
    });

    socket.on('call:end', ({ roomCode, durationSeconds }) => {
      io.to(roomCode).emit('call:ended');
    });

    socket.on('call:end-graceful', ({ roomCode }) => {
      socket.to(roomCode).emit('call:ended-graceful', { userId: socket.userId });
    });

    socket.on('subtitle:interim-send', ({ roomCode, text, inputMode }) => {
      socket.to(roomCode).emit('subtitle:interim-receive', {
        senderId: socket.userId,
        text,
        inputMode,
      });
    });

    // ── Transcript / subtitles ────────────────────────────────────────────────
    socket.on('subtitle:send', async ({ roomCode, text, inputMode, confidence }) => {
      let senderName = socket.userId || 'Participant';

      // Best-effort DB write — skipped silently in mock/offline mode
      if (mongoose.connection.readyState === 1 && socket.userId) {
        try {
          const user = await mongoose.model('User').findById(socket.userId).lean();
          if (user) {
            senderName = user.name;
            const room = await mongoose.model('Room').findOne({ roomCode }).lean();
            if (room) {
              await mongoose.model('Transcript').create({
                roomId: room._id, senderId: socket.userId, text, inputMode, confidence,
              }).catch(() => {}); // Non-fatal — session transcript still relayed live
            }
          }
        } catch (e) { /* DB unavailable — continue with relay */ }
      }

      // ⚠️ Use socket.to() NOT io.to() — sender must NOT receive their own subtitle back
      socket.to(roomCode).emit('subtitle:receive', {
        senderId:   socket.userId,
        senderName,
        text,
        inputMode,
        confidence,
        timestamp:  new Date(),
      });
    });

    // ── Voice → Video call upgrade request ───────────────────────────────────
    socket.on('call:upgrade-request', ({ roomCode }) => {
      socket.to(roomCode).emit('call:upgrade-request', {
        fromUserId: socket.userId,
      });
    });

    socket.on('call:upgrade-response', ({ roomCode, accepted }) => {
      socket.to(roomCode).emit('call:upgrade-response', { accepted });
    });

    socket.on('transcript:send', async ({ roomCode, text, inputMode, confidence, userId }) => {
      if (mongoose.connection.readyState === 1) {
        try {
          const room = await mongoose.model('Room').findOne({ roomCode });
          if (room) {
            await mongoose.model('Transcript').create({
              roomId: room._id, senderId: userId || socket.userId, text, inputMode, confidence,
            });
          }
        } catch (e) {}
      }
      io.to(roomCode).emit('transcript:receive', {
        userId: userId || socket.userId, text, inputMode, timestamp: new Date(),
      });
    });


    // ── SOS Alerts ────────────────────────────────────────────────────────────
    socket.on('sos:trigger', async (data) => {
      const userId = socket.userId;
      if (!userId) return;

      // Rate-limit: prevent accidental SOS spam (e.g. accidental triple-blink)
      const lastSOS = sosCooldown.get(userId);
      if (lastSOS && Date.now() - lastSOS < SOS_COOLDOWN_MS) {
        socket.emit('sos:cooldown', { retryAfterMs: SOS_COOLDOWN_MS - (Date.now() - lastSOS) });
        return;
      }
      sosCooldown.set(userId, Date.now());

      try {
        if (mongoose.connection.readyState === 1) {
          const user = await mongoose.model('User').findById(userId).populate('helpers');
          if (!user) return;

          const alertData = {
            fromUser:      { _id: user._id, name: user.name, avatar: user.avatar },
            emergencyType: data.emergencyType,
            gps:           data.gps,
            battery:       data.battery,
            silent:        data.silent,
            timestamp:     new Date(),
          };

          user.helpers.forEach(helper => {
            const sid = onlineUsers.get(helper._id.toString());
            if (sid) io.to(sid).emit('sos:alert', alertData);
          });

          const { sendSOSAlert } = require('../services/emailService');
          const { sendSOSAlertSMS } = require('../services/smsService');
          
          const helperEmails = user.helpers.map(h => h.email).filter(Boolean);
          if (helperEmails.length > 0) {
            sendSOSAlert(helperEmails, user.name, alertData.gps).catch(() => {});
          }

          // Twilio SMS / WhatsApp (Requires helpers to have a phone number in DB)
          // For now, we will extract phone numbers if they exist.
          // Assuming user.helpers have a 'phone' field and 'notificationPrefs.smsSOS' 
          const helperPhones = user.helpers
            .filter(h => h.phone && (h.notificationPrefs?.smsSOS !== false))
            .map(h => h.phone);
            
          if (helperPhones.length > 0) {
            // By default passing useWhatsApp = false, can be made dynamic based on preferences
            sendSOSAlertSMS(helperPhones, user.name, alertData.gps, false).catch(() => {});
          }
        }
        console.log(`🚨 SOS by user ${userId} (${data.emergencyType})`);
      } catch (err) {
        console.error('SOS Error:', err);
      }
    });

    // ── Connection request notifications ──────────────────────────────────────
    // (emitToUser helper is used by userController — handlers live there)

    // ── Typing indicators ─────────────────────────────────────────────────────
    // Client emits message:typing → server relays to receiver only
    socket.on('message:typing', ({ receiverId, isTyping }) => {
      if (!receiverId || !socket.userId) return;
      emitToUser(receiverId.toString(), 'message:typing', {
        fromUserId: socket.userId,
        isTyping:   !!isTyping,
      });
    });

    // ── Message reactions (real-time relay) ───────────────────────────────────
    // Persistence is handled by the REST PATCH /:id/react endpoint;
    // this socket event is a supplemental real-time push from the client
    // for optimistic UI without waiting for the HTTP round-trip.
    socket.on('message:react', ({ messageId, receiverId, emoji, reactions }) => {
      if (!receiverId || !messageId) return;
      const payload = { messageId, emoji, reactions, byUserId: socket.userId };
      emitToUser(receiverId.toString(), 'message:reacted', payload);
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      const uid = socket.userId;

      // If user was in an active call room, notify the remaining participants
      if (socket.roomCode) {
        socket.to(socket.roomCode).emit('call:ended-graceful', {
          userId: uid,
          reason: 'disconnected',
        });
        console.log(`👋 User ${uid} disconnected from room ${socket.roomCode} — notified peers`);
      }

      if (uid) {
        // Only remove from map if this socket is still the registered one
        if (onlineUsers.get(uid) === socket.id) {
          onlineUsers.delete(uid);
          if (mongoose.connection.readyState === 1) {
            try {
              await mongoose.model('User').findByIdAndUpdate(uid, {
                isOnline: false, lastSeen: new Date(),
              });
            } catch (e) {}
          }
          io.emit('user:status', { userId: uid, status: 'offline' });
        }
      }
      console.log(`❌ Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  initCommunitySocket(io);
};

// ── Utility: emit to a specific user by userId ────────────────────────────────
exports.emitToUser = (userId, event, payload) => {
  if (!ioInstance) return false;
  const sid = onlineUsers.get(userId.toString());
  if (sid) {
    ioInstance.to(sid).emit(event, payload);
    return true;
  }
  return false;
};

exports.getOnlineUsers = () => onlineUsers;

// ── Critical export: used by cronService for live push notifications ──────────
exports.getIO = () => ioInstance;
