import Phaser from "phaser";
import {
	CONTAMINANT_CATALOG,
	LEGAL_LIMITS,
	RECYCLABLE_CATALOG,
	VIOLATION_CATALOG,
	deriveCo2SavedGrams,
	parseCaptureId,
	type OrientationUsed,
	type SessionStartResponse,
} from "../../shared/contracts.ts";
import {
	computeSignalAt,
	createHighlightReel,
	createRunState,
	createStreetLayout,
	stepHighlightReel,
	stepRun,
	toSubmitScorePayload,
} from "../../domain/index.ts";
import type {
	HighlightMeta,
	HighlightReel,
	PedestrianSignalPhase,
	RunCommand,
	RunEvent,
	RunState,
	StreetFixture,
	WorldItem,
} from "../../domain/types.ts";
import { SoundSynth } from "../audio/SoundSynth.ts";
import {
	composePolaroidCard,
	type ComposedPolaroid,
} from "../capture/PolaroidCompositor.ts";
import { registerTaiwanStreetTextures } from "../render/StreetGraphics.ts";
import {
	DualOrientationTracker,
	PIXELS_PER_METER,
	type ViewportMetrics,
} from "../viewport/DualOrientationViewport.ts";

type ScooterVisual = {
	readonly sprite: Phaser.GameObjects.Image;
	readonly axis: "ns" | "ew";
	readonly dir: 1 | -1;
	xMeters: number;
	yMeters: number;
	readonly speedMps: number;
};

type SignalPostVisual = {
	readonly axis: "ns" | "ew";
	readonly container: Phaser.GameObjects.Container;
	readonly countdownText: Phaser.GameObjects.Text;
	readonly figureGfx: Phaser.GameObjects.Graphics;
};

export type GameEndPayload = {
	readonly finalState: RunState;
	readonly orientationUsed: OrientationUsed;
	readonly polaroids: readonly ComposedPolaroid[];
	readonly buildSubmission: (
		alias: string,
	) => ReturnType<typeof toSubmitScorePayload>;
};

export type AlleySceneBridge = {
	getRunState(): RunState | null;
	getViewportMetrics(): ViewportMetrics | null;
	getOrientationUsed(): OrientationUsed;
	getPerfMetrics(): {
		readonly sampleCount: number;
		readonly avgFrameMs: number;
		readonly p95FrameMs: number;
	};
	dispatchDomainCommand(cmd: RunCommand): void;
};

const toPx = (meters: number): number => meters * PIXELS_PER_METER;

export class AlleyGameScene extends Phaser.Scene implements AlleySceneBridge {
	private readonly orientationTracker = new DualOrientationTracker();
	private readonly soundSynth = new SoundSynth();
	private readonly onRoundComplete: (payload: GameEndPayload) => void;

	private runState: RunState | null = null;
	private viewportMetrics: ViewportMetrics | null = null;
	private reel: HighlightReel<HTMLImageElement> = createHighlightReel();
	private pendingSnapshotJobs: Array<Promise<void>> = [];
	private inFlightFrameDataUrl: Promise<string | null> | null = null;
	private roundEndedHandled = false;

	private playerCartSprite: Phaser.GameObjects.Image | null = null;
	private playerFootSprite: Phaser.GameObjects.Image | null = null;
	private parkedCartSprite: Phaser.GameObjects.Image | null = null;
	private statusRingGfx: Phaser.GameObjects.Graphics | null = null;

	private itemSprites = new Map<string, Phaser.GameObjects.Image>();
	private signalPosts: SignalPostVisual[] = [];
	private scooters: ScooterVisual[] = [];

	private hudContainer: Phaser.GameObjects.Container | null = null;
	private controlsRootContainer: Phaser.GameObjects.Container | null = null;
	private uiCamera: Phaser.Cameras.Scene2D.Camera | null = null;
	private hudBg: Phaser.GameObjects.Graphics | null = null;
	private hudScoreText: Phaser.GameObjects.Text | null = null;
	private hudTimerText: Phaser.GameObjects.Text | null = null;
	private hudSignalText: Phaser.GameObjects.Text | null = null;
	private hudTriadText: Phaser.GameObjects.Text | null = null;
	private hudHintText: Phaser.GameObjects.Text | null = null;

	private joyBaseGfx: Phaser.GameObjects.Graphics | null = null;
	private joyKnobGfx: Phaser.GameObjects.Graphics | null = null;
	private collectBtnContainer: Phaser.GameObjects.Container | null = null;
	private collectBtnBg: Phaser.GameObjects.Graphics | null = null;
	private collectBtnLabel: Phaser.GameObjects.Text | null = null;
	private cartBtnContainer: Phaser.GameObjects.Container | null = null;
	private cartBtnBg: Phaser.GameObjects.Graphics | null = null;
	private cartBtnLabel: Phaser.GameObjects.Text | null = null;

	private joystickPointerId: number | null = null;
	private joystickVec = { x: 0, y: 0 };
	private queuedDiscreteCommands: RunCommand[] = [];

	private cursors: {
		up: Phaser.Input.Keyboard.Key;
		down: Phaser.Input.Keyboard.Key;
		left: Phaser.Input.Keyboard.Key;
		right: Phaser.Input.Keyboard.Key;
	} | null = null;
	private wasdKeys: {
		W: Phaser.Input.Keyboard.Key;
		A: Phaser.Input.Keyboard.Key;
		S: Phaser.Input.Keyboard.Key;
		D: Phaser.Input.Keyboard.Key;
		SPACE: Phaser.Input.Keyboard.Key;
		E: Phaser.Input.Keyboard.Key;
		C: Phaser.Input.Keyboard.Key;
	} | null = null;

	private frameDeltasMs: number[] = [];

	public constructor(onRoundComplete: (payload: GameEndPayload) => void) {
		super({ key: "AlleyGameScene" });
		this.onRoundComplete = onRoundComplete;
	}

	public preload(): void {
		this.load.image("tile_asphalt", "/assets/street/tile-asphalt.jpg");
		this.load.image("tile_terrazzo", "/assets/street/tile-terrazzo.jpg");
		this.load.image("prop_telecom_box", "/assets/street/prop-telecom-box.png");
		this.load.image("prop_fire_hydrant", "/assets/street/prop-fire-hydrant.png");
		this.load.image(
			"sprite_recycler_cart",
			"/assets/street/sprite-recycler-cart.png",
		);
		this.load.image(
			"sprite_recycler_onfoot",
			"/assets/street/sprite-recycler-onfoot.png",
		);
		this.load.image(
			"prop_pushcart_parked",
			"/assets/street/prop-pushcart-parked.png",
		);
		this.load.image("prop_taiwan_scooter", "/assets/street/prop-taiwan-scooter.png");
	}

	public create(): void {
		registerTaiwanStreetTextures(this);

		this.input.addPointer(2);
		this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
			this.soundSynth.unlock();
			this.handlePointerDown(pointer);
		});
		this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
			this.handlePointerMove(pointer);
		});
		this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
			this.handlePointerUp(pointer);
		});
		this.input.on("pointerupoutside", (pointer: Phaser.Input.Pointer) => {
			this.handlePointerUp(pointer);
		});

		this.game.events.on(Phaser.Core.Events.BLUR, () => {
			this.resetJoystick();
		});

		if (this.input.keyboard) {
			this.input.keyboard.on("keydown", () => {
				this.soundSynth.unlock();
			});
			this.cursors = {
				up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP, false),
				down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN, false),
				left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT, false),
				right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT, false),
			};
			this.wasdKeys = {
				W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W, false),
				A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false),
				S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S, false),
				D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D, false),
				SPACE: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false),
				E: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E, false),
				C: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C, false),
			};
		}

		const previewLayout = createStreetLayout(20261028);
		this.renderWorldMap(previewLayout);
		this.createHudAndControls();

		this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
			this.applyViewportLayout(gameSize.width, gameSize.height);
		});
		this.applyViewportLayout(this.scale.width, this.scale.height);
	}

	public startNewRound(grant: SessionStartResponse): void {
		this.soundSynth.unlock();
		this.resetJoystick();
		if (this.uiCamera) {
			this.cameras.remove(this.uiCamera, true);
			this.uiCamera = null;
		}
		this.children.removeAll(true);
		this.itemSprites.clear();
		this.signalPosts = [];
		this.scooters = [];
		this.reel = createHighlightReel();
		this.pendingSnapshotJobs = [];
		this.inFlightFrameDataUrl = null;
		this.queuedDiscreteCommands = [];
		this.roundEndedHandled = false;
		this.frameDeltasMs = [];
		this.orientationTracker.reset(this.scale.width, this.scale.height);

		const layout = createStreetLayout(grant.seed);
		this.runState = createRunState({
			sessionId: grant.sessionId,
			signature: grant.signature,
			alias: grant.alias,
			seed: grant.seed,
			roundDurationMs: grant.roundDurationMs,
			layout,
		});

		this.renderWorldMap(layout);
		this.spawnActorsAndItems(this.runState);
		this.createHudAndControls();
		this.applyViewportLayout(this.scale.width, this.scale.height);
		this.syncVisualsFromState(this.runState);
	}

	public override update(_time: number, deltaMs: number): void {
		const state = this.runState;
		if (!state) return;

		if (deltaMs > 0 && deltaMs < 250) {
			this.frameDeltasMs.push(deltaMs);
			if (this.frameDeltasMs.length > 600) {
				this.frameDeltasMs.shift();
			}
		}

		if (state.status === "finished") {
			if (!this.roundEndedHandled) {
				this.roundEndedHandled = true;
				void this.finalizeRound(state);
			}
			return;
		}

		if (this.wasdKeys && !this.isTextInputFocused()) {
			if (
				Phaser.Input.Keyboard.JustDown(this.wasdKeys.SPACE) ||
				Phaser.Input.Keyboard.JustDown(this.wasdKeys.E)
			) {
				this.queuedDiscreteCommands.push({ kind: "interact_nearest" });
			}
			if (Phaser.Input.Keyboard.JustDown(this.wasdKeys.C)) {
				this.queuedDiscreteCommands.push({ kind: "toggle_cart" });
			}
		}

		let current = state;
		const frameEvents: RunEvent[] = [];

		while (this.queuedDiscreteCommands.length > 0) {
			const cmd = this.queuedDiscreteCommands.shift();
			if (!cmd) break;
			const res = stepRun(current, cmd);
			current = res.state;
			frameEvents.push(...res.events);
		}

		const clampedDt = Math.min(50, Math.max(4, Math.round(deltaMs)));
		const moveDir = this.readInputVector();
		const maxSpeed = current.locomotion.kind === "pushing_cart" ? 4.4 : 6.2;
		const nsSig = computeSignalAt(current.elapsedMs, "ns");
		const ewSig = computeSignalAt(current.elapsedMs, "ew");

		const stepRes = stepRun(current, {
			kind: "advance_frame",
			dtMs: clampedDt,
			velocityMps: {
				vx: moveDir.x * maxSpeed,
				vy: moveDir.y * maxSpeed,
			},
			signals: {
				ns: nsSig.phase,
				ew: ewSig.phase,
			},
		});

		current = stepRes.state;
		frameEvents.push(...stepRes.events);
		this.runState = current;

		this.updateScooters(clampedDt / 1000, nsSig.phase, ewSig.phase);
		this.syncVisualsFromState(current);
		this.presentDomainEvents(current, frameEvents);

		this.reel = stepHighlightReel({
			reel: this.reel,
			state: current,
			events: frameEvents,
			captureFrame: (meta) => this.enqueueLiveSnapshot(meta),
		});

		if (current.status === "finished" && !this.roundEndedHandled) {
			this.roundEndedHandled = true;
			void this.finalizeRound(current);
		}
	}

	public getRunState(): RunState | null {
		return this.runState;
	}

	public getViewportMetrics(): ViewportMetrics | null {
		return this.viewportMetrics;
	}

	public getOrientationUsed(): OrientationUsed {
		return this.orientationTracker.getOrientationUsed();
	}

	public getPerfMetrics(): {
		readonly sampleCount: number;
		readonly avgFrameMs: number;
		readonly p95FrameMs: number;
	} {
		if (this.frameDeltasMs.length === 0) {
			return { sampleCount: 0, avgFrameMs: 16.6, p95FrameMs: 16.6 };
		}
		const sorted = [...this.frameDeltasMs].sort((a, b) => a - b);
		const sum = sorted.reduce((acc, v) => acc + v, 0);
		const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
		return {
			sampleCount: sorted.length,
			avgFrameMs: Number((sum / sorted.length).toFixed(2)),
			p95FrameMs: Number((sorted[p95Idx] ?? 16.6).toFixed(2)),
		};
	}

	public dispatchDomainCommand(cmd: RunCommand): void {
		if (!this.runState) return;
		const res = stepRun(this.runState, cmd);
		this.runState = res.state;
		this.syncVisualsFromState(res.state);
		this.presentDomainEvents(res.state, res.events);
		this.reel = stepHighlightReel({
			reel: this.reel,
			state: res.state,
			events: res.events,
			captureFrame: (meta) => this.enqueueLiveSnapshot(meta),
		});
		if (res.state.status === "finished" && !this.roundEndedHandled) {
			this.roundEndedHandled = true;
			void this.finalizeRound(res.state);
		}
	}

	private renderWorldMap(layout: ReturnType<typeof createStreetLayout>): void {
		const worldW = toPx(layout.widthMeters);
		const worldH = toPx(layout.depthMeters);
		this.cameras.main.setBounds(0, 0, worldW, worldH);

		const asphalt = this.add.tileSprite(
			worldW / 2,
			worldH / 2,
			worldW,
			worldH,
			"tile_asphalt",
		);
		asphalt.setTileScale(0.45, 0.45);
		asphalt.setDepth(0);

		const zoneGfx = this.add.graphics();
		zoneGfx.setDepth(2);

		for (const z of layout.zones) {
			if (z.kind === "arcade_walkway") {
				const ts = this.add.tileSprite(
					toPx(z.bounds.minXMeters + z.bounds.widthMeters / 2),
					toPx(z.bounds.minYMeters + z.bounds.depthMeters / 2),
					toPx(z.bounds.widthMeters),
					toPx(z.bounds.depthMeters),
					"tile_terrazzo",
				);
				ts.setTileScale(0.35, 0.35);
				ts.setDepth(1);
			} else if (z.kind === "sidewalk") {
				zoneGfx.fillStyle(0x15803d, 0.62);
				zoneGfx.fillRect(
					toPx(z.bounds.minXMeters),
					toPx(z.bounds.minYMeters),
					toPx(z.bounds.widthMeters),
					toPx(z.bounds.depthMeters),
				);
				zoneGfx.lineStyle(3, 0xf8fafc, 0.9);
				zoneGfx.strokeRect(
					toPx(z.bounds.minXMeters) + 2,
					toPx(z.bounds.minYMeters) + 2,
					toPx(z.bounds.widthMeters) - 4,
					toPx(z.bounds.depthMeters) - 4,
				);
			} else if (z.kind === "unsignalized_alley_lane") {
				zoneGfx.fillStyle(0x7c2d12, 0.72);
				zoneGfx.fillRect(
					toPx(z.bounds.minXMeters),
					toPx(z.bounds.minYMeters),
					toPx(z.bounds.widthMeters),
					toPx(z.bounds.depthMeters),
				);
			} else if (z.kind === "alley_stop_buffer") {
				zoneGfx.fillStyle(0xfacc15, 0.22);
				zoneGfx.fillRect(
					toPx(z.bounds.minXMeters),
					toPx(z.bounds.minYMeters),
					toPx(z.bounds.widthMeters),
					toPx(z.bounds.depthMeters),
				);
				zoneGfx.lineStyle(4, 0xffffff, 0.95);
				zoneGfx.strokeRect(
					toPx(z.bounds.minXMeters),
					toPx(z.bounds.minYMeters),
					toPx(z.bounds.widthMeters),
					toPx(z.bounds.depthMeters),
				);
				this.add
					.text(
						toPx(z.bounds.minXMeters + z.bounds.widthMeters / 2),
						toPx(z.bounds.minYMeters + z.bounds.depthMeters / 2),
						"停看聽",
						{
							fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
							fontSize: "15px",
							color: "#FEF08A",
							stroke: "#111827",
							strokeThickness: 3,
						},
					)
					.setOrigin(0.5)
					.setDepth(3);
			} else if (z.kind === "signalized_crosswalk") {
				const bx = toPx(z.bounds.minXMeters);
				const by = toPx(z.bounds.minYMeters);
				const bw = toPx(z.bounds.widthMeters);
				const bh = toPx(z.bounds.depthMeters);
				zoneGfx.fillStyle(0xffffff, 0.9);
				if (bw > bh) {
					const stripeW = 14;
					const gap = 12;
					for (let sx = bx + 6; sx + stripeW < bx + bw; sx += stripeW + gap) {
						zoneGfx.fillRect(sx, by + 4, stripeW, bh - 8);
					}
				} else {
					const stripeH = 14;
					const gap = 12;
					for (let sy = by + 6; sy + stripeH < by + bh; sy += stripeH + gap) {
						zoneGfx.fillRect(bx + 4, sy, bw - 8, stripeH);
					}
				}
			} else if (z.kind === "curb_marking") {
				const bx = toPx(z.bounds.minXMeters);
				const by = toPx(z.bounds.minYMeters);
				const bw = toPx(z.bounds.widthMeters);
				const bh = toPx(z.bounds.depthMeters);
				if (z.marking === "red_curb") {
					zoneGfx.fillStyle(0xdc2626, 0.88);
					zoneGfx.fillRect(bx, by, bw, bh);
				} else if (z.marking === "yellow_curb") {
					zoneGfx.fillStyle(0xfacc15, 0.88);
					zoneGfx.fillRect(bx, by, bw, bh);
					this.add
						.text(bx + bw / 2, by + bh / 2, "黃線3s", {
							fontFamily: '"OpenHuninn", sans-serif',
							fontSize: "12px",
							color: "#111827",
							backgroundColor: "rgba(250,204,21,0.85)",
						})
						.setOrigin(0.5)
						.setDepth(3);
				} else if (z.marking === "white_parking_bay") {
					zoneGfx.fillStyle(0x38bdf8, 0.16);
					zoneGfx.fillRect(bx, by, bw, bh);
					zoneGfx.lineStyle(4, 0xffffff, 0.95);
					zoneGfx.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);
					this.add
						.text(bx + bw / 2, by + bh / 2, "合法推車格", {
							fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
							fontSize: "13px",
							color: "#F8FAFC",
							stroke: "#0F172A",
							strokeThickness: 3,
						})
						.setOrigin(0.5)
						.setDepth(3);
				} else if (z.marking === "designated_arcade_spot") {
					zoneGfx.fillStyle(0x10b981, 0.24);
					zoneGfx.fillRect(bx, by, bw, bh);
					zoneGfx.lineStyle(3, 0x34d399, 0.95);
					zoneGfx.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);
					this.add
						.text(bx + bw / 2, by + bh / 2, "資收暫置區", {
							fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
							fontSize: "13px",
							color: "#A7F3D0",
							stroke: "#064E3B",
							strokeThickness: 3,
						})
						.setOrigin(0.5)
						.setDepth(3);
				} else if (z.marking === "yellow_box_junction") {
					zoneGfx.lineStyle(4, 0xfacc15, 0.85);
					zoneGfx.strokeRect(bx, by, bw, bh);
					zoneGfx.lineStyle(2.5, 0xfacc15, 0.55);
					const step = 36;
					for (let offset = -bh; offset < bw; offset += step) {
						const x1 = Math.max(bx, bx + offset);
						const y1 = offset < 0 ? by - offset : by;
						const x2 = Math.min(bx + bw, bx + offset + bh);
						const y2 = bx + offset + bh > bx + bw ? by + (bx + bw - (bx + offset)) : by + bh;
						if (x1 < bx + bw && y1 < by + bh) {
							zoneGfx.lineBetween(x1, y1, x2, y2);
						}
					}
				}
			} else if (z.kind === "hydrant_red_zone") {
				const cx = toPx(z.center.xMeters);
				const cy = toPx(z.center.yMeters);
				const rad = toPx(z.radiusMeters);
				zoneGfx.fillStyle(0xdc2626, 0.14);
				zoneGfx.fillCircle(cx, cy, rad);
				zoneGfx.lineStyle(3, 0xf87171, 0.78);
				zoneGfx.strokeCircle(cx, cy, rad);
				this.add
					.text(cx, cy + rad - 18, "消防栓 5m 禁推車", {
						fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
						fontSize: "13px",
						color: "#FECACA",
						stroke: "#7F1D1D",
						strokeThickness: 3,
					})
					.setOrigin(0.5)
					.setDepth(3);
			} else if (z.kind === "no_pedestrian_zone") {
				const bx = toPx(z.bounds.minXMeters);
				const by = toPx(z.bounds.minYMeters);
				const bw = toPx(z.bounds.widthMeters);
				const bh = toPx(z.bounds.depthMeters);
				zoneGfx.fillStyle(0x991b1b, 0.42);
				zoneGfx.fillRect(bx, by, bw, bh);
				zoneGfx.lineStyle(3, 0xfca5a5, 0.9);
				zoneGfx.strokeRect(bx, by, bw, bh);
				this.add
					.text(bx + bw / 2, by + bh / 2, "禁止行人通行", {
						fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
						fontSize: "13px",
						color: "#FEE2E2",
						stroke: "#450A0A",
						strokeThickness: 3,
					})
					.setOrigin(0.5)
					.setDepth(3);
			}
		}

		zoneGfx.lineStyle(3, 0xfacc15, 0.75);
		zoneGfx.lineBetween(toPx(18), toPx(0), toPx(18), toPx(16.5));
		zoneGfx.lineBetween(toPx(18), toPx(28.5), toPx(18), toPx(48));

		const shopBoards: ReadonlyArray<{
			x: number;
			y: number;
			title: string;
			bg: string;
			fg: string;
		}> = [
			{ x: 2.7, y: 7.5, title: "美而美早餐", bg: "#FEF3C7", fg: "#B91C1C" },
			{ x: 2.7, y: 15.0, title: "阿婆青草茶", bg: "#DCFCE7", fg: "#166534" },
			{ x: 2.7, y: 31.5, title: "老街切仔麵", bg: "#FFEDD5", fg: "#9A3412" },
			{ x: 33.3, y: 14.5, title: "順發機車行", bg: "#DBEAFE", fg: "#1E40AF" },
			{ x: 33.3, y: 31.0, title: "永康柑仔店", bg: "#FEF9C3", fg: "#854D0E" },
			{ x: 33.3, y: 42.0, title: "赤峰五金行", bg: "#E0E7FF", fg: "#3730A3" },
		];
		for (const sb of shopBoards) {
			this.add
				.text(toPx(sb.x), toPx(sb.y), sb.title, {
					fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
					fontSize: "16px",
					color: sb.fg,
					backgroundColor: sb.bg,
					padding: { x: 8, y: 4 },
				})
				.setOrigin(0.5)
				.setDepth(5);
		}

		for (const fix of layout.fixtures) {
			this.renderStreetFixture(fix);
		}
	}

	private renderStreetFixture(fix: StreetFixture): void {
		const px = toPx(fix.position.xMeters);
		const py = toPx(fix.position.yMeters);
		const depth = 20 + py;

		if (fix.kind === "telecom_box") {
			const img = this.add.image(px, py, "prop_telecom_box");
			img.setDisplaySize(78, 104);
			img.setOrigin(0.5, 0.86);
			img.setDepth(depth);
		} else if (fix.kind === "fire_hydrant") {
			const img = this.add.image(px, py, "prop_fire_hydrant");
			img.setDisplaySize(44, 82);
			img.setOrigin(0.5, 0.88);
			img.setDepth(depth);
		} else if (fix.kind === "stop_sign_post") {
			const img = this.add.image(px, py, "sign_stop_octagonal");
			img.setDisplaySize(54, 72);
			img.setOrigin(0.5, 0.92);
			img.setDepth(depth);
		} else if (fix.kind === "no_pedestrian_sign") {
			const img = this.add.image(px, py, "sign_no_pedestrian");
			img.setDisplaySize(54, 72);
			img.setOrigin(0.5, 0.92);
			img.setDepth(depth);
		} else if (fix.kind === "one_way_sign") {
			const img = this.add.image(px, py, "sign_one_way");
			img.setDisplaySize(54, 72);
			img.setOrigin(0.5, 0.92);
			img.setDepth(depth);
		} else if (fix.kind === "warning_pedestrian_sign") {
			const img = this.add.image(px, py, "sign_warning_pedestrian");
			img.setDisplaySize(52, 68);
			img.setOrigin(0.5, 0.92);
			img.setDepth(depth);
		} else if (fix.kind === "arcade_pillar") {
			const img = this.add.image(px, py, "arcade_pillar_tex");
			img.setDisplaySize(44, 58);
			img.setOrigin(0.5, 0.85);
			img.setDepth(depth);
		} else if (fix.kind === "signal_pole") {
			const axis: "ns" | "ew" = fix.id.includes("ew") ? "ew" : "ns";
			const housing = this.add.graphics();
			housing.fillStyle(0x334155, 1);
			housing.fillRect(-4, -34, 8, 36);
			housing.fillStyle(0x0f172a, 1);
			housing.lineStyle(2.5, 0x94a3b8, 1);
			housing.fillRoundedRect(-20, -96, 40, 64, 7);
			housing.strokeRoundedRect(-20, -96, 40, 64, 7);

			const countdownText = this.add
				.text(0, -80, "10", {
					fontFamily: '"JetBrains Mono", monospace',
					fontSize: "15px",
					fontStyle: "bold",
					color: "#FBBF24",
				})
				.setOrigin(0.5);

			const figureGfx = this.add.graphics();
			const container = this.add.container(px, py, [
				housing,
				countdownText,
				figureGfx,
			]);
			container.setDepth(depth);
			this.signalPosts.push({ axis, container, countdownText, figureGfx });
		}
	}

	private spawnActorsAndItems(state: RunState): void {
		for (const item of state.itemsById.values()) {
			const texKey =
				item.category === "recyclable"
					? `item_rec_${item.kind}`
					: `item_trash_${item.kind}`;
			const sprite = this.add.image(
				toPx(item.position.xMeters),
				toPx(item.position.yMeters),
				texKey,
			);
			sprite.setDisplaySize(44, 44);
			sprite.setDepth(18 + toPx(item.position.yMeters));
			this.tweens.add({
				targets: sprite,
				y: toPx(item.position.yMeters) - 5,
				duration: 950 + (item.position.xMeters * 37) % 300,
				yoyo: true,
				repeat: -1,
				ease: "Sine.easeInOut",
			});
			this.itemSprites.set(item.itemId, sprite);
		}

		this.parkedCartSprite = this.add
			.image(0, 0, "prop_pushcart_parked")
			.setDisplaySize(76, 88)
			.setOrigin(0.5, 0.82)
			.setVisible(false);

		this.playerCartSprite = this.add
			.image(
				toPx(state.locomotion.position.xMeters),
				toPx(state.locomotion.position.yMeters),
				"sprite_recycler_cart",
			)
			.setDisplaySize(84, 110)
			.setOrigin(0.5, 0.85);

		this.playerFootSprite = this.add
			.image(
				toPx(state.locomotion.position.xMeters),
				toPx(state.locomotion.position.yMeters),
				"sprite_recycler_onfoot",
			)
			.setDisplaySize(58, 92)
			.setOrigin(0.5, 0.86)
			.setVisible(false);

		this.statusRingGfx = this.add.graphics().setDepth(3000);

		const scooterConfigs: ReadonlyArray<{
			axis: "ns" | "ew";
			dir: 1 | -1;
			x: number;
			y: number;
			speed: number;
		}> = [
			{ axis: "ns", dir: 1, x: 14.2, y: 4.0, speed: 6.2 },
			{ axis: "ns", dir: -1, x: 21.8, y: 44.0, speed: 5.8 },
			{ axis: "ew", dir: 1, x: 4.0, y: 24.1, speed: 5.6 },
		];
		for (const sc of scooterConfigs) {
			const sprite = this.add
				.image(toPx(sc.x), toPx(sc.y), "prop_taiwan_scooter")
				.setDisplaySize(64, 92)
				.setOrigin(0.5, 0.82);
			if (sc.dir === 1 && sc.axis === "ew") {
				sprite.setFlipX(true);
			}
			this.scooters.push({
				sprite,
				axis: sc.axis,
				dir: sc.dir,
				xMeters: sc.x,
				yMeters: sc.y,
				speedMps: sc.speed,
			});
		}
	}

	private updateScooters(
		dtSec: number,
		nsPedPhase: PedestrianSignalPhase,
		ewPedPhase: PedestrianSignalPhase,
	): void {
		for (const sc of this.scooters) {
			if (sc.axis === "ns") {
				const vehicleRed = ewPedPhase !== "stop_red";
				const nearStop =
					sc.dir === 1
						? sc.yMeters >= 13.5 && sc.yMeters <= 15.8
						: sc.yMeters >= 29.2 && sc.yMeters <= 31.5;
				if (!(vehicleRed && nearStop)) {
					sc.yMeters += sc.dir * sc.speedMps * dtSec;
					if (sc.yMeters > 47.5) sc.yMeters = 0.5;
					if (sc.yMeters < 0.5) sc.yMeters = 47.5;
				}
			} else {
				const vehicleRed = nsPedPhase !== "stop_red";
				const nearStop = sc.xMeters >= 5.5 && sc.xMeters <= 7.8;
				if (!(vehicleRed && nearStop)) {
					sc.xMeters += sc.dir * sc.speedMps * dtSec;
					if (sc.xMeters > 35.5) sc.xMeters = 0.5;
					if (sc.xMeters < 0.5) sc.xMeters = 35.5;
				}
			}
			sc.sprite.setPosition(toPx(sc.xMeters), toPx(sc.yMeters));
			sc.sprite.setDepth(20 + toPx(sc.yMeters));
		}
	}

	private syncVisualsFromState(state: RunState): void {
		const px = toPx(state.locomotion.position.xMeters);
		const py = toPx(state.locomotion.position.yMeters);

		if (this.playerCartSprite && this.playerFootSprite && this.parkedCartSprite) {
			if (state.locomotion.kind === "pushing_cart") {
				this.playerCartSprite.setVisible(true).setPosition(px, py).setDepth(22 + py);
				this.playerFootSprite.setVisible(false);
				this.parkedCartSprite.setVisible(false);
			} else {
				const cpx = toPx(state.locomotion.parkedCart.position.xMeters);
				const cpy = toPx(state.locomotion.parkedCart.position.yMeters);
				this.playerCartSprite.setVisible(false);
				this.playerFootSprite.setVisible(true).setPosition(px, py).setDepth(22 + py);
				this.parkedCartSprite.setVisible(true).setPosition(cpx, cpy).setDepth(21 + cpy);
			}
		}

		this.cameras.main.centerOn(px, py);

		for (const [id, item] of state.itemsById) {
			const sprite = this.itemSprites.get(id);
			if (sprite && item.collected && sprite.visible) {
				sprite.setVisible(false);
			}
		}

		const nsSnap = computeSignalAt(state.elapsedMs, "ns");
		const ewSnap = computeSignalAt(state.elapsedMs, "ew");
		const walkStride = Math.floor(state.elapsedMs / 220) % 2 === 0;
		const flashVisible = Math.floor(state.elapsedMs / 150) % 2 === 0;

		for (const post of this.signalPosts) {
			const snap = post.axis === "ns" ? nsSnap : ewSnap;
			post.countdownText.setText(
				String(Math.max(1, Math.ceil(snap.phaseRemainingSeconds))),
			);
			post.countdownText.setColor(
				snap.phase === "stop_red"
					? "#F87171"
					: snap.phase === "flashing_green"
						? "#FBBF24"
						: "#4ADE80",
			);

			post.figureGfx.clear();
			if (snap.phase === "stop_red") {
				post.figureGfx.fillStyle(0xef4444, 1);
				post.figureGfx.fillCircle(0, -58, 5);
				post.figureGfx.fillRect(-4, -52, 8, 12);
			} else if (snap.phase === "walk_green" || flashVisible) {
				post.figureGfx.fillStyle(0x22c55e, 1);
				post.figureGfx.fillCircle(0, -59, 5);
				post.figureGfx.lineStyle(3.2, 0x22c55e, 1);
				post.figureGfx.lineBetween(0, -54, 0, -44);
				const legSpread = walkStride ? 6 : 2;
				post.figureGfx.lineBetween(0, -44, -legSpread, -36);
				post.figureGfx.lineBetween(0, -44, legSpread, -36);
			}
		}

		if (this.statusRingGfx) {
			this.statusRingGfx.clear();
			if (state.compliance.alleyStop.kind === "pausing") {
				const ratio = Math.min(
					1,
					state.compliance.alleyStop.pausedMs / LEGAL_LIMITS.alleyStopSignMinPauseMs,
				);
				this.statusRingGfx.lineStyle(5, 0xfacc15, 0.95);
				this.statusRingGfx.beginPath();
				this.statusRingGfx.arc(
					px,
					py - 56,
					22,
					-Math.PI / 2,
					-Math.PI / 2 + Math.PI * 2 * ratio,
				);
				this.statusRingGfx.strokePath();
			}
			if (
				state.locomotion.kind === "on_foot" &&
				state.locomotion.parkedCart.lease.policy === "temporary_yellow"
			) {
				const cpx = toPx(state.locomotion.parkedCart.position.xMeters);
				const cpy = toPx(state.locomotion.parkedCart.position.yMeters);
				const remainRatio = Math.max(
					0,
					1 -
						state.locomotion.parkedCart.lease.parkedDurationMs /
							LEGAL_LIMITS.yellowCurbMaxParkMs,
				);
				this.statusRingGfx.lineStyle(5, remainRatio > 0.3 ? 0xfacc15 : 0xef4444, 0.95);
				this.statusRingGfx.beginPath();
				this.statusRingGfx.arc(
					cpx,
					cpy - 50,
					24,
					-Math.PI / 2,
					-Math.PI / 2 + Math.PI * 2 * remainRatio,
				);
				this.statusRingGfx.strokePath();
			}
		}

		const remainSec = Math.max(
			0,
			(state.roundDurationMs - state.elapsedMs) / 1000,
		).toFixed(1);
		if (this.hudScoreText) {
			this.hudScoreText.setText(
				`得分 ${state.score}  ·  減碳 ${deriveCo2SavedGrams(state.recyclableTallies)}g`,
			);
		}
		if (this.hudTimerText) {
			this.hudTimerText.setText(`${remainSec}s`);
		}
		if (this.hudSignalText) {
			const nsIcon =
				nsSnap.phase === "walk_green"
					? "南北綠燈"
					: nsSnap.phase === "flashing_green"
						? "南北閃綠"
						: "南北紅燈";
			const ewIcon =
				ewSnap.phase === "walk_green"
					? "東西綠燈"
					: ewSnap.phase === "flashing_green"
						? "東西閃綠"
						: "東西紅燈";
			this.hudSignalText.setText(`${nsIcon} · ${ewIcon}`);
		}
		if (this.hudTriadText) {
			const s = state.combo.stepsActive;
			const modeText =
				state.locomotion.kind === "pushing_cart"
					? "推車中"
					: `徒步袋 ${state.locomotion.handCarried.length}/${LEGAL_LIMITS.handCarryMaxItems}`;
			this.hudTriadText.setText(
				`${modeText} ｜ 清${s.clean ? "✓" : "○"} 分${s.sort ? "✓" : "○"} 壓${s.compress ? "✓" : "○"} x${state.combo.streak}`,
			);
		}

		const nearest = this.findNearestItem(state);
		if (this.collectBtnLabel && this.collectBtnBg) {
			this.collectBtnBg.clear();
			if (nearest && nearest.dist <= LEGAL_LIMITS.pickupRadiusMeters) {
				if (nearest.item.category === "recyclable") {
					this.collectBtnBg.fillStyle(0x16a34a, 0.94);
					this.collectBtnLabel.setText(
						`撿資收\n${RECYCLABLE_CATALOG[nearest.item.kind].nameZh}`,
					);
				} else {
					this.collectBtnBg.fillStyle(0xb91c1c, 0.92);
					this.collectBtnLabel.setText("一般垃圾\n勿撿扣分!");
				}
			} else {
				this.collectBtnBg.fillStyle(0x0f766e, 0.8);
				this.collectBtnLabel.setText("撿資收\n[Space]");
			}
			this.collectBtnBg.lineStyle(3, 0xffffff, 0.85);
			this.collectBtnBg.fillCircle(0, 0, 44);
			this.collectBtnBg.strokeCircle(0, 0, 44);
		}

		if (this.cartBtnLabel && this.cartBtnBg) {
			this.cartBtnBg.clear();
			if (state.locomotion.kind === "pushing_cart") {
				this.cartBtnBg.fillStyle(0x0284c7, 0.88);
				this.cartBtnLabel.setText("停放推車\n切換徒步");
			} else {
				this.cartBtnBg.fillStyle(0xd97706, 0.9);
				this.cartBtnLabel.setText("取回推車\n裝載入車");
			}
			this.cartBtnBg.lineStyle(2.5, 0xffffff, 0.85);
			this.cartBtnBg.fillCircle(0, 0, 36);
			this.cartBtnBg.strokeCircle(0, 0, 36);
		}
	}

	private presentDomainEvents(state: RunState, events: readonly RunEvent[]): void {
		const px = toPx(state.locomotion.position.xMeters);
		const py = toPx(state.locomotion.position.yMeters) - 66;

		for (const ev of events) {
			if (ev.kind === "recyclable_collected") {
				const spec = RECYCLABLE_CATALOG[ev.recyclableKind];
				this.soundSynth.playPickup(ev.streak);
				this.spawnFloatingBanner(
					px,
					py,
					`+${ev.pointsAwarded} ${spec.nameZh}（${spec.prepLabelZh} ✓）`,
					"#4ADE80",
				);
				if (this.hudHintText) {
					this.hudHintText.setText(`♻ ${spec.nameZh}：${spec.reuseFactZh}`);
				}
				if (ev.triadCompletedNow) {
					this.soundSynth.playTriadOrDeposit();
					this.spawnFloatingBanner(px, py - 28, "清・分・壓 完美三連 +120!", "#FDE047");
				}
			} else if (ev.kind === "cart_deposited") {
				this.soundSynth.playTriadOrDeposit();
				this.spawnFloatingBanner(
					px,
					py,
					`資收物分類入車 +${ev.bonusPoints} 分！`,
					"#38BDF8",
				);
			} else if (ev.kind === "contaminant_penalized") {
				const spec = CONTAMINANT_CATALOG[ev.contaminantKind];
				this.soundSynth.playViolation();
				this.spawnFloatingBanner(
					px,
					py,
					`-${ev.penaltyPoints} 誤撿一般垃圾：${spec.nameZh}`,
					"#FCA5A5",
				);
				if (this.hudHintText) {
					this.hudHintText.setText(`⚠ ${spec.rejectReasonZh}`);
				}
			} else if (ev.kind === "violation_cited") {
				const vSpec = VIOLATION_CATALOG[ev.violationKind];
				this.soundSynth.playViolation();
				this.spawnFloatingBanner(
					px,
					py,
					`-${ev.penaltyPoints} 違規：${vSpec.titleZh}`,
					"#F87171",
				);
				if (this.hudHintText) {
					this.hudHintText.setText(`⚖ ${vSpec.lawCiteZh}`);
				}
			} else if (ev.kind === "stop_sign_cleared") {
				this.soundSynth.playStopCleared();
				this.spawnFloatingBanner(px, py, "巷口停看聽完成 ✓ 安全通過", "#FEF08A");
			} else if (ev.kind === "cart_action_refused") {
				const msg =
					ev.reason === "too_far_to_retrieve_cart"
						? "請走近已停放的手推車再取車"
						: "推車僅可停在白線格、資收暫置區或黃線(3秒)";
				this.spawnFloatingBanner(px, py, msg, "#FDE68A");
			} else if (ev.kind === "pickup_blocked_illegal_side") {
				this.spawnFloatingBanner(
					px,
					py,
					"請由安全人行道或騎樓側取物！",
					"#FDBA74",
				);
			} else if (ev.kind === "hand_bag_full") {
				this.spawnFloatingBanner(
					px,
					py,
					"隨身分類袋已滿，請回推車卸貨！",
					"#FCD34D",
				);
			}
		}
	}

	private spawnFloatingBanner(
		x: number,
		y: number,
		message: string,
		color: string,
	): void {
		const txt = this.add
			.text(x, y, message, {
				fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
				fontSize: "17px",
				color,
				stroke: "#090D16",
				strokeThickness: 4,
			})
			.setOrigin(0.5)
			.setDepth(4500);
		this.uiCamera?.ignore(txt);
		this.tweens.add({
			targets: txt,
			y: y - 42,
			alpha: 0,
			duration: 1250,
			ease: "Cubic.easeOut",
			onComplete: () => txt.destroy(),
		});
	}

	private createHudAndControls(): void {
		this.hudBg = this.add.graphics();
		this.hudScoreText = this.add.text(14, 8, "得分 0", {
			fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
			fontSize: "17px",
			color: "#FEFCE8",
		});
		this.hudTimerText = this.add
			.text(0, 8, "75.0s", {
				fontFamily: '"JetBrains Mono", monospace',
				fontSize: "18px",
				fontStyle: "bold",
				color: "#6EE7B7",
			})
			.setOrigin(1, 0);
		this.hudSignalText = this.add.text(14, 32, "", {
			fontFamily: '"Noto Sans TC", sans-serif',
			fontSize: "13px",
			color: "#BAE6FD",
		});
		this.hudTriadText = this.add.text(14, 51, "", {
			fontFamily: '"Noto Sans TC", sans-serif',
			fontSize: "13px",
			color: "#FDE68A",
		});
		this.hudHintText = this.add.text(
			14,
			70,
			"提示：將推車停入白線格，徒步去消防栓與彩繪變電箱旁撿可再利用資收物！",
			{
				fontFamily: '"Noto Sans TC", sans-serif',
				fontSize: "12px",
				color: "#CBD5E1",
			},
		);

		this.hudContainer = this.add
			.container(0, 0, [
				this.hudBg,
				this.hudScoreText,
				this.hudTimerText,
				this.hudSignalText,
				this.hudTriadText,
				this.hudHintText,
			])
			.setScrollFactor(0)
			.setDepth(5000);

		this.joyBaseGfx = this.add.graphics();
		this.joyKnobGfx = this.add.graphics();

		this.collectBtnBg = this.add.graphics();
		this.collectBtnLabel = this.add
			.text(0, 0, "撿資收", {
				fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
				fontSize: "14px",
				align: "center",
				color: "#FFFFFF",
			})
			.setOrigin(0.5);
		this.collectBtnContainer = this.add.container(0, 0, [
			this.collectBtnBg,
			this.collectBtnLabel,
		]);

		this.cartBtnBg = this.add.graphics();
		this.cartBtnLabel = this.add
			.text(0, 0, "停放推車", {
				fontFamily: '"OpenHuninn", "Noto Sans TC", sans-serif',
				fontSize: "12px",
				align: "center",
				color: "#FFFFFF",
			})
			.setOrigin(0.5);
		this.cartBtnContainer = this.add.container(0, 0, [
			this.cartBtnBg,
			this.cartBtnLabel,
		]);

		this.controlsRootContainer = this.add
			.container(0, 0, [
				this.joyBaseGfx,
				this.joyKnobGfx,
				this.collectBtnContainer,
				this.cartBtnContainer,
			])
			.setScrollFactor(0)
			.setDepth(5000);

		if (this.uiCamera) {
			this.cameras.remove(this.uiCamera, true);
		}
		this.uiCamera = this.cameras
			.add(0, 0, this.scale.width, this.scale.height)
			.setScroll(0, 0)
			.setZoom(1);

		this.cameras.main.ignore([this.hudContainer, this.controlsRootContainer]);
		for (const child of this.children.list) {
			if (child !== this.hudContainer && child !== this.controlsRootContainer) {
				this.uiCamera.ignore(child);
			}
		}
	}

	private applyViewportLayout(width: number, height: number): void {
		const prevMode = this.viewportMetrics?.mode;
		const m = this.orientationTracker.measure(width, height);
		this.viewportMetrics = m;
		if (prevMode && prevMode !== m.mode) {
			this.resetJoystick();
		}
		this.cameras.main.setViewport(0, 0, m.width, m.height);
		this.cameras.main.setZoom(m.cameraZoom);
		this.uiCamera?.setViewport(0, 0, m.width, m.height);

		if (
			this.hudContainer &&
			this.hudBg &&
			this.hudTimerText &&
			this.hudHintText
		) {
			const padX = Math.max(10, m.safeArea.left + 10);
			const barW = Math.min(m.width - padX * 2, 720);
			const barH = m.mode === "landscape" ? 72 : 92;
			this.hudContainer.setPosition((m.width - barW) / 2, m.hudTopY);
			this.hudBg.clear();
			this.hudBg.fillStyle(0x0b1310, 0.82);
			this.hudBg.lineStyle(1.5, 0x34d399, 0.55);
			this.hudBg.fillRoundedRect(0, 0, barW, barH, 14);
			this.hudBg.strokeRoundedRect(0, 0, barW, barH, 14);
			this.hudTimerText.setPosition(barW - 14, 8);
			this.hudHintText.setVisible(m.mode === "portrait" || m.height >= 430);
			this.hudHintText.setWordWrapWidth(barW - 28, true);
		}

		if (
			this.joyBaseGfx &&
			this.joyKnobGfx &&
			this.collectBtnContainer &&
			this.cartBtnContainer
		) {
			this.drawJoystick(m.joystickCenter.x, m.joystickCenter.y, 0, 0, m.joystickRadius);
			this.collectBtnContainer.setPosition(
				m.collectButtonCenter.x,
				m.collectButtonCenter.y,
			);
			this.cartBtnContainer.setPosition(
				m.cartButtonCenter.x,
				m.cartButtonCenter.y,
			);
		}
	}

	private drawJoystick(
		cx: number,
		cy: number,
		dx: number,
		dy: number,
		radius: number,
	): void {
		if (!this.joyBaseGfx || !this.joyKnobGfx) return;
		this.joyBaseGfx.clear();
		this.joyBaseGfx.fillStyle(0x0f172a, 0.52);
		this.joyBaseGfx.lineStyle(2.5, 0x94a3b8, 0.7);
		this.joyBaseGfx.fillCircle(cx, cy, radius);
		this.joyBaseGfx.strokeCircle(cx, cy, radius);

		this.joyKnobGfx.clear();
		this.joyKnobGfx.fillStyle(0x34d399, 0.88);
		this.joyKnobGfx.fillCircle(cx + dx, cy + dy, 22);
	}

	private handlePointerDown(pointer: Phaser.Input.Pointer): void {
		const m = this.viewportMetrics;
		if (!m || !this.runState || this.runState.status !== "active") return;

		const distCollect = Phaser.Math.Distance.Between(
			pointer.x,
			pointer.y,
			m.collectButtonCenter.x,
			m.collectButtonCenter.y,
		);
		if (distCollect <= 44) {
			this.queuedDiscreteCommands.push({ kind: "interact_nearest" });
			return;
		}

		const distCart = Phaser.Math.Distance.Between(
			pointer.x,
			pointer.y,
			m.cartButtonCenter.x,
			m.cartButtonCenter.y,
		);
		if (distCart <= 36) {
			this.queuedDiscreteCommands.push({ kind: "toggle_cart" });
			return;
		}

		const distJoy = Phaser.Math.Distance.Between(
			pointer.x,
			pointer.y,
			m.joystickCenter.x,
			m.joystickCenter.y,
		);
		if (distJoy <= m.joystickRadius + 24 && this.joystickPointerId === null) {
			this.joystickPointerId = pointer.id;
			this.updateJoystickFromPointer(pointer);
		}
	}

	private handlePointerMove(pointer: Phaser.Input.Pointer): void {
		if (this.joystickPointerId === pointer.id) {
			this.updateJoystickFromPointer(pointer);
		}
	}

	private handlePointerUp(pointer: Phaser.Input.Pointer): void {
		if (this.joystickPointerId === pointer.id) {
			this.resetJoystick();
		}
	}

	private resetJoystick(): void {
		this.joystickPointerId = null;
		this.joystickVec = { x: 0, y: 0 };
		if (this.viewportMetrics) {
			this.drawJoystick(
				this.viewportMetrics.joystickCenter.x,
				this.viewportMetrics.joystickCenter.y,
				0,
				0,
				this.viewportMetrics.joystickRadius,
			);
		}
	}

	private isTextInputFocused(): boolean {
		if (typeof document === "undefined") return false;
		const active = document.activeElement;
		return (
			active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
		);
	}

	private updateJoystickFromPointer(pointer: Phaser.Input.Pointer): void {
		const m = this.viewportMetrics;
		if (!m) return;
		const rawDx = pointer.x - m.joystickCenter.x;
		const rawDy = pointer.y - m.joystickCenter.y;
		const len = Math.hypot(rawDx, rawDy);
		const maxR = m.joystickRadius;
		const clampedLen = Math.min(maxR, len);
		const nx = len > 4 ? rawDx / len : 0;
		const ny = len > 4 ? rawDy / len : 0;
		this.joystickVec = {
			x: nx * (clampedLen / maxR),
			y: ny * (clampedLen / maxR),
		};
		this.drawJoystick(
			m.joystickCenter.x,
			m.joystickCenter.y,
			nx * clampedLen,
			ny * clampedLen,
			maxR,
		);
	}

	private readInputVector(): { x: number; y: number } {
		if (this.isTextInputFocused()) {
			return this.joystickVec;
		}
		let kx = 0;
		let ky = 0;
		if (this.cursors) {
			if (this.cursors.left.isDown) kx -= 1;
			if (this.cursors.right.isDown) kx += 1;
			if (this.cursors.up.isDown) ky -= 1;
			if (this.cursors.down.isDown) ky += 1;
		}
		if (this.wasdKeys) {
			if (this.wasdKeys.A.isDown) kx -= 1;
			if (this.wasdKeys.D.isDown) kx += 1;
			if (this.wasdKeys.W.isDown) ky -= 1;
			if (this.wasdKeys.S.isDown) ky += 1;
		}
		if (kx !== 0 || ky !== 0) {
			const mag = Math.hypot(kx, ky);
			return { x: kx / mag, y: ky / mag };
		}
		return this.joystickVec;
	}

	private findNearestItem(
		state: RunState,
	): { item: WorldItem; dist: number } | null {
		let best: { item: WorldItem; dist: number } | null = null;
		for (const item of state.itemsById.values()) {
			if (item.collected) continue;
			const dist = Math.hypot(
				item.position.xMeters - state.locomotion.position.xMeters,
				item.position.yMeters - state.locomotion.position.yMeters,
			);
			if (!best || dist < best.dist) {
				best = { item, dist };
			}
		}
		return best;
	}

	private requestNextRenderedDataUrl(): Promise<string | null> {
		if (this.inFlightFrameDataUrl) {
			return this.inFlightFrameDataUrl;
		}
		const job = new Promise<string | null>((resolve) => {
			let settled = false;
			const finish = (dataUrl: string | null) => {
				if (settled) return;
				settled = true;
				this.inFlightFrameDataUrl = null;
				resolve(dataUrl);
			};
			const timer = window.setTimeout(() => {
				try {
					finish(this.game.canvas.toDataURL("image/jpeg", 0.9));
				} catch {
					finish(null);
				}
			}, 500);
			this.game.renderer.snapshot(
				(snap) => {
					window.clearTimeout(timer);
					if (snap instanceof HTMLImageElement && snap.src) {
						finish(snap.src);
					} else {
						finish(null);
					}
				},
				"image/jpeg",
				0.92,
			);
		});
		this.inFlightFrameDataUrl = job;
		return job;
	}

	private enqueueLiveSnapshot(meta: HighlightMeta): HTMLImageElement {
		const img = new Image();
		this.soundSynth.playShutter();
		if (this.runState) {
			this.spawnFloatingBanner(
				toPx(this.runState.locomotion.position.xMeters),
				toPx(this.runState.locomotion.position.yMeters) - 96,
				`精彩抓拍：${meta.badgeZh}`,
				"#BAE6FD",
			);
		}
		const job = this.requestNextRenderedDataUrl().then(
			(dataUrl) =>
				new Promise<void>((resolve) => {
					if (!dataUrl) {
						resolve();
						return;
					}
					let done = false;
					const complete = () => {
						if (done) return;
						done = true;
						resolve();
					};
					const guard = window.setTimeout(complete, 400);
					img.onload = () => {
						window.clearTimeout(guard);
						complete();
					};
					img.onerror = () => {
						window.clearTimeout(guard);
						complete();
					};
					img.src = dataUrl;
					if (img.complete && img.naturalWidth > 0) {
						window.clearTimeout(guard);
						complete();
					}
				}),
		);
		this.pendingSnapshotJobs.push(job);
		return img;
	}

	private async finalizeRound(finalState: RunState): Promise<void> {
		this.resetJoystick();
		if (this.reel.shots.length === 0) {
			const fallbackMeta: HighlightMeta = {
				captureId: parseCaptureId("cap_commemorative_finish"),
				reason: "green_crosswalk_combo",
				badgeZh: "台灣街頭巡迴留影",
				detailZh: "穿梭騎樓巷弄守護可再利用資源",
				excitementScore: 10,
				capturedAtMs: finalState.elapsedMs,
				scoreAtCapture: finalState.score,
				streakAtCapture: finalState.combo.maxStreak,
			};
			const fallbackImg = this.enqueueLiveSnapshot(fallbackMeta);
			this.reel = {
				...this.reel,
				shots: [{ meta: fallbackMeta, frame: fallbackImg }],
			};
		}

		await Promise.all(this.pendingSnapshotJobs);

		const co2SavedGrams = deriveCo2SavedGrams(finalState.recyclableTallies);
		const composed: ComposedPolaroid[] = [];
		for (let i = 0; i < this.reel.shots.length; i++) {
			const shot = this.reel.shots[i];
			if (!shot) continue;
			const card = await composePolaroidCard({
				sourceImage: shot.frame,
				meta: shot.meta,
				alias: finalState.alias,
				co2SavedGrams,
				index: i,
			});
			composed.push(card);
		}

		const orientationUsed = this.orientationTracker.getOrientationUsed();
		this.onRoundComplete({
			finalState,
			orientationUsed,
			polaroids: composed,
			buildSubmission: (alias: string) =>
				toSubmitScorePayload({
					state: finalState,
					alias,
					orientationUsed,
				}),
		});
	}
}
