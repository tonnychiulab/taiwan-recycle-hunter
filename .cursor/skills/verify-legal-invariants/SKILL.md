---
name: verify-legal-invariants
description: Formally verify Taiwan traffic compliance and recyclable-separation invariants across the pure domain state machine. Run whenever editing src/domain/legal-engine.ts, src/domain/street-map.ts, src/domain/types.ts, or src/shared/contracts.ts.
---

# Verify legal pickup and traffic invariants

This skill checks five safety and liveness properties of the domain state machine for Taiwan Recycle Hunter. It pairs a TLA+ specification in `verification/legal_pickup.tla` with a zero-dependency breadth-first state-space explorer in `scripts/verify-formal.ts` that runs both the abstract TLA+ transition graph and concrete `stepRun` calls against real `RunState` values.

## When a change touches covered code

Run this verification whenever a change modifies any of these files or symbols:

- `src/domain/legal-engine.ts`: `stepRun`, `createRunState`, `computeSignalAt`, `toSubmitScorePayload`
- `src/domain/street-map.ts`: `createStreetLayout`, `resolveZonesAtPoint`, `resolvePrimaryZoneId`
- `src/domain/types.ts`: `RunState`, `LocomotionState`, `LegalComplianceState`, `RunCommand`, `RunEvent`, `StreetZone`, `WorldItem`
- `src/shared/contracts.ts`: `LEGAL_LIMITS`, `RECYCLABLE_CATALOG`, `CONTAMINANT_CATALOG`, `VIOLATION_CATALOG`, `VerifiedPickupClaimSchema`

## Properties verified and user harm prevented

- **NoIllegalPickupRewarded.** Every rewarded recyclable pickup matches a `VerifiedPickupClaim` recorded while the player stands inside one of the item's `legalStandingZoneIds` outside `no_pedestrian_zone` and bare `roadway_lane`. If this breaks, players score leaderboard points by grabbing items from dangerous utility zones or active traffic lanes, or submit tallies that fail Worker plausibility checks.
- **NoCartInHydrantUnpenalized.** Every reachable active state with `locomotion.kind === "pushing_cart"` inside a 5-meter `hydrant_red_zone` sets `compliance.hydrant.kind === "cart_cited"` and increments `violationTallies.hydrant_cart_intrusion`. If this breaks, players push handcarts into fire hydrant clearance zones or retrieve parked carts across the 5-meter boundary without receiving the Road Traffic Safety Rules Article 111 citation.
- **NoRedLightCrosswalkUnpenalized.** Stepping into a `signalized_crosswalk` from outside while its axis signal is `stop_red` cites `crosswalk_entered_on_red`, whereas entering on `walk_green` latches `legal_green_pass` even if the signal switches to `flashing_green` mid-crossing. If this breaks, red-light crossings go unpenalized or lawful pedestrians get cited mid-crosswalk when the green man starts flashing.
- **NoTrashCountedAsRecyclable.** Collecting a `contaminant` item increments `contaminantTallies`, deducts penalty points clamped at zero, resets `combo.streak` to zero, and leaves `recyclableTallies` and `pickupClaims` unchanged. If this breaks, dirty general trash pollutes reusable resource counts and corrupts `tally_claim_mismatch` checks on the leaderboard API.
- **NoDeadlock.** Every reachable state admits at least one valid transition, and every active `RunState` transitions cleanly to `finished` on `finish_now` or round timer completion. If this breaks, a combination of zone latches or cart leases freezes the round and prevents game-over score submission.

## Run the check

Run one command from the repository root:

```bash
npm run verify:formal
```

This executes `node --experimental-strip-types scripts/verify-formal.ts` in under one second. It runs three checks in sequence:

1. Exhaustive breadth-first search over all 13,752 reachable states and 111,174 transitions of the abstract model defined in `verification/legal_pickup.tla` and `verification/legal_pickup.cfg`.
2. Four built-in fault-injection mutations that suppress red-light citations, count dirty trash as recyclables, reward illegal-side pickups in `no_pedestrian_zone`, and skip hydrant cart citations, confirming each invariant fails with a minimal counterexample trace.
3. Concrete `stepRun` breadth-first exploration up to depth 5 over a multi-zone layout plus seeded `createStreetLayout` map checks.

When inspecting TLA+ model runs or counterexample traces from `verification/legal_pickup.tla`, read every result with the pstack `/statechart` skill. On a violation, `/statechart` renders the shortest counterexample path in plain words. On a pass, `/statechart` draws how the state machine moves between locomotion modes, signal phases, and compliance latches.

## Scope and assumptions

- **Bounded model scope.** The abstract TLA+ model tracks 11 representative zone classes, saturated citation counters, one representative recyclable item, and one contaminant item. Concrete `stepRun` exploration runs up to command depth 5 across a compact 11-zone layout and checks static geometry invariants across four production seeds.
- **Not covered.** This check does not verify Phaser canvas rendering in `src/game/`, HMAC Web Crypto signatures in `worker/crypto.ts`, or D1 SQL queries in `worker/`.

## Triaging a failure

When `npm run verify:formal` exits with code 1, read the printed invariant name and minimal counterexample trace:

- **Real domain bug.** The concrete `stepRun` explorer prints a command sequence such as `move(hydrant_rejoin_edge) -> toggle_cart` where `stepRun` violated the stated law. Fix the transition logic in `src/domain/legal-engine.ts` or zone geometry in `src/domain/street-map.ts`. Do not weaken the invariant to make the script pass.
- **Mutation self-check failure.** A built-in mutation failed to trigger its invariant, which means the invariant predicate grew too weak or stopped reaching the guarded branch. Tighten `checkConcreteTransitionInvariants` or `generateCandidateActions` in `scripts/verify-formal.ts` until the mutation is caught again.
- **Intentional rule change.** Product requirements intentionally changed a traffic or recycling law. Update `src/domain/legal-engine.ts`, `verification/legal_pickup.tla`, and `scripts/verify-formal.ts` together so the model and implementation match, verify that breaking the new rule in `src/domain/legal-engine.ts` fails `npm run verify:formal`, restore the code, and advance the sync record below.

If covered files drifted across earlier commits without re-running this check, use `/maintain-formal-verification-skill` to reconcile the model and code.

## Coverage sync record

Last confirmed sync state at commit `23000d3` on `main`. Verify file digests with `shasum -a 256`, and advance the sync commit or digests only after `npm run verify:formal` passes on the updated code:

- `src/domain/legal-engine.ts`: `b89d3249ed2fff3b3fdc25138f0b11063de4ac2a0c82eb62ca605f8be27e64dd`
- `src/domain/street-map.ts`: `ac6ea53fd93a8df8889aac9a34085112b00255c365522ecd218cea67fb76a6fc`
- `src/domain/types.ts`: `aebd662bd7a6fb6f38261d28f8d73f090d0595fcbc4539e0620dc28cc75c46c4`
- `src/shared/contracts.ts`: `e51be08d1965ca583a1ad3d5fd440b833f6d211dbdbe0bec31061c585650d4b4`
