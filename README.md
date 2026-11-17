# Arcane Guilds

Multiplayer web board game (magic-academy theme, Splendor-style engine building) that runs on iPad (touch) and desktop (mouse/keyboard).

Game rules & roadmap: [`docs/arcane-guilds-design.md`](docs/arcane-guilds-design.md) (Thai).

> Status: framework done (rooms, lobby, reconnect, chat) with a sample Connect 4 game; Arcane Guilds rules in progress.
Node.js + Express + Socket.io, server-authoritative rules, no database.

## Features
- Rooms with 4-letter codes + shareable link (`/?room=ABCD`), native share sheet on iPad
- Lobby with host controls (start, kick, pick game), host hand-off if the host leaves
- Reconnect after refresh / network drop (seat kept via a per-player token)
- Hidden-information support (`view(state, seat)` per player)
- In-game chat, game-over card, rematch
- iPad: no double-tap zoom, safe-area aware, Add-to-Home-Screen (PWA manifest)
- Basic hardening: per-socket rate limit, input sanitising, 16 KB message cap, idle room cleanup

## Run locally
```bash
npm install
npm run dev          # http://localhost:3000
npm test
```
To test with an iPad on the same Wi-Fi, open `http://<your-PC-IP>:3000`.

## Deploy (Render, free)
1. Push this repo to GitHub.
2. render.com → **New → Blueprint** → pick the repo → **Apply**. `render.yaml` does the rest.
3. Open the `*.onrender.com` URL.

Free instances sleep after ~15 min without traffic; the first visit after that takes ~30–60 s to wake.
Rooms live in memory, so a redeploy/restart ends running games.

## Project layout
```
server/index.js        HTTP + Socket.io wiring
server/rooms.js        rooms, lobby, turns, reconnect (transport-free, unit-tested)
server/games/          game rules modules  ← see server/games/README.md
public/                client shell (index.html, app.js, style.css)
public/games/          per-game board renderers
test/                  unit + end-to-end socket tests
```
