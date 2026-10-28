import type { HighlightMeta } from "../../domain/types.ts";

export type ComposedPolaroid = {
	readonly meta: HighlightMeta;
	readonly dataUrl: string;
	readonly blob: Blob;
	readonly filename: string;
};

function drawRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error("Polaroid blob encoding failed"));
			}
		}, "image/png");
	});
}

export async function composePolaroidCard(params: {
	readonly sourceImage: HTMLImageElement | HTMLCanvasElement;
	readonly meta: HighlightMeta;
	readonly alias: string;
	readonly co2SavedGrams: number;
	readonly index: number;
}): Promise<ComposedPolaroid> {
	const cardW = 880;
	const cardH = 720;
	const pad = 34;
	const photoW = cardW - pad * 2;
	const photoH = 500;

	const canvas = document.createElement("canvas");
	canvas.width = cardW;
	canvas.height = cardH;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("2D context unavailable for Polaroid compositor");
	}

	ctx.fillStyle = "#FCF8EE";
	drawRoundedRect(ctx, 0, 0, cardW, cardH, 24);
	ctx.fill();

	ctx.strokeStyle = "#E5DCC5";
	ctx.lineWidth = 4;
	drawRoundedRect(ctx, 8, 8, cardW - 16, cardH - 16, 18);
	ctx.stroke();

	ctx.save();
	drawRoundedRect(ctx, pad, pad, photoW, photoH, 12);
	ctx.clip();

	const srcW =
		params.sourceImage instanceof HTMLImageElement
			? params.sourceImage.naturalWidth || params.sourceImage.width
			: params.sourceImage.width;
	const srcH =
		params.sourceImage instanceof HTMLImageElement
			? params.sourceImage.naturalHeight || params.sourceImage.height
			: params.sourceImage.height;

	if (srcW > 0 && srcH > 0) {
		const scale = Math.max(photoW / srcW, photoH / srcH);
		const drawW = srcW * scale;
		const drawH = srcH * scale;
		const dx = pad + (photoW - drawW) / 2;
		const dy = pad + (photoH - drawH) / 2;
		ctx.drawImage(params.sourceImage, dx, dy, drawW, drawH);
	} else {
		ctx.fillStyle = "#1E293B";
		ctx.fillRect(pad, pad, photoW, photoH);
	}

	const grad = ctx.createLinearGradient(0, pad + photoH - 110, 0, pad + photoH);
	grad.addColorStop(0, "rgba(10, 18, 14, 0)");
	grad.addColorStop(1, "rgba(10, 18, 14, 0.78)");
	ctx.fillStyle = grad;
	ctx.fillRect(pad, pad + photoH - 110, photoW, 110);

	const sec = (params.meta.capturedAtMs / 1000).toFixed(1);
	ctx.fillStyle = "rgba(17, 24, 39, 0.82)";
	drawRoundedRect(ctx, pad + 16, pad + 16, 196, 38, 19);
	ctx.fill();
	ctx.fillStyle = "#6EE7B7";
	ctx.font = '700 18px "JetBrains Mono", monospace';
	ctx.fillText(`REC ${sec}s · #${params.index + 1}`, pad + 32, pad + 41);

	if (params.meta.streakAtCapture >= 2) {
		ctx.fillStyle = "#F59E0B";
		drawRoundedRect(ctx, pad + photoW - 196, pad + 16, 180, 38, 19);
		ctx.fill();
		ctx.fillStyle = "#111827";
		ctx.font = '800 18px "OpenHuninn", "Noto Sans TC", sans-serif';
		ctx.fillText(
			`合規連段 x${params.meta.streakAtCapture}`,
			pad + photoW - 176,
			pad + 41,
		);
	}

	ctx.fillStyle = "#FEFCE8";
	ctx.font = '700 22px "OpenHuninn", "Noto Sans TC", sans-serif';
	ctx.fillText(params.meta.detailZh, pad + 18, pad + photoH - 22);
	ctx.restore();

	ctx.fillStyle = "#111815";
	ctx.font = '700 30px "OpenHuninn", "Noto Sans TC", sans-serif';
	ctx.fillText(params.meta.badgeZh, pad + 4, pad + photoH + 52);

	ctx.fillStyle = "#334155";
	ctx.font = '600 19px "Noto Sans TC", "OpenHuninn", sans-serif';
	ctx.fillText(
		`資收達人：${params.alias}`,
		pad + 4,
		pad + photoH + 88,
		cardW - pad * 2 - 190,
	);
	ctx.fillStyle = "#0F766E";
	ctx.font = '700 18px "Noto Sans TC", "JetBrains Mono", sans-serif';
	ctx.fillText(
		`當下得分 ${params.meta.scoreAtCapture} 分  ·  累積減碳 ${params.co2SavedGrams}g CO₂e`,
		pad + 4,
		pad + photoH + 116,
		cardW - pad * 2 - 190,
	);

	ctx.save();
	ctx.translate(cardW - 118, pad + photoH + 78);
	ctx.rotate(-0.08);
	ctx.strokeStyle = "#15803D";
	ctx.lineWidth = 3.5;
	drawRoundedRect(ctx, -78, -28, 156, 56, 10);
	ctx.stroke();
	ctx.fillStyle = "#15803D";
	ctx.font = '700 20px "OpenHuninn", "Noto Sans TC", sans-serif';
	ctx.textAlign = "center";
	ctx.fillText("台灣街頭合規資收", 0, -2);
	ctx.font = '700 14px "JetBrains Mono", monospace';
	ctx.fillText("REUSE NOT TRASH", 0, 18);
	ctx.restore();

	const dataUrl = canvas.toDataURL("image/png");
	const blob = await canvasToBlob(canvas);
	const filename = `taiwan-recycle-highlight-${params.index + 1}.png`;

	return {
		meta: params.meta,
		dataUrl,
		blob,
		filename,
	};
}

export async function shareOrDownloadPolaroid(card: ComposedPolaroid): Promise<"shared" | "downloaded"> {
	if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
		const file = new File([card.blob], card.filename, { type: "image/png" });
		if (navigator.canShare({ files: [file] })) {
			try {
				await navigator.share({
					title: "巷弄尋寶：台灣資收達人 精彩瞬間",
					text: `${card.meta.badgeZh}（回收再利用，不是撿垃圾！）`,
					files: [file],
				});
				return "shared";
			} catch {
				void 0;
			}
		}
	}
	const anchor = document.createElement("a");
	anchor.href = card.dataUrl;
	anchor.download = card.filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	return "downloaded";
}
