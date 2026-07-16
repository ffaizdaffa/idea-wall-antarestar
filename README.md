# 💡 Idea Wall Antarestar

An internal **social idea board** for teams — a friendlier, more engaging replacement for the classic suggestion box. Employees post improvement ideas (with photos), like and comment on each other's, climb a contributor leaderboard, vote for Employee of the Month, and watch it all scroll live on an office TV. It even ships with a built-in mini-game to keep engagement up.

Built by [Antarestar](https://antarestar.com) for its own team and open-sourced so any company can run its own idea wall.

Everything runs on **Node.js + Express** with **plain JSON files** for storage — no database, no build step, no front-end framework. Realtime updates use Server-Sent Events.

---

## ✨ Features

- **📱 Social feed** — mobile-first, Pinterest-style responsive masonry (1 column on phones → up to 4 on desktop). Post an idea with a photo, categorize it, like ❤️, and comment. Updates stream in **realtime** (SSE).
- **🔐 Auth** — username/password accounts **plus optional Google Sign-In (OAuth)**. Cookie sessions that survive server restarts. Anonymous browsing supported (configurable).
- **🏷️ Categories** — Improvement Ideas 💡, Sports Day 🏆, and Employee of the Month voting.
- **🏆 Leaderboard** — top contributors by points (all-time / month / week / day) with a podium.
- **⭐ Employee of the Month** — a full voting round system: admin opens a round, members vote (with one of five core values + reason), live results on the leaderboard and a dedicated **EOTM TV** view; single-winner or per-value mode; a Hall of Champions history.
- **🏅 Hall of Fame** — an "Already Implemented" page showcasing ideas that shipped.
- **📺 TV dashboard** — an auto-scrolling signage view for office screens, with live spotlights when new ideas arrive and investor-friendly KPI chips.
- **🎮 Kejar Antares** — a built-in cinematic flappy mini-game (HTML5 Canvas, day/night cycle, shared leaderboard).
- **⚙️ Admin panel** — three tabs: an **analytics dashboard** (categories, status, trends, word cloud, EOTM), **idea management** (status / delete / comment, filter + search), and **EOTM controls**.
- **🔔 In-app notifications** — bell with unread badge when someone likes/comments your idea or a round opens.

---

## 🚀 Quick start

```bash
git clone https://github.com/ffaizdaffa/idea-wall-antarestar.git
cd idea-wall-antarestar
npm install
cp .env.example .env      # then edit .env (at least set ADMIN_PASSWORD)
npm start
```

Open **http://localhost:3030**. The app creates empty data files on first run — no seeding needed.

- Register an account, post an idea, and it shows up in the feed instantly.
- Admin panel: **http://localhost:3030/admin** (password from your `.env`).

---

## 🔧 Configuration

All config is via environment variables (see [`.env.example`](.env.example)):

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | HTTP port (default `3030`) |
| `ADMIN_PASSWORD` | **yes** | Password for the `/admin` panel |
| `GOOGLE_CLIENT_ID` | no | Google OAuth client ID — leave blank to disable Google login |
| `GOOGLE_CLIENT_SECRET` | no | Google OAuth client secret |
| `GOOGLE_REDIRECT` | no | OAuth callback URL (e.g. `https://yourhost/auth/google/callback`) |

Username/password login always works; Google Sign-In only activates when the OAuth vars are set.

---

## 🗂️ Project structure

```
idea-wall-antarestar/
├── server.js              # the whole backend: routes, auth, SSE, ideas, EOTM, game API
├── package.json
├── .env.example
├── data/                  # JSON storage (created at runtime, gitignored)
│   └── *.example.json     # shape references for each data file
└── public/                # static front-end (one self-contained HTML per page)
    ├── index.html         # social feed
    ├── login.html         # login / register (+ Google)
    ├── form.html          # submit an idea (+ photo, categories)
    ├── profile.html       # member profile, stats, own ideas
    ├── leaderboard.html   # contributor + EOTM leaderboard
    ├── diterapkan.html    # "Already Implemented" hall of fame
    ├── admin.html         # admin dashboard / idea management / EOTM
    ├── tv.html            # office TV signage (auto-scroll, realtime)
    ├── eotm-tv.html       # Employee of the Month TV view
    ├── game.html          # Kejar Antares mini-game
    └── assets/            # shared css/js + logos
```

### Pages / routes

| Route | Page | Access |
|-------|------|--------|
| `/` | Social feed | Public |
| `/login` | Login / register (+ Google) | Public |
| `/form` | Submit idea | Public |
| `/profile` | Member profile | Public |
| `/leaderboard` | Contributor + EOTM leaderboard | Public |
| `/diterapkan` | Implemented-ideas hall of fame | Public |
| `/game` | Kejar Antares mini-game | Public |
| `/tv` | TV signage dashboard | Public |
| `/eotm-tv` | Employee of the Month TV | Public |
| `/admin` | Admin panel | Password |

---

## 💾 Data & storage

State lives in JSON files under `data/` (auto-created, gitignored so real data never lands in git):

- `ideas.json` — ideas + likes + comments + status + category
- `members.json` — accounts (SHA-256 password hash + salt, Google logins)
- `eotm.json` — Employee of the Month round, votes, winner, history
- `sessions.json` — persisted login sessions (so restarts don't log everyone out)
- `notifications.json` — per-member in-app notifications
- `gamescores.json` — mini-game leaderboard
- `employees.json` — optional employee name list for EOTM autocomplete

Example shapes are in `data/*.example.json`. For heavier traffic, swap the `load*/save*` helpers in `server.js` for a real database.

---

## ☁️ Deploy

It's a standard Node/Express app — run it anywhere Node runs:

- **VPS** — `npm install && npm start` behind nginx + PM2. Point a domain at it, add HTTPS (e.g. certbot). Make sure the process can write to `data/` and `public/uploads/`.
- **PaaS** (Render / Railway / Fly / a VPS panel) — set the env vars, run `node server.js`.

For Google login in production, add your deploy URL's `/auth/google/callback` as an authorized redirect URI in Google Cloud Console and set `GOOGLE_REDIRECT` to match.

---

## 🔒 Security notes

- No secrets are committed — auth/admin/OAuth values come from environment variables.
- Passwords are hashed (SHA-256 + per-user salt). For a public deployment consider upgrading to a slow hash (bcrypt/argon2).
- The admin panel is protected by a single shared password — fine for a small internal tool; add per-user roles if you need more.
- User-uploaded photos live in `public/uploads/` and are gitignored.

---

## 🤝 Contributing

Issues and PRs welcome. Keep the stack dependency-light (Express only) and the front-end framework-free.

## 📄 License

[MIT](LICENSE). Antarestar branding assets are excluded from the license grant — swap them for your own. See the note in the license file.
