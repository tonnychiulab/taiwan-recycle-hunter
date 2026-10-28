import { z } from "zod";

export type NonEmpty<T> = readonly [T, ...T[]];

export type ParseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: string };

export type SessionId = string & { readonly __brand: "SessionId" };
export type ItemId = string & { readonly __brand: "ItemId" };
export type ZoneId = string & { readonly __brand: "ZoneId" };
export type CaptureId = string & { readonly __brand: "CaptureId" };

const SESSION_ID_RE = /^sess_[a-zA-Z0-9_-]{12,64}$/;
const ITEM_ID_RE = /^item_[a-zA-Z0-9_-]{2,64}$/;
const ZONE_ID_RE = /^zone_[a-zA-Z0-9_-]{2,64}$/;
const CAPTURE_ID_RE = /^cap_[a-zA-Z0-9_-]{2,64}$/;

export function isSessionId(input: string): input is SessionId {
	return SESSION_ID_RE.test(input);
}

export function isItemId(input: string): input is ItemId {
	return ITEM_ID_RE.test(input);
}

export function isZoneId(input: string): input is ZoneId {
	return ZONE_ID_RE.test(input);
}

export function isCaptureId(input: string): input is CaptureId {
	return CAPTURE_ID_RE.test(input);
}

export function parseSessionId(input: string): SessionId {
	if (!isSessionId(input)) {
		throw new Error(`Invalid SessionId: ${input}`);
	}
	return input;
}

export function parseItemId(input: string): ItemId {
	if (!isItemId(input)) {
		throw new Error(`Invalid ItemId: ${input}`);
	}
	return input;
}

export function parseZoneId(input: string): ZoneId {
	if (!isZoneId(input)) {
		throw new Error(`Invalid ZoneId: ${input}`);
	}
	return input;
}

export function parseCaptureId(input: string): CaptureId {
	if (!isCaptureId(input)) {
		throw new Error(`Invalid CaptureId: ${input}`);
	}
	return input;
}

function brandedStringSchema<T extends string>(
	guard: (input: string) => input is T,
	label: string,
) {
	return z.string().transform((val, ctx): T => {
		if (!guard(val)) {
			ctx.addIssue({ code: "custom", message: `Invalid ${label}` });
			return z.NEVER;
		}
		return val;
	});
}

export const SessionIdSchema = brandedStringSchema(isSessionId, "SessionId");
export const ItemIdSchema = brandedStringSchema(isItemId, "ItemId");
export const ZoneIdSchema = brandedStringSchema(isZoneId, "ZoneId");
export const CaptureIdSchema = brandedStringSchema(isCaptureId, "CaptureId");

export const RecyclableKindSchema = z.enum([
	"pet_bottle",
	"aluminum_can",
	"tin_can",
	"clean_cardboard",
	"glass_bottle",
	"waste_battery",
	"old_electronics",
]);
export type RecyclableKind = z.infer<typeof RecyclableKindSchema>;

export const ContaminantKindSchema = z.enum([
	"greasy_lunchbox",
	"used_tissue",
	"cigarette_butt",
	"soiled_plastic_bag",
]);
export type ContaminantKind = z.infer<typeof ContaminantKindSchema>;

export const PrepStepSchema = z.enum(["clean", "sort", "compress"]);
export type PrepStep = z.infer<typeof PrepStepSchema>;

export const ViolationKindSchema = z.enum([
	"crosswalk_entered_on_red",
	"crosswalk_entered_on_flashing_green",
	"jaywalking_outside_crosswalk",
	"hydrant_cart_intrusion",
	"hydrant_on_foot_linger",
	"red_curb_cart_violation",
	"yellow_box_cart_violation",
	"yellow_curb_parking_overstay",
	"stop_sign_check_skipped",
	"entered_no_pedestrian_zone",
]);
export type ViolationKind = z.infer<typeof ViolationKindSchema>;

export const OrientationUsedSchema = z.enum(["portrait", "landscape", "both"]);
export type OrientationUsed = z.infer<typeof OrientationUsedSchema>;

export const HighlightReasonKindSchema = z.enum([
	"green_crosswalk_combo",
	"hydrant_clutch_grab",
	"yellow_curb_pitstop",
	"telecom_box_jackpot",
	"stop_sign_textbook_cross",
	"clean_sort_compress_triad",
]);
export type HighlightReasonKind = z.infer<typeof HighlightReasonKindSchema>;

export const LEGAL_LIMITS = {
	roundDurationMs: 75_000,
	sessionTtlMs: 600_000,
	hydrantRadiusMeters: 5.0,
	hydrantOnFootMaxMs: 3_000,
	yellowCurbMaxParkMs: 3_000,
	alleyStopSignMinPauseMs: 400,
	stopSignStationarySpeedMps: 0.25,
	highlightCooldownMs: 4_000,
	highlightTopLimit: 3,
	handCarryMaxItems: 4,
	pickupRadiusMeters: 2.1,
	cartRejoinRadiusMeters: 2.3,
	minPlausiblePickupIntervalMs: 160,
	minPlausibleRunDurationMs: 5_000,
} as const;

export type RecyclableSpec = {
	readonly kind: RecyclableKind;
	readonly nameZh: string;
	readonly basePoints: number;
	readonly co2SavedGrams: number;
	readonly prepStep: PrepStep;
	readonly prepLabelZh: string;
	readonly reuseFactZh: string;
	readonly excitementBase: number;
};

export const RECYCLABLE_CATALOG = {
	pet_bottle: {
		kind: "pet_bottle",
		nameZh: "透明寶特瓶",
		basePoints: 100,
		co2SavedGrams: 65,
		prepStep: "compress",
		prepLabelZh: "排空壓扁",
		reuseFactZh: "可抽絲再製為機能環保球衣與織品",
		excitementBase: 18,
	},
	aluminum_can: {
		kind: "aluminum_can",
		nameZh: "乾淨鋁罐",
		basePoints: 130,
		co2SavedGrams: 180,
		prepStep: "compress",
		prepLabelZh: "沖淨壓扁",
		reuseFactZh: "再生鋁可節省 95% 原礦冶煉能耗",
		excitementBase: 24,
	},
	tin_can: {
		kind: "tin_can",
		nameZh: "馬口鐵罐",
		basePoints: 115,
		co2SavedGrams: 95,
		prepStep: "clean",
		prepLabelZh: "沖洗殘渣",
		reuseFactZh: "磁選分離後可回爐熔煉再生鋼材",
		excitementBase: 20,
	},
	clean_cardboard: {
		kind: "clean_cardboard",
		nameZh: "乾淨瓦楞紙箱",
		basePoints: 120,
		co2SavedGrams: 140,
		prepStep: "compress",
		prepLabelZh: "拆膠攤平",
		reuseFactZh: "散漿再製為再生紙箱，減少林木砍伐",
		excitementBase: 21,
	},
	glass_bottle: {
		kind: "glass_bottle",
		nameZh: "三色玻璃瓶",
		basePoints: 140,
		co2SavedGrams: 160,
		prepStep: "clean",
		prepLabelZh: "排空分色",
		reuseFactZh: "分色粉碎後可重熔再製容器或透水磚",
		excitementBase: 25,
	},
	waste_battery: {
		kind: "waste_battery",
		nameZh: "廢乾電池組",
		basePoints: 220,
		co2SavedGrams: 260,
		prepStep: "sort",
		prepLabelZh: "獨立分裝",
		reuseFactZh: "提煉鋅、錳、鐵與鈷，防止土壤重金屬污染",
		excitementBase: 38,
	},
	old_electronics: {
		kind: "old_electronics",
		nameZh: "廢資訊筆電手機",
		basePoints: 320,
		co2SavedGrams: 580,
		prepStep: "sort",
		prepLabelZh: "完好歸類",
		reuseFactZh: "城市礦山，可精煉回收金、銀、銅、鈀貴金屬",
		excitementBase: 52,
	},
} satisfies Readonly<Record<RecyclableKind, RecyclableSpec>>;

export type ContaminantSpec = {
	readonly kind: ContaminantKind;
	readonly nameZh: string;
	readonly penaltyPoints: number;
	readonly rejectReasonZh: string;
};

export const CONTAMINANT_CATALOG = {
	greasy_lunchbox: {
		kind: "greasy_lunchbox",
		nameZh: "油膩未洗便當盒",
		penaltyPoints: 140,
		rejectReasonZh: "嚴重油污屬一般垃圾，混入會污染整袋紙類資源！",
	},
	used_tissue: {
		kind: "used_tissue",
		nameZh: "用過衛生紙",
		penaltyPoints: 110,
		rejectReasonZh: "短纖維且受污染不可再生，屬於一般廢棄物！",
	},
	cigarette_butt: {
		kind: "cigarette_butt",
		nameZh: "菸蒂與濾嘴",
		penaltyPoints: 120,
		rejectReasonZh: "醋酸纖維含焦油毒素不可回收，誤撿扣分！",
	},
	soiled_plastic_bag: {
		kind: "soiled_plastic_bag",
		nameZh: "髒污破塑膠袋",
		penaltyPoints: 130,
		rejectReasonZh: "沾染廚餘湯汁之塑膠袋屬一般垃圾，不可混入資收車！",
	},
} satisfies Readonly<Record<ContaminantKind, ContaminantSpec>>;

export type ViolationSpec = {
	readonly kind: ViolationKind;
	readonly penaltyPoints: number;
	readonly titleZh: string;
	readonly lawCiteZh: string;
};

export const VIOLATION_CATALOG = {
	crosswalk_entered_on_red: {
		kind: "crosswalk_entered_on_red",
		penaltyPoints: 180,
		titleZh: "小紅人闖越行穿線",
		lawCiteZh: "道交條例 §78：行人須依小綠人號誌指示穿越馬路",
	},
	crosswalk_entered_on_flashing_green: {
		kind: "crosswalk_entered_on_flashing_green",
		penaltyPoints: 110,
		titleZh: "小綠人閃爍時搶先踏入",
		lawCiteZh: "號誌規則 §207：閃光綠燈表示時間不足，尚未進入者禁止跨入",
	},
	jaywalking_outside_crosswalk: {
		kind: "jaywalking_outside_crosswalk",
		penaltyPoints: 170,
		titleZh: "未走行人穿越道橫越車道",
		lawCiteZh: "道交規則 §134：設有行穿線處不得任意穿越車道",
	},
	hydrant_cart_intrusion: {
		kind: "hydrant_cart_intrusion",
		penaltyPoints: 190,
		titleZh: "回收推車闖入消防栓 5 公尺禁區",
		lawCiteZh: "道交規則 §111：消防栓前 5 公尺內嚴禁臨時停車或推車停置",
	},
	hydrant_on_foot_linger: {
		kind: "hydrant_on_foot_linger",
		penaltyPoints: 130,
		titleZh: "消防栓周邊逗留逾 3 秒阻礙救災",
		lawCiteZh: "消防淨空規範：徒步取物後請立即離開消防栓 5 公尺範圍",
	},
	red_curb_cart_violation: {
		kind: "red_curb_cart_violation",
		penaltyPoints: 160,
		titleZh: "手推車壓行或停放禁止臨停紅線",
		lawCiteZh: "道交標線 §169：紅實線全日禁止臨時停車",
	},
	yellow_box_cart_violation: {
		kind: "yellow_box_cart_violation",
		penaltyPoints: 175,
		titleZh: "手推車進入路口黃色網狀線",
		lawCiteZh: "道交標線 §173：網狀線告示路口淨空，嚴禁暫停滯留",
	},
	yellow_curb_parking_overstay: {
		kind: "yellow_curb_parking_overstay",
		penaltyPoints: 125,
		titleZh: "黃線臨停裝載逾 3 秒未駛離",
		lawCiteZh: "道交標線 §168：黃實線僅供短暫臨停裝卸，逾時視同違停",
	},
	stop_sign_check_skipped: {
		kind: "stop_sign_check_skipped",
		penaltyPoints: 150,
		titleZh: "無號誌巷口未依「停」標誌停看聽",
		lawCiteZh: "道交標誌 §58：遇八角形「停」標誌須暫停確認無來車始得通過",
	},
	entered_no_pedestrian_zone: {
		kind: "entered_no_pedestrian_zone",
		penaltyPoints: 165,
		titleZh: "闖入禁止行人通行區或危險變電側",
		lawCiteZh: "道交標誌 §73 與電信安全規範：請由合法騎樓或人行道側取物",
	},
} satisfies Readonly<Record<ViolationKind, ViolationSpec>>;

export type RecyclableTallies = Readonly<Record<RecyclableKind, number>>;
export type ContaminantTallies = Readonly<Record<ContaminantKind, number>>;
export type ViolationTallies = Readonly<Record<ViolationKind, number>>;

const NonNegInt = z.number().int().nonnegative();

export const RecyclableTalliesSchema: z.ZodType<RecyclableTallies> = z.object({
	pet_bottle: NonNegInt,
	aluminum_can: NonNegInt,
	tin_can: NonNegInt,
	clean_cardboard: NonNegInt,
	glass_bottle: NonNegInt,
	waste_battery: NonNegInt,
	old_electronics: NonNegInt,
});

export const ContaminantTalliesSchema: z.ZodType<ContaminantTallies> = z.object({
	greasy_lunchbox: NonNegInt,
	used_tissue: NonNegInt,
	cigarette_butt: NonNegInt,
	soiled_plastic_bag: NonNegInt,
});

export const ViolationTalliesSchema: z.ZodType<ViolationTallies> = z.object({
	crosswalk_entered_on_red: NonNegInt,
	crosswalk_entered_on_flashing_green: NonNegInt,
	jaywalking_outside_crosswalk: NonNegInt,
	hydrant_cart_intrusion: NonNegInt,
	hydrant_on_foot_linger: NonNegInt,
	red_curb_cart_violation: NonNegInt,
	yellow_box_cart_violation: NonNegInt,
	yellow_curb_parking_overstay: NonNegInt,
	stop_sign_check_skipped: NonNegInt,
	entered_no_pedestrian_zone: NonNegInt,
});

export function createEmptyRecyclableTallies(): RecyclableTallies {
	return {
		pet_bottle: 0,
		aluminum_can: 0,
		tin_can: 0,
		clean_cardboard: 0,
		glass_bottle: 0,
		waste_battery: 0,
		old_electronics: 0,
	};
}

export function createEmptyContaminantTallies(): ContaminantTallies {
	return {
		greasy_lunchbox: 0,
		used_tissue: 0,
		cigarette_butt: 0,
		soiled_plastic_bag: 0,
	};
}

export function createEmptyViolationTallies(): ViolationTallies {
	return {
		crosswalk_entered_on_red: 0,
		crosswalk_entered_on_flashing_green: 0,
		jaywalking_outside_crosswalk: 0,
		hydrant_cart_intrusion: 0,
		hydrant_on_foot_linger: 0,
		red_curb_cart_violation: 0,
		yellow_box_cart_violation: 0,
		yellow_curb_parking_overstay: 0,
		stop_sign_check_skipped: 0,
		entered_no_pedestrian_zone: 0,
	};
}

export function deriveRecycledCount(tallies: RecyclableTallies): number {
	return (
		tallies.pet_bottle +
		tallies.aluminum_can +
		tallies.tin_can +
		tallies.clean_cardboard +
		tallies.glass_bottle +
		tallies.waste_battery +
		tallies.old_electronics
	);
}

export function deriveCo2SavedGrams(tallies: RecyclableTallies): number {
	let grams = 0;
	for (const kind of RecyclableKindSchema.options) {
		grams += tallies[kind] * RECYCLABLE_CATALOG[kind].co2SavedGrams;
	}
	return grams;
}

export function deriveContaminantCount(tallies: ContaminantTallies): number {
	return (
		tallies.greasy_lunchbox +
		tallies.used_tissue +
		tallies.cigarette_butt +
		tallies.soiled_plastic_bag
	);
}

export function deriveViolationCount(tallies: ViolationTallies): number {
	let total = 0;
	for (const kind of ViolationKindSchema.options) {
		total += tallies[kind];
	}
	return total;
}

export const SessionStartResponseSchema = z.object({
	sessionId: SessionIdSchema,
	alias: z.string().min(2).max(20),
	seed: NonNegInt,
	issuedAtMs: NonNegInt,
	roundDurationMs: z.number().int().positive(),
	signature: z.string().min(32).max(128),
});
export type SessionStartResponse = z.infer<typeof SessionStartResponseSchema>;

export const VerifiedPickupClaimSchema = z.object({
	itemId: ItemIdSchema,
	kind: RecyclableKindSchema,
	atElapsedMs: NonNegInt,
	standingZoneId: ZoneIdSchema,
	awardedPoints: NonNegInt,
});
export type VerifiedPickupClaim = z.infer<typeof VerifiedPickupClaimSchema>;

export const SubmitScorePayloadSchema = z.object({
	sessionId: SessionIdSchema,
	signature: z.string().min(32).max(128),
	alias: z.string().trim().min(2).max(16).optional(),
	durationMs: z.number().int().min(LEGAL_LIMITS.minPlausibleRunDurationMs).max(120_000),
	score: z.number().int().min(0).max(60_000),
	recyclableTallies: RecyclableTalliesSchema,
	contaminantTallies: ContaminantTalliesSchema,
	violationTallies: ViolationTalliesSchema,
	triadsCompleted: NonNegInt.max(100),
	orientationUsed: OrientationUsedSchema,
	pickupClaims: z.array(VerifiedPickupClaimSchema).max(200),
});
export type SubmitScorePayload = z.infer<typeof SubmitScorePayloadSchema>;

export const LeaderboardScopeSchema = z.enum(["daily", "all_time"]);
export type LeaderboardScope = z.infer<typeof LeaderboardScopeSchema>;

export const LeaderboardEntrySchema = z.object({
	rank: z.number().int().positive(),
	sessionId: SessionIdSchema,
	alias: z.string().min(2).max(20),
	score: NonNegInt,
	recycledCount: NonNegInt,
	complianceRate: z.number().int().min(0).max(100),
	co2SavedGrams: NonNegInt,
	orientationUsed: OrientationUsedSchema,
	createdAtMs: NonNegInt,
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const CallerPlacementSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unranked") }),
	z.object({
		kind: z.literal("ranked"),
		rank: z.number().int().positive(),
		percentile: z.number().int().min(1).max(100),
		entry: LeaderboardEntrySchema,
	}),
]);
export type CallerPlacement = z.infer<typeof CallerPlacementSchema>;

export const LeaderboardResponseSchema = z.object({
	scope: LeaderboardScopeSchema,
	dayBucket: z.string().min(8).max(16),
	generatedAtMs: NonNegInt,
	entries: z.array(LeaderboardEntrySchema).max(50),
	callerPlacement: CallerPlacementSchema,
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export function parseSessionStartResponse(raw: unknown): ParseResult<SessionStartResponse> {
	const parsed = SessionStartResponseSchema.safeParse(raw);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
}

export function parseSubmitScorePayload(raw: unknown): ParseResult<SubmitScorePayload> {
	const parsed = SubmitScorePayloadSchema.safeParse(raw);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
}

export function parseLeaderboardResponse(raw: unknown): ParseResult<LeaderboardResponse> {
	const parsed = LeaderboardResponseSchema.safeParse(raw);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
}
