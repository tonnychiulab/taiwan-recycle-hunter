import process from "node:process";
import {
	deriveContaminantCount,
	deriveRecycledCount,
	parseItemId,
	parseSessionId,
	parseZoneId,
} from "../src/shared/contracts.ts";
import {
	computeSignalAt,
	createRunState,
	createStreetLayout,
	resolvePrimaryZoneId,
	resolveZonesAtPoint,
	stepRun,
	type PedestrianSignalPhase,
	type RunCommand,
	type RunState,
	type StreetLayout,
	type StreetZone,
	type TransitionResult,
	type WorldPoint,
} from "../src/domain/index.ts";

type InvariantName =
	| "NoIllegalPickupRewarded"
	| "NoCartInHydrantUnpenalized"
	| "NoRedLightCrosswalkUnpenalized"
	| "NoTrashCountedAsRecyclable"
	| "NoDeadlock";

type Counterexample = {
	readonly invariant: InvariantName;
	readonly detail: string;
	readonly trace: readonly string[];
};

type AbstractZone =
	| "sidewalk"
	| "arcade"
	| "parking_bay"
	| "yellow_curb"
	| "red_curb"
	| "crosswalk"
	| "roadway"
	| "hydrant"
	| "alley_buffer"
	| "alley_lane"
	| "no_ped";

type AbstractState = {
	readonly runStatus: "active" | "finished";
	readonly mode: "pushing_cart" | "on_foot";
	readonly zone: AbstractZone;
	readonly parkedZone: "none" | "parking_bay" | "yellow_curb";
	readonly yellowParkTicks: number;
	readonly yellowOverstayCited: boolean;
	readonly signal: PedestrianSignalPhase;
	readonly crosswalkLatch:
		| "outside"
		| "legal_green_pass"
		| "illegal_flashing"
		| "illegal_red";
	readonly hydrantLatch:
		| "outside"
		| "on_foot_grace"
		| "on_foot_cited"
		| "cart_cited";
	readonly hydrantDwellTicks: number;
	readonly alleyStop: "unarmed" | "pausing" | "cleared" | "skipped_cited";
	readonly recyclableCollected: boolean;
	readonly contaminantCollected: boolean;
	readonly recyclableTalliesCount: number;
	readonly contaminantTalliesCount: number;
	readonly claimsCount: number;
	readonly redLightCitations: number;
	readonly cartHydrantCitations: number;
	readonly lastRewardZone: AbstractZone | "none";
};

const ABSTRACT_ZONES: readonly AbstractZone[] = [
	"sidewalk",
	"arcade",
	"parking_bay",
	"yellow_curb",
	"red_curb",
	"crosswalk",
	"roadway",
	"hydrant",
	"alley_buffer",
	"alley_lane",
	"no_ped",
];

const LEGAL_STANDING_ZONES = new Set<AbstractZone>(["sidewalk", "arcade"]);
const PARKABLE_ZONES = new Set<AbstractZone>(["parking_bay", "yellow_curb"]);

function cap1(n: number): number {
	return n >= 1 ? 1 : 0;
}

function cap4(n: number): number {
	return n >= 4 ? 4 : n;
}

function serializeAbstractState(s: AbstractState): string {
	return [
		s.runStatus,
		s.mode,
		s.zone,
		s.parkedZone,
		s.yellowParkTicks,
		s.yellowOverstayCited ? 1 : 0,
		s.signal,
		s.crosswalkLatch,
		s.hydrantLatch,
		s.hydrantDwellTicks,
		s.alleyStop,
		s.recyclableCollected ? 1 : 0,
		s.contaminantCollected ? 1 : 0,
		s.recyclableTalliesCount,
		s.contaminantTalliesCount,
		s.claimsCount,
		s.redLightCitations,
		s.cartHydrantCitations,
		s.lastRewardZone,
	].join("|");
}

function initialAbstractState(): AbstractState {
	return {
		runStatus: "active",
		mode: "pushing_cart",
		zone: "sidewalk",
		parkedZone: "none",
		yellowParkTicks: 0,
		yellowOverstayCited: false,
		signal: "walk_green",
		crosswalkLatch: "outside",
		hydrantLatch: "outside",
		hydrantDwellTicks: 0,
		alleyStop: "unarmed",
		recyclableCollected: false,
		contaminantCollected: false,
		recyclableTalliesCount: 0,
		contaminantTalliesCount: 0,
		claimsCount: 0,
		redLightCitations: 0,
		cartHydrantCitations: 0,
		lastRewardZone: "none",
	};
}

function expandAbstractNext(
	s: AbstractState,
): readonly { readonly action: string; readonly next: AbstractState }[] {
	if (s.runStatus === "finished") {
		return [{ action: "FinishedIdempotentStep", next: s }];
	}

	const transitions: { readonly action: string; readonly next: AbstractState }[] = [];

	const nextSignal: PedestrianSignalPhase =
		s.signal === "walk_green"
			? "flashing_green"
			: s.signal === "flashing_green"
				? "stop_red"
				: "walk_green";
	transitions.push({
		action: `AdvanceSignal(${s.signal}->${nextSignal})`,
		next: { ...s, signal: nextSignal },
	});

	for (const nextZone of ABSTRACT_ZONES) {
		const stationaryChoices =
			nextZone === "alley_buffer" ? [false, true] : [false];
		for (const stationary of stationaryChoices) {
			const enteringCw = nextZone === "crosswalk" && s.crosswalkLatch === "outside";
			const stayingCw = nextZone === "crosswalk" && s.crosswalkLatch !== "outside";
			const crosswalkLatch: AbstractState["crosswalkLatch"] =
				nextZone !== "crosswalk"
					? "outside"
					: stayingCw
						? s.crosswalkLatch
						: s.signal === "walk_green"
							? "legal_green_pass"
							: s.signal === "flashing_green"
								? "illegal_flashing"
								: "illegal_red";
			const cwRedDelta = enteringCw && s.signal === "stop_red" ? 1 : 0;

			const hydrantDwellTicks =
				nextZone === "hydrant" && s.mode === "on_foot"
					? cap4(s.zone === "hydrant" ? s.hydrantDwellTicks + 1 : 1)
					: 0;
			const hydrantLatch: AbstractState["hydrantLatch"] =
				nextZone !== "hydrant"
					? "outside"
					: s.mode === "pushing_cart"
						? "cart_cited"
						: hydrantDwellTicks > 3 || s.hydrantLatch === "on_foot_cited"
							? "on_foot_cited"
							: "on_foot_grace";
			const hydrantCartDelta =
				nextZone === "hydrant" &&
				s.mode === "pushing_cart" &&
				s.hydrantLatch !== "cart_cited"
					? 1
					: 0;

			const alleyStop: AbstractState["alleyStop"] =
				nextZone === "alley_lane"
					? s.alleyStop === "cleared"
						? "cleared"
						: "skipped_cited"
					: nextZone === "alley_buffer"
						? s.alleyStop === "cleared" || stationary
							? "cleared"
							: "pausing"
						: "unarmed";

			const yellowParkTicks =
				s.mode === "on_foot" && s.parkedZone === "yellow_curb"
					? cap4(s.yellowParkTicks + 1)
					: s.yellowParkTicks;
			const yellowOverstayCited =
				s.mode === "on_foot" &&
				s.parkedZone === "yellow_curb" &&
				yellowParkTicks > 3
					? true
					: s.yellowOverstayCited;

			transitions.push({
				action: `MoveAndTick(${nextZone},stationary=${String(stationary)})`,
				next: {
					...s,
					zone: nextZone,
					crosswalkLatch,
					redLightCitations: cap1(s.redLightCitations + cwRedDelta),
					hydrantDwellTicks,
					hydrantLatch,
					cartHydrantCitations: cap1(s.cartHydrantCitations + hydrantCartDelta),
					alleyStop,
					yellowParkTicks,
					yellowOverstayCited,
				},
			});
		}
	}

	if (s.mode === "pushing_cart" && PARKABLE_ZONES.has(s.zone)) {
		const parkedZone = s.zone === "parking_bay" ? "parking_bay" : "yellow_curb";
		transitions.push({
			action: `ParkCart(${parkedZone})`,
			next: {
				...s,
				mode: "on_foot",
				parkedZone,
				yellowParkTicks: 0,
				yellowOverstayCited: false,
				hydrantLatch: "outside",
				hydrantDwellTicks: 0,
			},
		});
	}

	if (
		s.mode === "on_foot" &&
		(PARKABLE_ZONES.has(s.zone) || s.zone === "sidewalk" || s.zone === "hydrant")
	) {
		const inHydrant = s.zone === "hydrant";
		transitions.push({
			action: `RetrieveCart(at=${s.zone})`,
			next: {
				...s,
				mode: "pushing_cart",
				parkedZone: "none",
				yellowParkTicks: 0,
				yellowOverstayCited: false,
				hydrantDwellTicks: 0,
				hydrantLatch: inHydrant ? "cart_cited" : "outside",
				cartHydrantCitations: inHydrant
					? cap1(s.cartHydrantCitations + 1)
					: s.cartHydrantCitations,
			},
		});
	}

	if (!s.recyclableCollected) {
		if (LEGAL_STANDING_ZONES.has(s.zone)) {
			transitions.push({
				action: `InteractRecyclable(legal:${s.zone})`,
				next: {
					...s,
					recyclableCollected: true,
					recyclableTalliesCount: s.recyclableTalliesCount + 1,
					claimsCount: s.claimsCount + 1,
					lastRewardZone: s.zone,
				},
			});
		} else {
			transitions.push({
				action: `InteractRecyclable(blocked:${s.zone})`,
				next: s,
			});
		}
	}

	if (!s.contaminantCollected) {
		transitions.push({
			action: `InteractContaminant(at:${s.zone})`,
			next: {
				...s,
				contaminantCollected: true,
				contaminantTalliesCount: s.contaminantTalliesCount + 1,
			},
		});
	}

	transitions.push({
		action: "FinishRun",
		next: { ...s, runStatus: "finished" },
	});

	return transitions;
}

function checkAbstractInvariants(
	s: AbstractState,
	outgoingCount: number,
): { readonly invariant: InvariantName; readonly detail: string } | null {
	if (
		s.claimsCount !== s.recyclableTalliesCount ||
		(s.claimsCount > 0 &&
			(s.lastRewardZone === "none" || !LEGAL_STANDING_ZONES.has(s.lastRewardZone))) ||
		s.lastRewardZone === "no_ped" ||
		s.lastRewardZone === "roadway"
	) {
		return {
			invariant: "NoIllegalPickupRewarded",
			detail: `claims=${s.claimsCount}, tallies=${s.recyclableTalliesCount}, lastRewardZone=${s.lastRewardZone}`,
		};
	}

	if (
		s.mode === "pushing_cart" &&
		s.zone === "hydrant" &&
		(s.hydrantLatch !== "cart_cited" || s.cartHydrantCitations < 1)
	) {
		return {
			invariant: "NoCartInHydrantUnpenalized",
			detail: `mode=${s.mode}, zone=${s.zone}, hydrantLatch=${s.hydrantLatch}, citations=${s.cartHydrantCitations}`,
		};
	}

	if (
		(s.zone === "crosswalk" && s.crosswalkLatch === "outside") ||
		(s.crosswalkLatch === "illegal_red" && s.redLightCitations < 1) ||
		(s.zone === "crosswalk" &&
			s.signal === "stop_red" &&
			s.crosswalkLatch !== "legal_green_pass" &&
			s.crosswalkLatch !== "illegal_flashing" &&
			(s.crosswalkLatch !== "illegal_red" || s.redLightCitations < 1))
	) {
		return {
			invariant: "NoRedLightCrosswalkUnpenalized",
			detail: `zone=${s.zone}, signal=${s.signal}, crosswalkLatch=${s.crosswalkLatch}, redLightCitations=${s.redLightCitations}`,
		};
	}

	if (
		(s.contaminantCollected && s.contaminantTalliesCount < 1) ||
		(!s.recyclableCollected &&
			(s.recyclableTalliesCount !== 0 || s.claimsCount !== 0))
	) {
		return {
			invariant: "NoTrashCountedAsRecyclable",
			detail: `recCollected=${String(s.recyclableCollected)}, contCollected=${String(s.contaminantCollected)}, recTallies=${s.recyclableTalliesCount}, claims=${s.claimsCount}`,
		};
	}

	if (outgoingCount === 0) {
		return {
			invariant: "NoDeadlock",
			detail: `state ${serializeAbstractState(s)} has zero enabled transitions`,
		};
	}

	return null;
}

function exploreAbstractTlaModel(): {
	readonly visitedStates: number;
	readonly exploredEdges: number;
	readonly counterexample: Counterexample | null;
} {
	const init = initialAbstractState();
	const initKey = serializeAbstractState(init);
	const visited = new Set<string>([initKey]);
	const parentMap = new Map<
		string,
		{ readonly prevKey: string; readonly action: string }
	>();
	const queue: AbstractState[] = [init];
	let head = 0;
	let exploredEdges = 0;

	const reconstructTrace = (key: string): string[] => {
		const steps: string[] = [];
		let cursor = key;
		while (parentMap.has(cursor)) {
			const link = parentMap.get(cursor);
			if (!link) break;
			steps.push(link.action);
			cursor = link.prevKey;
		}
		steps.reverse();
		return steps;
	};

	while (head < queue.length) {
		const current = queue[head];
		head += 1;
		if (!current) continue;
		const currentKey = serializeAbstractState(current);
		const outgoing = expandAbstractNext(current);
		const violation = checkAbstractInvariants(current, outgoing.length);
		if (violation) {
			return {
				visitedStates: visited.size,
				exploredEdges,
				counterexample: {
					invariant: violation.invariant,
					detail: violation.detail,
					trace: reconstructTrace(currentKey),
				},
			};
		}

		for (const edge of outgoing) {
			exploredEdges += 1;
			const nextKey = serializeAbstractState(edge.next);
			if (!visited.has(nextKey)) {
				visited.add(nextKey);
				parentMap.set(nextKey, { prevKey: currentKey, action: edge.action });
				queue.push(edge.next);
			}
		}
	}

	return { visitedStates: visited.size, exploredEdges, counterexample: null };
}

function buildCompactVerificationLayout(): StreetLayout {
	const zSidewalk = parseZoneId("zone_vf_sidewalk");
	const zArcade = parseZoneId("zone_vf_arcade");
	const zArcadeSpot = parseZoneId("zone_vf_arcade_spot");
	const zBay = parseZoneId("zone_vf_white_bay");
	const zYellow = parseZoneId("zone_vf_yellow_curb");
	const zRed = parseZoneId("zone_vf_red_curb");
	const zRoad = parseZoneId("zone_vf_roadway");
	const zCrosswalk = parseZoneId("zone_vf_crosswalk");
	const zHydrant = parseZoneId("zone_vf_hydrant");
	const zNoPed = parseZoneId("zone_vf_no_ped");
	const zAlleyBuf = parseZoneId("zone_vf_alley_buf");
	const zAlleyLane = parseZoneId("zone_vf_alley_lane");

	const zones: readonly StreetZone[] = [
		{
			kind: "arcade_walkway",
			zoneId: zArcade,
			bounds: { minXMeters: 0, minYMeters: 0, widthMeters: 4, depthMeters: 16 },
		},
		{
			kind: "sidewalk",
			zoneId: zSidewalk,
			bounds: { minXMeters: 4, minYMeters: 0, widthMeters: 4, depthMeters: 12 },
		},
		{
			kind: "no_pedestrian_zone",
			zoneId: zNoPed,
			bounds: { minXMeters: 4, minYMeters: 12, widthMeters: 4, depthMeters: 4 },
		},
		{
			kind: "roadway_lane",
			zoneId: zRoad,
			bounds: { minXMeters: 8, minYMeters: 0, widthMeters: 8, depthMeters: 16 },
		},
		{
			kind: "curb_marking",
			zoneId: zArcadeSpot,
			bounds: { minXMeters: 4.6, minYMeters: 1, widthMeters: 1.6, depthMeters: 2 },
			marking: "designated_arcade_spot",
		},
		{
			kind: "curb_marking",
			zoneId: zBay,
			bounds: { minXMeters: 8, minYMeters: 0, widthMeters: 2, depthMeters: 3 },
			marking: "white_parking_bay",
		},
		{
			kind: "curb_marking",
			zoneId: zYellow,
			bounds: { minXMeters: 8, minYMeters: 3, widthMeters: 2, depthMeters: 3 },
			marking: "yellow_curb",
		},
		{
			kind: "curb_marking",
			zoneId: zRed,
			bounds: { minXMeters: 8, minYMeters: 6, widthMeters: 2, depthMeters: 2 },
			marking: "red_curb",
		},
		{
			kind: "signalized_crosswalk",
			zoneId: zCrosswalk,
			bounds: { minXMeters: 8, minYMeters: 8, widthMeters: 8, depthMeters: 3 },
			axis: "ew",
		},
		{
			kind: "hydrant_red_zone",
			zoneId: zHydrant,
			center: { xMeters: 2, yMeters: 2 },
			radiusMeters: 2.5,
		},
		{
			kind: "alley_stop_buffer",
			zoneId: zAlleyBuf,
			bounds: { minXMeters: 0, minYMeters: 16, widthMeters: 8, depthMeters: 2 },
			guardedAlleyZoneId: zAlleyLane,
		},
		{
			kind: "unsignalized_alley_lane",
			zoneId: zAlleyLane,
			bounds: { minXMeters: 0, minYMeters: 18, widthMeters: 8, depthMeters: 3 },
			requiredBufferZoneId: zAlleyBuf,
		},
	];

	const zonesById = new Map<ReturnType<typeof parseZoneId>, StreetZone>();
	for (const zone of zones) {
		zonesById.set(zone.zoneId, zone);
	}

	const spawnPoint: WorldPoint = { xMeters: 6, yMeters: 1.5 };

	return {
		widthMeters: 16,
		depthMeters: 22,
		spawnPoint,
		spawnZoneId: zSidewalk,
		zones,
		zonesById,
		fixtures: [
			{
				id: "fix_vf_telecom",
				kind: "telecom_box",
				position: { xMeters: 3.8, yMeters: 12.5 },
				labelZh: "山水彩繪變電箱",
			},
			{
				id: "fix_vf_hydrant",
				kind: "fire_hydrant",
				position: { xMeters: 2, yMeters: 2 },
				labelZh: "雙口地上式消防栓",
			},
		],
		initialItems: [
			{
				category: "recyclable",
				itemId: parseItemId("item_vf_rec_telecom"),
				kind: "old_electronics",
				position: { xMeters: 3.9, yMeters: 12.6 },
				hiddenNearFixtureId: "fix_vf_telecom",
				hidingSpotZh: "變電箱騎樓安全側",
				legalStandingZoneIds: [zArcade, zSidewalk],
				collected: false,
			},
			{
				category: "contaminant",
				itemId: parseItemId("item_vf_trash_trap"),
				kind: "greasy_lunchbox",
				position: { xMeters: 6.2, yMeters: 1.7 },
				hiddenNearFixtureId: "fix_vf_hydrant",
				hidingSpotZh: "步道邊油膩便當盒",
				collected: false,
			},
		],
	};
}

type StepperFn = (state: RunState, command: RunCommand) => TransitionResult;

type NamedConcreteAction = {
	readonly label: string;
	readonly command: RunCommand;
};

function generateCandidateActions(state: RunState): readonly NamedConcreteAction[] {
	if (state.status === "finished") {
		return [{ label: "finish_now(idempotent)", command: { kind: "finish_now" } }];
	}

	const targets: readonly { readonly name: string; readonly point: WorldPoint }[] = [
		{ name: "sidewalk_spawn", point: { xMeters: 6, yMeters: 1.5 } },
		{ name: "arcade_spot_near_hydrant", point: { xMeters: 4.7, yMeters: 2.0 } },
		{ name: "white_bay", point: { xMeters: 9, yMeters: 1.5 } },
		{ name: "yellow_curb", point: { xMeters: 9, yMeters: 4.5 } },
		{ name: "hydrant_core", point: { xMeters: 2.2, yMeters: 2.0 } },
		{ name: "hydrant_rejoin_edge", point: { xMeters: 4.2, yMeters: 2.0 } },
		{ name: "crosswalk_ew", point: { xMeters: 10, yMeters: 9.5 } },
		{ name: "bare_roadway", point: { xMeters: 12, yMeters: 13 } },
		{ name: "no_ped_trap", point: { xMeters: 4.8, yMeters: 12.6 } },
		{ name: "arcade_telecom_safe", point: { xMeters: 3.2, yMeters: 12.6 } },
		{ name: "alley_buffer", point: { xMeters: 5, yMeters: 17 } },
		{ name: "alley_lane", point: { xMeters: 5, yMeters: 19 } },
	];

	const actions: NamedConcreteAction[] = [];

	for (const target of targets) {
		const vx = (target.point.xMeters - state.locomotion.position.xMeters) * 2;
		const vy = (target.point.yMeters - state.locomotion.position.yMeters) * 2;
		if (target.name === "crosswalk_ew") {
			for (const ewPhase of [
				"walk_green",
				"flashing_green",
				"stop_red",
			] as const) {
				actions.push({
					label: `move(${target.name},ew=${ewPhase})`,
					command: {
						kind: "advance_frame",
						dtMs: 500,
						velocityMps: { vx, vy },
						signals: { ns: "stop_red", ew: ewPhase },
					},
				});
			}
		} else {
			actions.push({
				label: `move(${target.name})`,
				command: {
					kind: "advance_frame",
					dtMs: 500,
					velocityMps: { vx, vy },
					signals: { ns: "walk_green", ew: "walk_green" },
				},
			});
		}
	}

	actions.push({
		label: "stationary_pause_500ms",
		command: {
			kind: "advance_frame",
			dtMs: 500,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		},
	});
	actions.push({
		label: "toggle_cart",
		command: { kind: "toggle_cart" },
	});
	actions.push({
		label: "interact_nearest",
		command: { kind: "interact_nearest" },
	});
	actions.push({
		label: "finish_now",
		command: { kind: "finish_now" },
	});

	return actions;
}

function fingerprintConcreteState(state: RunState): string {
	const recItem = state.itemsById.get(parseItemId("item_vf_rec_telecom"));
	const trashItem = state.itemsById.get(parseItemId("item_vf_trash_trap"));
	const parked =
		state.locomotion.kind === "on_foot"
			? `${state.locomotion.parkedCart.lease.marking}:${Math.floor(
					state.locomotion.parkedCart.lease.policy === "temporary_yellow"
						? state.locomotion.parkedCart.lease.parkedDurationMs / 500
						: 0,
				)}`
			: "none";

	return [
		state.status,
		state.locomotion.kind,
		state.locomotion.position.xMeters.toFixed(1),
		state.locomotion.position.yMeters.toFixed(1),
		parked,
		state.compliance.crosswalk.kind,
		state.compliance.hydrant.kind,
		state.compliance.alleyStop.kind,
		recItem?.collected ? 1 : 0,
		trashItem?.collected ? 1 : 0,
		deriveRecycledCount(state.recyclableTallies),
		deriveContaminantCount(state.contaminantTallies),
		state.pickupClaims.length,
		state.violationTallies.crosswalk_entered_on_red > 0 ? 1 : 0,
		state.violationTallies.hydrant_cart_intrusion > 0 ? 1 : 0,
	].join("|");
}

function checkConcreteTransitionInvariants(params: {
	readonly prev: RunState;
	readonly command: RunCommand;
	readonly result: TransitionResult;
	readonly stepper: StepperFn;
}): { readonly invariant: InvariantName; readonly detail: string } | null {
	const { prev, command, result, stepper } = params;
	const next = result.state;
	const zonesAtNext = resolveZonesAtPoint(next.layout, next.locomotion.position);
	const zonesAtPrev = resolveZonesAtPoint(prev.layout, prev.locomotion.position);

	const prevTrashItem = prev.itemsById.get(parseItemId("item_vf_trash_trap"));
	const nextTrashItem = next.itemsById.get(parseItemId("item_vf_trash_trap"));
	if (prevTrashItem && !prevTrashItem.collected && nextTrashItem?.collected) {
		if (
			deriveRecycledCount(next.recyclableTallies) >
				deriveRecycledCount(prev.recyclableTallies) ||
			next.pickupClaims.length > prev.pickupClaims.length ||
			deriveContaminantCount(next.contaminantTallies) !==
				deriveContaminantCount(prev.contaminantTallies) + 1 ||
			next.combo.streak !== 0
		) {
			return {
				invariant: "NoTrashCountedAsRecyclable",
				detail: "contaminant collection polluted recyclableTallies/pickupClaims or failed to increment contaminantTallies and reset streak",
			};
		}
	}

	const recycledTotal = deriveRecycledCount(next.recyclableTallies);
	if (recycledTotal !== next.pickupClaims.length) {
		return {
			invariant: "NoIllegalPickupRewarded",
			detail: `recyclableTallies total (${recycledTotal}) diverged from pickupClaims length (${next.pickupClaims.length})`,
		};
	}

	const collectedEvent = result.events.find(
		(e) => e.kind === "recyclable_collected",
	);
	if (collectedEvent && collectedEvent.kind === "recyclable_collected") {
		const sourceItem = prev.itemsById.get(collectedEvent.itemId);
		const inNoPed = zonesAtPrev.some((z) => z.kind === "no_pedestrian_zone");
		const hasRoad = zonesAtPrev.some((z) => z.kind === "roadway_lane");
		const hasSafeOverlay = zonesAtPrev.some(
			(z) =>
				z.kind === "signalized_crosswalk" ||
				(z.kind === "curb_marking" && z.marking !== "yellow_box_junction") ||
				z.kind === "sidewalk" ||
				z.kind === "arcade_walkway",
		);
		const inBareRoad = hasRoad && !hasSafeOverlay;
		const matchedZone =
			sourceItem && sourceItem.category === "recyclable"
				? zonesAtPrev.some((z) =>
						sourceItem.legalStandingZoneIds.includes(z.zoneId),
					)
				: false;
		if (inNoPed || inBareRoad || !matchedZone) {
			return {
				invariant: "NoIllegalPickupRewarded",
				detail: `recyclable ${collectedEvent.itemId} rewarded at (${prev.locomotion.position.xMeters},${prev.locomotion.position.yMeters}) with inNoPed=${String(inNoPed)}, inBareRoad=${String(inBareRoad)}, matchedZone=${String(matchedZone)}`,
			};
		}
	}

	const inHydrantNow = zonesAtNext.some((z) => z.kind === "hydrant_red_zone");
	if (
		next.status === "active" &&
		next.locomotion.kind === "pushing_cart" &&
		inHydrantNow &&
		(next.compliance.hydrant.kind !== "cart_cited" ||
			next.violationTallies.hydrant_cart_intrusion < 1)
	) {
		return {
			invariant: "NoCartInHydrantUnpenalized",
			detail: `pushing_cart inside hydrant_red_zone without citation (hydrant=${next.compliance.hydrant.kind}, count=${next.violationTallies.hydrant_cart_intrusion})`,
		};
	}

	if (command.kind === "advance_frame" && prev.status === "active") {
		const cwZone = zonesAtNext.find(
			(z): z is Extract<StreetZone, { readonly kind: "signalized_crosswalk" }> =>
				z.kind === "signalized_crosswalk",
		);
		const wasOutsideThisCw =
			cwZone !== undefined &&
			(prev.compliance.crosswalk.kind === "outside" ||
				prev.compliance.crosswalk.zoneId !== cwZone.zoneId);
		if (
			cwZone &&
			wasOutsideThisCw &&
			command.signals[cwZone.axis] === "stop_red" &&
			next.status === "active"
		) {
			const citedRedEvent = result.events.some(
				(e) =>
					e.kind === "violation_cited" &&
					e.violationKind === "crosswalk_entered_on_red",
			);
			if (
				!citedRedEvent ||
				next.violationTallies.crosswalk_entered_on_red <=
					prev.violationTallies.crosswalk_entered_on_red
			) {
				return {
					invariant: "NoRedLightCrosswalkUnpenalized",
					detail: `entered crosswalk ${cwZone.zoneId} on stop_red without crosswalk_entered_on_red citation`,
				};
			}
		}
	}

	if (next.status === "active") {
		const finishCheck = stepper(next, { kind: "finish_now" });
		if (finishCheck.state.status !== "finished") {
			return {
				invariant: "NoDeadlock",
				detail: "active RunState failed to reach finished status on finish_now",
			};
		}
	}

	return null;
}

function exploreConcreteStepRun(
	stepper: StepperFn,
	maxDepth: number,
): {
	readonly visitedStates: number;
	readonly exploredTransitions: number;
	readonly counterexample: Counterexample | null;
} {
	const layout = buildCompactVerificationLayout();
	const init = createRunState({
		sessionId: parseSessionId("sess_formal_verify_0001"),
		signature: "formal_verification_hmac_signature_placeholder_0123456789",
		alias: "形式驗證員",
		seed: 20261028,
		roundDurationMs: 75_000,
		layout,
	});

	const initKey = fingerprintConcreteState(init);
	const visited = new Set<string>([initKey]);
	const queue: Array<{
		readonly state: RunState;
		readonly depth: number;
		readonly trace: readonly string[];
	}> = [{ state: init, depth: 0, trace: [] }];

	let head = 0;
	let exploredTransitions = 0;

	while (head < queue.length) {
		const node = queue[head];
		head += 1;
		if (!node) continue;

		const actions = generateCandidateActions(node.state);
		if (actions.length === 0) {
			return {
				visitedStates: visited.size,
				exploredTransitions,
				counterexample: {
					invariant: "NoDeadlock",
					detail: "no candidate actions generated for concrete state",
					trace: node.trace,
				},
			};
		}

		for (const act of actions) {
			exploredTransitions += 1;
			const result = stepper(node.state, act.command);
			const nextTrace = [...node.trace, act.label];

			const violation = checkConcreteTransitionInvariants({
				prev: node.state,
				command: act.command,
				result,
				stepper,
			});
			if (violation) {
				return {
					visitedStates: visited.size,
					exploredTransitions,
					counterexample: {
						invariant: violation.invariant,
						detail: violation.detail,
						trace: nextTrace,
					},
				};
			}

			if (node.depth + 1 < maxDepth) {
				const key = fingerprintConcreteState(result.state);
				if (!visited.has(key)) {
					visited.add(key);
					queue.push({
						state: result.state,
						depth: node.depth + 1,
						trace: nextTrace,
					});
				}
			}
		}
	}

	return {
		visitedStates: visited.size,
		exploredTransitions,
		counterexample: null,
	};
}

function createMutatedNoRedLightCitationStepper(): StepperFn {
	return (state, command) => {
		const real = stepRun(state, command);
		if (command.kind !== "advance_frame") {
			return real;
		}
		const filteredEvents = real.events.filter(
			(e) =>
				!(
					e.kind === "violation_cited" &&
					e.violationKind === "crosswalk_entered_on_red"
				),
		);
		if (filteredEvents.length === real.events.length) {
			return real;
		}
		return {
			state: {
				...real.state,
				violationTallies: {
					...real.state.violationTallies,
					crosswalk_entered_on_red: state.violationTallies.crosswalk_entered_on_red,
				},
			},
			events: filteredEvents,
		};
	};
}

function createMutatedIllegalSidePickupStepper(): StepperFn {
	return (state, command) => {
		const real = stepRun(state, command);
		const blocked = real.events.find(
			(e) => e.kind === "pickup_blocked_illegal_side",
		);
		if (!blocked || blocked.kind !== "pickup_blocked_illegal_side") {
			return real;
		}
		const claim = {
			itemId: blocked.itemId,
			kind: "old_electronics" as const,
			atElapsedMs: Math.round(state.elapsedMs),
			standingZoneId: state.locomotion.primaryZoneId,
			awardedPoints: 320,
		};
		return {
			state: {
				...real.state,
				recyclableTallies: {
					...real.state.recyclableTallies,
					old_electronics: real.state.recyclableTallies.old_electronics + 1,
				},
				pickupClaims: [...real.state.pickupClaims, claim],
			},
			events: [
				{
					kind: "recyclable_collected",
					itemId: blocked.itemId,
					recyclableKind: "old_electronics",
					pointsAwarded: 320,
					co2SavedGrams: 580,
					streak: 1,
					triadCompletedNow: false,
					hidingSpotZh: "變電箱騎樓安全側",
					highlightHint: "telecom_box_jackpot",
				},
			],
		};
	};
}

function createMutatedSkipHydrantCartStepper(): StepperFn {
	return (state, command) => {
		const real = stepRun(state, command);
		if (real.state.compliance.hydrant.kind !== "cart_cited") {
			return real;
		}
		return {
			state: {
				...real.state,
				compliance: {
					...real.state.compliance,
					hydrant: { kind: "outside" },
				},
				violationTallies: {
					...real.state.violationTallies,
					hydrant_cart_intrusion: 0,
				},
			},
			events: real.events.filter(
				(e) =>
					!(
						e.kind === "violation_cited" &&
						e.violationKind === "hydrant_cart_intrusion"
					),
			),
		};
	};
}
function createMutatedTrashAsRecyclableStepper(): StepperFn {
	return (state, command) => {
		const real = stepRun(state, command);
		const hadContaminant = real.events.some(
			(e) => e.kind === "contaminant_penalized",
		);
		if (!hadContaminant) {
			return real;
		}
		return {
			state: {
				...real.state,
				recyclableTallies: {
					...real.state.recyclableTallies,
					clean_cardboard: real.state.recyclableTallies.clean_cardboard + 1,
				},
			},
			events: real.events,
		};
	};
}

function verifySeededProductionMaps(): void {
	for (const seed of [1, 42, 2026, 99999]) {
		const layout = createStreetLayout(seed);
		const spawnPrimary = resolvePrimaryZoneId(layout, layout.spawnPoint);
		if (spawnPrimary !== layout.spawnZoneId) {
			throw new Error(
				`Seed ${seed}: spawnPoint primary zone ${spawnPrimary} !== spawnZoneId ${layout.spawnZoneId}`,
			);
		}
		for (const item of layout.initialItems) {
			if (item.category !== "recyclable") continue;
			for (const zid of item.legalStandingZoneIds) {
				const z = layout.zonesById.get(zid);
				if (!z || (z.kind !== "sidewalk" && z.kind !== "arcade_walkway")) {
					throw new Error(
						`Seed ${seed}: recyclable ${item.itemId} lists non-walkway legalStandingZoneId ${zid}`,
					);
				}
			}
		}
	}

	for (let ms = 2_000; ms < 12_000; ms += 1_000) {
		const ns = computeSignalAt(ms, "ns");
		const ew = computeSignalAt(ms, "ew");
		if (ns.phase === "stop_red" || ew.phase !== "stop_red") {
			throw new Error(
				`Signal offset invariant broken at ${ms}ms: ns=${ns.phase}, ew=${ew.phase}`,
			);
		}
	}
}

function main(): void {
	const startedAt = Date.now();

	const abstractRes = exploreAbstractTlaModel();
	if (abstractRes.counterexample) {
		const ce = abstractRes.counterexample;
		console.error(
			`[FAIL] Abstract TLA+ model violated ${ce.invariant}: ${ce.detail}`,
		);
		console.error(`  Counterexample trace: ${ce.trace.join(" -> ")}`);
		process.exit(1);
	}

	const mutRedRes = exploreConcreteStepRun(
		createMutatedNoRedLightCitationStepper(),
		4,
	);
	if (
		!mutRedRes.counterexample ||
		mutRedRes.counterexample.invariant !== "NoRedLightCrosswalkUnpenalized"
	) {
		console.error(
			"[FAIL] Mutation fault-injection check failed: disabling red-light citation was NOT caught!",
		);
		process.exit(1);
	}

	const mutTrashRes = exploreConcreteStepRun(
		createMutatedTrashAsRecyclableStepper(),
		4,
	);
	if (
		!mutTrashRes.counterexample ||
		mutTrashRes.counterexample.invariant !== "NoTrashCountedAsRecyclable"
	) {
		console.error(
			"[FAIL] Mutation fault-injection check failed: counting trash as recyclable was NOT caught!",
		);
		process.exit(1);
	}

	const mutIllegalPickupRes = exploreConcreteStepRun(
		createMutatedIllegalSidePickupStepper(),
		4,
	);
	if (
		!mutIllegalPickupRes.counterexample ||
		mutIllegalPickupRes.counterexample.invariant !== "NoIllegalPickupRewarded"
	) {
		console.error(
			"[FAIL] Mutation fault-injection check failed: illegal-side pickup reward was NOT caught!",
		);
		process.exit(1);
	}

	const mutHydrantRes = exploreConcreteStepRun(
		createMutatedSkipHydrantCartStepper(),
		4,
	);
	if (
		!mutHydrantRes.counterexample ||
		mutHydrantRes.counterexample.invariant !== "NoCartInHydrantUnpenalized"
	) {
		console.error(
			"[FAIL] Mutation fault-injection check failed: unpenalized cart in hydrant zone was NOT caught!",
		);
		process.exit(1);
	}

	const concreteRes = exploreConcreteStepRun(stepRun, 5);
	if (concreteRes.counterexample) {
		const ce = concreteRes.counterexample;
		console.error(
			`[FAIL] Real stepRun implementation violated ${ce.invariant}: ${ce.detail}`,
		);
		console.error(`  Minimal counterexample trace: ${ce.trace.join(" -> ")}`);
		process.exit(1);
	}

	verifySeededProductionMaps();

	const elapsedMs = Date.now() - startedAt;
	console.log(
		`[PASS] TLA+ abstract state space: ${abstractRes.visitedStates} reachable states, ${abstractRes.exploredEdges} transitions verified across 5 invariants.`,
	);
	console.log(
		`[PASS] Mutation fault-injection checks: caught NoRedLightCrosswalkUnpenalized (${mutRedRes.counterexample.trace.join(" -> ")}), NoTrashCountedAsRecyclable (${mutTrashRes.counterexample.trace.join(" -> ")}), NoIllegalPickupRewarded (${mutIllegalPickupRes.counterexample.trace.join(" -> ")}), and NoCartInHydrantUnpenalized (${mutHydrantRes.counterexample.trace.join(" -> ")}).`,
	);
	console.log(
		`[PASS] Concrete stepRun BFS explorer: ${concreteRes.visitedStates} reachable states, ${concreteRes.exploredTransitions} transitions + seeded StreetLayouts verified in ${elapsedMs}ms.`,
	);
}

main();
