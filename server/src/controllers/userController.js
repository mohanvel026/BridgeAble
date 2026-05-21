// server/src/controllers/userController.js
const mongoose = require('mongoose');
const User = require('../models').User;
const offlineDb = require('../config/offlineDb');
const { emitToUser } = require('../socket');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const isDbOnline = () => mongoose.connection.readyState === 1;

// ── Discover users with filters ───────────────────────────
exports.discoverUsers = async (req, res) => {
  try {
    const { disabilityType, language, online, interest, page = 1 } = req.query;
    const limit = 20;

    if (!isDbOnline()) {
      let allUsers = offlineDb.getUsers().filter(u => u._id !== req.user._id);
      const me = offlineDb.getUserById(req.user._id);
      const myConnections = me?.connections || [];
      const mySentRequests = me?.sentRequests || [];
      const myReceivedRequests = me?.receivedRequests || [];

      // Enrich each user with relationship state
      allUsers = allUsers.map(u => ({
        ...u,
        connectionStatus: myConnections.includes(u._id) ? 'connected'
          : mySentRequests.includes(u._id) ? 'pending_sent'
          : myReceivedRequests.includes(u._id) ? 'pending_received'
          : 'none',
      }));

      if (disabilityType) allUsers = allUsers.filter(u => u.disabilityType === disabilityType);
      if (online === 'true') allUsers = allUsers.filter(u => u.isOnline);

      return res.json({ success: true, users: allUsers });
    }

    const me = await User.findById(req.user._id).select('connections sentRequests receivedRequests blockedUsers');
    const filter = {
      _id: { $ne: req.user._id, $nin: me.blockedUsers || [] },
    };
    if (disabilityType) filter.disabilityType = disabilityType;
    if (language) filter['preferences.language'] = language;
    if (online === 'true') filter.isOnline = true;
    if (interest) filter.interests = { $in: [interest] };

    const users = await User.find(filter)
      .select('name avatar disabilityType inputMode interests isOnline lastSeen')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ isOnline: -1, lastSeen: -1 });

    const myConns = me.connections?.map(String) || [];
    const mySent = me.sentRequests?.map(String) || [];
    const myReceived = me.receivedRequests?.map(String) || [];

    const enriched = users.map(u => ({
      ...u.toObject(),
      connectionStatus: myConns.includes(String(u._id)) ? 'connected'
        : mySent.includes(String(u._id)) ? 'pending_sent'
        : myReceived.includes(String(u._id)) ? 'pending_received'
        : 'none',
    }));

    res.json({ success: true, users: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get my connections ────────────────────────────────────
exports.getConnections = async (req, res) => {
  try {
    if (!isDbOnline()) {
      const me = offlineDb.getUserById(req.user._id);
      const connections = (me?.connections || [])
        .map(id => offlineDb.getUserById(id))
        .filter(Boolean)
        .map(u => ({ ...u, connectionStatus: 'connected' }));
      return res.json({ success: true, connections });
    }

    const me = await User.findById(req.user._id)
      .populate('connections', 'name avatar disabilityType inputMode isOnline lastSeen');
    const connections = (me.connections || []).map(u => ({
      ...u.toObject(), connectionStatus: 'connected'
    }));
    res.json({ success: true, connections });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get pending connection requests (incoming) ────────────
exports.getConnectionRequests = async (req, res) => {
  try {
    if (!isDbOnline()) {
      const me = offlineDb.getUserById(req.user._id);
      const requests = (me?.receivedRequests || [])
        .map(id => offlineDb.getUserById(id))
        .filter(Boolean);
      return res.json({ success: true, requests });
    }

    const me = await User.findById(req.user._id)
      .populate('receivedRequests', 'name avatar disabilityType inputMode isOnline');
    res.json({ success: true, requests: me.receivedRequests || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Send connection request ───────────────────────────────
exports.sendConnectionRequest = async (req, res) => {
  try {
    const targetId = req.params.userId;
    const myId = req.user._id.toString();

    if (!isDbOnline()) {
      const me = offlineDb.getUserById(myId);
      const them = offlineDb.getUserById(targetId);
      if (!them) return res.status(404).json({ success: false, message: 'User not found' });

      const mySent = me.sentRequests || [];
      const myConns = me.connections || [];
      if (mySent.includes(targetId) || myConns.includes(targetId)) {
        return res.status(400).json({ success: false, message: 'Request already sent or already connected' });
      }

      offlineDb.updateUser(myId, { sentRequests: [...mySent, targetId] });
      const theirReceived = them.receivedRequests || [];
      offlineDb.updateUser(targetId, { receivedRequests: [...theirReceived, myId] });

      // Real-time notification
      try {
        emitToUser(targetId, 'connection:request', {
          fromUser: { _id: myId, name: me.name, avatar: me.avatar, disabilityType: me.disabilityType },
          timestamp: new Date(),
        });
      } catch (e) {}

      return res.json({ success: true, message: 'Connection request sent' });
    }

    const [me, them] = await Promise.all([
      User.findById(myId),
      User.findById(targetId),
    ]);
    if (!them) return res.status(404).json({ success: false, message: 'User not found' });
    if ((me.sentRequests || []).map(String).includes(targetId) ||
        (me.connections || []).map(String).includes(targetId)) {
      return res.status(400).json({ success: false, message: 'Request already sent or already connected' });
    }

    await User.findByIdAndUpdate(myId, { $addToSet: { sentRequests: targetId } });
    await User.findByIdAndUpdate(targetId, { $addToSet: { receivedRequests: myId } });

    emitToUser(targetId, 'connection:request', {
      fromUser: { _id: myId, name: me.name, avatar: me.avatar, disabilityType: me.disabilityType },
      timestamp: new Date(),
    });

    res.json({ success: true, message: 'Connection request sent' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Accept connection request ─────────────────────────────
exports.acceptConnectionRequest = async (req, res) => {
  try {
    const fromId = req.params.userId;
    const myId = req.user._id.toString();

    if (!isDbOnline()) {
      const me = offlineDb.getUserById(myId);
      const them = offlineDb.getUserById(fromId);
      if (!them) return res.status(404).json({ success: false, message: 'User not found' });

      // Move from receivedRequests → connections (me) and sentRequests → connections (them)
      const myReceived = (me.receivedRequests || []).filter(id => id !== fromId);
      const myConns = [...(me.connections || []), fromId];
      offlineDb.updateUser(myId, { receivedRequests: myReceived, connections: myConns });

      const theirSent = (them.sentRequests || []).filter(id => id !== myId);
      const theirConns = [...(them.connections || []), myId];
      offlineDb.updateUser(fromId, { sentRequests: theirSent, connections: theirConns });

      // Notify the original requester
      try {
        emitToUser(fromId, 'connection:accepted', {
          byUser: { _id: myId, name: me.name, avatar: me.avatar, disabilityType: me.disabilityType },
        });
      } catch (e) {}

      return res.json({ success: true, message: 'Connection accepted' });
    }

    await User.findByIdAndUpdate(myId, {
      $pull: { receivedRequests: fromId },
      $addToSet: { connections: fromId },
    });
    await User.findByIdAndUpdate(fromId, {
      $pull: { sentRequests: myId },
      $addToSet: { connections: myId },
    });

    const me = await User.findById(myId).select('name avatar disabilityType');
    emitToUser(fromId, 'connection:accepted', {
      byUser: { _id: myId, name: me.name, avatar: me.avatar, disabilityType: me.disabilityType },
    });

    res.json({ success: true, message: 'Connection accepted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Decline connection request ────────────────────────────
exports.declineConnectionRequest = async (req, res) => {
  try {
    const fromId = req.params.userId;
    const myId = req.user._id.toString();

    if (!isDbOnline()) {
      const me = offlineDb.getUserById(myId);
      const them = offlineDb.getUserById(fromId);

      const myReceived = (me?.receivedRequests || []).filter(id => id !== fromId);
      offlineDb.updateUser(myId, { receivedRequests: myReceived });

      if (them) {
        const theirSent = (them.sentRequests || []).filter(id => id !== myId);
        offlineDb.updateUser(fromId, { sentRequests: theirSent });
      }
      return res.json({ success: true, message: 'Request declined' });
    }

    await User.findByIdAndUpdate(myId, { $pull: { receivedRequests: fromId } });
    await User.findByIdAndUpdate(fromId, { $pull: { sentRequests: myId } });

    res.json({ success: true, message: 'Request declined' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Remove existing connection ────────────────────────────
exports.removeConnection = async (req, res) => {
  try {
    const targetId = req.params.userId;
    const myId = req.user._id.toString();

    if (!isDbOnline()) {
      const me = offlineDb.getUserById(myId);
      const them = offlineDb.getUserById(targetId);

      offlineDb.updateUser(myId, { connections: (me?.connections || []).filter(id => id !== targetId) });
      if (them) offlineDb.updateUser(targetId, { connections: (them.connections || []).filter(id => id !== myId) });
      return res.json({ success: true, message: 'Connection removed' });
    }

    await User.findByIdAndUpdate(myId, { $pull: { connections: targetId } });
    await User.findByIdAndUpdate(targetId, { $pull: { connections: myId } });

    res.json({ success: true, message: 'Connection removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get single profile ────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    if (!isDbOnline()) {
      const user = offlineDb.getUserById(req.params.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      return res.json({ success: true, user });
    }
    const user = await User.findById(req.params.id)
      .select('-passwordHash -resetOTP -resetOTPExpiry')
      .populate('helpers', 'name email isOnline avatar disabilityType');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Update profile ────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    if (!isDbOnline()) {
      const allowed = ['name', 'disabilityType', 'inputMode', 'interests', 'preferences'];
      const updates = {};
      allowed.forEach(key => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });
      const updatedUser = offlineDb.updateUser(req.user._id, updates);
      return res.json({ success: true, user: updatedUser });
    }
    const updates = {};
    const allowed = ['name', 'disabilityType', 'inputMode', 'interests', 'preferences', 'privacySettings', 'notificationPrefs'];
    allowed.forEach(key => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });
    if (req.file) updates.avatar = req.file.path;
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Link helper ───────────────────────────────────────────
exports.linkHelper = async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true, message: 'Helper linked (Mock)' });
    const { helperEmail } = req.body;
    const helper = await User.findOne({ email: helperEmail });
    if (!helper) return res.status(404).json({ success: false, message: 'Helper not found' });
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { helpers: helper._id } });
    await User.findByIdAndUpdate(helper._id, { $addToSet: { patients: req.user._id } });
    res.json({ success: true, message: 'Helper linked', helper });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Unlink helper ─────────────────────────────────────────
exports.unlinkHelper = async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true, message: 'Helper unlinked (Mock)' });
    await User.findByIdAndUpdate(req.user._id, { $pull: { helpers: req.params.helperId } });
    await User.findByIdAndUpdate(req.params.helperId, { $pull: { patients: req.user._id } });
    res.json({ success: true, message: 'Helper unlinked' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Legacy: Add friend (instant, no request) ──────────────
exports.addFriend = async (req, res) => {
  try {
    if (!isDbOnline()) {
      const me = offlineDb.getUserById(req.user._id);
      const them = offlineDb.getUserById(req.params.userId);
      if (me && them) {
        offlineDb.updateUser(me._id, { connections: [...(me.connections || []), them._id] });
        offlineDb.updateUser(them._id, { connections: [...(them.connections || []), me._id] });
      }
      return res.json({ success: true, message: 'Connected' });
    }
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { connections: req.params.userId } });
    res.json({ success: true, message: 'Connected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.removeFriend = async (req, res) => {
  req.params.userId = req.params.userId;
  return exports.removeConnection(req, res);
};

// ── Block user ────────────────────────────────────────────
exports.blockUser = async (req, res) => {
  try {
    if (!isDbOnline()) return res.json({ success: true, message: 'User blocked (Mock)' });
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { blockedUsers: req.params.userId } });
    res.json({ success: true, message: 'User blocked' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};