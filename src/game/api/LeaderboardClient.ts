import {
	LEGAL_LIMITS,
	parseLeaderboardResponse,
	parseSessionStartResponse,
	parseSessionId,
	type LeaderboardResponse,
	type LeaderboardScope,
	type SessionStartResponse,
	type SubmitScorePayload,
} from "../../shared/contracts.ts";

function buildFallbackGrant(): SessionStartResponse {
	const randomSuffix = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
	const seed = Math.floor(Math.random() * 0x7fffffff);
	const tag = String((seed % 8999) + 1000);
	return {
		sessionId: parseSessionId(`sess_local_${randomSuffix}`),
		alias: `巷弄環保先鋒 #${tag}`,
		seed,
		issuedAtMs: Date.now(),
		roundDurationMs: LEGAL_LIMITS.roundDurationMs,
		signature: "local_offline_fallback_signature_00000000",
	};
}

export async function startRemoteOrLocalSession(): Promise<SessionStartResponse> {
	try {
		const res = await fetch("/api/session/start", {
			method: "POST",
			headers: { "content-type": "application/json" },
		});
		if (!res.ok) {
			return buildFallbackGrant();
		}
		const raw: unknown = await res.json();
		const parsed = parseSessionStartResponse(raw);
		return parsed.ok ? parsed.value : buildFallbackGrant();
	} catch {
		return buildFallbackGrant();
	}
}

export async function submitRunScore(
	payload: SubmitScorePayload,
): Promise<{ readonly ok: true; readonly leaderboard: LeaderboardResponse } | { readonly ok: false; readonly reason: string }> {
	if (payload.signature.startsWith("local_offline_")) {
		return { ok: false, reason: "目前為離線練習模式，連線至伺服器即可登錄排行榜" };
	}
	try {
		const res = await fetch("/api/leaderboard/submit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
		const raw: unknown = await res.json();
		if (!res.ok) {
			const msg =
				typeof raw === "object" && raw !== null && "error" in raw && typeof raw.error === "string"
					? raw.error
					: `HTTP ${res.status}`;
			return { ok: false, reason: msg };
		}
		const parsed = parseLeaderboardResponse(raw);
		return parsed.ok
			? { ok: true, leaderboard: parsed.value }
			: { ok: false, reason: parsed.error };
	} catch {
		return { ok: false, reason: "網路連線中斷，請稍後再試" };
	}
}

export async function fetchLeaderboard(
	scope: LeaderboardScope,
	sessionId?: string,
): Promise<LeaderboardResponse | null> {
	try {
		const qs = new URLSearchParams({ scope });
		if (sessionId) qs.set("sessionId", sessionId);
		const res = await fetch(`/api/leaderboard?${qs.toString()}`);
		if (!res.ok) return null;
		const raw: unknown = await res.json();
		const parsed = parseLeaderboardResponse(raw);
		return parsed.ok ? parsed.value : null;
	} catch {
		return null;
	}
}
