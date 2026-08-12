// ============================================================
//  Idea Wall — one-off migration: JSON files  ->  SQLite
//  Safe: only READS the JSON files, never modifies them.
//  Run:  node migrate-to-sqlite.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA = path.join(__dirname, 'data');
const read = (f, fallback) => {
  const p = path.join(DATA, f);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
};

const ideas = read('ideas.json', { ideas: [], nextId: 1 });
const members = read('members.json', { members: [] });
const notif = read('notifications.json', {});
const scores = read('ai-scores.json', { scores: {}, scoredAt: null });
const game = read('gamescores.json', { entries: {}, plays: 0 });
const eotm = read('eotm.json', null);
const sessions = read('sessions.json', { member: [], admin: [] });
const employees = read('employees.json', null);

db.writeIdeaWall(ideas);
db.writeMembers(members);
db.writeNotif(notif);
db.writeAiScores(scores);
db.writeGame(game);
if (eotm) db.writeDoc('eotm', eotm);
db.writeDoc('sessions', sessions);
if (employees) db.writeDoc('employees', employees);

// ---- verify round-trip ----------------------------------------------
const back = db.readIdeaWall();
const backM = db.readMembers();
const backN = db.readNotif();
const backS = db.readAiScores();
const backG = db.readGame();

const cmp = (label, a, b) => {
  const ok = a === b;
  console.log(`${ok ? '✅' : '❌'} ${label}: JSON ${a} -> SQLite ${b}`);
  return ok;
};

let ok = true;
ok &= cmp('ideas', (ideas.ideas || []).length, back.ideas.length);
ok &= cmp('nextId', ideas.nextId, back.nextId);
ok &= cmp('members', (members.members || []).length, backM.members.length);
ok &= cmp('notif (member)', Object.keys(notif).length, Object.keys(backN).length);
ok &= cmp('ai-scores', Object.keys(scores.scores || {}).length, Object.keys(backS.scores).length);
ok &= cmp('game entries', Object.keys(game.entries || {}).length, Object.keys(backG.entries).length);

// deep check: totals that must survive exactly
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
ok &= cmp('total likes', sum(ideas.ideas || [], i => i.likes || 0), sum(back.ideas, i => i.likes || 0));
ok &= cmp('total comments', sum(ideas.ideas || [], i => (i.comments || []).length), sum(back.ideas, i => (i.comments || []).length));
ok &= cmp('total likedBy', sum(ideas.ideas || [], i => (i.likedBy || []).length), sum(back.ideas, i => (i.likedBy || []).length));
ok &= cmp('ide dgn foto', (ideas.ideas || []).filter(i => i.photo).length, back.ideas.filter(i => i.photo).length);
ok &= cmp('EOTM votes', Object.keys((eotm && eotm.votes) || {}).length, Object.keys((db.readDoc('eotm', {}) || {}).votes || {}).length);

console.log(ok ? '\n🎉 MIGRASI SUKSES — semua data cocok' : '\n⚠️ ADA SELISIH — jangan pakai SQLite dulu');
process.exit(ok ? 0 : 1);
