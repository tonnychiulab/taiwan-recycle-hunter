import {
	ContaminantKindSchema,
	LEGAL_LIMITS,
	RecyclableKindSchema,
	parseItemId,
	parseZoneId,
	type ContaminantKind,
	type RecyclableKind,
	type ZoneId,
} from "../shared/contracts.ts";
import type {
	MeterBounds,
	StreetFixture,
	StreetLayout,
	StreetZone,
	WorldItem,
	WorldPoint,
} from "./types.ts";

const MAP_WIDTH_METERS = 36;
const MAP_DEPTH_METERS = 48;

const ZONE_IDS = {
	arcadeNw: parseZoneId("zone_arcade_nw"),
	arcadeSw: parseZoneId("zone_arcade_sw"),
	arcadeNe: parseZoneId("zone_arcade_ne"),
	arcadeSeNorth: parseZoneId("zone_arcade_se_north"),
	arcadeSeSouth: parseZoneId("zone_arcade_se_south"),
	sidewalkNw: parseZoneId("zone_sidewalk_nw"),
	sidewalkSw: parseZoneId("zone_sidewalk_sw"),
	sidewalkNeNorth: parseZoneId("zone_sidewalk_ne_north"),
	sidewalkNeSouth: parseZoneId("zone_sidewalk_ne_south"),
	sidewalkSeNorth: parseZoneId("zone_sidewalk_se_north"),
	sidewalkSeSouth: parseZoneId("zone_sidewalk_se_south"),
	noPedNe: parseZoneId("zone_no_ped_ne"),
	roadNsMain: parseZoneId("zone_road_ns_main"),
	roadEwWest: parseZoneId("zone_road_ew_west"),
	roadEwEast: parseZoneId("zone_road_ew_east"),
	crosswalkNorth: parseZoneId("zone_crosswalk_north"),
	crosswalkSouth: parseZoneId("zone_crosswalk_south"),
	crosswalkWest: parseZoneId("zone_crosswalk_west"),
	crosswalkEast: parseZoneId("zone_crosswalk_east"),
	curbYellowBox: parseZoneId("zone_curb_yellow_box"),
	curbWhiteBayNw: parseZoneId("zone_curb_white_bay_nw"),
	curbWhiteBaySw: parseZoneId("zone_curb_white_bay_sw"),
	curbArcadeSpotNw: parseZoneId("zone_curb_arcade_spot_nw"),
	curbArcadeSpotSw: parseZoneId("zone_curb_arcade_spot_sw"),
	curbArcadeSpotSe: parseZoneId("zone_curb_arcade_spot_se"),
	curbYellowSw: parseZoneId("zone_curb_yellow_sw"),
	curbYellowNe: parseZoneId("zone_curb_yellow_ne"),
	curbRedNw: parseZoneId("zone_curb_red_nw"),
	curbRedSw: parseZoneId("zone_curb_red_sw"),
	curbRedNe: parseZoneId("zone_curb_red_ne"),
	curbRedSe: parseZoneId("zone_curb_red_se"),
	alleyEast: parseZoneId("zone_alley_east"),
	alleyBufferNorth: parseZoneId("zone_alley_buffer_north"),
	alleyBufferSouth: parseZoneId("zone_alley_buffer_south"),
	hydrantNw: parseZoneId("zone_hydrant_nw"),
	hydrantSe: parseZoneId("zone_hydrant_se"),
} as const;

type ItemAnchorSpec = {
	readonly slotKey: string;
	readonly basePosition: WorldPoint;
	readonly jitterXMeters: number;
	readonly jitterYMeters: number;
	readonly hiddenNearFixtureId: string;
	readonly hidingSpotZh: string;
	readonly legalStandingZoneIds: readonly ZoneId[];
};

const STREET_ZONES: readonly StreetZone[] = [
	{
		kind: "roadway_lane",
		zoneId: ZONE_IDS.roadNsMain,
		bounds: { minXMeters: 8.5, minYMeters: 0, widthMeters: 19, depthMeters: 48 },
	},
	{
		kind: "roadway_lane",
		zoneId: ZONE_IDS.roadEwWest,
		bounds: { minXMeters: 0, minYMeters: 18, widthMeters: 8.5, depthMeters: 9 },
	},
	{
		kind: "roadway_lane",
		zoneId: ZONE_IDS.roadEwEast,
		bounds: { minXMeters: 27.5, minYMeters: 18, widthMeters: 8.5, depthMeters: 9 },
	},
	{
		kind: "arcade_walkway",
		zoneId: ZONE_IDS.arcadeNw,
		bounds: { minXMeters: 0, minYMeters: 0, widthMeters: 5.5, depthMeters: 18 },
	},
	{
		kind: "arcade_walkway",
		zoneId: ZONE_IDS.arcadeSw,
		bounds: { minXMeters: 0, minYMeters: 27, widthMeters: 5.5, depthMeters: 21 },
	},
	{
		kind: "arcade_walkway",
		zoneId: ZONE_IDS.arcadeNe,
		bounds: { minXMeters: 30.5, minYMeters: 0, widthMeters: 5.5, depthMeters: 18 },
	},
	{
		kind: "arcade_walkway",
		zoneId: ZONE_IDS.arcadeSeNorth,
		bounds: { minXMeters: 30.5, minYMeters: 27, widthMeters: 5.5, depthMeters: 8 },
	},
	{
		kind: "arcade_walkway",
		zoneId: ZONE_IDS.arcadeSeSouth,
		bounds: { minXMeters: 30.5, minYMeters: 39.5, widthMeters: 5.5, depthMeters: 8.5 },
	},
	{
		kind: "sidewalk",
		zoneId: ZONE_IDS.sidewalkNw,
		bounds: { minXMeters: 5.5, minYMeters: 0, widthMeters: 3, depthMeters: 18 },
	},
	{
		kind: "sidewalk",
		zoneId: ZONE_IDS.sidewalkSw,
		bounds: { minXMeters: 5.5, minYMeters: 27, widthMeters: 3, depthMeters: 21 },
	},
	{
		kind: "sidewalk",
		zoneId: ZONE_IDS.sidewalkNeNorth,
		bounds: { minXMeters: 27.5, minYMeters: 0, widthMeters: 3, depthMeters: 6 },
	},
	{
		kind: "sidewalk",
		zoneId: ZONE_IDS.sidewalkNeSouth,
		bounds: { minXMeters: 27.5, minYMeters: 11, widthMeters: 3, depthMeters: 7 },
	},
	{
		kind: "sidewalk",
		zoneId: ZONE_IDS.sidewalkSeNorth,
		bounds: { minXMeters: 27.5, minYMeters: 27, widthMeters: 3, depthMeters: 8 },
	},
	{
		kind: "sidewalk",
		zoneId: ZONE_IDS.sidewalkSeSouth,
		bounds: { minXMeters: 27.5, minYMeters: 39.5, widthMeters: 3, depthMeters: 8.5 },
	},
	{
		kind: "no_pedestrian_zone",
		zoneId: ZONE_IDS.noPedNe,
		bounds: { minXMeters: 27.5, minYMeters: 6, widthMeters: 3, depthMeters: 5 },
	},
	{
		kind: "unsignalized_alley_lane",
		zoneId: ZONE_IDS.alleyEast,
		bounds: { minXMeters: 27.5, minYMeters: 35.01, widthMeters: 8.5, depthMeters: 4.48 },
		requiredBufferZoneId: ZONE_IDS.alleyBufferNorth,
	},
	{
		kind: "alley_stop_buffer",
		zoneId: ZONE_IDS.alleyBufferNorth,
		bounds: { minXMeters: 27.5, minYMeters: 33.4, widthMeters: 8.5, depthMeters: 1.6 },
		guardedAlleyZoneId: ZONE_IDS.alleyEast,
	},
	{
		kind: "alley_stop_buffer",
		zoneId: ZONE_IDS.alleyBufferSouth,
		bounds: { minXMeters: 27.5, minYMeters: 39.5, widthMeters: 8.5, depthMeters: 1.5 },
		guardedAlleyZoneId: ZONE_IDS.alleyEast,
	},
	{
		kind: "signalized_crosswalk",
		zoneId: ZONE_IDS.crosswalkNorth,
		bounds: { minXMeters: 8.5, minYMeters: 15.2, widthMeters: 19, depthMeters: 2.8 },
		axis: "ew",
	},
	{
		kind: "signalized_crosswalk",
		zoneId: ZONE_IDS.crosswalkSouth,
		bounds: { minXMeters: 8.5, minYMeters: 27, widthMeters: 19, depthMeters: 2.8 },
		axis: "ew",
	},
	{
		kind: "signalized_crosswalk",
		zoneId: ZONE_IDS.crosswalkWest,
		bounds: { minXMeters: 5.5, minYMeters: 18, widthMeters: 3, depthMeters: 9 },
		axis: "ns",
	},
	{
		kind: "signalized_crosswalk",
		zoneId: ZONE_IDS.crosswalkEast,
		bounds: { minXMeters: 27.5, minYMeters: 18, widthMeters: 3, depthMeters: 9 },
		axis: "ns",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbYellowBox,
		bounds: { minXMeters: 11, minYMeters: 19.5, widthMeters: 14, depthMeters: 6 },
		marking: "yellow_box_junction",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbWhiteBayNw,
		bounds: { minXMeters: 8.5, minYMeters: 0.8, widthMeters: 2, depthMeters: 2.8 },
		marking: "white_parking_bay",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbWhiteBaySw,
		bounds: { minXMeters: 8.5, minYMeters: 40.5, widthMeters: 2, depthMeters: 5.5 },
		marking: "white_parking_bay",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbArcadeSpotNw,
		bounds: { minXMeters: 0.8, minYMeters: 11.2, widthMeters: 2.2, depthMeters: 3.4 },
		marking: "designated_arcade_spot",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbArcadeSpotSw,
		bounds: { minXMeters: 1.2, minYMeters: 40.5, widthMeters: 2.6, depthMeters: 4 },
		marking: "designated_arcade_spot",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbArcadeSpotSe,
		bounds: { minXMeters: 33.2, minYMeters: 43.2, widthMeters: 2.2, depthMeters: 3.6 },
		marking: "designated_arcade_spot",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbYellowSw,
		bounds: { minXMeters: 8.5, minYMeters: 34.5, widthMeters: 1.9, depthMeters: 5 },
		marking: "yellow_curb",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbYellowNe,
		bounds: { minXMeters: 25.6, minYMeters: 1.2, widthMeters: 1.9, depthMeters: 4.4 },
		marking: "yellow_curb",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbRedNw,
		bounds: { minXMeters: 8.5, minYMeters: 3.8, widthMeters: 1.7, depthMeters: 11.2 },
		marking: "red_curb",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbRedSw,
		bounds: { minXMeters: 8.5, minYMeters: 30, widthMeters: 1.7, depthMeters: 4.2 },
		marking: "red_curb",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbRedNe,
		bounds: { minXMeters: 25.8, minYMeters: 6, widthMeters: 1.7, depthMeters: 9 },
		marking: "red_curb",
	},
	{
		kind: "curb_marking",
		zoneId: ZONE_IDS.curbRedSe,
		bounds: { minXMeters: 25.8, minYMeters: 30, widthMeters: 1.7, depthMeters: 5 },
		marking: "red_curb",
	},
	{
		kind: "hydrant_red_zone",
		zoneId: ZONE_IDS.hydrantNw,
		center: { xMeters: 8.2, yMeters: 8.8 },
		radiusMeters: LEGAL_LIMITS.hydrantRadiusMeters,
	},
	{
		kind: "hydrant_red_zone",
		zoneId: ZONE_IDS.hydrantSe,
		center: { xMeters: 27.8, yMeters: 46.2 },
		radiusMeters: LEGAL_LIMITS.hydrantRadiusMeters,
	},
];

const STREET_FIXTURES: readonly StreetFixture[] = [
	{
		id: "fix_telecom_ne_utility",
		kind: "telecom_box",
		position: { xMeters: 30.8, yMeters: 11.3 },
		labelZh: "山水彩繪變電箱",
	},
	{
		id: "fix_telecom_sw_curb",
		kind: "telecom_box",
		position: { xMeters: 8.0, yMeters: 36.8 },
		labelZh: "中華電信交接箱",
	},
	{
		id: "fix_telecom_nw_corner",
		kind: "telecom_box",
		position: { xMeters: 6.1, yMeters: 2.6 },
		labelZh: "藍鵲彩繪電力箱",
	},
	{
		id: "fix_hydrant_nw",
		kind: "fire_hydrant",
		position: { xMeters: 8.2, yMeters: 8.8 },
		labelZh: "雙口地上式消防栓",
	},
	{
		id: "fix_hydrant_se",
		kind: "fire_hydrant",
		position: { xMeters: 27.8, yMeters: 46.2 },
		labelZh: "雙口地上式消防栓（巷南）",
	},
	{
		id: "fix_signal_ns_west",
		kind: "signal_pole",
		position: { xMeters: 7.9, yMeters: 17.5 },
		labelZh: "小綠人行人號誌（西側南北向）",
	},
	{
		id: "fix_signal_ns_east",
		kind: "signal_pole",
		position: { xMeters: 28.1, yMeters: 27.5 },
		labelZh: "小綠人行人號誌（東側南北向）",
	},
	{
		id: "fix_signal_ew_north",
		kind: "signal_pole",
		position: { xMeters: 28.1, yMeters: 17.5 },
		labelZh: "小綠人行人號誌（北側東西向）",
	},
	{
		id: "fix_signal_ew_south",
		kind: "signal_pole",
		position: { xMeters: 7.9, yMeters: 27.5 },
		labelZh: "小綠人行人號誌（南側東西向）",
	},
	{
		id: "fix_stop_alley_north",
		kind: "stop_sign_post",
		position: { xMeters: 28.2, yMeters: 34.4 },
		labelZh: "停（停車再開）標誌",
	},
	{
		id: "fix_stop_alley_south",
		kind: "stop_sign_post",
		position: { xMeters: 28.2, yMeters: 40.2 },
		labelZh: "停（停車再開）標誌（南向）",
	},
	{
		id: "fix_no_ped_ne",
		kind: "no_pedestrian_sign",
		position: { xMeters: 30.7, yMeters: 6.3 },
		labelZh: "禁止行人通行標誌",
	},
	{
		id: "fix_one_way_alley",
		kind: "one_way_sign",
		position: { xMeters: 30.2, yMeters: 34.8 },
		labelZh: "單行道標誌",
	},
	{
		id: "fix_one_way_cross",
		kind: "one_way_sign",
		position: { xMeters: 6.1, yMeters: 17.6 },
		labelZh: "遵行方向標誌",
	},
	{
		id: "fix_warn_ped_north",
		kind: "warning_pedestrian_sign",
		position: { xMeters: 8.0, yMeters: 14.6 },
		labelZh: "當心行人警告標誌",
	},
	{
		id: "fix_warn_ped_south",
		kind: "warning_pedestrian_sign",
		position: { xMeters: 28.0, yMeters: 30.4 },
		labelZh: "當心行人警告標誌（南段）",
	},
	{
		id: "fix_pillar_nw_1",
		kind: "arcade_pillar",
		position: { xMeters: 5.3, yMeters: 5.8 },
		labelZh: "騎樓洗石子方柱（西北一）",
	},
	{
		id: "fix_pillar_nw_2",
		kind: "arcade_pillar",
		position: { xMeters: 5.3, yMeters: 13.4 },
		labelZh: "騎樓洗石子方柱（西北二）",
	},
	{
		id: "fix_pillar_sw_1",
		kind: "arcade_pillar",
		position: { xMeters: 5.3, yMeters: 32.2 },
		labelZh: "騎樓洗石子方柱（西南一）",
	},
	{
		id: "fix_pillar_sw_2",
		kind: "arcade_pillar",
		position: { xMeters: 5.3, yMeters: 45.2 },
		labelZh: "騎樓洗石子方柱（西南二）",
	},
	{
		id: "fix_pillar_ne_1",
		kind: "arcade_pillar",
		position: { xMeters: 30.7, yMeters: 3.2 },
		labelZh: "騎樓紅磚拱柱（東北）",
	},
	{
		id: "fix_pillar_se_1",
		kind: "arcade_pillar",
		position: { xMeters: 30.7, yMeters: 31.2 },
		labelZh: "騎樓紅磚拱柱（東南）",
	},
];

const ITEM_ANCHORS: readonly ItemAnchorSpec[] = [
	{
		slotKey: "telecom_ne_arcade_side",
		basePosition: { xMeters: 30.9, yMeters: 10.6 },
		jitterXMeters: 0.14,
		jitterYMeters: 0.14,
		hiddenNearFixtureId: "fix_telecom_ne_utility",
		hidingSpotZh: "山水彩繪變電箱騎樓側底座",
		legalStandingZoneIds: [ZONE_IDS.arcadeNe, ZONE_IDS.sidewalkNeSouth],
	},
	{
		slotKey: "telecom_ne_south_ledge",
		basePosition: { xMeters: 29.8, yMeters: 11.7 },
		jitterXMeters: 0.14,
		jitterYMeters: 0.12,
		hiddenNearFixtureId: "fix_telecom_ne_utility",
		hidingSpotZh: "變電箱南側合法步道角落",
		legalStandingZoneIds: [ZONE_IDS.sidewalkNeSouth, ZONE_IDS.arcadeNe],
	},
	{
		slotKey: "no_ped_sign_safe_edge",
		basePosition: { xMeters: 31.0, yMeters: 6.4 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.12,
		hiddenNearFixtureId: "fix_no_ped_ne",
		hidingSpotZh: "禁止行人標誌旁騎樓內側",
		legalStandingZoneIds: [ZONE_IDS.arcadeNe, ZONE_IDS.sidewalkNeNorth],
	},
	{
		slotKey: "telecom_sw_north_flank",
		basePosition: { xMeters: 7.5, yMeters: 35.8 },
		jitterXMeters: 0.14,
		jitterYMeters: 0.14,
		hiddenNearFixtureId: "fix_telecom_sw_curb",
		hidingSpotZh: "中華電信交接箱北側箱腳",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSw, ZONE_IDS.arcadeSw],
	},
	{
		slotKey: "telecom_sw_south_flank",
		basePosition: { xMeters: 7.5, yMeters: 38.0 },
		jitterXMeters: 0.14,
		jitterYMeters: 0.14,
		hiddenNearFixtureId: "fix_telecom_sw_curb",
		hidingSpotZh: "中華電信交接箱黃線旁步道側",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSw, ZONE_IDS.arcadeSw],
	},
	{
		slotKey: "telecom_nw_corner_base",
		basePosition: { xMeters: 6.5, yMeters: 2.3 },
		jitterXMeters: 0.15,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_telecom_nw_corner",
		hidingSpotZh: "藍鵲彩繪電力箱後方水泥基座",
		legalStandingZoneIds: [ZONE_IDS.sidewalkNw, ZONE_IDS.arcadeNw],
	},
	{
		slotKey: "hydrant_nw_curbside",
		basePosition: { xMeters: 7.5, yMeters: 8.6 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_hydrant_nw",
		hidingSpotZh: "西北側消防栓紅線旁步道邊",
		legalStandingZoneIds: [ZONE_IDS.sidewalkNw, ZONE_IDS.arcadeNw],
	},
	{
		slotKey: "hydrant_nw_south_step",
		basePosition: { xMeters: 7.4, yMeters: 10.6 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.14,
		hiddenNearFixtureId: "fix_hydrant_nw",
		hidingSpotZh: "西北消防栓南向淨空圈內步道",
		legalStandingZoneIds: [ZONE_IDS.sidewalkNw, ZONE_IDS.arcadeNw],
	},
	{
		slotKey: "hydrant_se_curbside",
		basePosition: { xMeters: 28.5, yMeters: 45.8 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_hydrant_se",
		hidingSpotZh: "東南側地上式消防栓旁步道",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSeSouth, ZONE_IDS.arcadeSeSouth],
	},
	{
		slotKey: "hydrant_se_arcade_edge",
		basePosition: { xMeters: 30.1, yMeters: 44.2 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_hydrant_se",
		hidingSpotZh: "東南消防栓斜後方騎樓台階",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSeSouth, ZONE_IDS.arcadeSeSouth],
	},
	{
		slotKey: "signal_nw_pole_base",
		basePosition: { xMeters: 7.3, yMeters: 16.9 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.12,
		hiddenNearFixtureId: "fix_signal_ns_west",
		hidingSpotZh: "西北角小綠人號誌桿底座",
		legalStandingZoneIds: [ZONE_IDS.sidewalkNw, ZONE_IDS.arcadeNw],
	},
	{
		slotKey: "signal_ne_pole_base",
		basePosition: { xMeters: 28.7, yMeters: 16.9 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.12,
		hiddenNearFixtureId: "fix_signal_ew_north",
		hidingSpotZh: "東北角小綠人號誌控制箱旁",
		legalStandingZoneIds: [ZONE_IDS.sidewalkNeSouth, ZONE_IDS.arcadeNe],
	},
	{
		slotKey: "signal_sw_pole_base",
		basePosition: { xMeters: 7.3, yMeters: 28.3 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.12,
		hiddenNearFixtureId: "fix_signal_ew_south",
		hidingSpotZh: "西南角小綠人行人觸動鈕柱腳",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSw, ZONE_IDS.arcadeSw],
	},
	{
		slotKey: "signal_se_pole_base",
		basePosition: { xMeters: 28.7, yMeters: 28.3 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.12,
		hiddenNearFixtureId: "fix_signal_ns_east",
		hidingSpotZh: "東南角小綠人號誌桿側邊",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSeNorth, ZONE_IDS.arcadeSeNorth],
	},
	{
		slotKey: "stop_sign_north_post",
		basePosition: { xMeters: 28.8, yMeters: 34.1 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.1,
		hiddenNearFixtureId: "fix_stop_alley_north",
		hidingSpotZh: "北側巷口「停」標誌桿下",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSeNorth, ZONE_IDS.arcadeSeNorth],
	},
	{
		slotKey: "stop_sign_south_post",
		basePosition: { xMeters: 28.8, yMeters: 40.5 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.1,
		hiddenNearFixtureId: "fix_stop_alley_south",
		hidingSpotZh: "南側紅磚巷口「停」標誌旁",
		legalStandingZoneIds: [ZONE_IDS.sidewalkSeSouth, ZONE_IDS.arcadeSeSouth],
	},
	{
		slotKey: "one_way_alley_corner",
		basePosition: { xMeters: 31.3, yMeters: 34.2 },
		jitterXMeters: 0.14,
		jitterYMeters: 0.1,
		hiddenNearFixtureId: "fix_one_way_alley",
		hidingSpotZh: "紅磚巷口單行道標誌騎樓轉角",
		legalStandingZoneIds: [ZONE_IDS.arcadeSeNorth, ZONE_IDS.sidewalkSeNorth],
	},
	{
		slotKey: "warn_ped_north_post",
		basePosition: { xMeters: 7.4, yMeters: 14.3 },
		jitterXMeters: 0.12,
		jitterYMeters: 0.12,
		hiddenNearFixtureId: "fix_warn_ped_north",
		hidingSpotZh: "北段當心行人標誌鐵桿下",
		legalStandingZoneIds: [ZONE_IDS.sidewalkNw, ZONE_IDS.arcadeNw],
	},
	{
		slotKey: "pillar_nw_1_nook",
		basePosition: { xMeters: 4.8, yMeters: 5.5 },
		jitterXMeters: 0.15,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_pillar_nw_1",
		hidingSpotZh: "美而美騎樓洗石子方柱內側",
		legalStandingZoneIds: [ZONE_IDS.arcadeNw, ZONE_IDS.sidewalkNw],
	},
	{
		slotKey: "pillar_nw_2_nook",
		basePosition: { xMeters: 4.8, yMeters: 13.1 },
		jitterXMeters: 0.15,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_pillar_nw_2",
		hidingSpotZh: "青草茶店前騎樓方柱旁",
		legalStandingZoneIds: [ZONE_IDS.arcadeNw, ZONE_IDS.sidewalkNw],
	},
	{
		slotKey: "pillar_sw_1_nook",
		basePosition: { xMeters: 4.8, yMeters: 32.0 },
		jitterXMeters: 0.15,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_pillar_sw_1",
		hidingSpotZh: "老街切仔麵騎樓柱腳邊",
		legalStandingZoneIds: [ZONE_IDS.arcadeSw, ZONE_IDS.sidewalkSw],
	},
	{
		slotKey: "pillar_sw_2_nook",
		basePosition: { xMeters: 4.7, yMeters: 45.4 },
		jitterXMeters: 0.15,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_pillar_sw_2",
		hidingSpotZh: "西南騎樓尾段方柱轉角",
		legalStandingZoneIds: [ZONE_IDS.arcadeSw, ZONE_IDS.sidewalkSw],
	},
	{
		slotKey: "pillar_ne_1_nook",
		basePosition: { xMeters: 31.3, yMeters: 3.1 },
		jitterXMeters: 0.15,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_pillar_ne_1",
		hidingSpotZh: "東北騎樓紅磚拱柱內側",
		legalStandingZoneIds: [ZONE_IDS.arcadeNe, ZONE_IDS.sidewalkNeNorth],
	},
	{
		slotKey: "pillar_se_1_nook",
		basePosition: { xMeters: 31.3, yMeters: 31.0 },
		jitterXMeters: 0.15,
		jitterYMeters: 0.15,
		hiddenNearFixtureId: "fix_pillar_se_1",
		hidingSpotZh: "永康柑仔店騎樓拱柱腳",
		legalStandingZoneIds: [ZONE_IDS.arcadeSeNorth, ZONE_IDS.sidewalkSeNorth],
	},
];

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function deterministicShuffle<T>(items: readonly T[], rng: () => number): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = copy[i];
		const target = copy[j];
		if (tmp !== undefined && target !== undefined) {
			copy[i] = target;
			copy[j] = tmp;
		}
	}
	return copy;
}

function buildRecyclablePool(rng: () => number): RecyclableKind[] {
	const allKinds = RecyclableKindSchema.options;
	const base: RecyclableKind[] = [
		...allKinds,
		...allKinds,
		"pet_bottle",
		"aluminum_can",
		"clean_cardboard",
		"waste_battery",
	];
	return deterministicShuffle(base, rng);
}

function buildContaminantPool(rng: () => number): ContaminantKind[] {
	const allKinds = ContaminantKindSchema.options;
	const base: ContaminantKind[] = [
		...allKinds,
		allKinds[Math.floor(rng() * allKinds.length)] ?? "greasy_lunchbox",
		allKinds[Math.floor(rng() * allKinds.length)] ?? "cigarette_butt",
	];
	return deterministicShuffle(base, rng);
}

function pointInBounds(p: WorldPoint, bounds: MeterBounds): boolean {
	return (
		p.xMeters >= bounds.minXMeters &&
		p.xMeters <= bounds.minXMeters + bounds.widthMeters &&
		p.yMeters >= bounds.minYMeters &&
		p.yMeters <= bounds.minYMeters + bounds.depthMeters
	);
}

function zoneContainsPoint(zone: StreetZone, p: WorldPoint): boolean {
	if (zone.kind === "hydrant_red_zone") {
		return (
			Math.hypot(p.xMeters - zone.center.xMeters, p.yMeters - zone.center.yMeters) <=
			zone.radiusMeters
		);
	}
	return pointInBounds(p, zone.bounds);
}

const ZONE_PRIORITY: Readonly<Record<StreetZone["kind"], number>> = {
	no_pedestrian_zone: 90,
	hydrant_red_zone: 80,
	unsignalized_alley_lane: 70,
	alley_stop_buffer: 60,
	signalized_crosswalk: 50,
	curb_marking: 40,
	sidewalk: 30,
	arcade_walkway: 20,
	roadway_lane: 10,
};

export function resolveZonesAtPoint(
	layout: StreetLayout,
	p: WorldPoint,
): readonly StreetZone[] {
	return layout.zones.filter((zone) => zoneContainsPoint(zone, p));
}

export function resolvePrimaryZoneId(layout: StreetLayout, p: WorldPoint): ZoneId {
	const matching = resolveZonesAtPoint(layout, p);
	let bestZone: StreetZone | undefined;
	let bestPriority = -1;
	for (const zone of matching) {
		const priority = ZONE_PRIORITY[zone.kind];
		if (priority > bestPriority) {
			bestPriority = priority;
			bestZone = zone;
		}
	}
	return bestZone ? bestZone.zoneId : layout.spawnZoneId;
}

export function createStreetLayout(seed: number): StreetLayout {
	const rng = mulberry32(seed);
	const anchorOrder = deterministicShuffle(
		ITEM_ANCHORS.map((_, idx) => idx),
		rng,
	);
	const contaminantIndices = new Set(anchorOrder.slice(0, 6));
	const recyclablePool = buildRecyclablePool(rng);
	const contaminantPool = buildContaminantPool(rng);

	let recIdx = 0;
	let contIdx = 0;

	const initialItems: WorldItem[] = ITEM_ANCHORS.map((anchor, index) => {
		const dx = (rng() * 2 - 1) * anchor.jitterXMeters;
		const dy = (rng() * 2 - 1) * anchor.jitterYMeters;
		const position: WorldPoint = {
			xMeters: Number((anchor.basePosition.xMeters + dx).toFixed(2)),
			yMeters: Number((anchor.basePosition.yMeters + dy).toFixed(2)),
		};
		const itemId = parseItemId(`item_${String(index + 1).padStart(2, "0")}_${anchor.slotKey}`);

		if (contaminantIndices.has(index)) {
			const kind = contaminantPool[contIdx] ?? "greasy_lunchbox";
			contIdx += 1;
			return {
				category: "contaminant",
				itemId,
				kind,
				position,
				hiddenNearFixtureId: anchor.hiddenNearFixtureId,
				hidingSpotZh: anchor.hidingSpotZh,
				collected: false,
			};
		}

		const kind = recyclablePool[recIdx] ?? "pet_bottle";
		recIdx += 1;
		return {
			category: "recyclable",
			itemId,
			kind,
			position,
			hiddenNearFixtureId: anchor.hiddenNearFixtureId,
			hidingSpotZh: anchor.hidingSpotZh,
			legalStandingZoneIds: anchor.legalStandingZoneIds,
			collected: false,
		};
	});

	const zonesById = new Map<ZoneId, StreetZone>();
	for (const zone of STREET_ZONES) {
		zonesById.set(zone.zoneId, zone);
	}

	const spawnPoint: WorldPoint = { xMeters: 6.8, yMeters: 42.5 };
	const spawnZoneId = ZONE_IDS.sidewalkSw;

	return {
		widthMeters: MAP_WIDTH_METERS,
		depthMeters: MAP_DEPTH_METERS,
		spawnPoint,
		spawnZoneId,
		zones: STREET_ZONES,
		zonesById,
		fixtures: STREET_FIXTURES,
		initialItems,
	};
}
