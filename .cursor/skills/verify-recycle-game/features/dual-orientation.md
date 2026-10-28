# Feature: Dual Orientation & Traditional Chinese Typography

## Invariants

1. `document.fonts.check('18px "OpenHuninn"')` resolves `true` from local `/fonts/jf-openhuninn-2.1.ttf`.
2. Starting a round in Portrait (`390x844` on WebKit or `412x915` on Chromium) sets `getViewportMetrics().mode === "portrait"` and positions single-hand thumb controls inside the lower safe zone without overlapping the top HUD bar.
3. Resizing the active viewport mid-round to Landscape (`844x390` or `915x412`) without reloading:
   - Preserves `getRunState().sessionId`, `score`, `elapsedMs`, and `locomotion.position`.
   - Transitions `getViewportMetrics().mode` to `"landscape"`.
   - Updates `getOrientationUsed()` to `"both"`.
4. `getPerfMetrics().p95FrameMs` remains `<= 34` ms under headless software WebGL/Canvas rendering.
