# Feature Verification Index

All live browser lanes inspect both user-visible DOM (`#overlay-root`, `#phaser-root`) and the narrow read/command bridge on `window.__RECYCLE_GAME__`.

## Bridge Surface (`window.__RECYCLE_GAME__`)

- `getRunState()`: Returns current immutable `RunState` (`sessionId`, `score`, `elapsedMs`, `locomotion`, `recyclableTallies`, `contaminantTallies`, `violationTallies`, `pickupClaims`).
- `getViewportMetrics()`: Returns `DualOrientationTracker` layout (`mode`, `cameraZoom`, `joystickCenter`, `collectButtonCenter`, `cartButtonCenter`).
- `getOrientationUsed()`: Returns `"portrait" | "landscape" | "both"`.
- `getPerfMetrics()`: Returns `{ sampleCount, avgFrameMs, p95FrameMs }`.
- `dispatchDomainCommand(cmd)`: Feeds deterministic `RunCommand` inputs through the live `AlleyGameScene` update pipeline, triggering Phaser rendering, audio synth, floating banners, and `game.renderer.snapshot()` highlight captures.

## Feature Scenarios

1. [dual-orientation.md](dual-orientation.md)
2. [legal-recycling.md](legal-recycling.md)
3. [polaroid-highlights.md](polaroid-highlights.md)
4. [leaderboard.md](leaderboard.md)
