// server/src/routes/messageRoutes.js
// Industry-grade messaging API:
//  • Inbox with pagination (cursor-based)
//  • Conversation thread between two users
//  • Unread count per user
//  • Soft delete (per-user)
//  • Delivery receipt via socket
//  • Offline DB fallback
//  • SMS fallback via Twilio when receiver is offline

const router   = require('express').Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const offlineDb  = require('../config/offlineDb');
const { emitToUser } = require('../socket');

const isDbOnline = () => mongoose.connection.readyState === 1;
const Message    = () => mongoose.model('Message');
const User       = () => mongoose.model('User');

// ── Per-user in-memory rate limiter (30 messages per 60 seconds) ───────────────
const sendRateMap = new Map(); // userId → { count, windowStart }
const RATE_LIMIT   = 30;
const RATE_WINDOW  = 60_000; // ms

function checkRateLimit(userId) {
  const now  = Date.now();
  const uid  = userId.toString();
  const slot = sendRateMap.get(uid) || { count: 0, windowStart: now };

  if (now - slot.windowStart > RATE_WINDOW) {
    // Reset window
    sendRateMap.set(uid, { count: 1, windowStart: now });
    return true;
  }
  if (slot.count >= RATE_LIMIT) return false;
  slot.count++;
  sendRateMap.set(uid, slot);
  return true;
}

// ── Validation helper ─────────────────────────────────────────────────────────
const VALID_TYPES = ['need','pain','emotion','custom','sos','yes-no'];

// ── POST /api/messages/send ───────────────────────────────────────────────────
router.post('/send', protect, async (req, res) => {
  try {
    const { receiverId, type, content } = req.body;

    if (!receiverId)          return res.status(400).json({ success: false, message: 'receiverId is required.' });
    if (!type)                return res.status(400).json({ success: false, message: 'type is required.' });
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ success: false, message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    if (content === undefined) return res.status(400).json({ success: false, message: 'content is required.' });

    // Rate limit: 30 messages per minute per user
    if (!checkRateLimit(req.user._id)) {
      return res.status(429).json({ success: false, message: 'Too many messages. Please wait a moment before sending again.' });
    }

    let msg;

    if (!isDbOnline()) {
      // ── Offline: persist to local JSON DB ─────────────────────────────────
      msg = {
        _id:         `msg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        senderId:    String(req.user._id),
        receiverId:  String(receiverId),
        type,
        content,
        isRead:      false,
        deliveredAt: null,
        createdAt:   new Date().toISOString(),
      };
      await offlineDb.addMessage(msg).catch(() => {});
    } else {
      // ── Online: persist to MongoDB ─────────────────────────────────────────
      const created = await Message().create({
        senderId:   req.user._id,
        receiverId,
        type,
        content,
      });
      msg = created.toObject();
    }

    // ── Real-time push: emit to receiver if online ────────────────────────────
    const senderPayload = {
      _id:           req.user._id,
      name:          req.user.name,
      avatar:        req.user.avatar || '',
      disabilityType: req.user.disabilityType,
    };

    const delivered = emitToUser(String(receiverId), 'message:new', {
      message: msg,
      sender:  senderPayload,
    });

    // Update deliveredAt immediately if socket push succeeded
    if (delivered && isDbOnline() && msg._id && !String(msg._id).startsWith('msg-')) {
      Message().findByIdAndUpdate(msg._id, { deliveredAt: new Date() }).catch(() => {});
      msg.deliveredAt = new Date();
    }

    // ── SMS fallback: send SMS if receiver is offline and has a phone number ──
    if (!delivered && isDbOnline()) {
      try {
        const receiver = await User().findById(receiverId).select('phone notificationPrefs name').lean();
        if (receiver?.phone && receiver.notificationPrefs?.smsMedicineMiss !== false) {
          const { sendMessage: sendSMS } = require('../services/smsService');
          const preview = type === 'pain'    ? `😣 Pain report from ${req.user.name}` :
                          type === 'sos'     ? `🚨 EMERGENCY from ${req.user.name}!` :
                          type === 'need'    ? `${req.user.name} needs: ${content?.item}` :
                          type === 'emotion' ? `${req.user.name} feels: ${content?.emotion}` :
                          type === 'yes-no'  ? `${req.user.name} responded: ${content?.answer?.toUpperCase()}` :
                                              `💬 Message from ${req.user.name}`;
          sendSMS(receiver.phone, preview, false).catch(() => {});
        }
      } catch { /* SMS failure is non-fatal */ }
    }

    res.status(201).json({ success: true, message: msg, delivered });
  } catch (err) {
    console.error('Message POST error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// ── GET /api/messages/inbox — Paginated inbox (cursor-based) ─────────────────
// Query params: limit (default 50), before (ISO date cursor for pagination)
router.get('/inbox', protect, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? new Date(req.query.before) : new Date();

    if (!isDbOnline()) {
      const stored = offlineDb.getMessages(String(req.user._id));
      stored.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.json({ success: true, messages: stored.slice(0, limit), hasMore: false });
    }

    const userId = req.user._id;
    const messages = await Message()
      .find({
        $or: [{ receiverId: userId }, { senderId: userId }],
        deletedFor: { $ne: userId },
        createdAt:  { $lt: before },
      })
      .populate('senderId receiverId', 'name avatar disabilityType phone')
      .sort({ createdAt: -1 })
      .limit(limit + 1)   // fetch one extra to detect hasMore
      .lean();

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    res.json({ success: true, messages, hasMore });
  } catch (err) {
    console.error('Message GET /inbox error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
});

// ── GET /api/messages/conversation/:userId — Thread between two users ─────────
// Returns all messages exchanged between the authenticated user and :userId
// Query params: limit (default 50), before (cursor)
router.get('/conversation/:userId', protect, async (req, res) => {
  try {
    const otherId = req.params.userId;
    const limit   = Math.min(parseInt(req.query.limit) || 50, 100);
    const before  = req.query.before ? new Date(req.query.before) : new Date();
    const myId    = req.user._id;

    if (!isDbOnline()) {
      return res.json({ success: true, messages: [], hasMore: false });
    }

    const messages = await Message()
      .find({
        $or: [
          { senderId: myId,    receiverId: otherId },
          { senderId: otherId, receiverId: myId    },
        ],
        deletedFor: { $ne: myId },
        createdAt:  { $lt: before },
      })
      .populate('senderId', 'name avatar disabilityType')
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    // Auto-mark as read all messages from otherId to myId
    Message().updateMany(
      { senderId: otherId, receiverId: myId, isRead: false },
      { isRead: true }
    ).catch(() => {});

    res.json({ success: true, messages: messages.reverse(), hasMore });
  } catch (err) {
    console.error('Conversation GET error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch conversation.' });
  }
});

// ── GET /api/messages/unread-count — Badge count for the current user ─────────
router.get('/unread-count', protect, async (req, res) => {
  try {
    if (!isDbOnline()) {
      const stored = offlineDb.getMessages(String(req.user._id));
      return res.json({ success: true, count: stored.filter(m => !m.isRead).length });
    }

    const count = await Message().countDocuments({
      receiverId: req.user._id,
      isRead:     false,
      deletedFor: { $ne: req.user._id },
    });

    res.json({ success: true, count });
  } catch (err) {
    console.error('Unread count error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get unread count.' });
  }
});

// ── PATCH /api/messages/:id/read — Mark a single message as read ──────────────
router.patch('/:id/read', protect, async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true });

    const msg = await Message().findOneAndUpdate(
      { _id: req.params.id, receiverId: req.user._id },
      { isRead: true },
      { new: true }
    ).lean();

    if (!msg) return res.status(404).json({ success: false, message: 'Message not found or unauthorized.' });

    // Notify sender that their message was read
    emitToUser(String(msg.senderId), 'message:read', { messageId: msg._id, readBy: req.user._id });

    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('Message PATCH read error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to mark message as read.' });
  }
});

// ── PATCH /api/messages/read-all/:senderId — Mark all from a sender as read ───
router.patch('/read-all/:senderId', protect, async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true, modifiedCount: 0 });

    const result = await Message().updateMany(
      { senderId: req.params.senderId, receiverId: req.user._id, isRead: false },
      { isRead: true }
    );

    emitToUser(req.params.senderId, 'messages:all-read', { by: req.user._id });

    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('Read-all error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to mark all as read.' });
  }
});

// ── DELETE /api/messages/:id — Soft delete for current user ──────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true });

    const msg = await Message().findOneAndUpdate(
      {
        _id: req.params.id,
        $or: [{ senderId: req.user._id }, { receiverId: req.user._id }],
      },
      { $addToSet: { deletedFor: req.user._id } },
      { new: true }
    ).lean();

    if (!msg) return res.status(404).json({ success: false, message: 'Message not found or unauthorized.' });

    res.json({ success: true });
  } catch (err) {
    console.error('Message DELETE error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete message.' });
  }
});

// ── GET /api/messages/conversations — Summarized conversation list ─────────────
// Returns one entry per unique conversation partner:
//   { partner, lastMessage, unreadCount, updatedAt }
router.get('/conversations', protect, async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true, conversations: [] });

    const myId = req.user._id;

    // Aggregate: find all messages where user is sender or receiver, group by partner
    const raw = await Message().aggregate([
      {
        $match: {
          $or: [{ senderId: myId }, { receiverId: myId }],
          deletedFor: { $ne: myId },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          partnerId: {
            $cond: [{ $eq: ['$senderId', myId] }, '$receiverId', '$senderId'],
          },
        },
      },
      {
        $group: {
          _id: '$partnerId',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$receiverId', myId] }, { $eq: ['$isRead', false] }] },
                1, 0,
              ],
            },
          },
          updatedAt: { $first: '$createdAt' },
        },
      },
      { $sort: { updatedAt: -1 } },
      { $limit: 50 },
    ]);

    // Populate partner info
    const partnerIds = raw.map(c => c._id);
    const partners   = await User().find({ _id: { $in: partnerIds } })
      .select('name avatar disabilityType isOnline lastSeen').lean();
    const partnerMap = Object.fromEntries(partners.map(p => [p._id.toString(), p]));

    const conversations = raw.map(c => ({
      partner:     partnerMap[c._id.toString()] || { _id: c._id, name: 'Unknown' },
      lastMessage: c.lastMessage,
      unreadCount: c.unreadCount,
      updatedAt:   c.updatedAt,
    }));

    res.json({ success: true, conversations });
  } catch (err) {
    console.error('Conversations GET error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch conversations.' });
  }
});

// ── POST /api/messages/typing — Broadcast typing indicator to receiver ─────────
// Body: { receiverId, isTyping: boolean }
router.post('/typing', protect, async (req, res) => {
  const { receiverId, isTyping } = req.body;
  if (!receiverId) return res.status(400).json({ success: false, message: 'receiverId is required.' });

  emitToUser(String(receiverId), 'message:typing', {
    fromUserId: String(req.user._id),
    fromName:   req.user.name,
    isTyping:   !!isTyping,
  });

  res.json({ success: true });
});

// ── PATCH /api/messages/:id/react — Add or toggle an emoji reaction ────────────
// Body: { emoji: '👍' }
router.patch('/:id/react', protect, async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true });

    const { emoji } = req.body;
    if (!emoji || typeof emoji !== 'string' || emoji.length > 8) {
      return res.status(400).json({ success: false, message: 'Invalid emoji.' });
    }

    const myId = req.user._id;
    const msg  = await Message().findOne({
      _id: req.params.id,
      $or: [{ senderId: myId }, { receiverId: myId }],
      deletedFor: { $ne: myId },
    });
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });

    // Ensure reactions array exists on the document (mixed content field)
    if (!Array.isArray(msg.content?.reactions)) {
      msg.content = { ...(msg.content || {}), reactions: [] };
    }

    const uid      = myId.toString();
    const existing = msg.content.reactions.findIndex(
      r => r.emoji === emoji && r.userId === uid,
    );

    if (existing >= 0) {
      // Toggle off — remove reaction
      msg.content.reactions.splice(existing, 1);
    } else {
      msg.content.reactions.push({ emoji, userId: uid, reactedAt: new Date() });
    }
    msg.markModified('content');
    await msg.save();

    // Notify both parties in real time
    const otherId = myId.toString() === msg.senderId.toString()
      ? msg.receiverId.toString()
      : msg.senderId.toString();

    const reactionPayload = { messageId: msg._id, reactions: msg.content.reactions };
    emitToUser(otherId, 'message:reacted', reactionPayload);
    emitToUser(uid,     'message:reacted', reactionPayload);

    res.json({ success: true, reactions: msg.content.reactions });
  } catch (err) {
    console.error('Message react error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to add reaction.' });
  }
});

// ── GET /api/messages/search — Full-text message search ───────────────────────
// Query params: q (required), limit (default 20)
router.get('/search', protect, async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true, messages: [] });
    const q     = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    if (!q) return res.status(400).json({ success: false, message: 'Search query is required.' });

    const myId = req.user._id;
    const messages = await Message()
      .find({
        $or: [{ senderId: myId }, { receiverId: myId }],
        deletedFor: { $ne: myId },
        'content.text': { $regex: q, $options: 'i' },
      })
      .populate('senderId receiverId', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, messages, query: q });
  } catch (err) {
    console.error('Message search error:', err.message);
    res.status(500).json({ success: false, message: 'Search failed.' });
  }
});

module.exports = router;