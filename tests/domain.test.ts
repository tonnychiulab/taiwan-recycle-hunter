import { describe, expect, it, vi } from "vitest";
import { verifySubmissionPlausibility } from "../worker/plausibility.ts";
import {
	CONTAMINANT_CATALOG,
	ContaminantKindSchema,
	LEGAL_LIMITS,
	RECYCLABLE_CATALOG,
	RecyclableKindSchema,
	VIOLATION_CATALOG,
	deriveContaminantCount,
	deriveRecycledCount,
	parseItemId,
	parseSessionId,
	parseSubmitScorePayload,
	parseZoneId,
} from "../src/shared/contracts.ts";
import {
	computeSignalAt,
	createHighlightReel,
	createRunState,
	createStreetLayout,
	resolvePrimaryZoneId,
	resolveZonesAtPoint,
	stepHighlightReel,
	stepRun,
	toSubmitScorePayload,
	type HighlightMeta,
	type HighlightShot,
	type PedestrianSignalPhase,
	type RunState,
	type StreetLayout,
	type StreetZone,
	type WorldItem,
	type WorldPoint,
} from "../src/domain/index.ts";

function makeCustomLayout(params: {
	readonly zones: readonly StreetZone[];
	readonly items?: readonly WorldItem[];
	readonly spawnPoint?: WorldPoint;
	readonly spawnZoneId?: ReturnType<typeof parseZoneId>;
}): StreetLayout {
	const zonesById = new Map<ReturnType<typeof parseZoneId>, StreetZone>();
	for (const z of params.zones) {
		zonesById.set(z.zoneId, z);
	}
	const spawnPoint = params.spawnPoint ?? { xMeters: 2, yMeters: 2 };
	const spawnZoneId = params.spawnZoneId ?? parseZoneId("zone_test_sidewalk");
	return {
		widthMeters: 36,
		depthMeters: 48,
		spawnPoint,
		spawnZoneId,
		zones: params.zones,
		zonesById,
		fixtures: [
			{
				id: "fix_test_telecom",
				kind: "telecom_box",
				position: { xMeters: 4, yMeters: 4 },
				labelZh: "山水彩繪變電箱",
			},
			{
				id: "fix_test_hydrant",
				kind: "fire_hydrant",
				position: { xMeters: 15, yMeters: 15 },
				labelZh: "雙口地上式消防栓",
			},
			{
				id: "fix_test_stop",
				kind: "stop_sign_post",
				position: { xMeters: 28, yMeters: 34 },
				labelZh: "停（停車再開）標誌",
			},
		],
		initialItems: params.items ?? [],
	};
}

function makeRun(layout?: StreetLayout, seed = 20261028): RunState {
	return createRunState({
		sessionId: parseSessionId("sess_unit_test_run_0001"),
		signature: "0123456789abcdef0123456789abcdef0123456789abcdef",
		alias: "巷弄資收王",
		seed,
		roundDurationMs: LEGAL_LIMITS.roundDurationMs,
		...(layout ? { layout } : {}),
	});
}

function moveDirectlyTo(
	state: RunState,
	target: WorldPoint,
	dtMs = 250,
	signals: { readonly ns: PedestrianSignalPhase; readonly ew: PedestrianSignalPhase } = {
		ns: "walk_green",
		ew: "walk_green",
	},
) {
	const dtSec = dtMs / 1000;
	const vx = (target.xMeters - state.locomotion.position.xMeters) / dtSec;
	const vy = (target.yMeters - state.locomotion.position.yMeters) / dtSec;
	return stepRun(state, {
		kind: "advance_frame",
		dtMs,
		velocityMps: { vx, vy },
		signals,
	});
}

describe("street-map layout and spatial resolution", () => {
	it("constructs a deterministic 36m x 48m Taiwanese street neighborhood with all required zones, fixtures, and 24 items", () => {
		const layoutA = createStreetLayout(424242);
		const layoutB = createStreetLayout(424242);
		const layoutDifferent = createStreetLayout(989898);

		expect(layoutA.widthMeters).toBe(36);
		expect(layoutA.depthMeters).toBe(48);
		expect(layoutA.initialItems).toEqual(layoutB.initialItems);
		expect(layoutA.initialItems.map((i) => i.kind)).not.toEqual(
			layoutDifferent.initialItems.map((i) => i.kind),
		);

		expect(resolvePrimaryZoneId(layoutA, layoutA.spawnPoint)).toBe(
			layoutA.spawnZoneId,
		);
		const spawnZone = layoutA.zonesById.get(layoutA.spawnZoneId);
		expect(spawnZone?.kind).toBe("sidewalk");

		const countZoneKind = (kind: StreetZone["kind"]) =>
			layoutA.zones.filter((z) => z.kind === kind).length;
		expect(countZoneKind("arcade_walkway")).toBeGreaterThanOrEqual(4);
		expect(countZoneKind("sidewalk")).toBeGreaterThanOrEqual(4);
		expect(countZoneKind("roadway_lane")).toBeGreaterThanOrEqual(2);
		expect(countZoneKind("signalized_crosswalk")).toBe(4);
		expect(countZoneKind("hydrant_red_zone")).toBe(2);
		expect(countZoneKind("unsignalized_alley_lane")).toBe(1);
		expect(countZoneKind("alley_stop_buffer")).toBe(2);
		expect(countZoneKind("no_pedestrian_zone")).toBe(1);

		const crosswalkAxes = layoutA.zones
			.filter(
				(z): z is Extract<StreetZone, { readonly kind: "signalized_crosswalk" }> =>
					z.kind === "signalized_crosswalk",
			)
			.map((z) => z.axis);
		expect(crosswalkAxes.filter((a) => a === "ns")).toHaveLength(2);
		expect(crosswalkAxes.filter((a) => a === "ew")).toHaveLength(2);

		const markings = new Set(
			layoutA.zones
				.filter(
					(z): z is Extract<StreetZone, { readonly kind: "curb_marking" }> =>
						z.kind === "curb_marking",
				)
				.map((z) => z.marking),
		);
		expect(markings).toEqual(
			new Set([
				"white_parking_bay",
				"designated_arcade_spot",
				"yellow_curb",
				"red_curb",
				"yellow_box_junction",
			]),
		);

		const yellowBox = layoutA.zones.find(
			(z) => z.kind === "curb_marking" && z.marking === "yellow_box_junction",
		);
		expect(yellowBox).toBeDefined();
		if (yellowBox && yellowBox.kind === "curb_marking") {
			expect(yellowBox.bounds).toEqual({
				minXMeters: 11,
				minYMeters: 19.5,
				widthMeters: 14,
				depthMeters: 6,
			});
		}

		const noPed = layoutA.zones.find((z) => z.kind === "no_pedestrian_zone");
		expect(noPed).toBeDefined();
		if (noPed && noPed.kind === "no_pedestrian_zone") {
			expect(noPed.bounds).toEqual({
				minXMeters: 27.5,
				minYMeters: 6,
				widthMeters: 3,
				depthMeters: 5,
			});
		}

		const countFixture = (kind: StreetLayout["fixtures"][number]["kind"]) =>
			layoutA.fixtures.filter((f) => f.kind === kind).length;
		expect(countFixture("telecom_box")).toBe(3);
		expect(countFixture("fire_hydrant")).toBe(2);
		expect(countFixture("signal_pole")).toBe(4);
		expect(countFixture("stop_sign_post")).toBe(2);
		expect(countFixture("no_pedestrian_sign")).toBe(1);
		expect(countFixture("one_way_sign")).toBe(2);
		expect(countFixture("warning_pedestrian_sign")).toBe(2);
		expect(countFixture("arcade_pillar")).toBe(6);

		expect(layoutA.initialItems).toHaveLength(24);
		const recyclables = layoutA.initialItems.filter(
			(i): i is Extract<WorldItem, { readonly category: "recyclable" }> =>
				i.category === "recyclable",
		);
		const contaminants = layoutA.initialItems.filter(
			(i): i is Extract<WorldItem, { readonly category: "contaminant" }> =>
				i.category === "contaminant",
		);
		expect(recyclables).toHaveLength(18);
		expect(contaminants).toHaveLength(6);

		const presentRecyclableKinds = new Set(recyclables.map((r) => r.kind));
		expect(presentRecyclableKinds).toEqual(new Set(RecyclableKindSchema.options));

		const presentContaminantKinds = new Set(contaminants.map((c) => c.kind));
		expect(presentContaminantKinds).toEqual(
			new Set(ContaminantKindSchema.options),
		);

		for (const rec of recyclables) {
			expect(rec.legalStandingZoneIds.length).toBeGreaterThan(0);
			for (const zid of rec.legalStandingZoneIds) {
				const z = layoutA.zonesById.get(zid);
				expect(z).toBeDefined();
				expect(["sidewalk", "arcade_walkway"]).toContain(z?.kind);
			}
		}
	});
});

describe("pedestrian signal schedule computeSignalAt", () => {
	it("follows the 24s cycle (10s walk_green, 4s flashing_green, 10s stop_red) with 12s E-W offset", () => {
		expect(computeSignalAt(0, "ns")).toEqual({
			phase: "walk_green",
			phaseRemainingSeconds: 10,
		});
		expect(computeSignalAt(9_500, "ns")).toEqual({
			phase: "walk_green",
			phaseRemainingSeconds: 0.5,
		});
		expect(computeSignalAt(10_000, "ns")).toEqual({
			phase: "flashing_green",
			phaseRemainingSeconds: 4,
		});
		expect(computeSignalAt(14_000, "ns")).toEqual({
			phase: "stop_red",
			phaseRemainingSeconds: 10,
		});
		expect(computeSignalAt(24_000, "ns")).toEqual({
			phase: "walk_green",
			phaseRemainingSeconds: 10,
		});

		expect(computeSignalAt(5_000, "ns").phase).toBe("walk_green");
		expect(computeSignalAt(5_000, "ew").phase).toBe("stop_red");
		expect(computeSignalAt(11_000, "ns").phase).toBe("flashing_green");
		expect(computeSignalAt(11_000, "ew").phase).toBe("stop_red");
		expect(computeSignalAt(12_000, "ew")).toEqual({
			phase: "walk_green",
			phaseRemainingSeconds: 10,
		});
		expect(computeSignalAt(17_000, "ew").phase).toBe("walk_green");
		expect(computeSignalAt(17_000, "ns").phase).toBe("stop_red");
	});
});

describe("Taiwan legal compliance engine rules 1 through 6", () => {
	it("Rule 1: enforces crosswalk red/flashing citations, preserves legal_green_pass when signal turns flashing mid-crossing, and cites jaywalking", () => {
		const layout = createStreetLayout(101);
		let state = makeRun(layout, 101);

		state = moveDirectlyTo(state, { xMeters: 7.0, yMeters: 28.0 }).state;
		expect(state.violationTallies.crosswalk_entered_on_red).toBe(0);

		const redEntry = moveDirectlyTo(
			state,
			{ xMeters: 12.0, yMeters: 28.0 },
			250,
			{ ns: "walk_green", ew: "stop_red" },
		);
		expect(redEntry.state.violationTallies.crosswalk_entered_on_red).toBe(1);
		expect(redEntry.events).toContainEqual({
			kind: "violation_cited",
			violationKind: "crosswalk_entered_on_red",
			zoneId: parseZoneId("zone_crosswalk_south"),
			penaltyPoints: VIOLATION_CATALOG.crosswalk_entered_on_red.penaltyPoints,
		});

		const stillInCrosswalk = moveDirectlyTo(
			redEntry.state,
			{ xMeters: 15.0, yMeters: 28.0 },
			250,
			{ ns: "walk_green", ew: "stop_red" },
		);
		expect(
			stillInCrosswalk.state.violationTallies.crosswalk_entered_on_red,
		).toBe(1);
		expect(stillInCrosswalk.events).toHaveLength(0);

		const exited = moveDirectlyTo(
			stillInCrosswalk.state,
			{ xMeters: 7.0, yMeters: 28.0 },
		).state;
		expect(exited.compliance.crosswalk).toEqual({ kind: "outside" });

		const flashingEntry = moveDirectlyTo(
			exited,
			{ xMeters: 11.0, yMeters: 28.0 },
			250,
			{ ns: "stop_red", ew: "flashing_green" },
		);
		expect(
			flashingEntry.state.violationTallies.crosswalk_entered_on_flashing_green,
		).toBe(1);

		const freshForGreen = moveDirectlyTo(
			makeRun(layout, 101),
			{ xMeters: 7.0, yMeters: 28.0 },
		).state;
		const greenEntry = moveDirectlyTo(
			freshForGreen,
			{ xMeters: 12.0, yMeters: 28.0 },
			250,
			{ ns: "stop_red", ew: "walk_green" },
		);
		expect(greenEntry.state.compliance.crosswalk).toEqual({
			kind: "legal_green_pass",
			zoneId: parseZoneId("zone_crosswalk_south"),
		});
		expect(greenEntry.events).toHaveLength(0);

		const midCrossingFlash = moveDirectlyTo(
			greenEntry.state,
			{ xMeters: 22.0, yMeters: 28.0 },
			500,
			{ ns: "stop_red", ew: "flashing_green" },
		);
		expect(midCrossingFlash.state.compliance.crosswalk).toEqual({
			kind: "legal_green_pass",
			zoneId: parseZoneId("zone_crosswalk_south"),
		});
		expect(
			midCrossingFlash.state.violationTallies.crosswalk_entered_on_flashing_green,
		).toBe(0);
		expect(midCrossingFlash.events).toHaveLength(0);

		const jaywalkStep = moveDirectlyTo(
			freshForGreen,
			{ xMeters: 14.0, yMeters: 42.0 },
		);
		expect(jaywalkStep.state.violationTallies.jaywalking_outside_crosswalk).toBe(
			1,
		);
	});

	it("Rule 2: cites pushing_cart in hydrant_red_zone immediately and allows on_foot up to 3000ms before citing hydrant_on_foot_linger", () => {
		const layout = createStreetLayout(202);
		const initial = makeRun(layout, 202);

		const nearNwArcadeSpot = moveDirectlyTo(initial, {
			xMeters: 2.0,
			yMeters: 12.5,
		}).state;
		expect(nearNwArcadeSpot.violationTallies.hydrant_cart_intrusion).toBe(0);

		const cartIntoHydrant = moveDirectlyTo(nearNwArcadeSpot, {
			xMeters: 7.5,
			yMeters: 8.8,
		});
		expect(cartIntoHydrant.state.violationTallies.hydrant_cart_intrusion).toBe(1);
		expect(cartIntoHydrant.state.compliance.hydrant).toEqual({
			kind: "cart_cited",
			zoneId: parseZoneId("zone_hydrant_nw"),
		});

		const parkedRes = stepRun(nearNwArcadeSpot, { kind: "toggle_cart" });
		expect(parkedRes.state.locomotion.kind).toBe("on_foot");

		const footEntry = moveDirectlyTo(
			parkedRes.state,
			{ xMeters: 7.5, yMeters: 8.8 },
			500,
		);
		expect(footEntry.state.violationTallies.hydrant_on_foot_linger).toBe(0);
		expect(footEntry.state.compliance.hydrant).toEqual({
			kind: "on_foot_grace",
			zoneId: parseZoneId("zone_hydrant_nw"),
			dwellMs: 500,
			cited: false,
		});

		const atExactLimit = stepRun(footEntry.state, {
			kind: "advance_frame",
			dtMs: 2_500,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(atExactLimit.state.violationTallies.hydrant_on_foot_linger).toBe(0);

		const overLimit = stepRun(atExactLimit.state, {
			kind: "advance_frame",
			dtMs: 1,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(overLimit.state.violationTallies.hydrant_on_foot_linger).toBe(1);

		const lingerFurther = stepRun(overLimit.state, {
			kind: "advance_frame",
			dtMs: 1_000,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(lingerFurther.state.violationTallies.hydrant_on_foot_linger).toBe(1);
	});

	it("Rule 3: enforces red_curb and yellow_box cart violations, yellow_curb 3000ms parking lease, and cart_deposited bonus on retrieval", () => {
		const zSidewalk = parseZoneId("zone_r3_sidewalk");
		const zYellow = parseZoneId("zone_r3_yellow");
		const zWhite = parseZoneId("zone_r3_white");
		const zRed = parseZoneId("zone_r3_red");
		const zBox = parseZoneId("zone_r3_box");
		const item1 = parseItemId("item_r3_bottle_1");
		const item2 = parseItemId("item_r3_bottle_2");

		const layout = makeCustomLayout({
			spawnPoint: { xMeters: 2, yMeters: 2 },
			spawnZoneId: zSidewalk,
			zones: [
				{
					kind: "sidewalk",
					zoneId: zSidewalk,
					bounds: { minXMeters: 0, minYMeters: 0, widthMeters: 8, depthMeters: 20 },
				},
				{
					kind: "curb_marking",
					zoneId: zYellow,
					bounds: { minXMeters: 8, minYMeters: 0, widthMeters: 2, depthMeters: 5 },
					marking: "yellow_curb",
				},
				{
					kind: "curb_marking",
					zoneId: zWhite,
					bounds: { minXMeters: 8, minYMeters: 5, widthMeters: 2, depthMeters: 5 },
					marking: "white_parking_bay",
				},
				{
					kind: "curb_marking",
					zoneId: zRed,
					bounds: { minXMeters: 8, minYMeters: 10, widthMeters: 2, depthMeters: 5 },
					marking: "red_curb",
				},
				{
					kind: "curb_marking",
					zoneId: zBox,
					bounds: { minXMeters: 10, minYMeters: 10, widthMeters: 6, depthMeters: 6 },
					marking: "yellow_box_junction",
				},
			],
			items: [
				{
					category: "recyclable",
					itemId: item1,
					kind: "pet_bottle",
					position: { xMeters: 6.5, yMeters: 2.0 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "測試點一",
					legalStandingZoneIds: [zSidewalk],
					collected: false,
				},
				{
					category: "recyclable",
					itemId: item2,
					kind: "aluminum_can",
					position: { xMeters: 6.5, yMeters: 6.5 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "測試點二",
					legalStandingZoneIds: [zSidewalk],
					collected: false,
				},
			],
		});

		const start = makeRun(layout);
		const refusedPark = stepRun(start, { kind: "toggle_cart" });
		expect(refusedPark.events).toEqual([
			{
				kind: "cart_action_refused",
				reason: "must_park_on_white_bay_arcade_spot_or_yellow_curb",
			},
		]);

		const onRed = moveDirectlyTo(start, { xMeters: 9, yMeters: 12 });
		expect(onRed.state.violationTallies.red_curb_cart_violation).toBe(1);

		const onBox = moveDirectlyTo(onRed.state, { xMeters: 12, yMeters: 12 });
		expect(onBox.state.violationTallies.yellow_box_cart_violation).toBe(1);

		const onYellow = moveDirectlyTo(start, { xMeters: 9, yMeters: 2 }).state;
		const parkedYellow = stepRun(onYellow, { kind: "toggle_cart" });
		expect(parkedYellow.state.locomotion.kind).toBe("on_foot");

		const walkedToBottle = moveDirectlyTo(
			parkedYellow.state,
			{ xMeters: 6.8, yMeters: 2.0 },
			1_000,
		).state;
		const grabbed1 = stepRun(walkedToBottle, { kind: "interact_nearest" });
		expect(grabbed1.state.score).toBe(100);

		const waitedTo3000 = stepRun(grabbed1.state, {
			kind: "advance_frame",
			dtMs: 2_000,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(waitedTo3000.state.violationTallies.yellow_curb_parking_overstay).toBe(
			0,
		);

		const overstay = stepRun(waitedTo3000.state, {
			kind: "advance_frame",
			dtMs: 50,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(overstay.state.violationTallies.yellow_curb_parking_overstay).toBe(1);

		const tooFar = moveDirectlyTo(overstay.state, { xMeters: 2, yMeters: 2 }).state;
		const refusedRetrieve = stepRun(tooFar, { kind: "toggle_cart" });
		expect(refusedRetrieve.events).toEqual([
			{ kind: "cart_action_refused", reason: "too_far_to_retrieve_cart" },
		]);

		const nearCart = moveDirectlyTo(tooFar, { xMeters: 7.5, yMeters: 2 }).state;
		const retrieved = stepRun(nearCart, { kind: "toggle_cart" });
		expect(retrieved.state.locomotion.kind).toBe("pushing_cart");
		expect(retrieved.events).toContainEqual({
			kind: "cart_deposited",
			depositedCount: 1,
			bonusPoints: 25,
		});
	});

	it("Rule 4: requires >= 400ms stationary pause in alley_stop_buffer before entering unsignalized_alley_lane", () => {
		const layout = createStreetLayout(404);
		const start = makeRun(layout, 404);

		const atBufferNorth = moveDirectlyTo(start, {
			xMeters: 29.0,
			yMeters: 34.2,
		}).state;
		expect(atBufferNorth.compliance.alleyStop.kind).toBe("pausing");

		const rushedIntoAlley = moveDirectlyTo(
			atBufferNorth,
			{ xMeters: 29.0, yMeters: 36.5 },
			200,
		);
		expect(rushedIntoAlley.state.violationTallies.stop_sign_check_skipped).toBe(1);

		const exitedSouthSidewalk = moveDirectlyTo(
			rushedIntoAlley.state,
			{ xMeters: 29.0, yMeters: 42.0 },
		).state;
		expect(exitedSouthSidewalk.compliance.alleyStop).toEqual({ kind: "unarmed" });

		const atBufferSouth = moveDirectlyTo(exitedSouthSidewalk, {
			xMeters: 29.0,
			yMeters: 40.2,
		}).state;
		const paused399 = stepRun(atBufferSouth, {
			kind: "advance_frame",
			dtMs: 399,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(paused399.state.compliance.alleyStop.kind).toBe("pausing");

		const clearedAt400 = stepRun(paused399.state, {
			kind: "advance_frame",
			dtMs: 1,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(clearedAt400.state.compliance.alleyStop).toEqual({
			kind: "cleared",
			guardedAlleyZoneId: parseZoneId("zone_alley_east"),
		});
		expect(clearedAt400.events).toContainEqual({
			kind: "stop_sign_cleared",
			guardedAlleyZoneId: parseZoneId("zone_alley_east"),
		});

		const legalAlleyCross = moveDirectlyTo(clearedAt400.state, {
			xMeters: 29.0,
			yMeters: 37.0,
		});
		expect(legalAlleyCross.state.violationTallies.stop_sign_check_skipped).toBe(1);
		expect(legalAlleyCross.events).toHaveLength(0);
	});

	it("Rules 5 and 6: blocks illegal-side pickup, enforces handCarryMaxItems, awards Clean-Sort-Compress triad +120 bonus, and separates contaminants", () => {
		const zArcade = parseZoneId("zone_r5_arcade");
		const zNoPed = parseZoneId("zone_r5_no_ped");
		const zBay = parseZoneId("zone_r5_bay");

		const layout = makeCustomLayout({
			spawnPoint: { xMeters: 2, yMeters: 2 },
			spawnZoneId: zArcade,
			zones: [
				{
					kind: "arcade_walkway",
					zoneId: zArcade,
					bounds: { minXMeters: 0, minYMeters: 0, widthMeters: 5, depthMeters: 25 },
				},
				{
					kind: "no_pedestrian_zone",
					zoneId: zNoPed,
					bounds: { minXMeters: 5, minYMeters: 5, widthMeters: 4, depthMeters: 6 },
				},
				{
					kind: "curb_marking",
					zoneId: zBay,
					bounds: { minXMeters: 1, minYMeters: 1, widthMeters: 2, depthMeters: 2 },
					marking: "designated_arcade_spot",
				},
			],
			items: [
				{
					category: "recyclable",
					itemId: parseItemId("item_r5_clean"),
					kind: "tin_can",
					position: { xMeters: 4.8, yMeters: 7.0 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "變電箱騎樓安全邊",
					legalStandingZoneIds: [zArcade],
					collected: false,
				},
				{
					category: "recyclable",
					itemId: parseItemId("item_r5_sort"),
					kind: "waste_battery",
					position: { xMeters: 2.5, yMeters: 11.0 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "騎樓柱旁",
					legalStandingZoneIds: [zArcade],
					collected: false,
				},
				{
					category: "recyclable",
					itemId: parseItemId("item_r5_compress"),
					kind: "pet_bottle",
					position: { xMeters: 2.5, yMeters: 14.5 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "騎樓尾端",
					legalStandingZoneIds: [zArcade],
					collected: false,
				},
				{
					category: "recyclable",
					itemId: parseItemId("item_r5_fourth"),
					kind: "glass_bottle",
					position: { xMeters: 2.5, yMeters: 18.0 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "騎樓四號位",
					legalStandingZoneIds: [zArcade],
					collected: false,
				},
				{
					category: "recyclable",
					itemId: parseItemId("item_r5_fifth"),
					kind: "clean_cardboard",
					position: { xMeters: 2.5, yMeters: 21.5 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "騎樓五號位",
					legalStandingZoneIds: [zArcade],
					collected: false,
				},
				{
					category: "contaminant",
					itemId: parseItemId("item_r5_dirty"),
					kind: "greasy_lunchbox",
					position: { xMeters: 2.5, yMeters: 24.2 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "角落髒便當盒",
					collected: false,
				},
			],
		});

		let state = makeRun(layout);

		const parked = stepRun(state, { kind: "toggle_cart" });
		expect(parked.state.locomotion.kind).toBe("on_foot");
		state = parked.state;

		const illegalApproach = moveDirectlyTo(state, { xMeters: 5.5, yMeters: 7.0 });
		expect(illegalApproach.state.violationTallies.entered_no_pedestrian_zone).toBe(
			1,
		);
		const blockedPickup = stepRun(illegalApproach.state, {
			kind: "interact_nearest",
		});
		expect(blockedPickup.events).toEqual([
			{
				kind: "pickup_blocked_illegal_side",
				itemId: parseItemId("item_r5_clean"),
			},
		]);
		expect(deriveRecycledCount(blockedPickup.state.recyclableTallies)).toBe(0);

		state = moveDirectlyTo(blockedPickup.state, {
			xMeters: 4.2,
			yMeters: 7.0,
		}).state;
		const pick1 = stepRun(state, { kind: "interact_nearest" });
		expect(pick1.state.recyclableTallies.tin_can).toBe(1);
		expect(pick1.state.score).toBe(RECYCLABLE_CATALOG.tin_can.basePoints);

		state = moveDirectlyTo(pick1.state, { xMeters: 2.5, yMeters: 11.0 }).state;
		const pick2 = stepRun(state, { kind: "interact_nearest" });
		expect(pick2.state.score).toBe(
			RECYCLABLE_CATALOG.tin_can.basePoints +
				RECYCLABLE_CATALOG.waste_battery.basePoints +
				15,
		);

		state = moveDirectlyTo(pick2.state, { xMeters: 2.5, yMeters: 14.5 }).state;
		const pick3 = stepRun(state, { kind: "interact_nearest" });
		expect(pick3.state.combo.triadsCompleted).toBe(1);
		expect(pick3.state.combo.stepsActive).toEqual({
			clean: false,
			sort: false,
			compress: false,
		});
		expect(pick3.events).toContainEqual(
			expect.objectContaining({
				kind: "recyclable_collected",
				triadCompletedNow: true,
				highlightHint: "clean_sort_compress_triad",
				pointsAwarded: RECYCLABLE_CATALOG.pet_bottle.basePoints + 30 + 120,
			}),
		);

		state = moveDirectlyTo(pick3.state, { xMeters: 2.5, yMeters: 18.0 }).state;
		const pick4 = stepRun(state, { kind: "interact_nearest" });
		expect(
			pick4.state.locomotion.kind === "on_foot"
				? pick4.state.locomotion.handCarried
				: [],
		).toHaveLength(4);

		state = moveDirectlyTo(pick4.state, { xMeters: 2.5, yMeters: 21.5 }).state;
		const bagFull = stepRun(state, { kind: "interact_nearest" });
		expect(bagFull.events).toEqual([
			{ kind: "hand_bag_full", maxItems: LEGAL_LIMITS.handCarryMaxItems },
		]);
		expect(deriveRecycledCount(bagFull.state.recyclableTallies)).toBe(4);

		state = moveDirectlyTo(bagFull.state, { xMeters: 2.5, yMeters: 24.2 }).state;
		const beforeContaminantClaims = state.pickupClaims;
		const beforeRecyclableTallies = state.recyclableTallies;
		const beforeScore = state.score;

		const trashRes = stepRun(state, { kind: "interact_nearest" });
		expect(trashRes.events).toEqual([
			{
				kind: "contaminant_penalized",
				itemId: parseItemId("item_r5_dirty"),
				contaminantKind: "greasy_lunchbox",
				penaltyPoints: CONTAMINANT_CATALOG.greasy_lunchbox.penaltyPoints,
			},
		]);
		expect(trashRes.state.recyclableTallies).toEqual(beforeRecyclableTallies);
		expect(trashRes.state.pickupClaims).toEqual(beforeContaminantClaims);
		expect(deriveContaminantCount(trashRes.state.contaminantTallies)).toBe(1);
		expect(trashRes.state.combo.streak).toBe(0);
		expect(trashRes.state.score).toBe(
			beforeScore - CONTAMINANT_CATALOG.greasy_lunchbox.penaltyPoints,
		);

		const finishRes = stepRun(trashRes.state, { kind: "finish_now" });
		expect(finishRes.state.status).toBe("finished");
		expect(finishRes.events).toEqual([
			{ kind: "run_finished", finalScore: trashRes.state.score },
		]);

		const idempotentAfterFinish = stepRun(finishRes.state, {
			kind: "finish_now",
		});
		expect(idempotentAfterFinish.events).toEqual([]);

		const payload = toSubmitScorePayload({
			state: finishRes.state,
			alias: "  資收高手  ",
			orientationUsed: "both",
		});
		const parsed = parseSubmitScorePayload(payload);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.value.alias).toBe("資收高手");
			expect(parsed.value.pickupClaims).toHaveLength(4);
			expect(parsed.value.triadsCompleted).toBe(1);
		}

		const zonesHere = resolveZonesAtPoint(layout, { xMeters: 2, yMeters: 2 });
		expect(zonesHere.map((z) => z.zoneId)).toContain(zArcade);
	});
});

describe("highlight-reel top-3 bounded priority queue and cooldown", () => {
	it("enforces 4000ms cooldown, skips captureFrame when excitement <= 3rd slot, and calls onEvict when replacing 3rd slot", () => {
		const baseState = makeRun();
		const capturedFrames: string[] = [];
		const evictedShots: HighlightShot<string>[] = [];
		const captureFrame = vi.fn((meta: HighlightMeta) => {
			const tag = `frame_${meta.captureId}_${meta.excitementScore}`;
			capturedFrames.push(tag);
			return tag;
		});
		const onEvict = vi.fn((evicted: HighlightShot<string>) => {
			evictedShots.push(evicted);
		});

		let reel = createHighlightReel<string>();

		reel = stepHighlightReel({
			reel,
			state: { ...baseState, elapsedMs: 1_000, score: 100 },
			events: [
				{
					kind: "recyclable_collected",
					itemId: parseItemId("item_hl_01"),
					recyclableKind: "pet_bottle",
					pointsAwarded: 100,
					co2SavedGrams: 65,
					streak: 1,
					triadCompletedNow: false,
					hidingSpotZh: "騎樓柱邊",
					highlightHint: "green_crosswalk_combo",
				},
			],
			captureFrame,
			onEvict,
		});
		expect(reel.shots).toHaveLength(1);
		expect(captureFrame).toHaveBeenCalledTimes(1);

		reel = stepHighlightReel({
			reel,
			state: { ...baseState, elapsedMs: 3_500, score: 420 },
			events: [
				{
					kind: "recyclable_collected",
					itemId: parseItemId("item_hl_cooldown_blocked"),
					recyclableKind: "old_electronics",
					pointsAwarded: 320,
					co2SavedGrams: 580,
					streak: 5,
					triadCompletedNow: true,
					hidingSpotZh: "變電箱旁",
					highlightHint: "clean_sort_compress_triad",
				},
			],
			captureFrame,
			onEvict,
		});
		expect(reel.shots).toHaveLength(1);
		expect(captureFrame).toHaveBeenCalledTimes(1);

		reel = stepHighlightReel({
			reel,
			state: { ...baseState, elapsedMs: 5_500, score: 320 },
			events: [
				{
					kind: "recyclable_collected",
					itemId: parseItemId("item_hl_02"),
					recyclableKind: "waste_battery",
					pointsAwarded: 220,
					co2SavedGrams: 260,
					streak: 2,
					triadCompletedNow: false,
					hidingSpotZh: "消防栓旁",
					highlightHint: "hydrant_clutch_grab",
				},
			],
			captureFrame,
			onEvict,
		});

		reel = stepHighlightReel({
			reel,
			state: { ...baseState, elapsedMs: 10_000, score: 500 },
			events: [
				{
					kind: "recyclable_collected",
					itemId: parseItemId("item_hl_03"),
					recyclableKind: "aluminum_can",
					pointsAwarded: 145,
					co2SavedGrams: 180,
					streak: 2,
					triadCompletedNow: false,
					hidingSpotZh: "黃線旁",
					highlightHint: "yellow_curb_pitstop",
				},
			],
			captureFrame,
			onEvict,
		});

		expect(reel.shots).toHaveLength(3);
		expect(captureFrame).toHaveBeenCalledTimes(3);
		expect(reel.shots[0]!.meta.excitementScore).toBeGreaterThanOrEqual(
			reel.shots[1]!.meta.excitementScore,
		);
		expect(reel.shots[1]!.meta.excitementScore).toBeGreaterThanOrEqual(
			reel.shots[2]!.meta.excitementScore,
		);
		const weakestBefore = reel.shots[2]!;

		reel = stepHighlightReel({
			reel,
			state: { ...baseState, elapsedMs: 15_000, score: 600 },
			events: [
				{
					kind: "recyclable_collected",
					itemId: parseItemId("item_hl_weak"),
					recyclableKind: "pet_bottle",
					pointsAwarded: 100,
					co2SavedGrams: 65,
					streak: 1,
					triadCompletedNow: false,
					hidingSpotZh: "騎樓角落",
					highlightHint: "green_crosswalk_combo",
				},
			],
			captureFrame,
			onEvict,
		});
		expect(captureFrame).toHaveBeenCalledTimes(3);
		expect(onEvict).not.toHaveBeenCalled();

		reel = stepHighlightReel({
			reel,
			state: { ...baseState, elapsedMs: 20_000, score: 1_060 },
			events: [
				{
					kind: "recyclable_collected",
					itemId: parseItemId("item_hl_jackpot"),
					recyclableKind: "old_electronics",
					pointsAwarded: 460,
					co2SavedGrams: 580,
					streak: 4,
					triadCompletedNow: true,
					hidingSpotZh: "山水彩繪變電箱底座",
					highlightHint: "clean_sort_compress_triad",
				},
			],
			captureFrame,
			onEvict,
		});
		expect(captureFrame).toHaveBeenCalledTimes(4);
		expect(onEvict).toHaveBeenCalledTimes(1);
		expect(evictedShots[0]).toEqual(weakestBefore);
		expect(reel.shots).toHaveLength(3);
		expect(reel.shots[0]!.meta.reason).toBe("clean_sort_compress_triad");
	});

	it("clamps score at 0 under heavy penalties, finishes automatically at roundDurationMs, and passes server plausibility checks", () => {
		const layout = createStreetLayout(777);
		let state = makeRun(layout, 777);

		const jaywalkFromZero = moveDirectlyTo(state, {
			xMeters: 15.0,
			yMeters: 42.0,
		});
		expect(jaywalkFromZero.state.score).toBe(0);

		state = makeRun(layout, 777);
		const firstRecyclable = layout.initialItems.find(
			(i) => i.category === "recyclable" && i.legalStandingZoneIds.includes(layout.spawnZoneId),
		);
		expect(firstRecyclable).toBeDefined();
		if (firstRecyclable) {
			state = moveDirectlyTo(state, firstRecyclable.position, 600).state;
			state = stepRun(state, { kind: "interact_nearest" }).state;
		}

		const expired = stepRun(state, {
			kind: "advance_frame",
			dtMs: LEGAL_LIMITS.roundDurationMs,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "stop_red" },
		});
		expect(expired.state.status).toBe("finished");
		expect(expired.state.elapsedMs).toBe(LEGAL_LIMITS.roundDurationMs);
		expect(expired.events).toContainEqual({
			kind: "run_finished",
			finalScore: state.score,
		});

		const submission = toSubmitScorePayload({
			state: expired.state,
			orientationUsed: "portrait",
		});
		const verdict = verifySubmissionPlausibility({
			payload: submission,
			sessionIssuedAtMs: 1_000_000,
			roundDurationMs: LEGAL_LIMITS.roundDurationMs,
			nowMs: 1_080_000,
		});
		expect(verdict.ok).toBe(true);
	});

	it("guards rapid <160ms double-taps, early zero-clamped penalties, cart retrieval near hydrants, stop-line boundaries, and yellow-box jaywalking", () => {
		const layout = createStreetLayout(2026);
		let state = makeRun(layout, 2026);

		state = moveDirectlyTo(state, { xMeters: 8.8, yMeters: 31.0 }, 400).state;
		state = moveDirectlyTo(state, { xMeters: 15.0, yMeters: 31.0 }, 400).state;
		expect(state.score).toBe(0);
		expect(state.violationTallies.red_curb_cart_violation).toBe(1);
		expect(state.violationTallies.jaywalking_outside_crosswalk).toBe(1);

		const swRecyclable = layout.initialItems.find(
			(it) =>
				it.category === "recyclable" &&
				it.legalStandingZoneIds.includes(parseZoneId("zone_sidewalk_sw")),
		);
		expect(swRecyclable).toBeDefined();
		if (swRecyclable) {
			state = moveDirectlyTo(state, { xMeters: 6.8, yMeters: swRecyclable.position.yMeters }, 800).state;
			state = stepRun(state, { kind: "interact_nearest" }).state;
		}
		expect(state.score).toBeGreaterThan(0);

		state = stepRun(state, {
			kind: "advance_frame",
			dtMs: 8_000,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "walk_green" },
		}).state;
		state = stepRun(state, { kind: "finish_now" }).state;

		const earlyPenaltyPayload = toSubmitScorePayload({
			state,
			orientationUsed: "portrait",
		});
		const earlyPenaltyVerdict = verifySubmissionPlausibility({
			payload: earlyPenaltyPayload,
			sessionSeed: 2026,
			sessionIssuedAtMs: 1_000_000,
			roundDurationMs: LEGAL_LIMITS.roundDurationMs,
			nowMs: 1_020_000,
		});
		expect(earlyPenaltyVerdict.ok).toBe(true);

		const zSw = parseZoneId("zone_cluster_sw");
		const clusterLayout = makeCustomLayout({
			spawnPoint: { xMeters: 3, yMeters: 3 },
			spawnZoneId: zSw,
			zones: [
				{
					kind: "sidewalk",
					zoneId: zSw,
					bounds: { minXMeters: 0, minYMeters: 0, widthMeters: 8, depthMeters: 8 },
				},
			],
			items: [
				{
					category: "recyclable",
					itemId: parseItemId("item_cluster_a"),
					kind: "pet_bottle",
					position: { xMeters: 3.2, yMeters: 3.0 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "A",
					legalStandingZoneIds: [zSw],
					collected: false,
				},
				{
					category: "recyclable",
					itemId: parseItemId("item_cluster_b"),
					kind: "aluminum_can",
					position: { xMeters: 3.4, yMeters: 3.0 },
					hiddenNearFixtureId: "fix_test_telecom",
					hidingSpotZh: "B",
					legalStandingZoneIds: [zSw],
					collected: false,
				},
			],
		});
		let clusterRun = makeRun(clusterLayout, 55);
		clusterRun = stepRun(clusterRun, {
			kind: "advance_frame",
			dtMs: 6_000,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "walk_green" },
		}).state;
		clusterRun = stepRun(clusterRun, { kind: "interact_nearest" }).state;
		clusterRun = stepRun(clusterRun, {
			kind: "advance_frame",
			dtMs: 80,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "walk_green" },
		}).state;
		const suppressedDoubleTap = stepRun(clusterRun, { kind: "interact_nearest" });
		expect(suppressedDoubleTap.state.pickupClaims).toHaveLength(1);

		let afterCooldown = stepRun(suppressedDoubleTap.state, {
			kind: "advance_frame",
			dtMs: 100,
			velocityMps: { vx: 0, vy: 0 },
			signals: { ns: "walk_green", ew: "walk_green" },
		}).state;
		afterCooldown = stepRun(afterCooldown, { kind: "interact_nearest" }).state;
		expect(afterCooldown.pickupClaims).toHaveLength(2);

		let retrieveRun = makeRun(layout, 2026);
		retrieveRun = moveDirectlyTo(retrieveRun, { xMeters: 8.5, yMeters: 3.5 }, 500).state;
		retrieveRun = stepRun(retrieveRun, { kind: "toggle_cart" }).state;
		expect(retrieveRun.locomotion.kind).toBe("on_foot");
		retrieveRun = moveDirectlyTo(retrieveRun, { xMeters: 8.5, yMeters: 3.9 }, 300).state;
		const retrievedCart = stepRun(retrieveRun, { kind: "toggle_cart" });
		expect(retrievedCart.state.locomotion.kind).toBe("pushing_cart");
		expect(retrievedCart.state.locomotion.position).toEqual({ xMeters: 8.5, yMeters: 3.5 });
		expect(retrievedCart.state.violationTallies.hydrant_cart_intrusion).toBe(0);
		expect(retrievedCart.state.violationTallies.red_curb_cart_violation).toBe(0);

		let stopLineRun = makeRun(layout, 2026);
		stopLineRun = moveDirectlyTo(stopLineRun, { xMeters: 29.0, yMeters: 35.0 }, 200).state;
		expect(stopLineRun.violationTallies.stop_sign_check_skipped).toBe(0);
		expect(stopLineRun.compliance.alleyStop.kind).toBe("pausing");

		let yellowBoxFootRun = makeRun(layout, 2026);
		yellowBoxFootRun = moveDirectlyTo(yellowBoxFootRun, { xMeters: 2.5, yMeters: 42.5 }, 200).state;
		yellowBoxFootRun = stepRun(yellowBoxFootRun, { kind: "toggle_cart" }).state;
		yellowBoxFootRun = moveDirectlyTo(yellowBoxFootRun, { xMeters: 18.0, yMeters: 22.5 }, 200).state;
		expect(yellowBoxFootRun.violationTallies.jaywalking_outside_crosswalk).toBe(1);
	});
});
