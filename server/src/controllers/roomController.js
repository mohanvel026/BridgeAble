// server/src/controllers/roomController.js
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

// ── Create room ───────────────────────────────────────────
exports.createRoom = async (req, res) => {
  try {
    const { type = '1-1', invitedUserId } = req.body;
    
    // Validate type against enum
    if (!['1-1', 'group', 'care'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid room type' });
    }

    const roomCode = uuidv4().slice(0, 8).toUpperCase();

    if (mongoose.connection.readyState !== 1) {
      console.log('🤖 Database offline. Creating mock WebRTC call room.');
      const mockRoom = {
        _id: '655f75e9b890f5451a92a201',
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
    res.status(500).json({ success: false, message: 'Internal server error while creating room' });
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
      .populate('participants', 'name avatar disabilityType inputMode blinkProfile');
      
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error while fetching room' });
  }
};

// ── End room ──────────────────────────────────────────────
exports.endRoom = async (req, res) => {
  try {
    const roomCode = req.params.roomCode;
    const durationSeconds = Number(req.body.durationSeconds) || 0;

    if (!roomCode || typeof roomCode !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid room code' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.json({
        success: true,
        room: { roomCode, status: 'ended', endedAt: new Date(), durationSeconds }
      });
    }

    const room = await mongoose.model('Room').findOneAndUpdate(
      { roomCode },
      { status: 'ended', endedAt: new Date(), durationSeconds },
      { new: true }
    );
    
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error while ending room' });
  }
};

// ── Get transcript for a room ─────────────────────────────
exports.getTranscript = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true, transcripts: [] });
    }

    const room = await mongoose.model('Room').findOne({ roomCode: req.params.roomCode });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const transcripts = await mongoose.model('Transcript').find({ roomId: room._id })
      .populate('senderId', 'name avatar disabilityType inputMode')
      .sort({ timestamp: 1 });

    res.json({ success: true, transcripts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get my call history ───────────────────────────────────
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
    .sort({ startedAt: -1 });

    res.json({ success: true, calls });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};