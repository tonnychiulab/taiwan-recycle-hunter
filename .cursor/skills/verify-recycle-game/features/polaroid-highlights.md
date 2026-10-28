# Feature: Auto-Captured Polaroid Highlight Keepsakes

## Invariants

1. Highlight-worthy gameplay events (`recyclable_collected`, `clean_sort_compress_triad`, `hydrant_clutch_grab`, `telecom_box_jackpot`) invoke `game.renderer.snapshot()` into a Top-3 excitement ring buffer with a `4000ms` cooldown.
2. When the round finishes (`status === "finished"`), `OverlayModals` renders `[data-testid="gameover-modal"]` containing `[data-testid="polaroid-gallery"]` with `1..3` `[data-testid="polaroid-image"]` elements.
3. Every `[data-testid="polaroid-image"]` has a `data:image/png;base64,...` source whose decoded PNG binary starts with the 8-byte PNG signature (`89 50 4E 47 0D 0A 1A 0A`) and decodes to natural dimensions `880x720`.
4. Every Polaroid card exposes `[data-testid="polaroid-download-btn"]` with a `.png` `download` filename so players can save keepsakes directly on Android and iOS.
