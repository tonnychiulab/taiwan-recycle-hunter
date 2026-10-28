import type { OrientationUsed } from "../../shared/contracts.ts";

export type LayoutMode = "portrait" | "landscape";

export type SafeAreaInsets = {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
};

export type ViewportMetrics = {
	readonly width: number;
	readonly height: number;
	readonly mode: LayoutMode;
	readonly cameraZoom: number;
	readonly safeArea: SafeAreaInsets;
	readonly joystickCenter: { readonly x: number; readonly y: number };
	readonly joystickRadius: number;
	readonly collectButtonCenter: { readonly x: number; readonly y: number };
	readonly cartButtonCenter: { readonly x: number; readonly y: number };
	readonly hudTopY: number;
};

const PIXELS_PER_METER = 34;

export class DualOrientationTracker {
	private sawPortrait = false;
	private sawLandscape = false;
	private probeEl: HTMLDivElement | null = null;

	public measure(width: number, height: number): ViewportMetrics {
		const safeWidth = Math.max(280, width);
		const safeHeight = Math.max(280, height);
		const mode: LayoutMode = safeWidth >= safeHeight ? "landscape" : "portrait";

		if (mode === "portrait") {
			this.sawPortrait = true;
		} else {
			this.sawLandscape = true;
		}

		const safeArea = this.readSafeAreaInsets();
		const targetVisibleMetersWide = mode === "portrait" ? 19.5 : 30.5;
		const targetVisibleMetersTall = mode === "portrait" ? 31.0 : 17.5;

		const zoomX = safeWidth / (targetVisibleMetersWide * PIXELS_PER_METER);
		const zoomY = safeHeight / (targetVisibleMetersTall * PIXELS_PER_METER);
		const rawZoom = Math.min(zoomX, zoomY);
		const cameraZoom = Math.max(0.52, Math.min(1.55, rawZoom));

		const compactPortrait = mode === "portrait" && safeWidth < 360;
		const bottomPad = safeArea.bottom + (mode === "portrait" ? 86 : 68);
		const leftPad =
			safeArea.left + (mode === "portrait" ? (compactPortrait ? 60 : 82) : 94);
		const rightPad =
			safeArea.right + (mode === "portrait" ? (compactPortrait ? 64 : 70) : 88);

		const joystickRadius = mode === "portrait" ? (compactPortrait ? 46 : 54) : 50;
		const joystickCenter = {
			x: leftPad,
			y: safeHeight - bottomPad,
		};

		const collectButtonCenter = {
			x: safeWidth - rightPad,
			y: safeHeight - bottomPad + (mode === "portrait" ? 8 : 6),
		};

		const cartButtonCenter =
			mode === "portrait"
				? {
						x: safeWidth - rightPad - 88,
						y: safeHeight - bottomPad + 22,
					}
				: {
						x: safeWidth - rightPad - 90,
						y: safeHeight - bottomPad + 16,
					};

		return {
			width: safeWidth,
			height: safeHeight,
			mode,
			cameraZoom,
			safeArea,
			joystickCenter,
			joystickRadius,
			collectButtonCenter,
			cartButtonCenter,
			hudTopY: safeArea.top + 10,
		};
	}

	public getOrientationUsed(): OrientationUsed {
		if (this.sawPortrait && this.sawLandscape) {
			return "both";
		}
		return this.sawLandscape ? "landscape" : "portrait";
	}

	public reset(currentWidth: number, currentHeight: number): void {
		this.sawPortrait = false;
		this.sawLandscape = false;
		this.measure(currentWidth, currentHeight);
	}

	private readSafeAreaInsets(): SafeAreaInsets {
		if (typeof document === "undefined") {
			return { top: 0, right: 0, bottom: 0, left: 0 };
		}
		if (!this.probeEl) {
			const el = document.createElement("div");
			el.style.position = "fixed";
			el.style.visibility = "hidden";
			el.style.pointerEvents = "none";
			el.style.paddingTop = "env(safe-area-inset-top, 0px)";
			el.style.paddingRight = "env(safe-area-inset-right, 0px)";
			el.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
			el.style.paddingLeft = "env(safe-area-inset-left, 0px)";
			document.body.appendChild(el);
			this.probeEl = el;
		}
		const style = window.getComputedStyle(this.probeEl);
		return {
			top: Number.parseFloat(style.paddingTop) || 0,
			right: Number.parseFloat(style.paddingRight) || 0,
			bottom: Number.parseFloat(style.paddingBottom) || 0,
			left: Number.parseFloat(style.paddingLeft) || 0,
		};
	}
}

export { PIXELS_PER_METER };
