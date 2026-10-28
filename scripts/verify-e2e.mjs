import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium, webkit } from "playwright";

function resolveBrowserExecutable(browserType, dirPrefix, relativeBin) {
	const defaultPath = browserType.executablePath();
	if (fsSync.existsSync(defaultPath)) {
		return defaultPath;
	}
	const cacheRoot = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
	if (fsSync.existsSync(cacheRoot)) {
		const dirs = fsSync
			.readdirSync(cacheRoot)
			.filter((d) => d.startsWith(`${dirPrefix}-`))
			.sort()
			.reverse();
		for (const d of dirs) {
			const candidate = path.join(cacheRoot, d, relativeBin);
			if (fsSync.existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

const DEFAULT_PORT = 8788;
const BASE_URL = process.env.VERIFY_BASE_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`;
const ARTIFACT_DIR =
	process.env.VERIFY_SCREENSHOT_DIR ??
	"/Users/tonny/.gemini/antigravity-cli/brain/55a1a5e1-f68c-468e-b68c-eb2c7ba3cbdf";

function assert(condition, message) {
	if (!condition) {
		throw new Error(`Verification failed: ${message}`);
	}
}

async function waitForHealth(baseUrl, timeoutMs = 25_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const res = await fetch(`${baseUrl}/api/health`);
			if (res.ok) return;
		} catch {
			void 0;
		}
		await new Promise((r) => setTimeout(r, 350));
	}
	throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
}

function startLocalWrangler(port) {
	const proc = spawn(
		"npx",
		["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port)],
		{
			cwd: process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, CI: "1" },
		},
	);
	let logs = "";
	proc.stdout?.on("data", (chunk) => {
		logs += String(chunk);
	});
	proc.stderr?.on("data", (chunk) => {
		logs += String(chunk);
	});
	return {
		proc,
		getLogs: () => logs,
		stop: async () => {
			if (proc.exitCode !== null) return;
			proc.kill("SIGTERM");
			await new Promise((resolve) => {
				const timer = setTimeout(() => {
					if (proc.exitCode === null) proc.kill("SIGKILL");
					resolve(undefined);
				}, 3000);
				proc.once("exit", () => {
					clearTimeout(timer);
					resolve(undefined);
				});
			});
		},
	};
}

function verifyPngDataUrl(dataUrl) {
	const prefix = "data:image/png;base64,";
	assert(
		typeof dataUrl === "string" && dataUrl.startsWith(prefix),
		"Polaroid src must be a base64 PNG data URL",
	);
	const buf = Buffer.from(dataUrl.slice(prefix.length), "base64");
	const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	assert(buf.length > 4096, `Polaroid PNG buffer too small (${buf.length} bytes)`);
	assert(
		buf.subarray(0, 8).equals(pngMagic),
		"Polaroid PNG buffer missing 8-byte PNG signature",
	);
	return buf;
}

async function runGameplayInPage(page, options) {
	const {
		laneName,
		portraitSize,
		landscapeSize,
		aliasToSubmit,
		expectExistingAlias,
		testViolationsAndContaminants,
		screenshotPrefix,
	} = options;

	const pageErrors = [];
	const consoleErrors = [];
	page.on("pageerror", (err) => pageErrors.push(err.message));
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			consoleErrors.push(msg.text());
		}
	});

	await page.setViewportSize(portraitSize);
	await page.goto(BASE_URL, { waitUntil: "networkidle" });
	await page.waitForSelector('[data-testid="start-modal"]', { timeout: 15_000 });

	const fontReady = await page.evaluate(async () => {
		await document.fonts.ready;
		await document.fonts.load('18px "OpenHuninn"');
		return document.fonts.check('18px "OpenHuninn"');
	});
	assert(fontReady, `[${laneName}] OpenHuninn Traditional Chinese font did not load`);

	if (expectExistingAlias) {
		await page.click('[data-testid="open-leaderboard-btn"]');
		await page.waitForFunction(
			(expected) => {
				const modal = document.querySelector('[data-testid="start-modal"]');
				return Boolean(modal && modal.textContent && modal.textContent.includes(expected));
			},
			expectExistingAlias,
			{ timeout: 10_000 },
		);
	}

	await page.screenshot({
		path: path.join(ARTIFACT_DIR, `${screenshotPrefix}-start-portrait.png`),
	});

	await page.click('[data-testid="start-game-btn"]');
	await page.waitForFunction(
		() => {
			const g = window.__RECYCLE_GAME__;
			const st = g?.getRunState();
			return Boolean(st && st.status === "active" && st.sessionId.startsWith("sess_"));
		},
		undefined,
		{ timeout: 10_000 },
	);

	const initialPortraitCheck = await page.evaluate(() => {
		const g = window.__RECYCLE_GAME__;
		const st = g.getRunState();
		const vm = g.getViewportMetrics();
		return {
			sessionId: st.sessionId,
			signaturePrefix: st.signature.slice(0, 12),
			mode: vm?.mode ?? null,
			orientationUsed: g.getOrientationUsed(),
		};
	});

	assert(
		initialPortraitCheck.signaturePrefix !== "local_offlin",
		`[${laneName}] Expected live Worker session grant, got offline fallback`,
	);
	assert(
		initialPortraitCheck.mode === "portrait",
		`[${laneName}] Expected portrait viewport mode, got ${initialPortraitCheck.mode}`,
	);

	const portraitGameplayResult = await page.evaluate(async () => {
		const g = window.__RECYCLE_GAME__;

		function stepSegment(targetX, targetY, signalPhase = "walk_green", maxSteps = 220) {
			for (let i = 0; i < maxSteps; i++) {
				const st = g.getRunState();
				const dx = targetX - st.locomotion.position.xMeters;
				const dy = targetY - st.locomotion.position.yMeters;
				const dist = Math.hypot(dx, dy);
				if (dist <= 0.28) break;
				const speed = st.locomotion.kind === "pushing_cart" ? 4.2 : 5.8;
				const stepMeters = speed * 0.05;
				const scale = dist < stepMeters ? dist / stepMeters : 1;
				g.dispatchDomainCommand({
					kind: "advance_frame",
					dtMs: 50,
					velocityMps: {
						vx: (dx / dist) * speed * scale,
						vy: (dy / dist) * speed * scale,
					},
					signals: { ns: signalPhase, ew: signalPhase },
				});
			}
		}

		function navigateLegally(targetX, targetY) {
			const start = g.getRunState().locomotion.position;
			const startWest = start.xMeters < 18;
			const targetWest = targetX < 18;
			const spineX = (west) => (west ? 2.4 : 32.2);
			const crossX = (west) => (west ? 6.8 : 29.0);

			if (startWest === targetWest) {
				const sx = spineX(startWest);
				const crossesIntersection =
					(start.yMeters >= 27 && targetY <= 18) ||
					(start.yMeters <= 18 && targetY >= 27);
				if (crossesIntersection) {
					const cx = crossX(startWest);
					stepSegment(sx, start.yMeters);
					stepSegment(sx, start.yMeters >= 27 ? 28.4 : 16.8);
					stepSegment(cx, start.yMeters >= 27 ? 27.6 : 17.4);
					stepSegment(cx, targetY <= 18 ? 17.4 : 27.6);
					stepSegment(sx, targetY <= 18 ? 16.8 : 28.4);
				} else {
					stepSegment(sx, start.yMeters);
				}
				stepSegment(sx, targetY);
				stepSegment(targetX, targetY);
			} else {
				const cxStart = crossX(startWest);
				const cxEnd = crossX(targetWest);
				stepSegment(spineX(startWest), start.yMeters);
				if (start.yMeters < 18) {
					stepSegment(spineX(startWest), 16.8);
					stepSegment(cxStart, 17.4);
					stepSegment(cxStart, 28.4);
				} else {
					stepSegment(spineX(startWest), 28.4);
					stepSegment(cxStart, 28.4);
				}
				stepSegment(cxEnd, 28.4);
				if (targetY < 18) {
					stepSegment(cxEnd, 17.4);
					stepSegment(spineX(targetWest), 16.8);
				}
				stepSegment(spineX(targetWest), targetY);
				stepSegment(targetX, targetY);
			}

			for (let pause = 0; pause < 6; pause++) {
				g.dispatchDomainCommand({
					kind: "advance_frame",
					dtMs: 50,
					velocityMps: { vx: 0, vy: 0 },
					signals: { ns: "walk_green", ew: "walk_green" },
				});
			}
		}

		const init = g.getRunState();
		const hydrants = init.layout.zones.filter((z) => z.kind === "hydrant_red_zone");
		const inHydrant = (pt) =>
			hydrants.some(
				(h) =>
					Math.hypot(pt.xMeters - h.center.xMeters, pt.yMeters - h.center.yMeters) <=
					h.radiusMeters + 0.5,
			);

		const westSafeRecyclables = [];
		const footRecyclables = [];

		for (const item of init.itemsById.values()) {
			if (item.collected || item.category !== "recyclable") continue;
			if (item.position.yMeters >= 33 && item.position.xMeters >= 27) continue;

			const standingZone = item.legalStandingZoneIds
				.map((zid) => init.layout.zonesById.get(zid))
				.find(
					(z) =>
						z &&
						(z.kind === "arcade_walkway" || z.kind === "sidewalk") &&
						"bounds" in z,
				);
			if (!standingZone || !("bounds" in standingZone)) continue;

			const standPt = {
				xMeters: Math.max(
					standingZone.bounds.minXMeters + 0.4,
					Math.min(
						standingZone.bounds.minXMeters + standingZone.bounds.widthMeters - 0.4,
						item.position.xMeters,
					),
				),
				yMeters: Math.max(
					standingZone.bounds.minYMeters + 0.4,
					Math.min(
						standingZone.bounds.minYMeters + standingZone.bounds.depthMeters - 0.4,
						item.position.yMeters,
					),
				),
			};
			if (
				Math.hypot(
					standPt.xMeters - item.position.xMeters,
					standPt.yMeters - item.position.yMeters,
				) > 1.9
			) {
				continue;
			}

			if (inHydrant(standPt) || inHydrant(item.position)) {
				footRecyclables.push({ item, standPt });
			} else if (standPt.xMeters < 18) {
				westSafeRecyclables.push({ item, standPt });
			} else {
				footRecyclables.push({ item, standPt });
			}
		}

		westSafeRecyclables.sort((a, b) => b.standPt.yMeters - a.standPt.yMeters);

		for (const target of westSafeRecyclables.slice(0, 2)) {
			navigateLegally(target.standPt.xMeters, target.standPt.yMeters);
			g.dispatchDomainCommand({ kind: "interact_nearest" });
		}

		let parkedAndDeposited = false;
		const swArcadeSpot = init.layout.zones.find(
			(z) => z.zoneId === "zone_curb_arcade_spot_sw",
		);
		if (swArcadeSpot && "bounds" in swArcadeSpot) {
			const parkX = swArcadeSpot.bounds.minXMeters + swArcadeSpot.bounds.widthMeters / 2;
			const parkY = swArcadeSpot.bounds.minYMeters + swArcadeSpot.bounds.depthMeters / 2;
			navigateLegally(parkX, parkY);
			g.dispatchDomainCommand({ kind: "toggle_cart" });
			if (g.getRunState().locomotion.kind === "on_foot") {
				const footTarget = westSafeRecyclables[2] ?? footRecyclables[0];
				if (footTarget) {
					navigateLegally(footTarget.standPt.xMeters, footTarget.standPt.yMeters);
					g.dispatchDomainCommand({ kind: "interact_nearest" });
				}
				navigateLegally(parkX, parkY);
				g.dispatchDomainCommand({ kind: "toggle_cart" });
				parkedAndDeposited = g.getRunState().locomotion.kind === "pushing_cart";
			}
		}

		const afterPortrait = g.getRunState();
		return {
			sessionId: afterPortrait.sessionId,
			score: afterPortrait.score,
			pickupClaimsCount: afterPortrait.pickupClaims.length,
			violations: afterPortrait.violationTallies,
			position: afterPortrait.locomotion.position,
			parkedAndDeposited,
		};
	});

	assert(
		portraitGameplayResult.pickupClaimsCount >= 2 && portraitGameplayResult.score > 0,
		`[${laneName}] Expected >=2 legal recyclable pickups in portrait, got ${portraitGameplayResult.pickupClaimsCount} (score=${portraitGameplayResult.score})`,
	);
	assert(
		portraitGameplayResult.parkedAndDeposited,
		`[${laneName}] Expected cart parking -> on-foot pickup -> cart deposit cycle to succeed`,
	);

	await page.waitForTimeout(250);
	await page.screenshot({
		path: path.join(ARTIFACT_DIR, `${screenshotPrefix}-gameplay-portrait.png`),
	});

	await page.setViewportSize(landscapeSize);
	await page.waitForTimeout(300);

	const postRotate = await page.evaluate(() => {
		const g = window.__RECYCLE_GAME__;
		const st = g.getRunState();
		const vm = g.getViewportMetrics();
		return {
			sessionId: st.sessionId,
			score: st.score,
			position: st.locomotion.position,
			mode: vm?.mode ?? null,
			orientationUsed: g.getOrientationUsed(),
		};
	});

	assert(
		postRotate.sessionId === portraitGameplayResult.sessionId,
		`[${laneName}] Mid-round rotation reset sessionId`,
	);
	assert(
		postRotate.score === portraitGameplayResult.score,
		`[${laneName}] Mid-round rotation altered score (${portraitGameplayResult.score} -> ${postRotate.score})`,
	);
	assert(
		postRotate.mode === "landscape" && postRotate.orientationUsed === "both",
		`[${laneName}] Expected landscape + orientationUsed='both', got mode=${postRotate.mode}, orientationUsed=${postRotate.orientationUsed}`,
	);

	await page.screenshot({
		path: path.join(ARTIFACT_DIR, `${screenshotPrefix}-gameplay-landscape.png`),
	});

	const preFinishCheck = await page.evaluate(
		({ runNegativeChecks }) => {
			const g = window.__RECYCLE_GAME__;

			function stepSegment(targetX, targetY, signalPhase = "walk_green", maxSteps = 220) {
				for (let i = 0; i < maxSteps; i++) {
					const st = g.getRunState();
					const dx = targetX - st.locomotion.position.xMeters;
					const dy = targetY - st.locomotion.position.yMeters;
					const dist = Math.hypot(dx, dy);
					if (dist <= 0.28) break;
					const speed = st.locomotion.kind === "pushing_cart" ? 4.2 : 5.8;
					const stepMeters = speed * 0.05;
					const scale = dist < stepMeters ? dist / stepMeters : 1;
					g.dispatchDomainCommand({
						kind: "advance_frame",
						dtMs: 50,
						velocityMps: {
							vx: (dx / dist) * speed * scale,
							vy: (dy / dist) * speed * scale,
						},
						signals: { ns: signalPhase, ew: signalPhase },
					});
				}
			}

			function navigateLegally(targetX, targetY) {
				const start = g.getRunState().locomotion.position;
				const startWest = start.xMeters < 18;
				const targetWest = targetX < 18;
				const spineX = (west) => (west ? 2.4 : 32.2);
				const crossX = (west) => (west ? 6.8 : 29.0);

				if (startWest === targetWest) {
					const sx = spineX(startWest);
					const crossesIntersection =
						(start.yMeters >= 27 && targetY <= 18) ||
						(start.yMeters <= 18 && targetY >= 27);
					if (crossesIntersection) {
						const cx = crossX(startWest);
						stepSegment(sx, start.yMeters >= 27 ? 28.4 : 16.8);
						stepSegment(cx, start.yMeters >= 27 ? 27.6 : 17.4);
						stepSegment(cx, targetY <= 18 ? 17.4 : 27.6);
						stepSegment(sx, targetY <= 18 ? 16.8 : 28.4);
					} else {
						stepSegment(sx, start.yMeters);
					}
					stepSegment(sx, targetY);
					stepSegment(targetX, targetY);
				} else {
					const cxStart = crossX(startWest);
					const cxEnd = crossX(targetWest);
					stepSegment(spineX(startWest), start.yMeters);
					if (start.yMeters < 18) {
						stepSegment(spineX(startWest), 16.8);
						stepSegment(cxStart, 17.4);
						stepSegment(cxStart, 28.4);
					} else {
						stepSegment(spineX(startWest), 28.4);
						stepSegment(cxStart, 28.4);
					}
					stepSegment(cxEnd, 28.4);
					if (targetY < 18) {
						stepSegment(cxEnd, 17.4);
						stepSegment(spineX(targetWest), 16.8);
					}
					stepSegment(spineX(targetWest), targetY);
					stepSegment(targetX, targetY);
				}

				for (let pause = 0; pause < 6; pause++) {
					g.dispatchDomainCommand({
						kind: "advance_frame",
						dtMs: 50,
						velocityMps: { vx: 0, vy: 0 },
						signals: { ns: "walk_green", ew: "walk_green" },
					});
				}
			}

			let contaminantTested = false;
			let redCrosswalkCited = false;

			if (runNegativeChecks) {
				const st0 = g.getRunState();
				const hydrants = st0.layout.zones.filter((z) => z.kind === "hydrant_red_zone");
				const inHydrant = (pt) =>
					hydrants.some(
						(h) =>
							Math.hypot(pt.xMeters - h.center.xMeters, pt.yMeters - h.center.yMeters) <=
							h.radiusMeters + 0.5,
					);

				const trashItem = [...st0.itemsById.values()].find(
					(it) =>
						!it.collected &&
						it.category === "contaminant" &&
						!inHydrant(it.position) &&
						!(it.position.yMeters >= 33 && it.position.xMeters >= 27),
				);
				if (trashItem) {
					const beforeClaims = g.getRunState().pickupClaims.length;
					navigateLegally(trashItem.position.xMeters, trashItem.position.yMeters);
					g.dispatchDomainCommand({ kind: "interact_nearest" });
					const afterTrash = g.getRunState();
					const totalTrash = Object.values(afterTrash.contaminantTallies).reduce(
						(a, b) => a + b,
						0,
					);
					contaminantTested =
						totalTrash >= 1 && afterTrash.pickupClaims.length === beforeClaims;
				}

				navigateLegally(6.8, 27.6);
				stepSegment(6.8, 25.8, "stop_red");
				redCrosswalkCited =
					g.getRunState().violationTallies.crosswalk_entered_on_red >= 1;
				stepSegment(6.8, 28.2, "walk_green");
				stepSegment(2.4, 28.4, "walk_green");
			}

			const stMid = g.getRunState();
			const hydrantsMid = stMid.layout.zones.filter((z) => z.kind === "hydrant_red_zone");
			const inHydrantMid = (pt) =>
				hydrantsMid.some(
					(h) =>
						Math.hypot(pt.xMeters - h.center.xMeters, pt.yMeters - h.center.yMeters) <=
						h.radiusMeters + 0.5,
				);

			const extraRecyclables = [...stMid.itemsById.values()].filter(
				(it) =>
					!it.collected &&
					it.category === "recyclable" &&
					!inHydrantMid(it.position) &&
					!(it.position.yMeters >= 33 && it.position.xMeters >= 27),
			);
			for (const item of extraRecyclables.slice(0, 3)) {
				const sz = item.legalStandingZoneIds
					.map((zid) => stMid.layout.zonesById.get(zid))
					.find(
						(z) =>
							z &&
							(z.kind === "arcade_walkway" || z.kind === "sidewalk") &&
							"bounds" in z,
					);
				if (!sz || !("bounds" in sz)) continue;
				const tx = Math.max(
					sz.bounds.minXMeters + 0.4,
					Math.min(
						sz.bounds.minXMeters + sz.bounds.widthMeters - 0.4,
						item.position.xMeters,
					),
				);
				const ty = Math.max(
					sz.bounds.minYMeters + 0.4,
					Math.min(
						sz.bounds.minYMeters + sz.bounds.depthMeters - 0.4,
						item.position.yMeters,
					),
				);
				if (inHydrantMid({ xMeters: tx, yMeters: ty })) continue;
				navigateLegally(tx, ty);
				g.dispatchDomainCommand({ kind: "interact_nearest" });
			}

			while (g.getRunState().elapsedMs < 6_500) {
				g.dispatchDomainCommand({
					kind: "advance_frame",
					dtMs: 50,
					velocityMps: { vx: 0, vy: 0 },
					signals: { ns: "walk_green", ew: "walk_green" },
				});
			}

			const perf = g.getPerfMetrics();
			g.dispatchDomainCommand({ kind: "finish_now" });
			const finalState = g.getRunState();
			return {
				contaminantTested,
				redCrosswalkCited,
				finalScore: finalState.score,
				elapsedMs: finalState.elapsedMs,
				perf,
			};
		},
		{ runNegativeChecks: testViolationsAndContaminants },
	);

	if (testViolationsAndContaminants) {
		assert(
			preFinishCheck.contaminantTested,
			`[${laneName}] Dirty trash contaminant pickup did not trigger penalty without incrementing recyclables`,
		);
		assert(
			preFinishCheck.redCrosswalkCited,
			`[${laneName}] Entering crosswalk on stop_red did not cite crosswalk_entered_on_red`,
		);
	}
	assert(
		preFinishCheck.finalScore > 0,
		`[${laneName}] Expected positive finalScore, got ${preFinishCheck.finalScore}`,
	);
	assert(
		preFinishCheck.perf.p95FrameMs <= 45,
		`[${laneName}] p95FrameMs exceeded budget (${preFinishCheck.perf.p95FrameMs}ms)`,
	);

	await page.waitForSelector('[data-testid="gameover-modal"]', { timeout: 15_000 });
	await page.waitForSelector('[data-testid="polaroid-image"]', { timeout: 15_000 });
	await page.waitForSelector(
		'[data-testid="leaderboard-table-holder"] .leaderboard-table',
		{ timeout: 15_000 },
	);

	const polaroidData = await page.evaluate(() => {
		const imgs = [...document.querySelectorAll('[data-testid="polaroid-image"]')];
		const links = [...document.querySelectorAll('[data-testid="polaroid-download-btn"]')];
		return imgs.map((img, idx) => ({
			src: img.getAttribute("src") ?? "",
			naturalWidth: img.naturalWidth,
			naturalHeight: img.naturalHeight,
			downloadName: links[idx]?.getAttribute("download") ?? "",
		}));
	});

	assert(
		polaroidData.length >= 1 && polaroidData.length <= 3,
		`[${laneName}] Expected 1..3 Polaroid highlight cards, got ${polaroidData.length}`,
	);
	for (const card of polaroidData) {
		const pngBuf = verifyPngDataUrl(card.src);
		assert(
			card.naturalWidth === 880 && card.naturalHeight === 720,
			`[${laneName}] Expected Polaroid 880x720, got ${card.naturalWidth}x${card.naturalHeight}`,
		);
		assert(
			card.downloadName.endsWith(".png"),
			`[${laneName}] Expected .png download attribute, got ${card.downloadName}`,
		);
		if (screenshotPrefix === "e2e-ios") {
			await fs.writeFile(
				path.join(ARTIFACT_DIR, "e2e-polaroid-keepsake.png"),
				pngBuf,
			);
		}
	}

	await page.fill('[data-testid="alias-input"]', "");
	await page.focus('[data-testid="alias-input"]');
	await page.keyboard.type("wasd ec ");
	const typedRawKeys = await page.inputValue('[data-testid="alias-input"]');
	assert(
		typedRawKeys === "wasd ec ",
		`[${laneName}] Phaser keyboard capture swallowed text input keys: got ${JSON.stringify(typedRawKeys)}`,
	);

	await page.fill('[data-testid="alias-input"]', aliasToSubmit);
	await page.click('[data-testid="submit-score-btn"]');
	await page.waitForFunction(
		(expectedAlias) => {
			const holder = document.querySelector('[data-testid="leaderboard-table-holder"]');
			return Boolean(holder && holder.textContent && holder.textContent.includes(expectedAlias));
		},
		aliasToSubmit,
		{ timeout: 10_000 },
	);

	await page.evaluate(() => {
		const card = document.querySelector(".taiwan-card");
		if (card) card.scrollTop = 0;
	});
	await page.screenshot({
		path: path.join(ARTIFACT_DIR, `${screenshotPrefix}-gameover-landscape.png`),
	});

	await page.evaluate(() => {
		const card = document.querySelector(".taiwan-card");
		if (card) card.scrollTop = card.scrollHeight;
	});
	await page.screenshot({
		path: path.join(ARTIFACT_DIR, `${screenshotPrefix}-leaderboard-ranked.png`),
	});

	assert(
		pageErrors.length === 0,
		`[${laneName}] Uncaught page errors: ${pageErrors.join(" | ")}`,
	);
	assert(
		consoleErrors.length === 0,
		`[${laneName}] Console errors: ${consoleErrors.join(" | ")}`,
	);

	return {
		laneName,
		finalScore: preFinishCheck.finalScore,
		polaroidCount: polaroidData.length,
		perf: preFinishCheck.perf,
	};
}

async function verifyEdgeAntiCheat() {
	const startRes = await fetch(`${BASE_URL}/api/session/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
	});
	assert(startRes.ok, "POST /api/session/start failed");
	const session = await startRes.json();

	const emptyRecyclables = {
		pet_bottle: 0,
		aluminum_can: 0,
		tin_can: 0,
		clean_cardboard: 0,
		glass_bottle: 0,
		waste_battery: 0,
		old_electronics: 0,
	};
	const emptyContaminants = {
		greasy_lunchbox: 0,
		used_tissue: 0,
		cigarette_butt: 0,
		soiled_plastic_bag: 0,
	};
	const emptyViolations = {
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

	const tamperedScoreRes = await fetch(`${BASE_URL}/api/leaderboard/submit`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			sessionId: session.sessionId,
			signature: session.signature,
			alias: "作弊測試員",
			durationMs: 12_000,
			score: 55_000,
			recyclableTallies: emptyRecyclables,
			contaminantTallies: emptyContaminants,
			violationTallies: emptyViolations,
			triadsCompleted: 0,
			orientationUsed: "portrait",
			pickupClaims: [],
		}),
	});
	assert(
		tamperedScoreRes.status === 422 || tamperedScoreRes.status === 400,
		`Expected 422/400 on tampered score, got ${tamperedScoreRes.status}`,
	);

	const forgedSigRes = await fetch(`${BASE_URL}/api/leaderboard/submit`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			sessionId: session.sessionId,
			signature: "0".repeat(64),
			alias: "偽造簽章客",
			durationMs: 12_000,
			score: 0,
			recyclableTallies: emptyRecyclables,
			contaminantTallies: emptyContaminants,
			violationTallies: emptyViolations,
			triadsCompleted: 0,
			orientationUsed: "portrait",
			pickupClaims: [],
		}),
	});
	assert(
		forgedSigRes.status === 403,
		`Expected 403 on forged HMAC signature, got ${forgedSigRes.status}`,
	);
}

async function main() {
	await fs.mkdir(ARTIFACT_DIR, { recursive: true });

	const useExternal = Boolean(process.env.VERIFY_BASE_URL);
	const server = useExternal ? null : startLocalWrangler(DEFAULT_PORT);

	try {
		await waitForHealth(BASE_URL);
		await verifyEdgeAntiCheat();

		const iosAlias = `永康資收王${String(Date.now()).slice(-4)}`;
		const androidAlias = `赤峰環保俠${String(Date.now()).slice(-4)}`;

		const webkitExec = resolveBrowserExecutable(webkit, "webkit", "pw_run.sh");
		const webkitBrowser = await webkit.launch({
			headless: true,
			...(webkitExec ? { executablePath: webkitExec } : {}),
		});
		let iosSummary;
		try {
			const iosContext = await webkitBrowser.newContext({
				viewport: { width: 390, height: 844 },
				deviceScaleFactor: 2,
				hasTouch: true,
				isMobile: true,
			});
			const iosPage = await iosContext.newPage();
			iosSummary = await runGameplayInPage(iosPage, {
				laneName: "ios-webkit",
				portraitSize: { width: 390, height: 844 },
				landscapeSize: { width: 844, height: 390 },
				aliasToSubmit: iosAlias,
				expectExistingAlias: null,
				testViolationsAndContaminants: true,
				screenshotPrefix: "e2e-ios",
			});
			await iosContext.close();
		} finally {
			await webkitBrowser.close();
		}

		const chromiumExec = resolveBrowserExecutable(
			chromium,
			"chromium",
			path.join(
				"chrome-mac-arm64",
				"Google Chrome for Testing.app",
				"Contents",
				"MacOS",
				"Google Chrome for Testing",
			),
		);
		const chromiumBrowser = await chromium.launch({
			headless: true,
			...(chromiumExec ? { executablePath: chromiumExec } : {}),
		});
		let androidSummary;
		try {
			const androidContext = await chromiumBrowser.newContext({
				viewport: { width: 412, height: 915 },
				deviceScaleFactor: 2,
				hasTouch: true,
				isMobile: true,
			});
			const androidPage = await androidContext.newPage();
			androidSummary = await runGameplayInPage(androidPage, {
				laneName: "android-chromium",
				portraitSize: { width: 412, height: 915 },
				landscapeSize: { width: 915, height: 412 },
				aliasToSubmit: androidAlias,
				expectExistingAlias: iosAlias,
				testViolationsAndContaminants: false,
				screenshotPrefix: "e2e-android",
			});
			await androidContext.close();
		} finally {
			await chromiumBrowser.close();
		}

		console.log(
			JSON.stringify(
				{
					ok: true,
					baseUrl: BASE_URL,
					antiCheatVerified: true,
					lanes: [iosSummary, androidSummary],
				},
				null,
				2,
			),
		);
	} catch (err) {
		if (server) {
			console.error("Wrangler logs:\n", server.getLogs());
		}
		throw err;
	} finally {
		if (server) {
			await server.stop();
		}
	}
}

await main();
