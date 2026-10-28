---
name: verify-recycle-game
description: Project-local end-to-end verification skill for 《巷弄尋寶：台灣資收達人》 (taiwan-recycle-hunter). Drives live Cloudflare Worker + local D1 + Phaser 3 client across iOS Safari (WebKit) and Android Chrome (Chromium) in both Portrait and Landscape viewports.
---

# Verify Taiwan Recycle Hunter (`verify-recycle-game`)

Run this skill whenever game logic, viewport math, rendering, Polaroid compositing, or Cloudflare Worker/D1 endpoints change. Never claim a feature works from typecheck or unit tests alone.

## Quick Run (Single-Command Lever)

```bash
npm run build && npm run db:migrate:local && npm run verify:e2e
```

`scripts/verify-e2e.mjs` boots a live `wrangler dev --local --port 8788` instance backed by local Cloudflare D1 SQLite, launches both Playwright **WebKit** (iOS Safari engine) and **Chromium** (Android Chrome engine), executes all feature scenarios below, asserts zero console/page errors, checks frame-time performance budgets, and writes screenshot receipts.

## Browser & Orientation Matrix

| Lane | Engine | Portrait Viewport | Landscape Viewport | Target Platform |
| :--- | :--- | :--- | :--- | :--- |
| `ios-webkit` | Playwright WebKit | `390x844` (iPhone 14) | `844x390` | iOS Safari |
| `android-chromium` | Playwright Chromium | `412x915` (Pixel 7) | `915x412` | Android Chrome |

## Feature Specs

Read the matching feature file before modifying or debugging a subsystem:

- [features/README.md](features/README.md): Index of verification invariants and debug bridge surface (`window.__RECYCLE_GAME__`).
- [features/dual-orientation.md](features/dual-orientation.md): Live Portrait <-> Landscape rotation without reload or state loss, plus `OpenHuninn` webfont verification.
- [features/legal-recycling.md](features/legal-recycling.md): Recyclable vs. dirty trash discrimination, Taiwan street compliance citations, and CO₂ saved tallies.
- [features/polaroid-highlights.md](features/polaroid-highlights.md): Live WebGL/Canvas snapshot ring buffer and downloadable Taiwanese Polaroid PNG keepsake cards.
- [features/leaderboard.md](features/leaderboard.md): Anonymous session HMAC grant, anti-cheat plausibility verification, D1 persistence, and ranked leaderboard rendering.
