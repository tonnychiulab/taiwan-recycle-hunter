import {
	type CallerPlacement,
	isSessionId,
	LEGAL_LIMITS,
	type LeaderboardEntry,
	type LeaderboardResponse,
	type LeaderboardScope,
	LeaderboardScopeSchema,
	OrientationUsedSchema,
	parseSessionId,
	parseSubmitScorePayload,
	type SessionId,
	type SessionStartResponse,
} from "../src/shared/contracts.ts";
import { generateTaiwanStreetAlias, sanitizePlayerAlias } from "./aliases.ts";
import { hashClientIp, signSessionGrant, verifySessionGrantSignature } from "./crypto.ts";
import { verifySubmissionPlausibility } from "./plausibility.ts";

export interface Env {
	readonly DB: D1Database;
	readonly ASSETS?: Fetcher;
	readonly SESSION_SECRET?: string;
}

const DEFAULT_DEV_SESSION_SECRET = "taiwan-recycle-hunter-dev-session-secret-v1";
const TAIWAN_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_SUBMISSIONS = 8;
const LEADERBOARD_TOP_LIMIT = 20;

type SessionRow = {
	readonly session_id: string;
	readonly alias: string;
	readonly seed: number;
	readonly issued_at: number;
	readonly consumed_at: number | null;
};

type LeaderboardRow = {
	readonly id: number;
	readonly session_id: string;
	readonly alias: string;
	readonly score: number;
	readonly recycled_count: number;
	readonly compliance_rate: number;
	readonly co2_saved_grams: number;
	readonly orientation_used: string;
	readonly day_bucket: string;
	readonly created_at: number;
};

type CountRow = {
	readonly count_value: number;
};

function resolveSessionSecret(env: Env): string {
	const trimmed = env.SESSION_SECRET?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_DEV_SESSION_SECRET;
}

export function toTaiwanDayBucket(epochMs: number): string {
	const shifted = new Date(epochMs + TAIWAN_UTC_OFFSET_MS);
	const year = shifted.getUTCFullYear();
	const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
	const day = String(shifted.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function extractClientIp(request: Request): string {
	const cfIp = request.headers.get("CF-Connecting-IP")?.trim();
	if (cfIp) {
		return cfIp;
	}
	const forwarded = request.headers.get("X-Forwarded-For");
	if (forwarded) {
		const firstHop = forwarded.split(",")[0]?.trim();
		if (firstHop) {
			return firstHop;
		}
	}
	return "127.0.0.1";
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
	const headers = new Headers({
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	if (extraHeaders) {
		for (const [key, value] of Object.entries(extraHeaders)) {
			headers.set(key, value);
		}
	}
	return new Response(JSON.stringify(body), { status, headers });
}

function mapRowToLeaderboardEntry(row: LeaderboardRow, rank: number): LeaderboardEntry {
	const parsedOrientation = OrientationUsedSchema.safeParse(row.orientation_used);
	return {
		rank,
		sessionId: parseSessionId(String(row.session_id)),
		alias: String(row.alias),
		score: Number(row.score),
		recycledCount: Number(row.recycled_count),
		complianceRate: Number(row.compliance_rate),
		co2SavedGrams: Number(row.co2_saved_grams),
		orientationUsed: parsedOrientation.success ? parsedOrientation.data : "portrait",
		createdAtMs: Number(row.created_at),
	};
}

function computePercentile(rank: number, totalCount: number): number {
	if (totalCount <= 0) {
		return 100;
	}
	const raw = Math.round(((totalCount - rank + 1) / totalCount) * 100);
	return Math.max(1, Math.min(100, raw));
}

async function computeCallerPlacement(
	db: D1Database,
	params: {
		readonly scope: LeaderboardScope;
		readonly dayBucket: string;
		readonly callerSessionId: SessionId | undefined;
	},
): Promise<CallerPlacement> {
	const { scope, dayBucket, callerSessionId } = params;
	if (!callerSessionId) {
		return { kind: "unranked" };
	}

	const callerRow =
		scope === "daily"
			? await db
					.prepare(
						`SELECT id, session_id, alias, score, recycled_count, compliance_rate,
							co2_saved_grams, orientation_used, day_bucket, created_at
						FROM leaderboard_entries
						WHERE session_id = ? AND day_bucket = ?`,
					)
					.bind(callerSessionId, dayBucket)
					.first<LeaderboardRow>()
			: await db
					.prepare(
						`SELECT id, session_id, alias, score, recycled_count, compliance_rate,
							co2_saved_grams, orientation_used, day_bucket, created_at
						FROM leaderboard_entries
						WHERE session_id = ?`,
					)
					.bind(callerSessionId)
					.first<LeaderboardRow>();

	if (!callerRow) {
		return { kind: "unranked" };
	}

	const score = Number(callerRow.score);
	const createdAt = Number(callerRow.created_at);
	const rowId = Number(callerRow.id);

	const totalRow =
		scope === "daily"
			? await db
					.prepare("SELECT COUNT(*) AS count_value FROM leaderboard_entries WHERE day_bucket = ?")
					.bind(dayBucket)
					.first<CountRow>()
			: await db
					.prepare("SELECT COUNT(*) AS count_value FROM leaderboard_entries")
					.first<CountRow>();

	const aheadRow =
		scope === "daily"
			? await db
					.prepare(
						`SELECT COUNT(*) AS count_value
						FROM leaderboard_entries
						WHERE day_bucket = ?
							AND (
								score > ?
								OR (score = ? AND created_at < ?)
								OR (score = ? AND created_at = ? AND id < ?)
							)`,
					)
					.bind(dayBucket, score, score, createdAt, score, createdAt, rowId)
					.first<CountRow>()
			: await db
					.prepare(
						`SELECT COUNT(*) AS count_value
						FROM leaderboard_entries
						WHERE score > ?
							OR (score = ? AND created_at < ?)
							OR (score = ? AND created_at = ? AND id < ?)`,
					)
					.bind(score, score, createdAt, score, createdAt, rowId)
					.first<CountRow>();

	const totalCount = Math.max(1, Number(totalRow?.count_value ?? 1));
	const aheadCount = Math.max(0, Number(aheadRow?.count_value ?? 0));
	const rank = aheadCount + 1;
	const percentile = computePercentile(rank, totalCount);

	return {
		kind: "ranked",
		rank,
		percentile,
		entry: mapRowToLeaderboardEntry(callerRow, rank),
	};
}

async function buildLeaderboardResponse(
	db: D1Database,
	params: {
		readonly scope: LeaderboardScope;
		readonly dayBucket: string;
		readonly callerSessionId: SessionId | undefined;
		readonly generatedAtMs: number;
	},
): Promise<LeaderboardResponse> {
	const { scope, dayBucket, callerSessionId, generatedAtMs } = params;

	const topResult =
		scope === "daily"
			? await db
					.prepare(
						`SELECT id, session_id, alias, score, recycled_count, compliance_rate,
							co2_saved_grams, orientation_used, day_bucket, created_at
						FROM leaderboard_entries
						WHERE day_bucket = ?
						ORDER BY score DESC, created_at ASC, id ASC
						LIMIT ?`,
					)
					.bind(dayBucket, LEADERBOARD_TOP_LIMIT)
					.all<LeaderboardRow>()
			: await db
					.prepare(
						`SELECT id, session_id, alias, score, recycled_count, compliance_rate,
							co2_saved_grams, orientation_used, day_bucket, created_at
						FROM leaderboard_entries
						ORDER BY score DESC, created_at ASC, id ASC
						LIMIT ?`,
					)
					.bind(LEADERBOARD_TOP_LIMIT)
					.all<LeaderboardRow>();

	const rows = topResult.results ?? [];
	const entries = rows.map((row, idx) => mapRowToLeaderboardEntry(row, idx + 1));
	const callerPlacement = await computeCallerPlacement(db, {
		scope,
		dayBucket,
		callerSessionId,
	});

	return {
		scope,
		dayBucket,
		generatedAtMs,
		entries,
		callerPlacement,
	};
}

async function handleSessionStart(env: Env, nowMs: number): Promise<Response> {
	const secret = resolveSessionSecret(env);
	const sessionId = parseSessionId(`sess_${globalThis.crypto.randomUUID().replace(/-/g, "")}`);

	const seedBuffer = new Uint32Array(1);
	globalThis.crypto.getRandomValues(seedBuffer);
	const seed = seedBuffer[0] ?? 1;

	const alias = generateTaiwanStreetAlias(seed);
	const issuedAtMs = nowMs;
	const roundDurationMs = LEGAL_LIMITS.roundDurationMs;
	const signature = await signSessionGrant(secret, {
		sessionId,
		alias,
		seed,
		issuedAtMs,
		roundDurationMs,
	});

	await env.DB.prepare(
		"INSERT INTO game_sessions (session_id, alias, seed, issued_at, consumed_at) VALUES (?, ?, ?, ?, NULL)",
	)
		.bind(sessionId, alias, seed, issuedAtMs)
		.run();

	const responseBody: SessionStartResponse = {
		sessionId,
		alias,
		seed,
		issuedAtMs,
		roundDurationMs,
		signature,
	};
	return jsonResponse(responseBody, 200);
}

async function handleLeaderboardSubmit(
	request: Request,
	env: Env,
	nowMs: number,
): Promise<Response> {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return jsonResponse(
			{ ok: false, error: "invalid_json", message: "Request body must be valid JSON." },
			400,
		);
	}

	const parsed = parseSubmitScorePayload(rawBody);
	if (!parsed.ok) {
		return jsonResponse(
			{ ok: false, error: "invalid_payload", message: parsed.error },
			400,
		);
	}

	const payload = parsed.value;
	const secret = resolveSessionSecret(env);

	const sessionRow = await env.DB.prepare(
		"SELECT session_id, alias, seed, issued_at, consumed_at FROM game_sessions WHERE session_id = ?",
	)
		.bind(payload.sessionId)
		.first<SessionRow>();

	if (!sessionRow) {
		return jsonResponse(
			{ ok: false, error: "unknown_session", message: "Session not found." },
			401,
		);
	}

	const signatureValid = await verifySessionGrantSignature(
		secret,
		{
			sessionId: payload.sessionId,
			alias: String(sessionRow.alias),
			seed: Number(sessionRow.seed),
			issuedAtMs: Number(sessionRow.issued_at),
			roundDurationMs: LEGAL_LIMITS.roundDurationMs,
		},
		payload.signature,
	);

	if (!signatureValid) {
		return jsonResponse(
			{ ok: false, error: "invalid_signature", message: "HMAC session signature verification failed." },
			403,
		);
	}

	const clientIp = extractClientIp(request);
	const ipHash = await hashClientIp(secret, clientIp);
	const checkIpRateLimit = async (): Promise<Response | null> => {
		const rateRow = await env.DB.prepare(
			"SELECT COUNT(*) AS count_value FROM leaderboard_entries WHERE ip_hash = ? AND created_at > ?",
		)
			.bind(ipHash, nowMs - RATE_LIMIT_WINDOW_MS)
			.first<CountRow>();

		if (Number(rateRow?.count_value ?? 0) >= RATE_LIMIT_MAX_SUBMISSIONS) {
			return jsonResponse(
				{
					ok: false,
					error: "rate_limited",
					message: "Submission rate limit exceeded. Try again in 60 seconds.",
				},
				429,
				{ "Retry-After": "60" },
			);
		}
		return null;
	};

	if (sessionRow.consumed_at !== null) {
		const existingEntry = await env.DB.prepare(
			"SELECT day_bucket, alias FROM leaderboard_entries WHERE session_id = ?",
		)
			.bind(payload.sessionId)
			.first<{ readonly day_bucket: string; readonly alias: string }>();

		if (existingEntry) {
			if (
				payload.alias !== undefined &&
				nowMs - Number(sessionRow.issued_at) <= LEGAL_LIMITS.sessionTtlMs
			) {
				const renamedAlias = sanitizePlayerAlias(payload.alias, String(existingEntry.alias));
				if (renamedAlias !== String(existingEntry.alias)) {
					const rateLimitResponse = await checkIpRateLimit();
					if (rateLimitResponse) {
						return rateLimitResponse;
					}
					await env.DB.prepare(
						"UPDATE leaderboard_entries SET alias = ? WHERE session_id = ?",
					)
						.bind(renamedAlias, payload.sessionId)
						.run();
				}
			}
			const idempotentBoard = await buildLeaderboardResponse(env.DB, {
				scope: "daily",
				dayBucket: String(existingEntry.day_bucket),
				callerSessionId: payload.sessionId,
				generatedAtMs: nowMs,
			});
			return jsonResponse(idempotentBoard, 200);
		}
	}

	const rateLimitResponse = await checkIpRateLimit();
	if (rateLimitResponse) {
		return rateLimitResponse;
	}

	const verdict = verifySubmissionPlausibility({
		payload,
		sessionSeed: Number(sessionRow.seed),
		sessionIssuedAtMs: Number(sessionRow.issued_at),
		roundDurationMs: LEGAL_LIMITS.roundDurationMs,
		nowMs,
	});

	if (!verdict.ok) {
		return jsonResponse(
			{ ok: false, error: verdict.code, message: verdict.reason },
			422,
		);
	}

	const safeAlias = sanitizePlayerAlias(payload.alias, String(sessionRow.alias));
	const dayBucket = toTaiwanDayBucket(nowMs);

	await env.DB.batch([
		env.DB.prepare(
			"UPDATE game_sessions SET consumed_at = ? WHERE session_id = ? AND consumed_at IS NULL",
		).bind(nowMs, payload.sessionId),
		env.DB.prepare(
			`INSERT OR IGNORE INTO leaderboard_entries (
				session_id, alias, score, recycled_count, compliance_rate,
				co2_saved_grams, orientation_used, ip_hash, day_bucket, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			payload.sessionId,
			safeAlias,
			payload.score,
			verdict.recycledCount,
			verdict.complianceRate,
			verdict.co2SavedGrams,
			payload.orientationUsed,
			ipHash,
			dayBucket,
			nowMs,
		),
	]);

	const recordedEntry = await env.DB.prepare(
		"SELECT day_bucket FROM leaderboard_entries WHERE session_id = ?",
	)
		.bind(payload.sessionId)
		.first<{ readonly day_bucket: string }>();

	const board = await buildLeaderboardResponse(env.DB, {
		scope: "daily",
		dayBucket: recordedEntry ? String(recordedEntry.day_bucket) : dayBucket,
		callerSessionId: payload.sessionId,
		generatedAtMs: nowMs,
	});

	return jsonResponse(board, 200);
}

async function handleLeaderboardGet(
	url: URL,
	env: Env,
	nowMs: number,
): Promise<Response> {
	const rawScope = url.searchParams.get("scope") ?? "daily";
	const parsedScope = LeaderboardScopeSchema.safeParse(rawScope);
	if (!parsedScope.success) {
		return jsonResponse(
			{ ok: false, error: "invalid_scope", message: "Scope must be daily or all_time." },
			400,
		);
	}

	const rawSessionId = url.searchParams.get("sessionId");
	let callerSessionId: SessionId | undefined;
	if (rawSessionId !== null && rawSessionId.trim() !== "") {
		if (!isSessionId(rawSessionId)) {
			return jsonResponse(
				{ ok: false, error: "invalid_session_id", message: "Malformed sessionId query parameter." },
				400,
			);
		}
		callerSessionId = rawSessionId;
	}

	const dayBucket = toTaiwanDayBucket(nowMs);
	const board = await buildLeaderboardResponse(env.DB, {
		scope: parsedScope.data,
		dayBucket,
		callerSessionId,
		generatedAtMs: nowMs,
	});
	return jsonResponse(board, 200);
}

export async function handleWorkerRequest(
	request: Request,
	env: Env,
	nowMs: number = Date.now(),
): Promise<Response> {
	const url = new URL(request.url);
	const { pathname } = url;
	const method = request.method.toUpperCase();

	if (pathname.startsWith("/api/")) {
		if (method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		if (pathname === "/api/health") {
			if (method !== "GET") {
				return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
			}
			return jsonResponse({ ok: true, service: "taiwan-recycle-hunter" }, 200);
		}

		if (pathname === "/api/session/start") {
			if (method !== "POST") {
				return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
			}
			return handleSessionStart(env, nowMs);
		}

		if (pathname === "/api/leaderboard/submit") {
			if (method !== "POST") {
				return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
			}
			return handleLeaderboardSubmit(request, env, nowMs);
		}

		if (pathname === "/api/leaderboard") {
			if (method !== "GET") {
				return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
			}
			return handleLeaderboardGet(url, env, nowMs);
		}

		return jsonResponse({ ok: false, error: "not_found" }, 404);
	}

	if (env.ASSETS) {
		const assetResponse = await env.ASSETS.fetch(
			request as unknown as Parameters<Fetcher["fetch"]>[0],
		);
		return assetResponse as unknown as Response;
	}

	return new Response("Not Found", { status: 404 });
}

const worker = {
	async fetch(request: Request, env: Env): Promise<Response> {
		return handleWorkerRequest(request, env, Date.now());
	},
};

export default worker;
