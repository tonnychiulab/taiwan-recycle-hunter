import Phaser from "phaser";
import "./styles/app.css";
import { startRemoteOrLocalSession } from "./game/api/LeaderboardClient.ts";
import { AlleyGameScene, type AlleySceneBridge } from "./game/scenes/AlleyGameScene.ts";
import { OverlayModals } from "./game/ui/OverlayModals.ts";

declare global {
	interface Window {
		__RECYCLE_GAME__?: AlleySceneBridge & {
			startRoundNow(): Promise<void>;
		};
	}
}

async function waitForTaiwanFonts(): Promise<void> {
	if (typeof document === "undefined" || !("fonts" in document)) return;
	try {
		await Promise.race([
			Promise.all([
				document.fonts.load('18px "OpenHuninn"'),
				document.fonts.ready,
			]),
			new Promise((resolve) => setTimeout(resolve, 1800)),
		]);
	} catch {
		return;
	}
}

async function bootstrap(): Promise<void> {
	await waitForTaiwanFonts();

	const phaserRoot = document.getElementById("phaser-root");
	const overlayRoot = document.getElementById("overlay-root");
	if (!phaserRoot || !overlayRoot) {
		throw new Error("Missing #phaser-root or #overlay-root container");
	}

	const modals = new OverlayModals(overlayRoot);
	let sceneRef: AlleyGameScene | null = null;

	const launchSessionRound = async (): Promise<void> => {
		const grant = await startRemoteOrLocalSession();
		sceneRef?.startNewRound(grant);
	};

	const alleyScene = new AlleyGameScene((endPayload) => {
		modals.showGameOverModal({
			finalState: endPayload.finalState,
			orientationUsed: endPayload.orientationUsed,
			polaroids: endPayload.polaroids,
			buildSubmission: endPayload.buildSubmission,
			onPlayAgain: () => {
				void launchSessionRound();
			},
		});
	});
	sceneRef = alleyScene;

	const readViewportSize = (): { readonly w: number; readonly h: number } => {
		const active = document.activeElement;
		const textFocused =
			active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
		const vv = textFocused ? null : window.visualViewport;
		const w = Math.max(280, Math.round(vv?.width || window.innerWidth || phaserRoot.clientWidth));
		const h = Math.max(280, Math.round(vv?.height || window.innerHeight || phaserRoot.clientHeight));
		return { w, h };
	};

	const initialVp = readViewportSize();

	const game = new Phaser.Game({
		type: Phaser.AUTO,
		parent: phaserRoot,
		backgroundColor: "#141D18",
		scale: {
			mode: Phaser.Scale.NONE,
			autoCenter: Phaser.Scale.NO_CENTER,
			width: initialVp.w,
			height: initialVp.h,
		},
		render: {
			antialias: true,
			pixelArt: false,
			roundPixels: false,
		},
		fps: {
			target: 60,
			forceSetTimeOut: false,
		},
		scene: [alleyScene],
	});

	const syncViewportSize = (): void => {
		const { w, h } = readViewportSize();
		if (game.scale.width !== w || game.scale.height !== h) {
			game.scale.resize(w, h);
		}
	};

	window.addEventListener("resize", syncViewportSize, { passive: true });
	window.addEventListener(
		"orientationchange",
		() => {
			syncViewportSize();
			window.setTimeout(syncViewportSize, 120);
		},
		{ passive: true },
	);
	window.visualViewport?.addEventListener("resize", syncViewportSize, { passive: true });

	window.__RECYCLE_GAME__ = {
		getRunState: () => alleyScene.getRunState(),
		getViewportMetrics: () => alleyScene.getViewportMetrics(),
		getOrientationUsed: () => alleyScene.getOrientationUsed(),
		getPerfMetrics: () => alleyScene.getPerfMetrics(),
		dispatchDomainCommand: (cmd) => alleyScene.dispatchDomainCommand(cmd),
		startRoundNow: () => launchSessionRound(),
	};

	modals.showStartModal({
		onStart: () => {
			void launchSessionRound();
		},
	});
}

void bootstrap();
