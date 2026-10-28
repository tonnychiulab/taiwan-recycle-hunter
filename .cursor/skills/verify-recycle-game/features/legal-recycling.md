# Feature: Legal Recycling & Taiwan Street Compliance

## Invariants

1. **Recyclable vs. Trash**:
   - Navigating to an uncollected `recyclable` item on a legal standing zone and dispatching `interact_nearest` increments `recyclableTallies[kind]`, increases `score`, and appends a `VerifiedPickupClaim`.
   - Interacting with a `contaminant` (greasy lunchbox, used tissue, cigarette butt, soiled plastic bag) increments `contaminantTallies[kind]`, deducts penalty points, resets combo `streak` to `0`, and never increments `recyclableTallies`.
2. **Taiwan Traffic & Fixture Law**:
   - Pushing the recycling cart into a `hydrant_red_zone` (within 5m of a fire hydrant) or onto `red_curb` cites `hydrant_cart_intrusion` or `red_curb_cart_violation` once per entry latch.
   - Parking the cart on a `white_parking_bay`, `designated_arcade_spot`, or `yellow_curb` switches `locomotion.kind` to `"on_foot"`, enabling legal quick retrieval near fire hydrants (`< 3s`).
   - Entering a `signalized_crosswalk` during `stop_red` cites `crosswalk_entered_on_red`.
