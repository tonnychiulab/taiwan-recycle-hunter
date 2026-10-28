import {
	LEGAL_LIMITS,
	RECYCLABLE_CATALOG,
	parseCaptureId,
	type HighlightReasonKind,
} from "../shared/contracts.ts";
import type {
	HighlightMeta,
	HighlightReel,
	HighlightShot,
	RunEvent,
	RunState,
} from "./types.ts";

const STREAK_EXCITEMENT_WEIGHT = 12;
const TRIAD_EXCITEMENT_BONUS = 35;

const REASON_BADGE_ZH: Readonly<Record<HighlightReasonKind, string>> = {
	green_crosswalk_combo: "小綠人合法通行連段",
	hydrant_clutch_grab: "消防栓 3 秒神速淨空",
	yellow_curb_pitstop: "黃線臨停極速收件",
	telecom_box_jackpot: "彩繪變電箱死角尋寶",
	stop_sign_textbook_cross: "巷口停看聽模範取物",
	clean_sort_compress_triad: "清分壓三合一完美達成",
};

function computeMasteryBonus(
	reason: HighlightReasonKind,
	state: RunState,
): number {
	switch (reason) {
		case "hydrant_clutch_grab":
			return 28;
		case "yellow_curb_pitstop":
			return 24;
		case "telecom_box_jackpot":
			return 22;
		case "stop_sign_textbook_cross":
			return 20;
		case "clean_sort_compress_triad":
			return 18;
		case "green_crosswalk_combo":
			return state.compliance.crosswalk.kind === "legal_green_pass" ? 16 : 8;
	}
}

export function createHighlightReel<TFrame>(): HighlightReel<TFrame> {
	return {
		lastCapturedAtMs: null,
		nextSeq: 1,
		shots: [],
	};
}

export function stepHighlightReel<TFrame>(params: {
	readonly reel: HighlightReel<TFrame>;
	readonly state: RunState;
	readonly events: readonly RunEvent[];
	readonly captureFrame: (meta: HighlightMeta) => TFrame;
	readonly onEvict?: (evicted: HighlightShot<TFrame>) => void;
}): HighlightReel<TFrame> {
	let currentReel = params.reel;

	for (const event of params.events) {
		if (event.kind !== "recyclable_collected") {
			continue;
		}

		if (
			currentReel.lastCapturedAtMs !== null &&
			params.state.elapsedMs - currentReel.lastCapturedAtMs <
				LEGAL_LIMITS.highlightCooldownMs
		) {
			continue;
		}

		const spec = RECYCLABLE_CATALOG[event.recyclableKind];
		const masteryBonus = computeMasteryBonus(event.highlightHint, params.state);
		const excitementScore =
			spec.excitementBase +
			event.streak * STREAK_EXCITEMENT_WEIGHT +
			(event.triadCompletedNow ? TRIAD_EXCITEMENT_BONUS : 0) +
			masteryBonus;

		const topLimit = LEGAL_LIMITS.highlightTopLimit;
		const weakestShot =
			currentReel.shots.length >= topLimit
				? currentReel.shots[topLimit - 1]
				: undefined;

		if (
			weakestShot !== undefined &&
			excitementScore <= weakestShot.meta.excitementScore
		) {
			continue;
		}

		const captureId = parseCaptureId(
			`cap_shot_${String(currentReel.nextSeq).padStart(3, "0")}`,
		);
		const meta: HighlightMeta = {
			captureId,
			reason: event.highlightHint,
			badgeZh: REASON_BADGE_ZH[event.highlightHint],
			detailZh: `${event.hidingSpotZh}回收${spec.nameZh}（+${event.pointsAwarded}分）`,
			excitementScore,
			capturedAtMs: Math.max(0, Math.round(params.state.elapsedMs)),
			scoreAtCapture: params.state.score,
			streakAtCapture: event.streak,
		};

		const frame = params.captureFrame(meta);
		const nextShot: HighlightShot<TFrame> = { meta, frame };

		let retainedShots: HighlightShot<TFrame>[];
		if (weakestShot !== undefined) {
			params.onEvict?.(weakestShot);
			retainedShots = [
				...currentReel.shots.slice(0, topLimit - 1),
				nextShot,
			];
		} else {
			retainedShots = [...currentReel.shots, nextShot];
		}

		retainedShots.sort(
			(a, b) => b.meta.excitementScore - a.meta.excitementScore,
		);

		currentReel = {
			lastCapturedAtMs: params.state.elapsedMs,
			nextSeq: currentReel.nextSeq + 1,
			shots: retainedShots,
		};
	}

	return currentReel;
}
