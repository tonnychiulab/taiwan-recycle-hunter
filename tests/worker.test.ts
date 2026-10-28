import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	createEmptyContaminantTallies,
	createEmptyRecyclableTallies,
	createEmptyViolationTallies,
	LEGAL_LIMITS,
	parseItemId,
	parseLeaderboardResponse,
	parseSessionStartResponse,
	parseZoneId,
	RECYCLABLE_CATALOG,
	type RecyclableKind,
	type SessionStartResponse,
	type SubmitScorePayload,
	type VerifiedPickupClaim,
} from "../src/shared/contracts.ts";
import { createStreetLayout } from "../src/domain/street-map.ts";
import { generateTaiwanStreetAlias, sanitizePlayerAlias } from "../worker/aliases.ts";
import worker, { type Env, handleWorkerRequest, toTaiwanDayBucket } from "../worker/index.ts";

const MIGRATION_SQL = readFileSync(
	resolve(process.cwd(), "migrations/0001_leaderboard.sql"),
	"utf8",
);

const TEST_SECRET = "unit-test-hmac-secret-taiwan-alley-2026";

type InternalExecutableStatement = D1PreparedStatement & {
	readonly __executeSync: () => D1Result<unknown>;
};

function toSqlInput(value: unknown): SQLInputValue {
	if (
		value === null ||
		typeof value === "number" ||
		typeof value === "bigint" ||
		typeof value === "string"
	) {
		return value;
	}
	if (typeof value === "boolean") {
		return value ? 1 : 0;
	}
	if (value instanceof Uint8Array) {
		return value;
	}
	return null;
}

function makeD1Meta(changes = 0, lastRowId = 0): D1Meta & Record<string, unknown> {
	return {
		duration: 0.1,
		size_after: 0,
		rows_read: 0,
		rows_written: changes,
		last_row_id: lastRowId,
		changed_db: changes > 0,
		changes,
	};
}

function createTestD1Database(): {
	readonly db: D1Database;
	readonly rawSqlite: DatabaseSync;
} {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(MIGRATION_SQL);

	function createStatement(sql: string, bound: readonly SQLInputValue[] = []): InternalExecutableStatement {
		const isReader = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);

		const executeSync = (): D1Result<unknown> => {
			const stmt = sqlite.prepare(sql);
			if (isReader) {
				const rawRows = stmt.all(...bound) as Record<string, unknown>[];
				const results = rawRows.map((row) => ({ ...row }));
				return {
					results,
					success: true,
					meta: makeD1Meta(0, 0),
				};
			}
			const info = stmt.run(...bound);
			return {
				results: [],
				success: true,
				meta: makeD1Meta(Number(info.changes), Number(info.lastInsertRowid)),
			};
		};

		const statement: InternalExecutableStatement = {
			__executeSync: executeSync,
			bind(...values: unknown[]): D1PreparedStatement {
				return createStatement(sql, values.map(toSqlInput));
			},
			first<T = unknown>(colName?: string): Promise<T | null> {
				const stmt = sqlite.prepare(sql);
				const row = stmt.get(...bound) as Record<string, unknown> | undefined;
				if (row === undefined) {
					return Promise.resolve(null);
				}
				const plain = { ...row };
				if (colName !== undefined) {
					const val = plain[colName];
					return Promise.resolve((val === undefined ? null : val) as T | null);
				}
				return Promise.resolve(plain as T);
			},
			run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
				return Promise.resolve(executeSync() as D1Result<T>);
			},
			all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
				return Promise.resolve(executeSync() as D1Result<T>);
			},
			raw: ((options?: { columnNames?: boolean }) => {
				const stmt = sqlite.prepare(sql);
				const rawRows = stmt.all(...bound) as Record<string, unknown>[];
				if (rawRows.length === 0) {
					return Promise.resolve([]);
				}
				const firstRow = rawRows[0] ?? {};
				const keys = Object.keys(firstRow);
				const tuples = rawRows.map((r) => keys.map((k) => r[k]));
				if (options?.columnNames) {
					return Promise.resolve([keys, ...tuples]);
				}
				return Promise.resolve(tuples);
			}) as D1PreparedStatement["raw"],
		};

		return statement;
	}

	const db = {
		prepare(query: string): D1PreparedStatement {
			return createStatement(query);
		},
		batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
			sqlite.exec("BEGIN IMMEDIATE");
			try {
				const outputs = statements.map((stmt) => {
					const internal = stmt as InternalExecutableStatement;
					return internal.__executeSync() as D1Result<T>;
				});
				sqlite.exec("COMMIT");
				return Promise.resolve(outputs);
			} catch (error) {
				sqlite.exec("ROLLBACK");
				return Promise.reject(error);
			}
		},
		exec(query: string): Promise<D1ExecResult> {
			sqlite.exec(query);
			return Promise.resolve({ count: 1, duration: 0.1 });
		},
		withSession(): D1DatabaseSession {
			throw new Error("withSession not required in unit test adapter");
		},
		dump(): Promise<ArrayBuffer> {
			return Promise.resolve(new ArrayBuffer(0));
		},
	} as unknown as D1Database;

	return { db, rawSqlite: sqlite };
}

function createEnv(db: D1Database, assets?: Fetcher): Env {
	if (assets) {
		return { DB: db, SESSION_SECRET: TEST_SECRET, ASSETS: assets };
	}
	return { DB: db, SESSION_SECRET: TEST_SECRET };
}

async function startSessionAt(env: Env, nowMs: number): Promise<SessionStartResponse> {
	const response = await handleWorkerRequest(
		new Request("https://recycle.example.tw/api/session/start", { method: "POST" }),
		env,
		nowMs,
	);
	expect(response.status).toBe(200);
	const parsed = parseSessionStartResponse(await response.json());
	if (!parsed.ok) {
		throw new Error(`Invalid SessionStartResponse: ${parsed.error}`);
	}
	return parsed.value;
}

function buildValidPayload(
	session: SessionStartResponse,
	kinds: readonly RecyclableKind[],
	overrides?: Partial<SubmitScorePayload>,
): SubmitScorePayload {
	const layout = createStreetLayout(session.seed);
	const availableRecyclables = layout.initialItems.filter(
		(it): it is Extract<(typeof layout.initialItems)[number], { readonly category: "recyclable" }> =>
			it.category === "recyclable",
	);
	const usedIds = new Set<string>();
	const mutableTallies: Record<RecyclableKind, number> = {
		...createEmptyRecyclableTallies(),
	};
	const pickupClaims: VerifiedPickupClaim[] = [];

	let baseScore = 0;
	kinds.forEach((requestedKind, index) => {
		const matched =
			availableRecyclables.find((it) => it.kind === requestedKind && !usedIds.has(it.itemId)) ??
			availableRecyclables.find((it) => !usedIds.has(it.itemId));
		if (!matched) {
			throw new Error("Exhausted seeded recyclables in buildValidPayload");
		}
		usedIds.add(matched.itemId);
		const actualKind = matched.kind;
		mutableTallies[actualKind] += 1;
		const pts = RECYCLABLE_CATALOG[actualKind].basePoints;
		baseScore += pts;
		pickupClaims.push({
			itemId: matched.itemId,
			kind: actualKind,
			atElapsedMs: 1_200 + index * 450,
			standingZoneId: matched.legalStandingZoneIds[0] ?? parseZoneId("zone_arcade_nw"),
			awardedPoints: pts,
		});
	});

	return {
		sessionId: session.sessionId,
		signature: session.signature,
		durationMs: 28_000,
		score: baseScore,
		recyclableTallies: mutableTallies,
		contaminantTallies: createEmptyContaminantTallies(),
		violationTallies: createEmptyViolationTallies(),
		triadsCompleted: 0,
		orientationUsed: "portrait",
		pickupClaims,
		...overrides,
	};
}

async function submitScoreAt(
	env: Env,
	payload: unknown,
	nowMs: number,
	ip = "203.0.113.42",
): Promise<Response> {
	return handleWorkerRequest(
		new Request("https://recycle.example.tw/api/leaderboard/submit", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify(payload),
		}),
		env,
		nowMs,
	);
}

describe("Taiwan Recycle Hunter Worker + D1 API", () => {
	it("serves /api/health and delegates non-API paths to ASSETS or returns 404", async () => {
		const { db } = createTestD1Database();
		const envWithoutAssets = createEnv(db);

		const healthRes = await worker.fetch(
			new Request("https://recycle.example.tw/api/health"),
			envWithoutAssets,
		);
		expect(healthRes.status).toBe(200);
		expect(await healthRes.json()).toEqual({
			ok: true,
			service: "taiwan-recycle-hunter",
		});

		const missingAssetRes = await worker.fetch(
			new Request("https://recycle.example.tw/play"),
			envWithoutAssets,
		);
		expect(missingAssetRes.status).toBe(404);

		const unknownApiRes = await worker.fetch(
			new Request("https://recycle.example.tw/api/nonexistent"),
			envWithoutAssets,
		);
		expect(unknownApiRes.status).toBe(404);

		const mockAssets = {
			fetch: async (req: Request) =>
				new Response(`SPA:${new URL(req.url).pathname}`, { status: 200 }),
		} as unknown as Fetcher;
		const envWithAssets = createEnv(db, mockAssets);
		const spaRes = await worker.fetch(
			new Request("https://recycle.example.tw/alley"),
			envWithAssets,
		);
		expect(spaRes.status).toBe(200);
		expect(await spaRes.text()).toBe("SPA:/alley");
	});

	it("starts an unconsumed session with Taiwan street alias and verifiable HMAC grant", async () => {
		const { db, rawSqlite } = createTestD1Database();
		const env = createEnv(db);
		const nowMs = Date.UTC(2026, 9, 28, 9, 0, 0);

		const session = await startSessionAt(env, nowMs);
		expect(session.sessionId.startsWith("sess_")).toBe(true);
		expect(session.alias.length).toBeGreaterThanOrEqual(2);
		expect(session.alias.length).toBeLessThanOrEqual(18);
		expect(session.alias).toMatch(/#\d{4}$/);
		expect(session.issuedAtMs).toBe(nowMs);
		expect(session.roundDurationMs).toBe(LEGAL_LIMITS.roundDurationMs);
		expect(session.signature).toMatch(/^[0-9a-f]{64}$/);

		const row = rawSqlite
			.prepare("SELECT session_id, alias, seed, issued_at, consumed_at FROM game_sessions WHERE session_id = ?")
			.get(session.sessionId) as Record<string, unknown> | undefined;
		expect(row).toBeDefined();
		expect(row?.alias).toBe(session.alias);
		expect(row?.seed).toBe(session.seed);
		expect(row?.issued_at).toBe(nowMs);
		expect(row?.consumed_at).toBeNull();
	});

	it("accepts a plausible score submission, computes CO2 & compliance metrics, and hashes client IP", async () => {
		const { db, rawSqlite } = createTestD1Database();
		const env = createEnv(db);
		const issuedAt = Date.UTC(2026, 9, 28, 16, 30, 0);
		const submitAt = issuedAt + 35_000;

		const session = await startSessionAt(env, issuedAt);
		const kinds: readonly RecyclableKind[] = [
			"pet_bottle",
			"aluminum_can",
			"glass_bottle",
			"waste_battery",
		];
		const basePayload = buildValidPayload(session, kinds, {
			triadsCompleted: 1,
			score: 720,
			orientationUsed: "both",
		});

		const rawClientIp = "198.51.100.77";
		const res = await submitScoreAt(env, basePayload, submitAt, rawClientIp);
		expect(res.status).toBe(200);

		const parsedBoard = parseLeaderboardResponse(await res.json());
		expect(parsedBoard.ok).toBe(true);
		if (!parsedBoard.ok) {
			return;
		}

		expect(parsedBoard.value.scope).toBe("daily");
		expect(parsedBoard.value.dayBucket).toBe("2026-10-29");
		expect(toTaiwanDayBucket(submitAt)).toBe("2026-10-29");
		expect(parsedBoard.value.entries).toHaveLength(1);

		const topEntry = parsedBoard.value.entries[0];
		expect(topEntry?.sessionId).toBe(session.sessionId);
		expect(topEntry?.score).toBe(720);
		expect(topEntry?.recycledCount).toBe(4);
		expect(topEntry?.complianceRate).toBe(100);
		expect(topEntry?.co2SavedGrams).toBe(65 + 180 + 160 + 260);
		expect(topEntry?.orientationUsed).toBe("both");

		expect(parsedBoard.value.callerPlacement).toEqual({
			kind: "ranked",
			rank: 1,
			percentile: 100,
			entry: topEntry,
		});

		const dbEntry = rawSqlite
			.prepare("SELECT ip_hash, day_bucket FROM leaderboard_entries WHERE session_id = ?")
			.get(session.sessionId) as { ip_hash: string; day_bucket: string } | undefined;
		expect(dbEntry?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(dbEntry?.ip_hash).not.toContain(rawClientIp);
		expect(dbEntry?.day_bucket).toBe("2026-10-29");

		const sessionWithPenalty = await startSessionAt(env, issuedAt + 1_000);
		const penalizedPayload = buildValidPayload(
			sessionWithPenalty,
			["pet_bottle", "aluminum_can", "clean_cardboard"],
			{
				score: 60,
				contaminantTallies: {
					...createEmptyContaminantTallies(),
					used_tissue: 1,
				},
				violationTallies: {
					...createEmptyViolationTallies(),
					stop_sign_check_skipped: 1,
				},
			},
		);
		const penRes = await submitScoreAt(env, penalizedPayload, submitAt + 2_000, rawClientIp);
		expect(penRes.status).toBe(200);
		const penBoard = parseLeaderboardResponse(await penRes.json());
		expect(penBoard.ok).toBe(true);
		if (penBoard.ok && penBoard.value.callerPlacement.kind === "ranked") {
			expect(penBoard.value.callerPlacement.entry.complianceRate).toBe(60);
			expect(penBoard.value.callerPlacement.rank).toBe(2);
		}
	});

	it("handles duplicate network retries on the same sessionId idempotently", async () => {
		const { db, rawSqlite } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 4, 0, 0);

		const session = await startSessionAt(env, t0);
		const payload = buildValidPayload(session, ["pet_bottle", "aluminum_can"], {
			score: 260,
		});

		const firstRes = await submitScoreAt(env, payload, t0 + 30_000);
		expect(firstRes.status).toBe(200);
		const firstBoard = parseLeaderboardResponse(await firstRes.json());
		expect(firstBoard.ok).toBe(true);

		const mutatedRetryPayload: SubmitScorePayload = {
			...payload,
			score: 300,
		};
		const retryRes = await submitScoreAt(env, mutatedRetryPayload, t0 + 32_000);
		expect(retryRes.status).toBe(200);
		const retryBoard = parseLeaderboardResponse(await retryRes.json());
		expect(retryBoard.ok).toBe(true);

		if (firstBoard.ok && retryBoard.ok) {
			expect(retryBoard.value.entries).toHaveLength(1);
			expect(retryBoard.value.entries[0]?.score).toBe(260);
			expect(retryBoard.value.callerPlacement).toEqual(firstBoard.value.callerPlacement);
		}

		const countRow = rawSqlite
			.prepare("SELECT COUNT(*) AS cnt FROM leaderboard_entries WHERE session_id = ?")
			.get(session.sessionId) as { cnt: number };
		expect(countRow.cnt).toBe(1);

		const renamePayload: SubmitScorePayload = {
			...payload,
			alias: "永康資收王",
			score: 999,
		};
		const renameRes = await submitScoreAt(env, renamePayload, t0 + 35_000);
		expect(renameRes.status).toBe(200);
		const renameBoard = parseLeaderboardResponse(await renameRes.json());
		expect(renameBoard.ok).toBe(true);
		if (renameBoard.ok) {
			expect(renameBoard.value.entries[0]?.alias).toBe("永康資收王");
			expect(renameBoard.value.entries[0]?.score).toBe(260);
		}
	});

	it("rejects unknown sessions with 401 and tampered HMAC signatures with 403", async () => {
		const { db, rawSqlite } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 5, 0, 0);

		const session = await startSessionAt(env, t0);
		const validPayload = buildValidPayload(session, ["pet_bottle"]);

		const forgedSig =
			validPayload.signature.slice(0, -2) +
			(validPayload.signature.endsWith("aa") ? "bb" : "aa");
		const tamperedRes = await submitScoreAt(
			env,
			{ ...validPayload, signature: forgedSig },
			t0 + 20_000,
		);
		expect([401, 403]).toContain(tamperedRes.status);
		expect(tamperedRes.status).toBe(403);

		const unknownSessionRes = await submitScoreAt(
			env,
			{ ...validPayload, sessionId: "sess_nonexistent0000000001" },
			t0 + 20_000,
		);
		expect([401, 403]).toContain(unknownSessionRes.status);
		expect(unknownSessionRes.status).toBe(401);

		const totalRows = rawSqlite
			.prepare("SELECT COUNT(*) AS cnt FROM leaderboard_entries")
			.get() as { cnt: number };
		expect(totalRows.cnt).toBe(0);
	});

	it("rejects automated bot <160ms pickup cadence, duplicate itemIds, and expired sessions with 422", async () => {
		const { db } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 6, 0, 0);

		const botSession = await startSessionAt(env, t0);
		const baseBotPayload = buildValidPayload(botSession, ["pet_bottle", "aluminum_can"]);
		const c0 = baseBotPayload.pickupClaims[0];
		const c1 = baseBotPayload.pickupClaims[1];
		if (!c0 || !c1) {
			throw new Error("Expected 2 seeded claims in baseBotPayload");
		}
		const fastClaims: VerifiedPickupClaim[] = [
			{ ...c0, atElapsedMs: 2_000 },
			{ ...c1, atElapsedMs: 2_110 },
		];
		const botRes = await submitScoreAt(
			env,
			{ ...baseBotPayload, pickupClaims: fastClaims },
			t0 + 20_000,
		);
		expect(botRes.status).toBe(422);
		const botErr = (await botRes.json()) as { error: string };
		expect(botErr.error).toBe("bot_pickup_cadence");

		const dupSession = await startSessionAt(env, t0);
		const dupPayload = buildValidPayload(dupSession, ["pet_bottle", "pet_bottle"]);
		const d0 = dupPayload.pickupClaims[0];
		if (!d0) {
			throw new Error("Expected seeded claim in dupPayload");
		}
		const dupClaims: VerifiedPickupClaim[] = [
			{ ...d0, atElapsedMs: 1_000 },
			{ ...d0, atElapsedMs: 2_000 },
		];
		const dupRes = await submitScoreAt(
			env,
			{ ...dupPayload, pickupClaims: dupClaims },
			t0 + 20_000,
		);
		expect(dupRes.status).toBe(422);
		expect(((await dupRes.json()) as { error: string }).error).toBe("duplicate_pickup_item");

		const expiredSession = await startSessionAt(env, t0);
		const expiredPayload = buildValidPayload(expiredSession, ["pet_bottle"]);
		const expiredRes = await submitScoreAt(
			env,
			expiredPayload,
			t0 + LEGAL_LIMITS.sessionTtlMs + 1_000,
		);
		expect(expiredRes.status).toBe(422);
		expect(((await expiredRes.json()) as { error: string }).error).toBe("session_expired");

		const overDurationSession = await startSessionAt(env, t0);
		const overDurationPayload = buildValidPayload(overDurationSession, ["pet_bottle"], {
			durationMs: LEGAL_LIMITS.roundDurationMs + 8_000,
		});
		const overDurationRes = await submitScoreAt(env, overDurationPayload, t0 + 83_000);
		expect(overDurationRes.status).toBe(422);
		expect(((await overDurationRes.json()) as { error: string }).error).toBe("invalid_duration");
	});

	it("rejects inflated scores exceeding deterministic ceiling with 422", async () => {
		const { db } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 7, 0, 0);

		const session = await startSessionAt(env, t0);
		const inflatedPayload = buildValidPayload(session, ["pet_bottle", "aluminum_can"], {
			score: 4_500,
		});

		const res = await submitScoreAt(env, inflatedPayload, t0 + 25_000);
		expect(res.status).toBe(422);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("score_exceeds_ceiling");

		const heavilyPenalizedSession = await startSessionAt(env, t0);
		const unpenalizedClaimedScore = buildValidPayload(
			heavilyPenalizedSession,
			["pet_bottle"],
			{
				score: 150,
				violationTallies: {
					...createEmptyViolationTallies(),
					hydrant_cart_intrusion: 2,
				},
			},
		);
		const penCeilingRes = await submitScoreAt(env, unpenalizedClaimedScore, t0 + 25_000);
		expect(penCeilingRes.status).toBe(422);
		expect(((await penCeilingRes.json()) as { error: string }).error).toBe("score_exceeds_ceiling");
	});

	it("rejects contaminant-inflated recyclableTallies that lack verified pickupClaims with 422", async () => {
		const { db } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 8, 0, 0);

		const session = await startSessionAt(env, t0);
		const basePayload = buildValidPayload(session, ["pet_bottle"]);
		const contaminantInflatedPayload: SubmitScorePayload = {
			...basePayload,
			recyclableTallies: {
				...basePayload.recyclableTallies,
				clean_cardboard: 1,
			},
			contaminantTallies: {
				...createEmptyContaminantTallies(),
				greasy_lunchbox: 1,
			},
			score: 100,
		};

		const res = await submitScoreAt(env, contaminantInflatedPayload, t0 + 20_000);
		expect(res.status).toBe(422);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("tally_claim_mismatch");
	});

	it("redacts phone/email PII and strips HTML in player aliases while keeping valid custom aliases", async () => {
		const fallback = generateTaiwanStreetAlias(42);
		expect(sanitizePlayerAlias("0912345678", fallback)).toBe(fallback);
		expect(sanitizePlayerAlias("聯絡0987-654-321", fallback)).toBe(fallback);
		expect(sanitizePlayerAlias("+886-912-345-678", fallback)).toBe(fallback);
		expect(sanitizePlayerAlias("tonny@example.com", fallback)).toBe(fallback);
		expect(sanitizePlayerAlias("A123456789", fallback)).toBe(fallback);
		expect(sanitizePlayerAlias("<b>鹿港環保伯</b>", fallback)).toBe("鹿港環保伯");
		expect(sanitizePlayerAlias("<script></script>", fallback)).toBe(fallback);

		const { db } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 9, 30, 0);

		const phoneSession = await startSessionAt(env, t0);
		const phoneRes = await submitScoreAt(
			env,
			buildValidPayload(phoneSession, ["pet_bottle"], { alias: "0912345678" }),
			t0 + 15_000,
		);
		expect(phoneRes.status).toBe(200);
		const phoneBoard = parseLeaderboardResponse(await phoneRes.json());
		expect(phoneBoard.ok).toBe(true);
		if (phoneBoard.ok) {
			expect(phoneBoard.value.entries[0]?.alias).toBe(phoneSession.alias);
			expect(phoneBoard.value.entries[0]?.alias).not.toContain("0912");
		}

		const emailSession = await startSessionAt(env, t0 + 1_000);
		const emailRes = await submitScoreAt(
			env,
			buildValidPayload(emailSession, ["aluminum_can"], { alias: "a@b.tw" }),
			t0 + 16_000,
		);
		expect(emailRes.status).toBe(200);
		const emailBoard = parseLeaderboardResponse(await emailRes.json());
		expect(emailBoard.ok).toBe(true);
		if (emailBoard.ok && emailBoard.value.callerPlacement.kind === "ranked") {
			expect(emailBoard.value.callerPlacement.entry.alias).toBe(emailSession.alias);
			expect(emailBoard.value.callerPlacement.entry.alias).not.toContain("@");
		}
	});

	it("enforces IP-hash rate limit of max 8 submissions per 60 seconds with 429", async () => {
		const { db } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 10, 0, 0);
		const burstIp = "203.0.113.200";

		for (let i = 0; i < 8; i++) {
			const session = await startSessionAt(env, t0 + i * 500);
			const payload = buildValidPayload(session, ["pet_bottle"]);
			const res = await submitScoreAt(env, payload, t0 + 10_000 + i * 500, burstIp);
			expect(res.status).toBe(200);
		}

		const ninthSession = await startSessionAt(env, t0 + 5_000);
		const ninthPayload = buildValidPayload(ninthSession, ["pet_bottle"]);
		const ninthRes = await submitScoreAt(env, ninthPayload, t0 + 15_000, burstIp);
		expect(ninthRes.status).toBe(429);
		expect(ninthRes.headers.get("Retry-After")).toBe("60");

		const otherIpRes = await submitScoreAt(
			env,
			ninthPayload,
			t0 + 15_500,
			"198.51.100.88",
		);
		expect(otherIpRes.status).toBe(200);

		const afterWindowSession = await startSessionAt(env, t0 + 65_000);
		const afterWindowPayload = buildValidPayload(afterWindowSession, ["pet_bottle"]);
		const afterWindowRes = await submitScoreAt(
			env,
			afterWindowPayload,
			t0 + 75_000,
			burstIp,
		);
		expect(afterWindowRes.status).toBe(200);
	});

	it("ranks daily and all_time leaderboards (top 20) and computes exact caller rank and percentile", async () => {
		const { db } = createTestD1Database();
		const env = createEnv(db);

		const yesterdayStart = Date.UTC(2026, 9, 27, 3, 0, 0);
		const yesterdayLegend = await startSessionAt(env, yesterdayStart);
		const legendPayload = buildValidPayload(
			yesterdayLegend,
			[
				"old_electronics",
				"old_electronics",
				"waste_battery",
				"waste_battery",
				"waste_battery",
				"clean_cardboard",
				"glass_bottle",
				"tin_can",
			],
			{ score: 1_900 },
		);
		const legendRes = await submitScoreAt(
			env,
			legendPayload,
			yesterdayStart + 30_000,
			"192.0.2.1",
		);
		expect(legendRes.status).toBe(200);

		const todayBase = Date.UTC(2026, 9, 28, 3, 0, 0);
		const todaySessions: SessionStartResponse[] = [];

		for (let i = 0; i < 22; i++) {
			const issuedAt = todayBase + i * 1_000;
			const session = await startSessionAt(env, issuedAt);
			todaySessions.push(session);

			const targetScore = 880 - i * 25;
			const payload = buildValidPayload(
				session,
				["old_electronics", "waste_battery", "glass_bottle", "aluminum_can"],
				{ score: targetScore },
			);
			const ip = `198.51.100.${10 + Math.floor(i / 4)}`;
			const res = await submitScoreAt(env, payload, issuedAt + 20_000, ip);
			expect(res.status).toBe(200);
		}

		const queryTime = todayBase + 90_000;
		const rank1Today = todaySessions[0];
		const rank11Today = todaySessions[10];
		const rank22Today = todaySessions[21];

		if (!rank1Today || !rank11Today || !rank22Today) {
			throw new Error("Expected 22 today sessions");
		}

		const dailyTopRes = await handleWorkerRequest(
			new Request(
				`https://recycle.example.tw/api/leaderboard?scope=daily&sessionId=${rank1Today.sessionId}`,
			),
			env,
			queryTime,
		);
		expect(dailyTopRes.status).toBe(200);
		const dailyTop = parseLeaderboardResponse(await dailyTopRes.json());
		expect(dailyTop.ok).toBe(true);
		if (dailyTop.ok) {
			expect(dailyTop.value.entries).toHaveLength(20);
			expect(dailyTop.value.entries[0]?.sessionId).toBe(rank1Today.sessionId);
			expect(dailyTop.value.entries[0]?.score).toBe(880);
			expect(dailyTop.value.callerPlacement).toMatchObject({
				kind: "ranked",
				rank: 1,
				percentile: 100,
			});
		}

		const dailyOutsideTop20Res = await handleWorkerRequest(
			new Request(
				`https://recycle.example.tw/api/leaderboard?scope=daily&sessionId=${rank22Today.sessionId}`,
			),
			env,
			queryTime,
		);
		const dailyBottom = parseLeaderboardResponse(await dailyOutsideTop20Res.json());
		expect(dailyBottom.ok).toBe(true);
		if (dailyBottom.ok) {
			expect(dailyBottom.value.entries).toHaveLength(20);
			expect(
				dailyBottom.value.entries.some((e) => e.sessionId === rank22Today.sessionId),
			).toBe(false);
			expect(dailyBottom.value.callerPlacement).toMatchObject({
				kind: "ranked",
				rank: 22,
				percentile: Math.round((1 / 22) * 100),
			});
		}

		const yesterdayInDailyRes = await handleWorkerRequest(
			new Request(
				`https://recycle.example.tw/api/leaderboard?scope=daily&sessionId=${yesterdayLegend.sessionId}`,
			),
			env,
			queryTime,
		);
		const yesterdayInDaily = parseLeaderboardResponse(await yesterdayInDailyRes.json());
		expect(yesterdayInDaily.ok).toBe(true);
		if (yesterdayInDaily.ok) {
			expect(yesterdayInDaily.value.callerPlacement).toEqual({ kind: "unranked" });
		}

		const allTimeRes = await handleWorkerRequest(
			new Request(
				`https://recycle.example.tw/api/leaderboard?scope=all_time&sessionId=${rank11Today.sessionId}`,
			),
			env,
			queryTime,
		);
		expect(allTimeRes.status).toBe(200);
		const allTime = parseLeaderboardResponse(await allTimeRes.json());
		expect(allTime.ok).toBe(true);
		if (allTime.ok) {
			expect(allTime.value.scope).toBe("all_time");
			expect(allTime.value.entries).toHaveLength(20);
			expect(allTime.value.entries[0]?.sessionId).toBe(yesterdayLegend.sessionId);
			expect(allTime.value.entries[0]?.score).toBe(1_900);
			expect(allTime.value.entries[1]?.sessionId).toBe(rank1Today.sessionId);
			expect(allTime.value.callerPlacement).toMatchObject({
				kind: "ranked",
				rank: 12,
				percentile: Math.round(((23 - 12 + 1) / 23) * 100),
			});
		}
	});

	it("rejects forged itemIds or illegal standing zones against the session seed and rate-limits alias updates on consumed sessions", async () => {
		const { db } = createTestD1Database();
		const env = createEnv(db);
		const t0 = Date.UTC(2026, 9, 28, 12, 0, 0);

		const forgedSession = await startSessionAt(env, t0);
		const forgedPayload: SubmitScorePayload = {
			sessionId: forgedSession.sessionId,
			signature: forgedSession.signature,
			durationMs: 25_000,
			score: 320,
			recyclableTallies: {
				...createEmptyRecyclableTallies(),
				old_electronics: 1,
			},
			contaminantTallies: createEmptyContaminantTallies(),
			violationTallies: createEmptyViolationTallies(),
			triadsCompleted: 0,
			orientationUsed: "portrait",
			pickupClaims: [
				{
					itemId: parseItemId("item_forged_999"),
					kind: "old_electronics",
					atElapsedMs: 4_000,
					standingZoneId: parseZoneId("zone_no_ped_ne"),
					awardedPoints: 320,
				},
			],
		};
		const forgedRes = await submitScoreAt(env, forgedPayload, t0 + 30_000, "203.0.113.88");
		expect(forgedRes.status).toBe(422);

		const spamIp = "203.0.113.99";
		const consumedSessions: SessionStartResponse[] = [];
		for (let i = 0; i < 8; i++) {
			const s = await startSessionAt(env, t0 + i * 100);
			consumedSessions.push(s);
			const valid = buildValidPayload(s, ["pet_bottle"]);
			const okRes = await submitScoreAt(env, valid, t0 + 20_000 + i * 100, spamIp);
			expect(okRes.status).toBe(200);
		}

		const alreadyConsumed = consumedSessions[0];
		if (!alreadyConsumed) {
			throw new Error("Expected consumed session");
		}
		const blockedRename = await submitScoreAt(
			env,
			buildValidPayload(alreadyConsumed, ["pet_bottle"], { alias: "刷頻改名客" }),
			t0 + 25_000,
			spamIp,
		);
		expect(blockedRename.status).toBe(429);
	});
});
