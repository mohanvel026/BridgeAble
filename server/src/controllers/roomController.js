// server/src/controllers/roomController.js
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

// ── Create room ───────────────────────────────────────────
exports.createRoom = async (req, res) => {
  try {
    const { type = '1-1' } = req.body; // invitedUserId param removed — not used
    
    // Validate type against enum
    if (!['1-1', 'group', 'care'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid room type' });
    }

    const roomCode = uuidv4().slice(0, 8).toUpperCase();

    if (mongoose.connection.readyState !== 1) {
      console.log('🤖 Database offline. Creating mock WebRTC call room.');
      const mockRoom = {
        _id: `mock-${Date.now()}`, // unique per call
        roomCode,
        hostId: req.user._id,
        participants: [req.user._id],
        type,
        isGroup: type === 'group',
        status: 'waiting',
        startedAt: new Date(),
      };
      return res.status(201).json({ success: true, room: mockRoom, roomCode });
    }

    const room = await mongoose.model('Room').create({
      roomCode,
      hostId: req.user._id,
      participants: [req.user._id],
      type,
      isGroup: type === 'group',
      status: 'waiting',
      startedAt: new Date(),
    });

    res.status(201).json({ success: true, room, roomCode });
  } catch (err) {
    console.error('[createRoom]', err.message);
    res.status(500).json({ success: false, message: 'Failed to create room. Please try again.' });
  }
};

// ── Get room by code ──────────────────────────────────────
exports.getRoom = async (req, res) => {
  try {
    const roomCode = req.params.roomCode;
    if (!roomCode || typeof roomCode !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid room code' });
    }

    if (mongoose.connection.readyState !== 1) {
      const mockRoom = {
        _id: '655f75e9b890f5451a92a201',
        roomCode,
        hostId: '655f75e9b890f5451a92a101',
        participants: [
          {
            _id: '655f75e9b890f5451a92a101',
            name: 'Demo Patient',
            disabilityType: 'paralyzed',
            inputMode: 'blink',
            blinkProfile: { calibrated: true, earThreshold: 0.25, dashMs: 400 }
          }
        ],
        type: '1-1',
        isGroup: false,
        status: 'active',
        startedAt: new Date(),
      };
      return res.json({ success: true, room: mockRoom });
    }

    const room = await mongoose.model('Room').findOne({ roomCode })
      .populate('participants', 'name avatar disabilityType inputMode'); // blinkProfile excluded (sensitive)
      
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    // Only participants can view room details
    const isParticipant = (room.participants || []).some(
      p => String(p._id || p) === String(req.user._id)
    );
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, room });
  } catch (err) {
    console.error('[getRoom]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch room' });
  }
};

// ── End room ───────────────────────────────────────────
exports.endRoom = async (req, res) => {
  try {
    const roomCode = req.params.roomCode;

    if (!roomCode || typeof roomCode !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid room code' });
    }

    if (mongoose.connection.readyState !== 1) {
      const clientDur = Math.min(Number(req.body.durationSeconds) || 0, 86400);
      return res.json({
        success: true,
        room: { roomCode, status: 'ended', endedAt: new Date(), durationSeconds: clientDur }
      });
    }

    // Fetch first to verify authorization and compute server-side duration
    const existingRoom = await mongoose.model('Room').findOne({ roomCode });
    if (!existingRoom) return res.status(404).json({ success: false, message: 'Room not found' });

    // Participants (or host) can end the room — not just any user
    const isParticipant = (existingRoom.participants || []).some(
      p => String(p) === String(req.user._id)
    );
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Not authorized to end this room' });
    }

    // Server-computed duration — don't trust the client value
    const serverDuration = existingRoom.startedAt
      ? Math.min(Math.floor((Date.now() - new Date(existingRoom.startedAt).getTime()) / 1000), 86400)
      : Math.min(Number(req.body.durationSeconds) || 0, 86400);

    const room = await mongoose.model('Room').findOneAndUpdate(
      { roomCode },
      { status: 'ended', endedAt: new Date(), durationSeconds: serverDuration },
      { new: true }
    );

    res.json({ success: true, room });
  } catch (err) {
    console.error('[endRoom]', err.message);
    res.status(500).json({ success: false, message: 'Failed to end room' });
  }
};

// ── Get transcript for a room ──────────────────────────
exports.getTranscript = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, transcripts: [] });
    }

    const room = await mongoose.model('Room').findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    // Authorization: only room participants can read transcripts
    const isParticipant = (room.participants || []).some(
      p => String(p) === String(req.user._id)
    );
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'Access denied: not a room participant' });
    }

    const transcripts = await mongoose.model('Transcript').find({ roomId: room._id })
      .populate('senderId', 'name avatar disabilityType inputMode')
      .sort({ timestamp: 1 });

    res.json({ success: true, transcripts });
  } catch (err) {
    console.error('[getTranscript]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch transcript' });
  }
};

// ── Get my call history ─────────────────────────────────────
exports.getCallHistory = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, calls: [] });
    }

    const calls = await mongoose.model('Room').find({
      participants: req.user._id,
      status: 'ended'
    })
    .populate('participants', 'name avatar disabilityType inputMode')
    .sort({ startedAt: -1 })
    .limit(50);

    res.json({ success: true, calls });
  } catch (err) {
    console.error('[getCallHistory]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch call history' });
  }
};