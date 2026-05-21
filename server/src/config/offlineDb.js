// server/src/config/offlineDb.js
// Industry-grade JSON file-based mock database.
// Features: atomic writes (temp-file + rename), write queue to prevent corruption,
//           deduplication guards on connections arrays, full schema normalization.
const fs    = require('fs');
const path  = require('path');
const bcrypt = require('bcryptjs');

const DB_FILE  = path.join(__dirname, '../../offline_db.json');
const TMP_FILE = DB_FILE + '.tmp';

// ── Serialized write queue — prevents concurrent write corruption ─────────────
class WriteQueue {
  constructor() { this._q = Promise.resolve(); }
  enqueue(op) {
    return new Promise((resolve, reject) => {
      this._q = this._q.then(op).then(resolve).catch(reject);
    });
  }
}
const q = new WriteQueue();

// ── Atomic write: write to .tmp then rename — prevents partial-write corruption
function writeDb(data) {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(TMP_FILE, DB_FILE);
  } catch (e) {
    console.error('⚠️ offlineDb write error:', e.message);
    // Cleanup temp if rename failed
    try { fs.unlinkSync(TMP_FILE); } catch (_) {}
  }
}

// ── Read with JSON parse error recovery ──────────────────────────────────────
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) _seedDb();
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('⚠️ offlineDb read error:', e.message);
    return _emptyDb();
  }
}

// ── Default empty structure ────────────────────────────────────────────────────
function _emptyDb() {
  return { users: [], friendRequests: [], rooms: [], messages: [], healthLogs: [], medicines: [], tasks: [], circles: [] };
}

// ── Seed only if file doesn't exist ───────────────────────────────────────────
function _seedDb() {
  writeDb(_emptyDb()); // Start clean — offline_db.json already has seed data
}

// ── Normalize a user record to a consistent schema ────────────────────────────
function _normalizeUser(u) {
  return {
    plan: 'free',
    avatar: '',
    interests: [],
    connections: [],
    sentRequests: [],
    receivedRequests: [],
    friends: [],
    helpers: [],
    patients: [],
    blinkProfile: { calibrated: false, earThreshold: 0.25, dashMs: 400 },
    preferences: { language: 'en', speed: 'normal', fontSize: 'medium', highContrast: false },
    notificationPrefs: {
      emailSOS: true, emailMedicineMiss: true,
      emailCircleReminder: true, emailHealthSummary: true, emailCallMissed: true,
    },
    privacySettings: { whoCanCall: 'everyone', anonymousCommunity: false },
    ...u,
    // Deduplicate array fields to prevent offline_db corruption over time
    connections:      [...new Set(u.connections      || [])],
    sentRequests:     [...new Set(u.sentRequests     || [])],
    receivedRequests: [...new Set(u.receivedRequests || [])],
    friends:          [...new Set(u.friends          || [])],
    helpers:          [...new Set(u.helpers          || [])],
    patients:         [...new Set(u.patients         || [])],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Reads ────────────────────────────────────────────────────────────────
  getUsers: () => readDb().users.map(_normalizeUser),

  getUserById: (id) => {
    const u = readDb().users.find(u => u._id === String(id));
    return u ? _normalizeUser(u) : null;
  },

  getUserByEmail: (email) => {
    const u = readDb().users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
    return u ? _normalizeUser(u) : null;
  },

  // ── Create user with bcrypt hash ─────────────────────────────────────────
  createUser: async (userData) => {
    return q.enqueue(async () => {
      const db = readDb();

      let passwordHash = userData.passwordHash || '';
      if (passwordHash && !passwordHash.startsWith('$2')) {
        passwordHash = await bcrypt.hash(passwordHash, 12);
      }

      const newUser = _normalizeUser({
        _id:       'mock-id-' + Math.random().toString(36).slice(2, 11),
        isOnline:  true,
        lastSeen:  new Date().toISOString(),
        ...userData,
        passwordHash,
      });

      db.users = db.users || [];
      db.users.push(newUser);
      writeDb(db);
      return newUser;
    });
  },

  // ── Update user — deduplicates all array fields on every write ───────────
  updateUser: (id, updates) => {
    return q.enqueue(() => {
      const db  = readDb();
      const idx = db.users.findIndex(u => u._id === String(id));
      if (idx === -1) return null;

      db.users[idx] = _normalizeUser({ ...db.users[idx], ...updates });
      writeDb(db);
      return db.users[idx];
    });
  },

  // ── Health logs ──────────────────────────────────────────────────────────
  addHealthLog: (log) => {
    return q.enqueue(() => {
      const db = readDb();
      db.healthLogs = db.healthLogs || [];
      const entry = { _id: 'log-' + Date.now(), ...log, createdAt: new Date().toISOString() };
      db.healthLogs.push(entry);
      writeDb(db);
      return entry;
    });
  },

  getHealthLogs: (userId) => {
    const db = readDb();
    return (db.healthLogs || []).filter(l => l.userId === String(userId));
  },

  // ── Rooms ────────────────────────────────────────────────────────────────
  getRooms: () => readDb().rooms || [],

  createRoom: (room) => {
    return q.enqueue(() => {
      const db = readDb();
      db.rooms = db.rooms || [];
      const entry = { _id: 'room-' + Date.now(), ...room, createdAt: new Date().toISOString() };
      db.rooms.push(entry);
      writeDb(db);
      return entry;
    });
  },

  // ── Messages ─────────────────────────────────────────────────────────────
  getMessages: (userId) => {
    const db  = readDb();
    const uid = String(userId);
    return (db.messages || []).filter(m => m.senderId === uid || m.receiverId === uid);
  },

  addMessage: (msg) => {
    return q.enqueue(() => {
      const db = readDb();
      db.messages = db.messages || [];
      const entry = { _id: 'msg-' + Date.now(), ...msg, createdAt: new Date().toISOString() };
      db.messages.push(entry);
      writeDb(db);
      return entry;
    });
  },

  // ── Medicines ────────────────────────────────────────────────────────────
  getMedicines: (patientId) => {
    const db = readDb();
    return (db.medicines || []).filter(m => m.patientId === String(patientId));
  },

  addMedicine: (medicine) => {
    return q.enqueue(() => {
      const db = readDb();
      db.medicines = db.medicines || [];
      const entry = { _id: 'med-' + Date.now(), ...medicine, createdAt: new Date().toISOString(), isActive: true };
      db.medicines.push(entry);
      writeDb(db);
      return entry;
    });
  },

  updateMedicine: (id, updates) => {
    return q.enqueue(() => {
      const db = readDb();
      const idx = (db.medicines || []).findIndex(m => m._id === String(id));
      if (idx === -1) return null;
      db.medicines[idx] = { ...db.medicines[idx], ...updates, updatedAt: new Date().toISOString() };
      writeDb(db);
      return db.medicines[idx];
    });
  },

  deleteMedicine: (id) => {
    return q.enqueue(() => {
      const db = readDb();
      db.medicines = (db.medicines || []).filter(m => m._id !== String(id));
      writeDb(db);
      return true;
    });
  },

  // ── Tasks ────────────────────────────────────────────────────────────────
  getTasks: (patientId) => {
    const db = readDb();
    return (db.tasks || []).filter(t => t.patientId === String(patientId));
  },

  addTask: (task) => {
    return q.enqueue(() => {
      const db = readDb();
      db.tasks = db.tasks || [];
      const entry = { _id: 'task-' + Date.now(), ...task, createdAt: new Date().toISOString(), status: 'todo' };
      db.tasks.push(entry);
      writeDb(db);
      return entry;
    });
  },

  updateTask: (id, updates) => {
    return q.enqueue(() => {
      const db = readDb();
      const idx = (db.tasks || []).findIndex(t => t._id === String(id));
      if (idx === -1) return null;
      db.tasks[idx] = { ...db.tasks[idx], ...updates, updatedAt: new Date().toISOString() };
      writeDb(db);
      return db.tasks[idx];
    });
  },

  deleteTask: (id) => {
    return q.enqueue(() => {
      const db = readDb();
      db.tasks = (db.tasks || []).filter(t => t._id !== String(id));
      writeDb(db);
      return true;
    });
  },

  // ── Friend/connection requests (legacy + modern) ──────────────────────────
  getFriendRequests: () => readDb().friendRequests || [],

  sendFriendRequest: (fromUserId, toUserId) => {
    return q.enqueue(() => {
      const db = readDb();
      db.friendRequests = db.friendRequests || [];

      const exists = db.friendRequests.find(
        r => (r.from === fromUserId && r.to === toUserId) ||
             (r.from === toUserId   && r.to === fromUserId)
      );
      if (exists) return exists;

      const request = {
        _id: 'req-' + Math.random().toString(36).slice(2, 11),
        from: fromUserId, to: toUserId,
        status: 'pending', createdAt: new Date().toISOString(),
      };
      db.friendRequests.push(request);

      // Update receiver's receivedRequests list
      const toIdx = db.users.findIndex(u => u._id === toUserId);
      if (toIdx !== -1) {
        db.users[toIdx] = _normalizeUser({
          ...db.users[toIdx],
          receivedRequests: [...new Set([...(db.users[toIdx].receivedRequests || []), fromUserId])],
        });
      }
      // Update sender's sentRequests list
      const fromIdx = db.users.findIndex(u => u._id === fromUserId);
      if (fromIdx !== -1) {
        db.users[fromIdx] = _normalizeUser({
          ...db.users[fromIdx],
          sentRequests: [...new Set([...(db.users[fromIdx].sentRequests || []), toUserId])],
        });
      }

      writeDb(db);

      try {
        const { emitToUser } = require('../socket');
        emitToUser(toUserId, 'connection:request', { fromUserId });
      } catch (_) {}

      return request;
    });
  },

  acceptFriendRequest: (fromUserId, toUserId) => {
    return q.enqueue(() => {
      const db = readDb();

      const fromIdx = db.users.findIndex(u => u._id === fromUserId);
      const toIdx   = db.users.findIndex(u => u._id === toUserId);
      if (fromIdx === -1 || toIdx === -1) return false;

      const from = db.users[fromIdx];
      const to   = db.users[toIdx];

      db.users[fromIdx] = _normalizeUser({
        ...from,
        connections:  [...new Set([...(from.connections  || []), toUserId])],
        sentRequests: (from.sentRequests || []).filter(id => id !== toUserId),
      });
      db.users[toIdx] = _normalizeUser({
        ...to,
        connections:      [...new Set([...(to.connections      || []), fromUserId])],
        receivedRequests: (to.receivedRequests || []).filter(id => id !== fromUserId),
      });

      db.friendRequests = (db.friendRequests || []).filter(
        r => !(r.from === fromUserId && r.to === toUserId)
      );

      writeDb(db);

      try {
        const { emitToUser } = require('../socket');
        emitToUser(fromUserId, 'connection:accepted', { byUser: { _id: toUserId } });
      } catch (_) {}

      return true;
    });
  },

  declineFriendRequest: (fromUserId, toUserId) => {
    return q.enqueue(() => {
      const db = readDb();

      const toIdx = db.users.findIndex(u => u._id === toUserId);
      if (toIdx !== -1) {
        db.users[toIdx] = _normalizeUser({
          ...db.users[toIdx],
          receivedRequests: (db.users[toIdx].receivedRequests || []).filter(id => id !== fromUserId),
        });
      }
      const fromIdx = db.users.findIndex(u => u._id === fromUserId);
      if (fromIdx !== -1) {
        db.users[fromIdx] = _normalizeUser({
          ...db.users[fromIdx],
          sentRequests: (db.users[fromIdx].sentRequests || []).filter(id => id !== toUserId),
        });
      }
      db.friendRequests = (db.friendRequests || []).filter(
        r => !(r.from === fromUserId && r.to === toUserId)
      );

      writeDb(db);
      return true;
    });
  },
};
