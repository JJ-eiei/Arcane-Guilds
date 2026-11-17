# Arcane Guilds

เกมบอร์ดออนไลน์แนวสร้างเครื่องยนต์ (engine-building) ธีมสำนักเวทมนตร์ เล่น 2–4 คน
ใช้ได้ทั้งบนไอแพด (แตะ) และคอมพิวเตอร์ (เมาส์/คีย์บอร์ด)

Multiplayer web board game — magic-academy theme, Splendor-style engine building with three
original mechanics (seals, secret prophecies, a contested dragon). Node.js + Express + Socket.io,
server-authoritative rules, no database.

- กฎเกมฉบับเต็ม: [`docs/arcane-guilds-design.md`](docs/arcane-guilds-design.md)
- ตารางการ์ดทั้งหมด: [`docs/cards.md`](docs/cards.md)
- รายงานสมดุลเกม (บอทเล่น 160,000+ เกม): [`docs/simulation-report.md`](docs/simulation-report.md)

## Features
- **Gameplay:** 90 original cards, 10 guardian spirits, 5 dragons, 11 secret prophecies; every rule
  enforced on the server (the browser can't cheat); per-player hidden information (prophecies,
  blind reserves, deck order never leave the server)
- **Balance:** tuned with heuristic bots + self-play hill-climbing across 160k simulated games
  (turn-order compensation, seal/dragon/prophecy values) — see the report
- **Multiplayer:** rooms with 4-letter codes + share link (`/?room=ABCD`), lobby, host hand-off,
  reconnect after refresh / network drop, in-game chat
- **iPad + desktop UI:** responsive board (landscape/portrait), tap-to-select crystals, action
  sheet with payment preview, colour-blind-safe crystal shapes, PWA (Add to Home Screen)
- **Hardening:** per-socket rate limit, input validation, 16 KB message cap, idle-room cleanup,
  security headers, no-cache for code so deploys show up immediately

## Run locally
```bash
npm install
npm run dev          # http://localhost:3000  (open 2 tabs to play against yourself)
npm test             # 33 tests: rules, rooms, end-to-end sockets
npm run cards        # regenerate docs/cards.md from the card data
npm run sim:quick    # quick balance check (~30 s); `npm run sim` for the full run
```
To play from an iPad on the same Wi-Fi: open `http://<your-PC-IP>:3000`.

## Deploy on Render (free)
1. Push this repo to GitHub.
2. https://render.com → **New +** → **Blueprint** → connect GitHub → choose this repo → **Apply**.
   `render.yaml` sets everything (Node 22, Singapore region, health check `/healthz`).
3. Wait for the build (~2 min) and open the `https://arcane-guilds-xxxx.onrender.com` URL.
4. Every `git push` to `main` redeploys automatically.

Notes for the free plan: the server sleeps after ~15 min without visitors (first visit then takes
~30–60 s), and rooms live in memory, so a redeploy/restart ends games in progress.

## Project layout
```
server/index.js              HTTP + Socket.io wiring, static files, /api/games/:id/data
server/rooms.js              rooms, lobby, turns, reconnect (transport-free, unit-tested)
server/games/arcane/         data.js (cards & tunable CONFIG) · engine.js (rules)
public/                      app shell (index.html, app.js, style.css)
public/games/arcane.{js,css} game board renderer
public/art/                  card/guardian/dragon art + manifest.json (missing art → generated emblem)
scripts/                     card report, bots & balance simulation
test/                        rules, rooms, end-to-end tests
```

## Adding art
Put a `.webp` named after the id (e.g. `public/art/cards/fi21.webp`, `public/art/guardians/g32.webp`,
`public/art/dragons/d1.webp`) and add the id to `public/art/manifest.json`. Ids are listed in
`docs/cards.md`.
