// ============================================================
//  IDEA WALL — Standalone social app for PT Antarestar Global Kreatifindo
//  Express + JSON persistence + SSE + member auth + Google OAuth.
//  No external deps except express; OAuth uses built-in https.
// ============================================================
'use strict';

// Load .env if present (optional dependency — safe to skip if not installed).
try { require('dotenv').config(); } catch (e) { /* dotenv optional */ }

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3030;

// ------------------------------------------------------------
//  Safety net: never let a stray error kill the process.
//  PM2 would restart it, but logging + staying up is better UX.
// ------------------------------------------------------------
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ------------------------------------------------------------
//  Paths & data bootstrap
// ------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const IDEA_WALL_FILE = path.join(DATA_DIR, 'ideas.json');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;       // 5MB photo cap
const MEMBER_SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const ADMIN_SESSION_TTL = 24 * 60 * 60 * 1000;       // 24 hours
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-admin';
const VALID_STATUS = ['pending', 'in_progress', 'done'];
const EOTM_FILE = path.join(DATA_DIR, 'eotm.json');
const CORE_VALUES = ['jujur', 'kerjasama', 'integritas', 'komunikasi', 'customer_focus'];
const CORE_VALUE_LABELS = { jujur: 'Jujur', kerjasama: 'Kerjasama', integritas: 'Integritas', komunikasi: 'Komunikasi', customer_focus: 'Customer Focus' };
const CORE_VALUE_EMOJI = { jujur: '🫡', kerjasama: '🤝', integritas: '🛡️', komunikasi: '💬', customer_focus: '🎯' };
const MON_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function ensureDir(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}
ensureDir(DATA_DIR);
ensureDir(UPLOADS_DIR);
ensureDir(ASSETS_DIR);

// ------------------------------------------------------------
//  Seed ideas (only when ideas.json missing)
// ------------------------------------------------------------
function seedIdeas() {
  const now = Date.now();
  const min = 60 * 1000;
  const mk = (id, name, username, avatar, text, status, likes, photo, comments, ago) => ({
    id, name, memberId: null, memberUsername: username, memberAvatar: avatar,
    text, status, likes, photo: photo || '',
    comments: comments || [], ts: now - ago,
  });
  return {
    nextId: 6,
    ideas: [
      mk(5, 'Dewi Lestari', 'dewilestari', '',
        'Pasang rak penyimpanan di gudang properti foto biar barang tidak menumpuk di lantai dan lebih gampang dicari saat shooting.',
        'pending', 12, '',
        [{ id: crypto.randomBytes(6).toString('hex'), name: 'Manajer', memberId: null, memberUsername: null, memberAvatar: '', text: 'Bagus, kita anggarkan minggu ini.', ts: now - 2 * min }],
        2 * min),
      mk(4, 'Rizky Pratama', 'rizkypratama', '',
        'Bikin template caption otomatis untuk klien rutin biar tim sosmed nggak mulai dari nol tiap hari.',
        'in_progress', 31, '', [], 6 * min),
      mk(3, 'Putri Anjani', 'putrianjani', '',
        'Folder aset brand terpusat di cloud — satu klien satu folder, gampang dicari dan nggak ada file nyasar.',
        'done', 27, '',
        [{ id: crypto.randomBytes(6).toString('hex'), name: 'Manajer', memberId: null, memberUsername: null, memberAvatar: '', text: 'Sudah dibuat di Drive.', ts: now - 10 * min }],
        14 * min),
      mk(2, 'Bagus Saputra', 'bagussaputra', '',
        'Checklist serah-terima proyek ke klien biar nggak ada file final yang ketinggalan dikirim.',
        'in_progress', 18, '', [], 22 * min),
      mk(1, 'Sari Widodo', 'sariwidodo', '',
        'Bank musik bebas royalti internal biar tim video nggak buang waktu cari-cari backsound tiap proyek.',
        'pending', 44, '', [], 35 * min),
    ],
  };
}

// ------------------------------------------------------------
//  Persistence — load → mutate → save
// ------------------------------------------------------------
let ideaWallData = null;
function loadIdeaWall() {
  if (ideaWallData) return ideaWallData;
  try {
    if (fs.existsSync(IDEA_WALL_FILE)) {
      ideaWallData = JSON.parse(fs.readFileSync(IDEA_WALL_FILE, 'utf8'));
    } else {
      ideaWallData = seedIdeas();
      saveIdeaWall();
    }
  } catch (e) {
    ideaWallData = { ideas: [], nextId: 1 };
  }
  if (!Array.isArray(ideaWallData.ideas)) ideaWallData.ideas = [];
  if (typeof ideaWallData.nextId !== 'number') ideaWallData.nextId = 1;
  return ideaWallData;
}
let ideasJsonCache = null; // cache string response /api/ideas (di-rebuild saat ada perubahan)
function saveIdeaWall() {
  ideasJsonCache = null; // invalidate cache
  try { fs.writeFileSync(IDEA_WALL_FILE, JSON.stringify(ideaWallData, null, 2)); } catch (e) { /* ignore */ }
}
// Response /api/ideas: pre-stringify sekali + buang field internal (likedBy) → ringan & hemat CPU saat banyak request bareng
function ideasJsonString() {
  if (ideasJsonCache) return ideasJsonCache;
  const wall = loadIdeaWall();
  const light = wall.ideas.map(i => { const { likedBy, ...rest } = i; return rest; });
  ideasJsonCache = JSON.stringify({ ideas: light });
  return ideasJsonCache;
}

let membersCache = null;
function loadMembers() {
  if (membersCache) return membersCache;
  try {
    if (fs.existsSync(MEMBERS_FILE)) { membersCache = JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8')); return membersCache; }
  } catch (e) { /* ignore */ }
  membersCache = { members: [] };
  return membersCache;
}
function saveMembers(list) {
  membersCache = list; // jaga cache tetap sinkron
  try { fs.writeFileSync(MEMBERS_FILE, JSON.stringify(list, null, 2)); } catch (e) { /* ignore */ }
}

// ---- Employee of the Month (EOTM) persistence ----
function monthKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function monthLabel(d) { d = d || new Date(); return MON_ID[d.getMonth()] + ' ' + d.getFullYear(); }
function defaultEotm() { return { round: monthKey(), title: monthLabel(), status: 'closed', mode: 'single', openedAt: null, closedAt: null, winner: null, votes: {} }; }
let eotmData = null;
function loadEotm() {
  if (eotmData) return eotmData;
  try {
    if (fs.existsSync(EOTM_FILE)) eotmData = JSON.parse(fs.readFileSync(EOTM_FILE, 'utf8'));
    else { eotmData = defaultEotm(); saveEotm(); }
  } catch (e) { eotmData = defaultEotm(); }
  if (!eotmData.votes || typeof eotmData.votes !== 'object') eotmData.votes = {};
  return eotmData;
}
function saveEotm() { try { fs.writeFileSync(EOTM_FILE, JSON.stringify(eotmData, null, 2)); } catch (e) { /* ignore */ } }
function normName(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function buildEotmTally(e) {
  const byName = {}; let total = 0;
  for (const v of Object.values(e.votes || {})) {
    const key = normName(v.name); if (!key) continue;
    if (!byName[key]) byName[key] = { name: v.name, votes: 0, byValue: {} };
    byName[key].votes += 1;
    if (v.value) byName[key].byValue[v.value] = (byName[key].byValue[v.value] || 0) + 1;
    total += 1;
  }
  const rows = Object.values(byName).sort((a, b) => b.votes - a.votes).map((r, i) => ({ ...r, rank: i + 1 }));
  return { rows, total };
}
function eotmPublic(e, member) {
  const { rows, total } = buildEotmTally(e);
  return {
    round: e.round, title: e.title, status: e.status, mode: e.mode,
    openedAt: e.openedAt, closedAt: e.closedAt, winner: e.winner,
    coreValues: CORE_VALUES.map(k => ({ key: k, label: CORE_VALUE_LABELS[k], emoji: CORE_VALUE_EMOJI[k] })),
    tally: rows, totalVotes: total,
    totalMembers: loadMembers().members.length,
    history: (e.history || []).slice(0, 12),
    loggedIn: !!member,
    voterName: member ? member.name : null,
    myVote: member && e.votes[member.id] ? e.votes[member.id] : null,
  };
}

// ------------------------------------------------------------
//  Auth helpers
// ------------------------------------------------------------
function hashPassword(pw, salt) {
  return crypto.createHash('sha256').update(pw + salt).digest('hex');
}
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
function genToken() { return crypto.randomBytes(24).toString('hex'); }

// Sessions persist ke file biar restart app TIDAK nge-logout user
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const memberSessions = new Map(); // token -> { memberId, ts }
const adminSessions = new Map();  // token -> { ts }
(function loadSessions() {
  try {
    const s = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    for (const [k, v] of Object.entries(s.member || {})) memberSessions.set(k, v);
    for (const [k, v] of Object.entries(s.admin || {})) adminSessions.set(k, v);
  } catch (e) { /* belum ada file, normal */ }
})();
let _saveT = null;
function saveSessions() {
  clearTimeout(_saveT);
  _saveT = setTimeout(() => {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify({
        member: Object.fromEntries(memberSessions),
        admin: Object.fromEntries(adminSessions),
      }));
    } catch (e) { /* ignore */ }
  }, 500); // debounce 0.5s biar nggak nulis tiap request
}

function getMember(req) {
  const token = req.cookies && req.cookies.member_session;
  if (!token) return null;
  const sess = memberSessions.get(token);
  if (!sess) return null;
  if (Date.now() - sess.ts > MEMBER_SESSION_TTL) { memberSessions.delete(token); return null; }
  const data = loadMembers();
  return data.members.find(m => m.id === sess.memberId) || null;
}

function isAdmin(req) {
  const token = req.cookies && req.cookies.admin_session;
  if (!token) return false;
  const sess = adminSessions.get(token);
  if (!sess) return false;
  if (Date.now() - sess.ts > ADMIN_SESSION_TTL) { adminSessions.delete(token); return false; }
  return true;
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Akses admin diperlukan' });
  next();
}

// ------------------------------------------------------------
//  Minimal cookie parser (no cookie-parser dependency)
// ------------------------------------------------------------
function cookieParser(req, _res, next) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  req.cookies = out;
  next();
}

// ------------------------------------------------------------
//  SSE broadcast
// ------------------------------------------------------------
const sseClients = new Map(); // id -> res
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients.values()) {
    try { res.write(data); } catch (e) { /* ignore broken pipe */ }
  }
}

// ---- In-app notifications (per member, JSON, pruned) ----
const NOTIF_FILE = path.join(DATA_DIR, 'notifications.json');
let notifData = null;
function loadNotif() {
  if (notifData) return notifData;
  try { notifData = fs.existsSync(NOTIF_FILE) ? JSON.parse(fs.readFileSync(NOTIF_FILE, 'utf8')) : {}; }
  catch (e) { notifData = {}; }
  if (!notifData || typeof notifData !== 'object') notifData = {};
  return notifData;
}
let _notifT = null;
function saveNotif() { clearTimeout(_notifT); _notifT = setTimeout(() => { try { fs.writeFileSync(NOTIF_FILE, JSON.stringify(notifData)); } catch (e) { /* ignore */ } }, 400); }
function pushNotif(memberId, text, link) {
  if (!memberId) return;
  const n = loadNotif();
  if (!Array.isArray(n[memberId])) n[memberId] = [];
  const note = { id: crypto.randomBytes(6).toString('hex'), text: String(text).slice(0, 160), link: link || '/', read: false, ts: Date.now() };
  n[memberId].unshift(note);
  const cutoff = Date.now() - 30 * 86400000;
  n[memberId] = n[memberId].filter(x => !(x.read && x.ts < cutoff)).slice(0, 50);
  saveNotif();
  broadcast('notif', { to: memberId }); // konten TIDAK di-broadcast (privasi) — client re-fetch
}
function notifAllMembers(text, link) {
  const members = loadMembers().members;
  const n = loadNotif();
  const cutoff = Date.now() - 30 * 86400000;
  for (const m of members) {
    if (!Array.isArray(n[m.id])) n[m.id] = [];
    n[m.id].unshift({ id: crypto.randomBytes(6).toString('hex'), text: String(text).slice(0, 160), link: link || '/', read: false, ts: Date.now() });
    n[m.id] = n[m.id].filter(x => !(x.read && x.ts < cutoff)).slice(0, 50);
  }
  saveNotif();
  broadcast('notif', { to: '*' }); // semua client re-fetch
}

// ------------------------------------------------------------
//  Game Leaderboard (Flappy Gunung) — best score per pemain
// ------------------------------------------------------------
const GAME_FILE = path.join(DATA_DIR, 'gamescores.json');
let gameData = null;
function loadGame() {
  if (gameData) return gameData;
  try { gameData = fs.existsSync(GAME_FILE) ? JSON.parse(fs.readFileSync(GAME_FILE, 'utf8')) : null; }
  catch (e) { gameData = null; }
  if (!gameData || typeof gameData !== 'object') gameData = { entries: {}, plays: 0 };
  if (!gameData.entries) gameData.entries = {};
  return gameData;
}
let _gameT = null;
function saveGame() { clearTimeout(_gameT); _gameT = setTimeout(() => { try { fs.writeFileSync(GAME_FILE, JSON.stringify(gameData)); } catch (e) { /* ignore */ } }, 400); }
function gameRanked(g) {
  return Object.entries(g.entries)
    .map(([k, v]) => ({ k, name: v.name, score: v.score, ts: v.ts }))
    .sort((a, b) => b.score - a.score || a.ts - b.ts);
}

// ------------------------------------------------------------
//  Middleware
// ------------------------------------------------------------
app.use(express.json({ limit: '10mb' }));
// Catch malformed JSON bodies (bots/scanners send junk) -> 400, don't crash.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }
  if (err) {
    console.error('[request-error]', err && err.stack ? err.stack : err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
  next();
});
app.use(cookieParser);
app.use('/assets', express.static(ASSETS_DIR, { maxAge: '5m', etag: true }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// ------------------------------------------------------------
//  Page routes
// ------------------------------------------------------------
function sendPage(file) {
  return (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
}
// Wajib login member — siap dinyalakan (tinggal pasang requireMemberPage di route bawah)
function requireMemberPage(req, res, next) {
  if (getMember(req)) return next();
  res.redirect('/login?return=' + encodeURIComponent(req.originalUrl || '/'));
}
const LOGIN_REQUIRED = false; // ← set true buat wajib login semua halaman
const gate = (req, res, next) => (LOGIN_REQUIRED ? requireMemberPage(req, res, next) : next());
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(ASSETS_DIR, 'antarestar-logo.jpg')));
app.get('/login', sendPage('login.html'));
app.get('/tv', sendPage('tv.html'));            // display kantor — selalu publik
app.get('/eotm-tv', sendPage('eotm-tv.html'));   // display TV khusus Employee of the Month
app.get('/game', sendPage('game.html'));         // mini game flappy tema gunung

// --- Leaderboard skor game ---
app.get('/api/game/leaderboard', (req, res) => {
  const g = loadGame();
  const me = getMember(req);
  const myKey = me ? me.id : null;
  const ranked = gameRanked(g);
  const top = ranked.slice(0, 50).map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, you: e.k === myKey }));
  let mine = null;
  if (myKey) {
    const idx = ranked.findIndex(e => e.k === myKey);
    if (idx >= 0) mine = { rank: idx + 1, name: ranked[idx].name, score: ranked[idx].score };
  }
  res.json({ top, me: mine, players: ranked.length, plays: g.plays || 0, loggedIn: !!me });
});

app.post('/api/game/score', (req, res) => {
  const g = loadGame();
  const member = getMember(req);
  let score = Math.floor(Number(req.body && req.body.score));
  if (!isFinite(score) || score < 0) return res.status(400).json({ error: 'Skor tidak valid' });
  score = Math.min(score, 100000); // guard angka aneh
  let name, key;
  if (member) { name = member.name; key = member.id; }
  else {
    name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });
    key = 'g:' + normName(name);
  }
  g.plays = (g.plays || 0) + 1;
  const prev = g.entries[key];
  const isRecord = !prev || score > prev.score;
  if (isRecord) g.entries[key] = { name, score, ts: Date.now(), memberId: member ? member.id : null };
  else g.entries[key].name = name; // segarkan nama terbaru
  saveGame();
  const ranked = gameRanked(g);
  const rank = ranked.findIndex(e => e.k === key) + 1;
  res.json({ ok: true, isRecord, best: g.entries[key].score, rank, players: ranked.length });
});
app.get('/admin', sendPage('admin.html'));       // gate sendiri (password admin)
app.get('/', gate, sendPage('index.html'));
app.get('/profile', gate, sendPage('profile.html'));
app.get('/form', gate, sendPage('form.html'));
app.get('/leaderboard', gate, sendPage('leaderboard.html'));
app.get('/diterapkan', gate, sendPage('diterapkan.html'));

// ------------------------------------------------------------
//  Google OAuth (raw https)
// ------------------------------------------------------------
// Set these via environment variables (see .env.example). Google login is
// optional — leave them empty and only username/password login will be active.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT = process.env.GOOGLE_REDIRECT || 'http://localhost:3030/auth/google/callback';

app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.redirect('/login?err=nogoogle'); // OAuth not configured
  const state = req.query.return || '/';
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT,
    response_type: 'code',
    scope: 'openid email profile',
    state: String(state),
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

app.get('/auth/google/callback', (req, res) => {
  const code = req.query.code;
  const state = req.query.state || '/';
  if (!code) return res.redirect('/login');
  const tokenData = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_REDIRECT,
    grant_type: 'authorization_code',
  }).toString();

  const tReq = https.request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(tokenData),
    },
  }, tRes => {
    let body = '';
    tRes.on('data', c => (body += c));
    tRes.on('end', () => {
      try {
        const tok = JSON.parse(body);
        if (!tok.access_token) return res.redirect('/login?err=token');
        https.get('https://www.googleapis.com/oauth2/v2/userinfo?access_token=' + tok.access_token, uRes => {
          let ub = '';
          uRes.on('data', c => (ub += c));
          uRes.on('end', () => {
            try {
              const info = JSON.parse(ub);
              const data = loadMembers();
              let m = data.members.find(x => x.googleId === info.id);
              if (!m) {
                let base = (info.email || 'user').split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user';
                let uname = base, n = 1;
                while (data.members.find(x => x.username === uname)) uname = base + (n++);
                m = {
                  id: 'm_' + crypto.randomBytes(8).toString('hex'),
                  name: info.name || base,
                  username: uname,
                  email: info.email || '',
                  googleId: info.id,
                  avatar: info.picture || '',
                  passwordHash: '', salt: '',
                  createdAt: Date.now(),
                };
                data.members.push(m);
                saveMembers(data);
              }
              const token = genToken();
              memberSessions.set(token, { memberId: m.id, ts: Date.now() }); saveSessions();
              res.setHeader('Set-Cookie', `member_session=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; SameSite=Lax`);
              res.redirect(String(state) || '/');
            } catch (e) { res.redirect('/login?err=parse'); }
          });
        }).on('error', () => res.redirect('/login?err=net'));
      } catch (e) { res.redirect('/login?err=tok'); }
    });
  });
  tReq.on('error', () => res.redirect('/login?err=req'));
  tReq.write(tokenData);
  tReq.end();
});

// ------------------------------------------------------------
//  Member auth API
// ------------------------------------------------------------
app.post('/api/member/register', (req, res) => {
  const { name, username, email, password } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'Lengkapi semua field' });
  const uname = String(username).replace(/[^a-z0-9_]/gi, '').toLowerCase();
  if (uname.length < 3) return res.status(400).json({ error: 'Username minimal 3 karakter' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
  const data = loadMembers();
  if (data.members.find(m => m.username === uname)) return res.status(400).json({ error: 'Username sudah dipakai' });
  const salt = makeSalt();
  const m = {
    id: 'm_' + crypto.randomBytes(8).toString('hex'),
    name: String(name).slice(0, 60),
    username: uname,
    email: String(email || '').slice(0, 120),
    passwordHash: hashPassword(password, salt),
    salt,
    avatar: '',
    createdAt: Date.now(),
  };
  data.members.push(m);
  saveMembers(data);
  const token = genToken();
  memberSessions.set(token, { memberId: m.id, ts: Date.now() }); saveSessions();
  res.setHeader('Set-Cookie', `member_session=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; SameSite=Lax`);
  res.json({ ok: true, member: { id: m.id, name: m.name, username: m.username, avatar: m.avatar } });
});

app.post('/api/member/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Lengkapi username & password' });
  const uname = String(username).replace(/[^a-z0-9_]/gi, '').toLowerCase();
  const data = loadMembers();
  const m = data.members.find(x => x.username === uname);
  if (!m || !m.passwordHash) return res.status(401).json({ error: 'Username atau password salah' });
  if (hashPassword(password, m.salt) !== m.passwordHash) return res.status(401).json({ error: 'Username atau password salah' });
  const token = genToken();
  memberSessions.set(token, { memberId: m.id, ts: Date.now() }); saveSessions();
  res.setHeader('Set-Cookie', `member_session=${token}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; SameSite=Lax`);
  res.json({ ok: true, member: { id: m.id, name: m.name, username: m.username, avatar: m.avatar } });
});

app.post('/api/member/logout', (req, res) => {
  const token = req.cookies && req.cookies.member_session;
  if (token) memberSessions.delete(token); saveSessions();
  res.setHeader('Set-Cookie', 'member_session=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/member/me', (req, res) => {
  const m = getMember(req);
  if (!m) return res.json({ member: null });
  res.json({ member: { id: m.id, name: m.name, username: m.username, avatar: m.avatar, email: m.email, createdAt: m.createdAt } });
});

app.get('/api/member/profile/:username', (req, res) => {
  const data = loadMembers();
  const m = data.members.find(x => x.username === String(req.params.username).toLowerCase());
  if (!m) return res.status(404).json({ error: 'Member tidak ditemukan' });
  const wall = loadIdeaWall();
  const myIdeas = wall.ideas.filter(i => i.memberId === m.id);
  const totalLikes = myIdeas.reduce((s, i) => s + (i.likes || 0), 0);
  const totalComments = myIdeas.reduce((s, i) => s + ((i.comments || []).length), 0);
  res.json({
    member: { id: m.id, name: m.name, username: m.username, avatar: m.avatar, createdAt: m.createdAt },
    ideas: myIdeas,
    stats: { ideas: myIdeas.length, likes: totalLikes, comments: totalComments },
  });
});

// Profil member yang sedang login — 1 request (hemat round-trip di HP)
app.get('/api/me/profile', (req, res) => {
  const m = getMember(req);
  if (!m) return res.status(401).json({ error: 'Belum login' });
  const wall = loadIdeaWall();
  const myIdeas = wall.ideas.filter(i => i.memberId === m.id);
  const totalLikes = myIdeas.reduce((s, i) => s + (i.likes || 0), 0);
  const totalComments = myIdeas.reduce((s, i) => s + ((i.comments || []).length), 0);
  res.json({
    member: { id: m.id, name: m.name, username: m.username, avatar: m.avatar, createdAt: m.createdAt },
    ideas: myIdeas,
    stats: { ideas: myIdeas.length, likes: totalLikes, comments: totalComments },
  });
});

// Leaderboard — rank contributors by points (likes + ideas*5 + comments*2)
app.get('/api/leaderboard', (req, res) => {
  const wall = loadIdeaWall();
  const members = loadMembers().members;
  const period = req.query.period === 'day' || req.query.period === 'week' ? req.query.period
    : (req.query.period === 'month' ? 'month' : 'all');
  const DAY = 86400000;
  const cutoff = period === 'day' ? Date.now() - DAY
    : period === 'week' ? Date.now() - 7 * DAY
    : period === 'month' ? Date.now() - 30 * DAY
    : 0;
  const scoped = cutoff ? wall.ideas.filter(i => (i.ts || 0) >= cutoff) : wall.ideas;
  const byKey = {};
  for (const idea of scoped) {
    const key = idea.memberId || ('name:' + (idea.name || 'Anonim'));
    if (!byKey[key]) {
      const m = idea.memberId ? members.find(x => x.id === idea.memberId) : null;
      byKey[key] = {
        memberId: idea.memberId || null,
        username: (m && m.username) || idea.memberUsername || null,
        name: (m && m.name) || idea.name || 'Anonim',
        avatar: (m && m.avatar) || idea.memberAvatar || null,
        ideas: 0, likes: 0, comments: 0,
      };
    }
    const e = byKey[key];
    e.ideas += 1;
    e.likes += (idea.likes || 0);
    e.comments += (idea.comments || []).length;
  }
  const rows = Object.values(byKey)
    .map(e => ({ ...e, points: e.likes + e.ideas * 5 + e.comments * 2 }))
    .sort((a, b) => b.points - a.points || b.likes - a.likes)
    .map((e, i) => ({ ...e, rank: i + 1 }));
  res.json({ rows });
});

// ------------------------------------------------------------
//  Idea Wall API
// ------------------------------------------------------------
app.get('/api/ideas', (_req, res) => {
  res.set('Content-Type', 'application/json; charset=utf-8').send(ideasJsonString());
});

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const id = Date.now() + Math.random();
  sseClients.set(id, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* ignore */ } }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(id); });
});

app.post('/api/idea', (req, res) => {
  const wall = loadIdeaWall();
  const { text, photo, name, category } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Teks ide wajib diisi' });
  const cat = category === 'sports_day' ? 'sports_day' : 'ide_perbaikan';
  const member = getMember(req);
  let photoUrl = '';
  if (photo && typeof photo === 'string' && photo.startsWith('data:image')) {
    try {
      const m = photo.match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) {
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length <= MAX_PHOTO_BYTES) {
          const fname = 'idea_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
          fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
          photoUrl = '/uploads/' + fname;
        }
      }
    } catch (e) { /* ignore bad image */ }
  }
  const idea = {
    id: wall.nextId++,
    name: member ? member.name : (name ? String(name).slice(0, 60) : 'Anonim'),
    memberId: member ? member.id : null,
    memberUsername: member ? member.username : null,
    memberAvatar: member ? member.avatar : '',
    text: String(text).slice(0, 500),
    category: cat,
    status: 'pending',
    pic: '',
    due: '',
    progress: [],
    impact: '',
    saveMoney: 0,
    saveHours: 0,
    likes: 0,
    photo: photoUrl,
    comments: [],
    ts: Date.now(),
  };
  wall.ideas.unshift(idea);
  saveIdeaWall();
  broadcast('idea', idea);
  res.json({ ok: true, idea });
});

app.post('/api/idea/:id/like', (req, res) => {
  const wall = loadIdeaWall();
  const idea = wall.ideas.find(i => i.id === parseInt(req.params.id, 10));
  if (!idea) return res.status(404).json({ error: 'Ide tidak ditemukan' });

  // identitas peng-like: member id kalau login, atau cookie liker_id utk tamu
  const member = getMember(req);
  let likerId = member ? ('m:' + member.id) : (req.cookies && req.cookies.liker_id);
  if (!likerId) {
    likerId = 'g:' + crypto.randomBytes(8).toString('hex');
    res.setHeader('Set-Cookie', `liker_id=${likerId}; Path=/; Max-Age=${365 * 24 * 60 * 60}; HttpOnly; SameSite=Lax`);
  }

  if (!Array.isArray(idea.likedBy)) idea.likedBy = [];
  const already = idea.likedBy.includes(likerId);
  const wantLike = !(req.body && req.body.delta === -1);

  if (wantLike && !already) { idea.likedBy.push(likerId); }
  else if (!wantLike && already) { idea.likedBy = idea.likedBy.filter(x => x !== likerId); }
  // kalau sudah sesuai state (like lagi padahal udah like) → no-op, nggak nambah

  idea.likes = idea.likedBy.length;
  saveIdeaWall();
  broadcast('like', { id: idea.id, likes: idea.likes });
  if (wantLike && !already && idea.memberId && (!member || member.id !== idea.memberId)) {
    pushNotif(idea.memberId, '❤️ ' + (member ? member.name : 'Seseorang') + ' menyukai idemu', '/');
  }
  res.json({ ok: true, likes: idea.likes, liked: idea.likedBy.includes(likerId) });
});

app.post('/api/idea/:id/comment', (req, res) => {
  const wall = loadIdeaWall();
  const idea = wall.ideas.find(i => i.id === parseInt(req.params.id, 10));
  if (!idea) return res.status(404).json({ error: 'Ide tidak ditemukan' });
  const { text, name } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Komentar kosong' });
  const member = getMember(req);
  const comment = {
    id: crypto.randomBytes(6).toString('hex'),
    name: member ? member.name : (name ? String(name).slice(0, 60) : 'Anonim'),
    memberId: member ? member.id : null,
    memberUsername: member ? member.username : null,
    memberAvatar: member ? member.avatar : '',
    text: String(text).slice(0, 300),
    ts: Date.now(),
  };
  if (!Array.isArray(idea.comments)) idea.comments = [];
  idea.comments.push(comment);
  saveIdeaWall();
  broadcast('comment', { id: idea.id, comment });
  if (idea.memberId && comment.memberId !== idea.memberId) {
    pushNotif(idea.memberId, '💬 ' + comment.name + ' komentar di idemu: "' + comment.text.slice(0, 60) + '"', '/');
  }
  res.json({ ok: true, comment });
});

app.put('/api/idea/:id/status', requireAdmin, (req, res) => {
  const wall = loadIdeaWall();
  const idea = wall.ideas.find(i => i.id === parseInt(req.params.id, 10));
  if (!idea) return res.status(404).json({ error: 'Ide tidak ditemukan' });
  const { status, impact } = req.body || {};
  if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Status invalid' });
  idea.status = status;
  if (status === 'done' && typeof impact === 'string') idea.impact = impact.slice(0, 300);
  saveIdeaWall();
  broadcast('status', { id: idea.id, status, impact: idea.impact || '' });
  const lbl = { pending: 'Pending', in_progress: 'Dikerjakan', done: 'Selesai' }[status] || status;
  pushNotif(idea.memberId, '📌 Idemu sekarang: ' + lbl + (status === 'done' && idea.impact ? ' — ' + idea.impact.slice(0, 60) : ''), '/profile');
  res.json({ ok: true });
});

// PIC + deadline (admin)
app.put('/api/idea/:id/assign', requireAdmin, (req, res) => {
  const wall = loadIdeaWall();
  const idea = wall.ideas.find(i => i.id === parseInt(req.params.id, 10));
  if (!idea) return res.status(404).json({ error: 'Ide tidak ditemukan' });
  const { pic, due } = req.body || {};
  if (typeof pic === 'string') idea.pic = pic.slice(0, 60);
  if (typeof due === 'string') idea.due = due.slice(0, 10); // YYYY-MM-DD
  saveIdeaWall();
  broadcast('assign', { id: idea.id, pic: idea.pic || '', due: idea.due || '' });
  if (idea.pic) pushNotif(idea.memberId, '👤 Idemu ditugaskan ke ' + idea.pic + (idea.due ? ' (deadline ' + idea.due + ')' : ''), '/profile');
  res.json({ ok: true, pic: idea.pic || '', due: idea.due || '' });
});

// Progress note resmi (admin)
app.post('/api/idea/:id/progress', requireAdmin, (req, res) => {
  const wall = loadIdeaWall();
  const idea = wall.ideas.find(i => i.id === parseInt(req.params.id, 10));
  if (!idea) return res.status(404).json({ error: 'Ide tidak ditemukan' });
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Update kosong' });
  if (!Array.isArray(idea.progress)) idea.progress = [];
  const note = { text: String(text).slice(0, 300), ts: Date.now() };
  idea.progress.push(note);
  saveIdeaWall();
  broadcast('progress', { id: idea.id, note });
  pushNotif(idea.memberId, '📣 Ada update progress di idemu: "' + note.text.slice(0, 60) + '"', '/profile');
  res.json({ ok: true, note });
});

app.delete('/api/idea/:id', requireAdmin, (req, res) => {
  const wall = loadIdeaWall();
  const id = parseInt(req.params.id, 10);
  const idx = wall.ideas.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Ide tidak ditemukan' });
  wall.ideas.splice(idx, 1);
  saveIdeaWall();
  broadcast('delete', { id });
  res.json({ ok: true });
});

// ------------------------------------------------------------
//  Notifications API (member)
// ------------------------------------------------------------
app.get('/api/notifications', (req, res) => {
  const m = getMember(req);
  if (!m) return res.json({ notifications: [], unread: 0 });
  const list = loadNotif()[m.id] || [];
  res.json({ notifications: list.slice(0, 30), unread: list.filter(x => !x.read).length });
});
app.post('/api/notifications/read', (req, res) => {
  const m = getMember(req);
  if (!m) return res.json({ ok: true });
  const n = loadNotif();
  (n[m.id] || []).forEach(x => { x.read = true; });
  saveNotif();
  res.json({ ok: true });
});

// ------------------------------------------------------------
//  Daftar karyawan (buat picker EOTM) — dari data/employees.json
// ------------------------------------------------------------
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
let employeesCache = null;
function loadEmployees() {
  if (employeesCache) return employeesCache;
  try {
    const d = JSON.parse(fs.readFileSync(EMPLOYEES_FILE, 'utf8'));
    employeesCache = Array.isArray(d) ? d : (Array.isArray(d.names) ? d.names : []);
  } catch (e) { employeesCache = []; }
  return employeesCache;
}
app.get('/api/employees', (_req, res) => res.json({ names: loadEmployees() }));

// ------------------------------------------------------------
//  Employee of the Month (EOTM) API
// ------------------------------------------------------------
app.get('/api/eotm', (req, res) => {
  res.json(eotmPublic(loadEotm(), getMember(req)));
});

app.post('/api/eotm/vote', (req, res) => {
  const member = getMember(req);
  if (!member) return res.status(401).json({ error: 'Login dulu buat ikut voting Employee of the Month' });
  const e = loadEotm();
  if (e.status !== 'open') return res.status(400).json({ error: 'Voting belum dibuka atau sudah ditutup' });
  const { name, value, reason } = req.body || {};
  const nm = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!nm) return res.status(400).json({ error: 'Isi nama karyawan yang kamu pilih' });
  if (!CORE_VALUES.includes(value)) return res.status(400).json({ error: 'Pilih satu core value' });
  if (normName(nm) === normName(member.name)) return res.status(400).json({ error: 'Nggak bisa vote diri sendiri 😄' });
  e.votes[member.id] = { name: nm, value, reason: String(reason || '').slice(0, 200), voter: member.name, ts: Date.now() };
  saveEotm();
  broadcast('eotm', { status: e.status, ts: Date.now() });
  const pub = eotmPublic(e, member);
  res.json({ ok: true, myVote: pub.myVote, tally: pub.tally, totalVotes: pub.totalVotes });
});

app.post('/api/admin/eotm/open', requireAdmin, (req, res) => {
  const e = loadEotm();
  const { round, title, mode, reset } = req.body || {};
  const newRound = round ? String(round).slice(0, 20) : e.round;
  if (reset || (newRound && newRound !== e.round)) { e.votes = {}; e.winner = null; }
  e.round = newRound;
  e.title = title ? String(title).slice(0, 40) : (e.title || monthLabel());
  e.mode = mode === 'per_value' ? 'per_value' : 'single';
  e.status = 'open';
  e.openedAt = Date.now();
  e.closedAt = null;
  saveEotm();
  broadcast('eotm', { status: e.status, ts: Date.now() });
  notifAllMembers('⭐ Voting Employee of the Month dibuka! Yuk pilih karyawan terbaik.', '/form');
  res.json({ ok: true });
});

app.post('/api/admin/eotm/close', requireAdmin, (req, res) => {
  const e = loadEotm();
  const { rows } = buildEotmTally(e);
  const total = Object.keys(e.votes || {}).length;
  if (e.mode === 'per_value') {
    const perValue = {};
    CORE_VALUES.forEach(k => {
      let best = null;
      rows.forEach(r => { const c = r.byValue[k] || 0; if (c > 0 && (!best || c > best.votes)) best = { name: r.name, votes: c }; });
      perValue[k] = best;
    });
    e.winner = { mode: 'per_value', perValue, total };
  } else {
    e.winner = rows.length ? { mode: 'single', name: rows[0].name, votes: rows[0].votes, byValue: rows[0].byValue, total } : null;
  }
  e.status = 'closed';
  e.closedAt = Date.now();
  if (e.winner) {
    if (!Array.isArray(e.history)) e.history = [];
    e.history.unshift({ round: e.round, title: e.title, winner: e.winner, ts: Date.now() });
    e.history = e.history.slice(0, 24);
  }
  saveEotm();
  broadcast('eotm', { status: e.status, ts: Date.now() });
  res.json({ ok: true, winner: e.winner });
});

app.post('/api/admin/eotm/reset', requireAdmin, (req, res) => {
  const e = loadEotm();
  e.votes = {}; e.winner = null; e.status = 'closed'; e.openedAt = null; e.closedAt = null;
  saveEotm();
  broadcast('eotm', { status: e.status, ts: Date.now() });
  res.json({ ok: true });
});

// ------------------------------------------------------------
//  Admin auth API (standalone)
// ------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Password salah' });
  const token = genToken();
  adminSessions.set(token, { ts: Date.now() }); saveSessions();
  res.setHeader('Set-Cookie', `admin_session=${token}; Path=/; Max-Age=${24 * 60 * 60}; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ admin: isAdmin(req) });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.cookies && req.cookies.admin_session;
  if (token) adminSessions.delete(token); saveSessions();
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ------------------------------------------------------------
//  Boot
// ------------------------------------------------------------
loadIdeaWall(); // seed on boot if missing
app.listen(PORT, () => {
  console.log(`Idea Wall running on http://localhost:${PORT}`);
});
