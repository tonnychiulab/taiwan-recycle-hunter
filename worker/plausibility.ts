import { createStreetLayout } from "../src/domain/street-map.ts";
import {
	type ContaminantTallies,
	deriveCo2SavedGrams,
	deriveContaminantCount,
	deriveRecycledCount,
	deriveViolationCount,
	type ItemId,
	LEGAL_LIMITS,
	RECYCLABLE_CATALOG,
	type RecyclableKind,
	RecyclableKindSchema,
	type RecyclableTallies,
	type SubmitScorePayload,
	type ViolationTallies,
} from "../src/shared/contracts.ts";

export type PlausibilityRejectionCode =
	| "session_expired"
	| "invalid_duration"
	| "duplicate_pickup_item"
	| "invalid_pickup_claim"
	| "pickup_after_run_end"
	| "non_monotonic_pickup_timestamps"
	| "bot_pickup_cadence"
	| "tally_claim_mismatch"
	| "impossible_triad_count"
	| "score_exceeds_ceiling";

export type PlausibilityVerdict =
	| {
			readonly ok: true;
			readonly recycledCount: number;
			readonly co2SavedGrams: number;
			readonly complianceRate: number;
			readonly maxPlausibleScore: number;
	  }
	| {
			readonly ok: false;
			readonly code: PlausibilityRejectionCode;
			readonly reason: string;
	  };

const MAX_STREAK_STEP_BONUS = 15;
const MAX_STREAK_PER_ITEM_BONUS = 120;
const MAX_TRIAD_COMPLETION_BONUS = 120;
const MAX_CART_DEPOSIT_PER_ITEM_BONUS = 25;
const DURATION_GRACE_MS = 5_000;
const CLOCK_SKEW_TOLERANCE_MS = 5_000;

export function computeMaxPossibleTriads(tallies: RecyclableTallies): number {
	const cleanCount = tallies.tin_can + tallies.glass_bottle;
	const sortCount = tallies.waste_battery + tallies.old_electronics;
	const compressCount = tallies.pet_bottle + tallies.aluminum_can + tallies.clean_cardboard;
	return Math.min(cleanCount, sortCount, compressCount);
}

export function computeMaxPlausibleScore(params: {
	readonly recyclableTallies: RecyclableTallies;
	readonly contaminantTallies: ContaminantTallies;
	readonly violationTallies: ViolationTallies;
}): number {
	const { recyclableTallies } = params;

	let basePoints = 0;
	for (const kind of RecyclableKindSchema.options) {
		basePoints += recyclableTallies[kind] * RECYCLABLE_CATALOG[kind].basePoints;
	}

	const recycledCount = deriveRecycledCount(recyclableTallies);
	let streakBonusCeiling = 0;
	for (let i = 0; i < recycledCount; i++) {
		streakBonusCeiling += Math.min(i * MAX_STREAK_STEP_BONUS, MAX_STREAK_PER_ITEM_BONUS);
	}

	const maxTriads = computeMaxPossibleTriads(recyclableTallies);
	const triadBonusCeiling = maxTriads * MAX_TRIAD_COMPLETION_BONUS;

	const cartDepositBonusCeiling = recycledCount * MAX_CART_DEPOSIT_PER_ITEM_BONUS;

	return basePoints + streakBonusCeiling + triadBonusCeiling + cartDepositBonusCeiling;
}

export function computeComplianceRate(params: {
	readonly recycledCount: number;
	readonly violationCount: number;
	readonly contaminantCount: number;
}): number {
	const { recycledCount, violationCount, contaminantCount } = params;
	const nonCompliantCount = violationCount + contaminantCount;
	if (nonCompliantCount === 0) {
		return 100;
	}
	const denominator = recycledCount + nonCompliantCount;
	return Math.max(0, Math.min(100, Math.round((recycledCount / denominator) * 100)));
}

export function verifySubmissionPlausibility(params: {
	readonly payload: SubmitScorePayload;
	readonly sessionSeed?: number;
	readonly sessionIssuedAtMs: number;
	readonly roundDurationMs: number;
	readonly nowMs: number;
}): PlausibilityVerdict {
	const { payload, sessionSeed, sessionIssuedAtMs, roundDurationMs, nowMs } = params;

	const seededLayout =
		sessionSeed !== undefined ? createStreetLayout(sessionSeed) : undefined;
	const seededItemsById =
		seededLayout !== undefined
			? new Map(seededLayout.initialItems.map((it) => [it.itemId, it]))
			: undefined;

	const sessionAgeMs = nowMs - sessionIssuedAtMs;
	if (sessionAgeMs > LEGAL_LIMITS.sessionTtlMs || sessionAgeMs < -CLOCK_SKEW_TOLERANCE_MS) {
		return {
			ok: false,
			code: "session_expired",
			reason: "Session token has expired or has an invalid issue timestamp.",
		};
	}

	if (
		payload.durationMs < LEGAL_LIMITS.minPlausibleRunDurationMs ||
		payload.durationMs > roundDurationMs + DURATION_GRACE_MS
	) {
		return {
			ok: false,
			code: "invalid_duration",
			reason: "Run duration falls outside the legal round bounds.",
		};
	}

	const seenItemIds = new Set<ItemId>();
	const claimedCounts: Record<RecyclableKind, number> = {
		pet_bottle: 0,
		aluminum_can: 0,
		tin_can: 0,
		clean_cardboard: 0,
		glass_bottle: 0,
		waste_battery: 0,
		old_electronics: 0,
	};

	let previousElapsedMs: number | null = null;
	for (const claim of payload.pickupClaims) {
		if (seenItemIds.has(claim.itemId)) {
			return {
				ok: false,
				code: "duplicate_pickup_item",
				reason: `Duplicate pickup itemId detected: ${claim.itemId}.`,
			};
		}
		seenItemIds.add(claim.itemId);

		if (seededItemsById !== undefined) {
			const seededItem = seededItemsById.get(claim.itemId);
			if (
				!seededItem ||
				seededItem.category !== "recyclable" ||
				seededItem.kind !== claim.kind ||
				!seededItem.legalStandingZoneIds.includes(claim.standingZoneId)
			) {
				return {
					ok: false,
					code: "invalid_pickup_claim",
					reason: `Pickup claim ${claim.itemId} does not match seeded street layout.`,
				};
			}
		}

		if (claim.atElapsedMs > payload.durationMs) {
			return {
				ok: false,
				code: "pickup_after_run_end",
				reason: "Pickup timestamp exceeds reported run duration.",
			};
		}

		if (previousElapsedMs !== null) {
			if (claim.atElapsedMs < previousElapsedMs) {
				return {
					ok: false,
					code: "non_monotonic_pickup_timestamps",
					reason: "Pickup timestamps must be monotonically non-decreasing.",
				};
			}
			if (claim.atElapsedMs - previousElapsedMs < LEGAL_LIMITS.minPlausiblePickupIntervalMs) {
				return {
					ok: false,
					code: "bot_pickup_cadence",
					reason: "Consecutive pickups occurred faster than minimum human cadence.",
				};
			}
		}

		claimedCounts[claim.kind] += 1;
		previousElapsedMs = claim.atElapsedMs;
	}

	for (const kind of RecyclableKindSchema.options) {
		if (claimedCounts[kind] !== payload.recyclableTallies[kind]) {
			return {
				ok: false,
				code: "tally_claim_mismatch",
				reason: `Recyclable tally for ${kind} does not match verified pickup claims.`,
			};
		}
	}

	const maxPossibleTriads = computeMaxPossibleTriads(payload.recyclableTallies);
	if (payload.triadsCompleted > maxPossibleTriads) {
		return {
			ok: false,
			code: "impossible_triad_count",
			reason: "Reported Clean-Sort-Compress triads exceed physically possible combinations.",
		};
	}

	const maxPlausibleScore = computeMaxPlausibleScore({
		recyclableTallies: payload.recyclableTallies,
		contaminantTallies: payload.contaminantTallies,
		violationTallies: payload.violationTallies,
	});

	if (payload.score > maxPlausibleScore) {
		return {
			ok: false,
			code: "score_exceeds_ceiling",
			reason: `Score ${payload.score} exceeds maximum plausible ceiling ${maxPlausibleScore}.`,
		};
	}

	const recycledCount = deriveRecycledCount(payload.recyclableTallies);
	const co2SavedGrams = deriveCo2SavedGrams(payload.recyclableTallies);
	const contaminantCount = deriveContaminantCount(payload.contaminantTallies);
	const violationCount = deriveViolationCount(payload.violationTallies);
	const complianceRate = computeComplianceRate({
		recycledCount,
		violationCount,
		contaminantCount,
	});

	return {
		ok: true,
		recycledCount,
		co2SavedGrams,
		complianceRate,
		maxPlausibleScore,
	};
}
