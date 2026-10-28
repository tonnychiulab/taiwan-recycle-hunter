import {
	CONTAMINANT_CATALOG,
	LEGAL_LIMITS,
	RECYCLABLE_CATALOG,
	VIOLATION_CATALOG,
	createEmptyContaminantTallies,
	createEmptyRecyclableTallies,
	createEmptyViolationTallies,
	type HighlightReasonKind,
	type ItemId,
	type OrientationUsed,
	type PrepStep,
	type SessionId,
	type SubmitScorePayload,
	type VerifiedPickupClaim,
	type ViolationKind,
	type ViolationTallies,
	type ZoneId,
} from "../shared/contracts.ts";
import {
	createStreetLayout,
	resolvePrimaryZoneId,
	resolveZonesAtPoint,
} from "./street-map.ts";
import type {
	AlleyStopSubstate,
	CleanSortCompressState,
	CrosswalkSubstate,
	HydrantDwellSubstate,
	LocomotionState,
	ParkedCartLease,
	RunCommand,
	RunEvent,
	RunState,
	SignalSnapshot,
	StreetFixture,
	StreetLayout,
	StreetZone,
	TransitionResult,
	WorldItem,
	WorldPoint,
	ZoneLatch,
} from "./types.ts";

const SIGNAL_CYCLE_MS = 24_000;
const SIGNAL_WALK_GREEN_MS = 10_000;
const SIGNAL_FLASHING_END_MS = 14_000;
const SIGNAL_EW_OFFSET_MS = 12_000;

const TRIAD_COMPLETION_BONUS_POINTS = 120;
const STREAK_STEP_BONUS_POINTS = 15;
const STREAK_MAX_BONUS_POINTS = 120;
const CART_DEPOSIT_PER_ITEM_BONUS_POINTS = 25;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function isInBareRoadway(zonesAtPoint: readonly StreetZone[]): boolean {
	const hasRoadway = zonesAtPoint.some((z) => z.kind === "roadway_lane");
	if (!hasRoadway) {
		return false;
	}
	const hasOverlayOrWalkway = zonesAtPoint.some(
		(z) =>
			z.kind === "signalized_crosswalk" ||
			(z.kind === "curb_marking" && z.marking !== "yellow_box_junction") ||
			z.kind === "sidewalk" ||
			z.kind === "arcade_walkway" ||
			z.kind === "unsignalized_alley_lane" ||
			z.kind === "alley_stop_buffer" ||
			z.kind === "no_pedestrian_zone",
	);
	return !hasOverlayOrWalkway;
}

export function computeSignalAt(
	elapsedMs: number,
	axis: "ns" | "ew",
): SignalSnapshot {
	const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
	const offsetMs = axis === "ew" ? SIGNAL_EW_OFFSET_MS : 0;
	const cyclePosMs = (safeElapsedMs + offsetMs) % SIGNAL_CYCLE_MS;

	if (cyclePosMs < SIGNAL_WALK_GREEN_MS) {
		return {
			phase: "walk_green",
			phaseRemainingSeconds: (SIGNAL_WALK_GREEN_MS - cyclePosMs) / 1000,
		};
	}
	if (cyclePosMs < SIGNAL_FLASHING_END_MS) {
		return {
			phase: "flashing_green",
			phaseRemainingSeconds: (SIGNAL_FLASHING_END_MS - cyclePosMs) / 1000,
		};
	}
	return {
		phase: "stop_red",
		phaseRemainingSeconds: (SIGNAL_CYCLE_MS - cyclePosMs) / 1000,
	};
}

export function createRunState(params: {
	readonly sessionId: SessionId;
	readonly signature: string;
	readonly alias: string;
	readonly seed: number;
	readonly roundDurationMs: number;
	readonly layout?: StreetLayout;
}): RunState {
	const layout = params.layout ?? createStreetLayout(params.seed);
	const itemsById = new Map<ItemId, WorldItem>();
	for (const item of layout.initialItems) {
		itemsById.set(item.itemId, item);
	}

	return {
		sessionId: params.sessionId,
		signature: params.signature,
		alias: params.alias,
		seed: params.seed,
		roundDurationMs: params.roundDurationMs,
		status: "active",
		elapsedMs: 0,
		layout,
		locomotion: {
			kind: "pushing_cart",
			position: layout.spawnPoint,
			primaryZoneId: layout.spawnZoneId,
		},
		compliance: {
			crosswalk: { kind: "outside" },
			hydrant: { kind: "outside" },
			alleyStop: { kind: "unarmed" },
			jaywalkLatch: { kind: "clear" },
			forbiddenCurbLatch: { kind: "clear" },
			noPedestrianLatch: { kind: "clear" },
		},
		itemsById,
		score: 0,
		combo: {
			streak: 0,
			maxStreak: 0,
			stepsActive: { clean: false, sort: false, compress: false },
			triadsCompleted: 0,
		},
		recyclableTallies: createEmptyRecyclableTallies(),
		contaminantTallies: createEmptyContaminantTallies(),
		violationTallies: createEmptyViolationTallies(),
		pickupClaims: [],
	};
}

type CitationLedger = {
	score: number;
	violationTallies: ViolationTallies;
	readonly events: RunEvent[];
};

function citeViolation(
	ledger: CitationLedger,
	violationKind: ViolationKind,
	zoneId: ZoneId,
): void {
	const penaltyPoints = VIOLATION_CATALOG[violationKind].penaltyPoints;
	ledger.score = Math.max(0, ledger.score - penaltyPoints);
	ledger.violationTallies = {
		...ledger.violationTallies,
		[violationKind]: ledger.violationTallies[violationKind] + 1,
	};
	ledger.events.push({
		kind: "violation_cited",
		violationKind,
		zoneId,
		penaltyPoints,
	});
}

function findParkingZone(
	zonesAtPoint: readonly StreetZone[],
):
	| Extract<
			StreetZone,
			{
				readonly kind: "curb_marking";
			}
	  >
	| undefined {
	if (
		zonesAtPoint.some(
			(z) => z.kind === "hydrant_red_zone" || z.kind === "no_pedestrian_zone",
		)
	) {
		return undefined;
	}
	const unlimitedZone = zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "curb_marking" }> =>
			z.kind === "curb_marking" &&
			(z.marking === "white_parking_bay" || z.marking === "designated_arcade_spot"),
	);
	if (unlimitedZone) {
		return unlimitedZone;
	}
	return zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "curb_marking" }> =>
			z.kind === "curb_marking" && z.marking === "yellow_curb",
	);
}

function stepAdvanceFrame(
	state: RunState,
	command: Extract<RunCommand, { readonly kind: "advance_frame" }>,
): TransitionResult {
	const rawDt = Number.isFinite(command.dtMs) ? Math.max(0, command.dtMs) : 0;
	const remainingMs = Math.max(0, state.roundDurationMs - state.elapsedMs);
	const dt = Math.min(rawDt, remainingMs);
	const dtSec = dt / 1000;

	const vx = Number.isFinite(command.velocityMps.vx) ? command.velocityMps.vx : 0;
	const vy = Number.isFinite(command.velocityMps.vy) ? command.velocityMps.vy : 0;
	const speedMps = Math.hypot(vx, vy);

	const nextPosition: WorldPoint = {
		xMeters: clamp(
			state.locomotion.position.xMeters + vx * dtSec,
			0,
			state.layout.widthMeters,
		),
		yMeters: clamp(
			state.locomotion.position.yMeters + vy * dtSec,
			0,
			state.layout.depthMeters,
		),
	};

	const zonesAtPoint = resolveZonesAtPoint(state.layout, nextPosition);
	const primaryZoneId = resolvePrimaryZoneId(state.layout, nextPosition);

	const ledger: CitationLedger = {
		score: state.score,
		violationTallies: state.violationTallies,
		events: [],
	};

	const crosswalkZone = zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "signalized_crosswalk" }> =>
			z.kind === "signalized_crosswalk",
	);
	let nextCrosswalk: CrosswalkSubstate;
	if (!crosswalkZone) {
		nextCrosswalk = { kind: "outside" };
	} else if (
		(state.compliance.crosswalk.kind === "legal_green_pass" ||
			state.compliance.crosswalk.kind === "illegal_cited") &&
		state.compliance.crosswalk.zoneId === crosswalkZone.zoneId
	) {
		nextCrosswalk = state.compliance.crosswalk;
	} else {
		const axisPhase = command.signals[crosswalkZone.axis];
		if (axisPhase === "walk_green") {
			nextCrosswalk = { kind: "legal_green_pass", zoneId: crosswalkZone.zoneId };
		} else if (axisPhase === "flashing_green") {
			citeViolation(
				ledger,
				"crosswalk_entered_on_flashing_green",
				crosswalkZone.zoneId,
			);
			nextCrosswalk = {
				kind: "illegal_cited",
				zoneId: crosswalkZone.zoneId,
				enteredOn: "flashing_green",
			};
		} else {
			citeViolation(ledger, "crosswalk_entered_on_red", crosswalkZone.zoneId);
			nextCrosswalk = {
				kind: "illegal_cited",
				zoneId: crosswalkZone.zoneId,
				enteredOn: "stop_red",
			};
		}
	}

	const roadwayZone = zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "roadway_lane" }> =>
			z.kind === "roadway_lane",
	);
	let nextJaywalkLatch: ZoneLatch;
	if (!roadwayZone || !isInBareRoadway(zonesAtPoint)) {
		nextJaywalkLatch = { kind: "clear" };
	} else if (
		state.compliance.jaywalkLatch.kind === "latched" &&
		state.compliance.jaywalkLatch.zoneId === roadwayZone.zoneId
	) {
		nextJaywalkLatch = state.compliance.jaywalkLatch;
	} else {
		citeViolation(ledger, "jaywalking_outside_crosswalk", roadwayZone.zoneId);
		nextJaywalkLatch = { kind: "latched", zoneId: roadwayZone.zoneId };
	}

	const hydrantZone = zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "hydrant_red_zone" }> =>
			z.kind === "hydrant_red_zone",
	);
	let nextHydrant: HydrantDwellSubstate;
	if (!hydrantZone) {
		nextHydrant = { kind: "outside" };
	} else if (state.locomotion.kind === "pushing_cart") {
		if (
			state.compliance.hydrant.kind === "cart_cited" &&
			state.compliance.hydrant.zoneId === hydrantZone.zoneId
		) {
			nextHydrant = state.compliance.hydrant;
		} else {
			citeViolation(ledger, "hydrant_cart_intrusion", hydrantZone.zoneId);
			nextHydrant = { kind: "cart_cited", zoneId: hydrantZone.zoneId };
		}
	} else {
		const prevDwellMs =
			state.compliance.hydrant.kind === "on_foot_grace" &&
			state.compliance.hydrant.zoneId === hydrantZone.zoneId
				? state.compliance.hydrant.dwellMs
				: 0;
		const prevCited =
			state.compliance.hydrant.kind === "on_foot_grace" &&
			state.compliance.hydrant.zoneId === hydrantZone.zoneId
				? state.compliance.hydrant.cited
				: false;
		const nextDwellMs = prevDwellMs + dt;
		if (!prevCited && nextDwellMs > LEGAL_LIMITS.hydrantOnFootMaxMs) {
			citeViolation(ledger, "hydrant_on_foot_linger", hydrantZone.zoneId);
			nextHydrant = {
				kind: "on_foot_grace",
				zoneId: hydrantZone.zoneId,
				dwellMs: nextDwellMs,
				cited: true,
			};
		} else {
			nextHydrant = {
				kind: "on_foot_grace",
				zoneId: hydrantZone.zoneId,
				dwellMs: nextDwellMs,
				cited: prevCited,
			};
		}
	}

	let nextForbiddenCurbLatch: ZoneLatch;
	if (state.locomotion.kind === "pushing_cart") {
		const forbiddenCurb = zonesAtPoint.find(
			(z): z is Extract<StreetZone, { readonly kind: "curb_marking" }> =>
				z.kind === "curb_marking" &&
				(z.marking === "red_curb" || z.marking === "yellow_box_junction"),
		);
		if (!forbiddenCurb) {
			nextForbiddenCurbLatch = { kind: "clear" };
		} else if (
			state.compliance.forbiddenCurbLatch.kind === "latched" &&
			state.compliance.forbiddenCurbLatch.zoneId === forbiddenCurb.zoneId
		) {
			nextForbiddenCurbLatch = state.compliance.forbiddenCurbLatch;
		} else {
			const violationKind: ViolationKind =
				forbiddenCurb.marking === "red_curb"
					? "red_curb_cart_violation"
					: "yellow_box_cart_violation";
			citeViolation(ledger, violationKind, forbiddenCurb.zoneId);
			nextForbiddenCurbLatch = { kind: "latched", zoneId: forbiddenCurb.zoneId };
		}
	} else {
		nextForbiddenCurbLatch = { kind: "clear" };
	}

	let nextLocomotion: LocomotionState;
	if (state.locomotion.kind === "pushing_cart") {
		nextLocomotion = {
			kind: "pushing_cart",
			position: nextPosition,
			primaryZoneId,
		};
	} else {
		let nextLease: ParkedCartLease = state.locomotion.parkedCart.lease;
		if (nextLease.policy === "temporary_yellow") {
			const nextParkedDurationMs = nextLease.parkedDurationMs + dt;
			if (
				!nextLease.overstayCited &&
				nextParkedDurationMs > LEGAL_LIMITS.yellowCurbMaxParkMs
			) {
				citeViolation(
					ledger,
					"yellow_curb_parking_overstay",
					nextLease.zoneId,
				);
				nextLease = {
					...nextLease,
					parkedDurationMs: nextParkedDurationMs,
					overstayCited: true,
				};
			} else {
				nextLease = {
					...nextLease,
					parkedDurationMs: nextParkedDurationMs,
				};
			}
		}
		nextLocomotion = {
			...state.locomotion,
			position: nextPosition,
			primaryZoneId,
			parkedCart: {
				...state.locomotion.parkedCart,
				lease: nextLease,
			},
		};
	}

	const alleyLaneZone = zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "unsignalized_alley_lane" }> =>
			z.kind === "unsignalized_alley_lane",
	);
	const alleyBufferZone = zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "alley_stop_buffer" }> =>
			z.kind === "alley_stop_buffer",
	);
	let nextAlleyStop: AlleyStopSubstate;
	if (alleyLaneZone) {
		if (
			state.compliance.alleyStop.kind === "cleared" &&
			state.compliance.alleyStop.guardedAlleyZoneId === alleyLaneZone.zoneId
		) {
			nextAlleyStop = state.compliance.alleyStop;
		} else if (
			state.compliance.alleyStop.kind === "skipped_cited" &&
			state.compliance.alleyStop.alleyZoneId === alleyLaneZone.zoneId
		) {
			nextAlleyStop = state.compliance.alleyStop;
		} else {
			citeViolation(ledger, "stop_sign_check_skipped", alleyLaneZone.zoneId);
			nextAlleyStop = { kind: "skipped_cited", alleyZoneId: alleyLaneZone.zoneId };
		}
	} else if (alleyBufferZone) {
		if (
			state.compliance.alleyStop.kind === "cleared" &&
			state.compliance.alleyStop.guardedAlleyZoneId ===
				alleyBufferZone.guardedAlleyZoneId
		) {
			nextAlleyStop = state.compliance.alleyStop;
		} else {
			const prevPausedMs =
				state.compliance.alleyStop.kind === "pausing" &&
				state.compliance.alleyStop.bufferZoneId === alleyBufferZone.zoneId
					? state.compliance.alleyStop.pausedMs
					: 0;
			const nextPausedMs =
				speedMps <= LEGAL_LIMITS.stopSignStationarySpeedMps
					? prevPausedMs + dt
					: prevPausedMs;
			if (nextPausedMs >= LEGAL_LIMITS.alleyStopSignMinPauseMs) {
				nextAlleyStop = {
					kind: "cleared",
					guardedAlleyZoneId: alleyBufferZone.guardedAlleyZoneId,
				};
				ledger.events.push({
					kind: "stop_sign_cleared",
					guardedAlleyZoneId: alleyBufferZone.guardedAlleyZoneId,
				});
			} else {
				nextAlleyStop = {
					kind: "pausing",
					bufferZoneId: alleyBufferZone.zoneId,
					guardedAlleyZoneId: alleyBufferZone.guardedAlleyZoneId,
					pausedMs: nextPausedMs,
				};
			}
		}
	} else {
		nextAlleyStop = { kind: "unarmed" };
	}

	const noPedZone = zonesAtPoint.find(
		(z): z is Extract<StreetZone, { readonly kind: "no_pedestrian_zone" }> =>
			z.kind === "no_pedestrian_zone",
	);
	let nextNoPedestrianLatch: ZoneLatch;
	if (!noPedZone) {
		nextNoPedestrianLatch = { kind: "clear" };
	} else if (
		state.compliance.noPedestrianLatch.kind === "latched" &&
		state.compliance.noPedestrianLatch.zoneId === noPedZone.zoneId
	) {
		nextNoPedestrianLatch = state.compliance.noPedestrianLatch;
	} else {
		citeViolation(ledger, "entered_no_pedestrian_zone", noPedZone.zoneId);
		nextNoPedestrianLatch = { kind: "latched", zoneId: noPedZone.zoneId };
	}

	const nextElapsedMs = Math.min(state.roundDurationMs, state.elapsedMs + dt);
	const reachedEnd = nextElapsedMs >= state.roundDurationMs;
	if (reachedEnd) {
		ledger.events.push({ kind: "run_finished", finalScore: ledger.score });
	}

	return {
		state: {
			...state,
			status: reachedEnd ? "finished" : "active",
			elapsedMs: nextElapsedMs,
			locomotion: nextLocomotion,
			compliance: {
				crosswalk: nextCrosswalk,
				hydrant: nextHydrant,
				alleyStop: nextAlleyStop,
				jaywalkLatch: nextJaywalkLatch,
				forbiddenCurbLatch: nextForbiddenCurbLatch,
				noPedestrianLatch: nextNoPedestrianLatch,
			},
			score: ledger.score,
			violationTallies: ledger.violationTallies,
		},
		events: ledger.events,
	};
}

function stepToggleCart(state: RunState): TransitionResult {
	const zonesAtPoint = resolveZonesAtPoint(
		state.layout,
		state.locomotion.position,
	);

	if (state.locomotion.kind === "pushing_cart") {
		const parkingZone = findParkingZone(zonesAtPoint);
		if (!parkingZone) {
			return {
				state,
				events: [
					{
						kind: "cart_action_refused",
						reason: "must_park_on_white_bay_arcade_spot_or_yellow_curb",
					},
				],
			};
		}

		const lease: ParkedCartLease =
			parkingZone.marking === "white_parking_bay" ||
			parkingZone.marking === "designated_arcade_spot"
				? {
						policy: "unlimited",
						marking: parkingZone.marking,
						zoneId: parkingZone.zoneId,
				  }
				: {
						policy: "temporary_yellow",
						marking: "yellow_curb",
						zoneId: parkingZone.zoneId,
						parkedDurationMs: 0,
						overstayCited: false,
				  };

		const hydrantZone = zonesAtPoint.find(
			(z): z is Extract<StreetZone, { readonly kind: "hydrant_red_zone" }> =>
				z.kind === "hydrant_red_zone",
		);
		const nextHydrant: HydrantDwellSubstate = hydrantZone
			? {
					kind: "on_foot_grace",
					zoneId: hydrantZone.zoneId,
					dwellMs: 0,
					cited: false,
			  }
			: { kind: "outside" };

		return {
			state: {
				...state,
				locomotion: {
					kind: "on_foot",
					position: state.locomotion.position,
					primaryZoneId: state.locomotion.primaryZoneId,
					handCarried: [],
					parkedCart: {
						position: state.locomotion.position,
						lease,
					},
				},
				compliance: {
					...state.compliance,
					hydrant: nextHydrant,
					forbiddenCurbLatch: { kind: "clear" },
				},
			},
			events: [{ kind: "mode_switched", mode: "on_foot" }],
		};
	}

	const distToCart = Math.hypot(
		state.locomotion.position.xMeters -
			state.locomotion.parkedCart.position.xMeters,
		state.locomotion.position.yMeters -
			state.locomotion.parkedCart.position.yMeters,
	);
	if (distToCart > LEGAL_LIMITS.cartRejoinRadiusMeters) {
		return {
			state,
			events: [
				{
					kind: "cart_action_refused",
					reason: "too_far_to_retrieve_cart",
				},
			],
		};
	}

	const depositedCount = state.locomotion.handCarried.length;
	const bonusPoints = depositedCount * CART_DEPOSIT_PER_ITEM_BONUS_POINTS;
	const ledger: CitationLedger = {
		score: state.score + bonusPoints,
		violationTallies: state.violationTallies,
		events: [],
	};

	if (depositedCount > 0) {
		ledger.events.push({
			kind: "cart_deposited",
			depositedCount,
			bonusPoints,
		});
	}
	ledger.events.push({ kind: "mode_switched", mode: "pushing_cart" });

	const resumedPos = state.locomotion.parkedCart.position;
	const resumedPrimaryZoneId = resolvePrimaryZoneId(state.layout, resumedPos);
	const zonesAtCart = resolveZonesAtPoint(state.layout, resumedPos);

	const hydrantZone = zonesAtCart.find(
		(z): z is Extract<StreetZone, { readonly kind: "hydrant_red_zone" }> =>
			z.kind === "hydrant_red_zone",
	);
	let nextHydrant: HydrantDwellSubstate = { kind: "outside" };
	if (hydrantZone) {
		citeViolation(ledger, "hydrant_cart_intrusion", hydrantZone.zoneId);
		nextHydrant = { kind: "cart_cited", zoneId: hydrantZone.zoneId };
	}

	const forbiddenCurb = zonesAtCart.find(
		(z): z is Extract<StreetZone, { readonly kind: "curb_marking" }> =>
			z.kind === "curb_marking" &&
			(z.marking === "red_curb" || z.marking === "yellow_box_junction"),
	);
	let nextForbiddenCurbLatch: ZoneLatch = { kind: "clear" };
	if (forbiddenCurb) {
		const violationKind: ViolationKind =
			forbiddenCurb.marking === "red_curb"
				? "red_curb_cart_violation"
				: "yellow_box_cart_violation";
		citeViolation(ledger, violationKind, forbiddenCurb.zoneId);
		nextForbiddenCurbLatch = { kind: "latched", zoneId: forbiddenCurb.zoneId };
	}

	return {
		state: {
			...state,
			locomotion: {
				kind: "pushing_cart",
				position: resumedPos,
				primaryZoneId: resumedPrimaryZoneId,
			},
			compliance: {
				...state.compliance,
				hydrant: nextHydrant,
				forbiddenCurbLatch: nextForbiddenCurbLatch,
			},
			score: ledger.score,
			violationTallies: ledger.violationTallies,
		},
		events: ledger.events,
	};
}

function selectHighlightHint(params: {
	readonly state: RunState;
	readonly zonesAtPlayer: readonly StreetZone[];
	readonly triadCompletedNow: boolean;
	readonly nearFixture: StreetFixture | undefined;
}): HighlightReasonKind {
	if (params.triadCompletedNow) {
		return "clean_sort_compress_triad";
	}
	if (params.zonesAtPlayer.some((z) => z.kind === "hydrant_red_zone")) {
		return "hydrant_clutch_grab";
	}
	if (
		params.state.locomotion.kind === "on_foot" &&
		params.state.locomotion.parkedCart.lease.policy === "temporary_yellow" &&
		!params.state.locomotion.parkedCart.lease.overstayCited
	) {
		return "yellow_curb_pitstop";
	}
	if (
		params.state.compliance.alleyStop.kind === "cleared" ||
		params.zonesAtPlayer.some((z) => z.kind === "alley_stop_buffer") ||
		params.nearFixture?.kind === "stop_sign_post"
	) {
		return "stop_sign_textbook_cross";
	}
	if (params.nearFixture?.kind === "telecom_box") {
		return "telecom_box_jackpot";
	}
	return "green_crosswalk_combo";
}

function findNearestCollectableItem(
	state: RunState,
	position: WorldPoint,
): WorldItem | undefined {
	let nearest: WorldItem | undefined;
	let bestDist = Number.POSITIVE_INFINITY;

	for (const item of state.itemsById.values()) {
		if (item.collected) {
			continue;
		}
		const dist = Math.hypot(
			item.position.xMeters - position.xMeters,
			item.position.yMeters - position.yMeters,
		);
		if (dist > LEGAL_LIMITS.pickupRadiusMeters) {
			continue;
		}
		if (
			dist < bestDist ||
			(dist === bestDist && nearest && item.itemId < nearest.itemId)
		) {
			bestDist = dist;
			nearest = item;
		}
	}
	return nearest;
}

function stepInteractNearest(state: RunState): TransitionResult {
	const nearest = findNearestCollectableItem(state, state.locomotion.position);
	if (!nearest) {
		return { state, events: [] };
	}

	if (nearest.category === "contaminant") {
		const spec = CONTAMINANT_CATALOG[nearest.kind];
		const nextItemsById = new Map(state.itemsById);
		nextItemsById.set(nearest.itemId, { ...nearest, collected: true });
		const nextScore = Math.max(0, state.score - spec.penaltyPoints);

		return {
			state: {
				...state,
				itemsById: nextItemsById,
				score: nextScore,
				combo: {
					...state.combo,
					streak: 0,
				},
				contaminantTallies: {
					...state.contaminantTallies,
					[nearest.kind]: state.contaminantTallies[nearest.kind] + 1,
				},
			},
			events: [
				{
					kind: "contaminant_penalized",
					itemId: nearest.itemId,
					contaminantKind: nearest.kind,
					penaltyPoints: spec.penaltyPoints,
				},
			],
		};
	}

	const lastClaim = state.pickupClaims[state.pickupClaims.length - 1];
	if (
		lastClaim !== undefined &&
		Math.round(state.elapsedMs) - lastClaim.atElapsedMs <
			LEGAL_LIMITS.minPlausiblePickupIntervalMs
	) {
		return { state, events: [] };
	}

	const zonesAtPlayer = resolveZonesAtPoint(
		state.layout,
		state.locomotion.position,
	);
	const inForbiddenPickupArea =
		zonesAtPlayer.some((z) => z.kind === "no_pedestrian_zone") ||
		isInBareRoadway(zonesAtPlayer);

	const matchingLegalZone = inForbiddenPickupArea
		? undefined
		: zonesAtPlayer.find((z) => nearest.legalStandingZoneIds.includes(z.zoneId));

	if (!matchingLegalZone) {
		return {
			state,
			events: [
				{
					kind: "pickup_blocked_illegal_side",
					itemId: nearest.itemId,
				},
			],
		};
	}

	if (
		state.locomotion.kind === "on_foot" &&
		state.locomotion.handCarried.length >= LEGAL_LIMITS.handCarryMaxItems
	) {
		return {
			state,
			events: [
				{
					kind: "hand_bag_full",
					maxItems: LEGAL_LIMITS.handCarryMaxItems,
				},
			],
		};
	}

	const spec = RECYCLABLE_CATALOG[nearest.kind];
	const nextStreak = state.combo.streak + 1;
	const nextMaxStreak = Math.max(state.combo.maxStreak, nextStreak);
	const candidateSteps: Record<PrepStep, boolean> = {
		...state.combo.stepsActive,
		[spec.prepStep]: true,
	};
	const triadCompletedNow =
		candidateSteps.clean && candidateSteps.sort && candidateSteps.compress;
	const nextCombo: CleanSortCompressState = {
		streak: nextStreak,
		maxStreak: nextMaxStreak,
		stepsActive: triadCompletedNow
			? { clean: false, sort: false, compress: false }
			: candidateSteps,
		triadsCompleted: triadCompletedNow
			? state.combo.triadsCompleted + 1
			: state.combo.triadsCompleted,
	};

	const streakBonus = Math.min(
		(nextStreak - 1) * STREAK_STEP_BONUS_POINTS,
		STREAK_MAX_BONUS_POINTS,
	);
	const triadBonus = triadCompletedNow ? TRIAD_COMPLETION_BONUS_POINTS : 0;
	const pointsAwarded = spec.basePoints + streakBonus + triadBonus;

	const standingZoneId = nearest.legalStandingZoneIds.includes(
		state.locomotion.primaryZoneId,
	)
		? state.locomotion.primaryZoneId
		: matchingLegalZone.zoneId;

	const claim: VerifiedPickupClaim = {
		itemId: nearest.itemId,
		kind: nearest.kind,
		atElapsedMs: Math.max(0, Math.round(state.elapsedMs)),
		standingZoneId,
		awardedPoints: pointsAwarded,
	};

	const nextItemsById = new Map(state.itemsById);
	nextItemsById.set(nearest.itemId, { ...nearest, collected: true });

	const nextLocomotion: LocomotionState =
		state.locomotion.kind === "on_foot"
			? {
					...state.locomotion,
					handCarried: [
						...state.locomotion.handCarried,
						{ itemId: nearest.itemId, kind: nearest.kind },
					],
			  }
			: state.locomotion;

	const nearFixture = state.layout.fixtures.find(
		(f) => f.id === nearest.hiddenNearFixtureId,
	);
	const highlightHint = selectHighlightHint({
		state,
		zonesAtPlayer,
		triadCompletedNow,
		nearFixture,
	});

	return {
		state: {
			...state,
			locomotion: nextLocomotion,
			itemsById: nextItemsById,
			score: state.score + pointsAwarded,
			combo: nextCombo,
			recyclableTallies: {
				...state.recyclableTallies,
				[nearest.kind]: state.recyclableTallies[nearest.kind] + 1,
			},
			pickupClaims: [...state.pickupClaims, claim],
		},
		events: [
			{
				kind: "recyclable_collected",
				itemId: nearest.itemId,
				recyclableKind: nearest.kind,
				pointsAwarded,
				co2SavedGrams: spec.co2SavedGrams,
				streak: nextStreak,
				triadCompletedNow,
				hidingSpotZh: nearest.hidingSpotZh,
				highlightHint,
			},
		],
	};
}

export function stepRun(state: RunState, command: RunCommand): TransitionResult {
	if (state.status === "finished") {
		return { state, events: [] };
	}

	switch (command.kind) {
		case "advance_frame":
			return stepAdvanceFrame(state, command);
		case "toggle_cart":
			return stepToggleCart(state);
		case "interact_nearest":
			return stepInteractNearest(state);
		case "finish_now":
			return {
				state: {
					...state,
					status: "finished",
				},
				events: [{ kind: "run_finished", finalScore: state.score }],
			};
	}
}

export function toSubmitScorePayload(params: {
	readonly state: RunState;
	readonly alias?: string;
	readonly orientationUsed: OrientationUsed;
}): SubmitScorePayload {
	const pickupClaims = params.state.pickupClaims.slice(0, 200);
	const maxClaimMs = pickupClaims.reduce(
		(acc, claim) => Math.max(acc, claim.atElapsedMs),
		0,
	);
	const durationMs = clamp(
		Math.max(Math.round(params.state.elapsedMs), maxClaimMs),
		LEGAL_LIMITS.minPlausibleRunDurationMs,
		Math.min(120_000, params.state.roundDurationMs + 5_000),
	);

	const candidateAlias = (params.alias ?? params.state.alias).trim().slice(0, 16);
	const fallbackAlias = params.state.alias.trim().slice(0, 16);
	const validAlias =
		candidateAlias.length >= 2
			? candidateAlias
			: fallbackAlias.length >= 2
				? fallbackAlias
				: undefined;

	const basePayload = {
		sessionId: params.state.sessionId,
		signature: params.state.signature,
		durationMs,
		score: clamp(Math.round(params.state.score), 0, 60_000),
		recyclableTallies: params.state.recyclableTallies,
		contaminantTallies: params.state.contaminantTallies,
		violationTallies: params.state.violationTallies,
		triadsCompleted: clamp(params.state.combo.triadsCompleted, 0, 100),
		orientationUsed: params.orientationUsed,
		pickupClaims,
	};

	if (validAlias !== undefined) {
		return {
			...basePayload,
			alias: validAlias,
		};
	}
	return basePayload;
}
