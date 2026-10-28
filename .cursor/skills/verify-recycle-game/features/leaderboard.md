# Feature: Anonymous Cloudflare D1 Leaderboard & Anti-Cheat

## Invariants

1. Clicking `[data-testid="start-game-btn"]` calls `POST /api/session/start` and receives a signed anonymous session (`sess_*`, Taiwanese street alias, deterministic seed, HMAC signature). Zero PII is requested or stored.
2. At game over, the client automatically submits the completed run (`elapsedMs >= 5000`) to `POST /api/leaderboard/submit`, and the user can customize their 2–16 char street alias via `[data-testid="alias-input"]` + `[data-testid="submit-score-btn"]`.
3. `[data-testid="leaderboard-table-holder"]` renders `.leaderboard-table` containing the player's alias, score, recycled count, compliance rate, and CO₂ saved grams, persisted across both the WebKit (iOS) and Chromium (Android) sessions in shared local D1.
4. Submitting a forged score (tampered points or invalid HMAC signature) directly to `POST /api/leaderboard/submit` returns HTTP `400`, `403`, or `422` and is rejected before D1 insertion.
