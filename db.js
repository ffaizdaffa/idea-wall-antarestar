// ============================================================
//  Idea Wall — SQLite storage layer (better-sqlite3)
//  Drop-in replacement for the JSON files: every read* returns
//  exactly the same shape the app used to read from disk, and
//  every write* persists it in a single atomic transaction.
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.IW_DB || path.join(DATA_DIR, 'idea-wall.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');   // concurrent readers, crash-safe writes
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY,
  name TEXT, member_id TEXT, member_username TEXT, member_avatar TEXT,
  text TEXT, category TEXT, status TEXT,
  pic TEXT, due TEXT, progress TEXT, impact TEXT,
  save_money TEXT, save_hours TEXT,
  likes INTEGER DEFAULT 0, photo TEXT, comments TEXT, ts INTEGER, liked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_ideas_ts ON ideas(ts);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, name TEXT, username TEXT, email TEXT, google_id TEXT,
  avatar TEXT, password_hash TEXT, salt TEXT, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_members_username ON members(username);

CREATE TABLE IF NOT EXISTS notifications (member_id TEXT PRIMARY KEY, items TEXT);

CREATE TABLE IF NOT EXISTS ai_scores (
  idea_id TEXT PRIMARY KEY,
  ib INTEGER, it INTEGER, ef INTEGER, co INTEGER, ri INTEGER,
  th TEXT, rs TEXT, edited INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_scores (
  key TEXT PRIMARY KEY, name TEXT, score INTEGER, ts INTEGER, member_id TEXT
);

CREATE TABLE IF NOT EXISTS kv (key TEXT, value TEXT, PRIMARY KEY (key));
`);

const J = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const S = (v) => JSON.stringify(v == null ? null : v);

// ---- kv helpers (eotm, sessions, employees, meta) --------------------
const kvGet = db.prepare('SELECT value FROM kv WHERE key = ?');
const kvSet = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
function getKV(key, fallback) { const r = kvGet.get(key); return r ? J(r.value, fallback) : fallback; }
function setKV(key, val) { kvSet.run(key, S(val)); }

// ---- ideas ----------------------------------------------------------
const selIdeas = db.prepare('SELECT * FROM ideas ORDER BY ts DESC');
const insIdea = db.prepare(`INSERT INTO ideas
  (id,name,member_id,member_username,member_avatar,text,category,status,pic,due,progress,impact,save_money,save_hours,likes,photo,comments,ts,liked_by)
  VALUES (@id,@name,@member_id,@member_username,@member_avatar,@text,@category,@status,@pic,@due,@progress,@impact,@save_money,@save_hours,@likes,@photo,@comments,@ts,@liked_by)`);
const delIdeas = db.prepare('DELETE FROM ideas');

function rowToIdea(r) {
  const o = {
    id: r.id, name: r.name, memberId: r.member_id, memberUsername: r.member_username,
    memberAvatar: r.member_avatar, text: r.text, category: r.category, status: r.status,
    pic: r.pic, due: r.due, progress: J(r.progress, []), impact: r.impact,
    likes: r.likes || 0, photo: r.photo, comments: J(r.comments, []), ts: r.ts,
    likedBy: J(r.liked_by, []),
  };
  if (r.save_money != null) o.saveMoney = J(r.save_money, r.save_money);
  if (r.save_hours != null) o.saveHours = J(r.save_hours, r.save_hours);
  return o;
}
function ideaToRow(i) {
  return {
    id: i.id, name: i.name || '', member_id: i.memberId || null,
    member_username: i.memberUsername || null, member_avatar: i.memberAvatar || '',
    text: i.text || '', category: i.category || 'ide_perbaikan', status: i.status || 'pending',
    pic: i.pic || '', due: i.due || '', progress: S(i.progress || []), impact: i.impact || '',
    save_money: i.saveMoney != null ? S(i.saveMoney) : null,
    save_hours: i.saveHours != null ? S(i.saveHours) : null,
    likes: i.likes || 0, photo: i.photo || '', comments: S(i.comments || []),
    ts: i.ts || Date.now(), liked_by: S(i.likedBy || []),
  };
}

const writeIdeasTx = db.transaction((ideas, nextId) => {
  delIdeas.run();
  for (const i of ideas) insIdea.run(ideaToRow(i));
  setKV('nextId', nextId);
});

function readIdeaWall() {
  return { ideas: selIdeas.all().map(rowToIdea), nextId: getKV('nextId', 1) };
}
function writeIdeaWall(data) {
  writeIdeasTx(data.ideas || [], data.nextId || 1);
}

// ---- members --------------------------------------------------------
const selMembers = db.prepare('SELECT * FROM members ORDER BY created_at ASC');
const insMember = db.prepare(`INSERT INTO members
  (id,name,username,email,google_id,avatar,password_hash,salt,created_at)
  VALUES (@id,@name,@username,@email,@google_id,@avatar,@password_hash,@salt,@created_at)`);
const delMembers = db.prepare('DELETE FROM members');

const writeMembersTx = db.transaction((list) => {
  delMembers.run();
  for (const m of list) insMember.run({
    id: m.id, name: m.name || '', username: m.username || '', email: m.email || '',
    google_id: m.googleId || null, avatar: m.avatar || '',
    password_hash: m.passwordHash || '', salt: m.salt || '', created_at: m.createdAt || Date.now(),
  });
});

function readMembers() {
  return {
    members: selMembers.all().map(r => ({
      id: r.id, name: r.name, username: r.username, email: r.email,
      googleId: r.google_id || undefined, avatar: r.avatar,
      passwordHash: r.password_hash, salt: r.salt, createdAt: r.created_at,
    })),
  };
}
function writeMembers(data) { writeMembersTx((data && data.members) || []); }

// ---- notifications --------------------------------------------------
const selNotif = db.prepare('SELECT * FROM notifications');
const insNotif = db.prepare('INSERT INTO notifications (member_id, items) VALUES (?, ?)');
const delNotif = db.prepare('DELETE FROM notifications');
const writeNotifTx = db.transaction((obj) => {
  delNotif.run();
  for (const k of Object.keys(obj)) insNotif.run(k, S(obj[k] || []));
});
function readNotif() {
  const out = {};
  for (const r of selNotif.all()) out[r.member_id] = J(r.items, []);
  return out;
}
function writeNotif(obj) { writeNotifTx(obj || {}); }

// ---- AI scores ------------------------------------------------------
const selScores = db.prepare('SELECT * FROM ai_scores');
const insScore = db.prepare(`INSERT INTO ai_scores (idea_id,ib,it,ef,co,ri,th,rs,edited)
  VALUES (@idea_id,@ib,@it,@ef,@co,@ri,@th,@rs,@edited)`);
const delScores = db.prepare('DELETE FROM ai_scores');
const writeScoresTx = db.transaction((scores, scoredAt) => {
  delScores.run();
  for (const id of Object.keys(scores)) {
    const s = scores[id];
    insScore.run({ idea_id: String(id), ib: s.ib, it: s.it, ef: s.ef, co: s.co, ri: s.ri,
      th: s.th || '', rs: s.rs || '', edited: s.edited ? 1 : 0 });
  }
  setKV('aiScoredAt', scoredAt || null);
});
function readAiScores() {
  const scores = {};
  for (const r of selScores.all()) {
    scores[r.idea_id] = { ib: r.ib, it: r.it, ef: r.ef, co: r.co, ri: r.ri, th: r.th, rs: r.rs };
    if (r.edited) scores[r.idea_id].edited = true;
  }
  return { scores, scoredAt: getKV('aiScoredAt', null) };
}
function writeAiScores(d) { writeScoresTx((d && d.scores) || {}, d && d.scoredAt); }

// ---- game scores ----------------------------------------------------
const selGame = db.prepare('SELECT * FROM game_scores');
const insGame = db.prepare('INSERT INTO game_scores (key,name,score,ts,member_id) VALUES (@key,@name,@score,@ts,@member_id)');
const delGame = db.prepare('DELETE FROM game_scores');
const writeGameTx = db.transaction((entries, plays) => {
  delGame.run();
  for (const k of Object.keys(entries)) {
    const e = entries[k];
    insGame.run({ key: k, name: e.name, score: e.score, ts: e.ts || Date.now(), member_id: e.memberId || null });
  }
  setKV('gamePlays', plays || 0);
});
function readGame() {
  const entries = {};
  for (const r of selGame.all()) entries[r.key] = { name: r.name, score: r.score, ts: r.ts, memberId: r.member_id };
  return { entries, plays: getKV('gamePlays', 0) };
}
function writeGame(d) { writeGameTx((d && d.entries) || {}, d && d.plays); }

// ---- simple documents (eotm, sessions, employees) --------------------
function readDoc(key, fallback) { return getKV(key, fallback); }
function writeDoc(key, val) { setKV(key, val); }

module.exports = {
  db, DB_FILE,
  readIdeaWall, writeIdeaWall,
  readMembers, writeMembers,
  readNotif, writeNotif,
  readAiScores, writeAiScores,
  readGame, writeGame,
  readDoc, writeDoc,
};
