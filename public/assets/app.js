/* ============================================================
   ANTARESTAR IDEA WALL — shared client helpers
   esc / initials / formatTime / avatar / SSE / like dedup
   ============================================================ */
(function (g) {
  'use strict';

  const AV = [
    'linear-gradient(135deg,#FF6B2B,#FF9A4D)',
    'linear-gradient(135deg,#1A6BFF,#5C97FF)',
    'linear-gradient(135deg,#1FA85B,#5FD08C)',
    'linear-gradient(135deg,#E5484D,#FF7A7E)',
    'linear-gradient(135deg,#7C3AED,#A47BF0)',
    'linear-gradient(135deg,#0EA5A5,#5FD0C8)',
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avColor(seed) {
    let h = 0;
    const s = String(seed || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV[h % AV.length];
  }

  function formatTime(ts) {
    const now = Date.now();
    const diff = Math.max(0, now - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Baru saja';
    if (min < 60) return min + ' menit lalu';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' jam lalu';
    const day = Math.floor(hr / 24);
    if (day < 7) return day + ' hari lalu';
    const d = new Date(ts);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
  }

  function pad4(n) { return String(n).padStart(4, '0'); }

  /* like dedup via localStorage */
  function hasLiked(id) {
    try { return localStorage.getItem('liked_' + id) === '1'; } catch (e) { return false; }
  }
  function setLiked(id, v) {
    try {
      if (v) localStorage.setItem('liked_' + id, '1');
      else localStorage.removeItem('liked_' + id);
    } catch (e) { /* ignore */ }
  }

  /* avatar html */
  function avatarHTML(idea, size) {
    const s = size || 42;
    const style = `width:${s}px;height:${s}px;font-size:${Math.round(s * 0.36)}px;`;
    if (idea.memberAvatar) {
      return `<div class="avatar" style="${style}background-image:url('${esc(idea.memberAvatar)}')"></div>`;
    }
    return `<div class="avatar" style="${style}background:${avColor(idea.name || idea.memberUsername || idea.id)}">${esc(initials(idea.name))}</div>`;
  }

  /* SSE connect with reconnect */
  function connectStream(handlers) {
    let es;
    function open() {
      es = new EventSource('/api/stream');
      ['idea', 'delete', 'status', 'comment', 'like', 'assign', 'progress'].forEach(ev => {
        if (handlers[ev]) {
          es.addEventListener(ev, e => {
            try { handlers[ev](JSON.parse(e.data)); } catch (err) { /* ignore */ }
          });
        }
      });
      es.onerror = () => { try { es.close(); } catch (e) {} setTimeout(open, 4000); };
    }
    open();
    return () => { try { es.close(); } catch (e) {} };
  }

  /* toast */
  function toast(msg, isErr) {
    let el = document.getElementById('iw-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'iw-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  /* lightbox */
  function lightbox(src) {
    let lb = document.getElementById('iw-lightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'iw-lightbox';
      lb.className = 'lightbox';
      lb.innerHTML = '<img alt="">';
      lb.addEventListener('click', () => lb.classList.remove('show'));
      document.body.appendChild(lb);
    }
    lb.querySelector('img').src = src;
    lb.classList.add('show');
  }

  const STATUS = {
    pending: { label: 'Pending', cls: 'pending', icon: '⏳' },
    in_progress: { label: 'Dikerjakan', cls: 'in_progress', icon: '🔧' },
    done: { label: 'Selesai', cls: 'done', icon: '✅' },
  };

  /* official multicolor Google "G" mark */
  const GOOGLE_G = '<svg class="google-g" viewBox="0 0 48 48" aria-hidden="true">'
    + '<path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>'
    + '<path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>'
    + '<path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>'
    + '<path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>'
    + '</svg>';

  /* brand logo lockup (real Antarestar A-mark) */
  function brandLockup(opts) {
    const o = opts || {};
    const tile = o.tile || 34;
    const radius = o.radius || 9;
    const pad = o.pad != null ? o.pad : 3;
    const fs = o.fontSize || 17;
    return '<span class="logo-tile" style="width:' + tile + 'px;height:' + tile + 'px;border-radius:' + radius + 'px;padding:' + pad + 'px;">'
      + '<img src="/assets/antarestar-logo.jpg" alt="Antarestar"></span>'
      + '<span class="brand-word" style="font-size:' + fs + 'px;">Antarestar <span>Idea</span></span>';
  }

  /* attach a click-toggle overflow menu (returns the wrapper element) */
  function attachMenu(items) {
    const wrap = document.createElement('div');
    wrap.className = 'menu-wrap';
    const btn = document.createElement('button');
    btn.className = 'menu-btn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Menu'); btn.textContent = '⋯';
    const pop = document.createElement('div');
    pop.className = 'menu-pop';
    pop.innerHTML = items.map(function (it) {
      if (it.sep) return '<div class="sep"></div>';
      const cls = it.danger ? ' class="danger"' : '';
      if (it.action) return '<button type="button" data-act="' + it.action + '"' + cls + '><span class="em">' + it.icon + '</span>' + it.label + '</button>';
      return '<a href="' + it.href + '"' + cls + '><span class="em">' + it.icon + '</span>' + it.label + '</a>';
    }).join('');
    wrap.appendChild(btn); wrap.appendChild(pop);
    btn.addEventListener('click', function (e) { e.stopPropagation(); pop.classList.toggle('open'); });
    document.addEventListener('click', function () { pop.classList.remove('open'); });
    return wrap;
  }

  /* in-app notification bell — fetches own notifs, live via SSE, mark-read on open */
  function attachNotifBell() {
    const wrap = document.createElement('div');
    wrap.className = 'notif-wrap';
    wrap.style.display = 'none';
    wrap.innerHTML = '<button class="notif-btn" type="button" aria-label="Notifikasi">🔔<span class="notif-badge" style="display:none;">0</span></button>'
      + '<div class="notif-pop"><div class="notif-h">Notifikasi</div><div class="notif-list"><div class="notif-empty">Belum ada notifikasi.</div></div></div>';
    const btn = wrap.querySelector('.notif-btn');
    const badge = wrap.querySelector('.notif-badge');
    const pop = wrap.querySelector('.notif-pop');
    const listEl = wrap.querySelector('.notif-list');
    let myId = null, unread = 0;

    function setBadge(n) { unread = n; if (n > 0) { badge.style.display = ''; badge.textContent = n > 9 ? '9+' : n; } else badge.style.display = 'none'; }
    function itemHTML(x) { return '<a class="notif-item' + (x.read ? '' : ' unread') + '" href="' + esc(x.link || '/') + '">' + esc(x.text) + '<span class="notif-t">' + formatTime(x.ts) + '</span></a>'; }
    function renderList(arr) { listEl.innerHTML = (arr && arr.length) ? arr.map(itemHTML).join('') : '<div class="notif-empty">Belum ada notifikasi.</div>'; }
    function refresh() { fetch('/api/notifications').then(r => r.json()).then(n => { renderList(n.notifications || []); setBadge(n.unread || 0); }).catch(() => {}); }

    fetch('/api/member/me').then(r => r.json()).then(d => {
      if (!d.member) return; // tamu: lonceng disembunyikan
      myId = d.member.id; wrap.style.display = '';
      refresh();
      try {
        const es = new EventSource('/api/stream');
        es.addEventListener('notif', e => { try { const p = JSON.parse(e.data); if (p.to === myId || p.to === '*') refresh(); } catch (err) { /* ignore */ } });
      } catch (e) { /* ignore */ }
    }).catch(() => {});

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = pop.classList.toggle('open');
      if (open && unread > 0) { fetch('/api/notifications/read', { method: 'POST' }).catch(() => {}); setBadge(0); listEl.querySelectorAll('.notif-item.unread').forEach(x => x.classList.remove('unread')); }
    });
    document.addEventListener('click', () => pop.classList.remove('open'));
    return wrap;
  }

  /* badge/gamifikasi — dihitung dari aktivitas (derived) */
  function badges(o) {
    o = o || {};
    const b = [];
    if (o.wonEotm) b.push({ e: '👑', t: 'Juara EOTM' });
    if ((o.ideas || 0) >= 10) b.push({ e: '🚀', t: 'Produktif' });
    else if ((o.ideas || 0) >= 1) b.push({ e: '💡', t: 'Pencetus' });
    if ((o.likes || 0) >= 50) b.push({ e: '🔥', t: 'Disukai' });
    if ((o.comments || 0) >= 20) b.push({ e: '💬', t: 'Komentator' });
    if (o.hasDone) b.push({ e: '🏅', t: 'Ide Diterapkan' });
    return b;
  }
  function badgesHTML(o, mini) {
    const arr = badges(o);
    if (!arr.length) return '';
    return arr.map(x => '<span class="badge-chip' + (mini ? ' mini' : '') + '" title="' + esc(x.t) + '">' + x.e + (mini ? '' : ' ' + esc(x.t)) + '</span>').join('');
  }
  /* kumpulan nama pemenang EOTM (ternormalisasi) dari history → untuk badge Juara */
  function eotmWinnerSet(history) {
    const set = new Set();
    (history || []).forEach(h => {
      const w = h.winner; if (!w) return;
      if (w.mode === 'per_value' && w.perValue) { Object.values(w.perValue).forEach(x => { if (x && x.name) set.add(String(x.name).trim().toLowerCase()); }); }
      else if (w.name) set.add(String(w.name).trim().toLowerCase());
    });
    return set;
  }

  g.IW = {
    esc, initials, avColor, formatTime, pad4,
    hasLiked, setLiked, avatarHTML, connectStream, toast, lightbox, STATUS,
    GOOGLE_G, brandLockup, attachMenu, attachNotifBell, badges, badgesHTML, eotmWinnerSet,
  };
})(window);
