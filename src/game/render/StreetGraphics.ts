import type Phaser from "phaser";
import type { ContaminantKind, RecyclableKind } from "../../shared/contracts.ts";

function makeCanvasTexture(
	scene: Phaser.Scene,
	key: string,
	w: number,
	h: number,
	draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): void {
	if (scene.textures.exists(key)) return;
	const tex = scene.textures.createCanvas(key, w, h);
	if (!tex) return;
	const ctx = tex.getContext();
	ctx.clearRect(0, 0, w, h);
	draw(ctx, w, h);
	tex.refresh();
}

export function registerTaiwanStreetTextures(scene: Phaser.Scene): void {
	makeCanvasTexture(scene, "sign_stop_octagonal", 96, 128, (ctx) => {
		ctx.fillStyle = "#64748B";
		ctx.fillRect(43, 64, 10, 62);
		ctx.fillStyle = "#DC2626";
		ctx.strokeStyle = "#FFFFFF";
		ctx.lineWidth = 5;
		const cx = 48;
		const cy = 42;
		const r = 34;
		ctx.beginPath();
		for (let i = 0; i < 8; i++) {
			const angle = (Math.PI / 8) + (i * Math.PI) / 4;
			const x = cx + r * Math.cos(angle);
			const y = cy + r * Math.sin(angle);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#FFFFFF";
		ctx.font = '900 32px "OpenHuninn", "Noto Sans TC", sans-serif';
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText("停", cx, cy + 2);
	});

	makeCanvasTexture(scene, "sign_no_pedestrian", 96, 128, (ctx) => {
		ctx.fillStyle = "#64748B";
		ctx.fillRect(43, 64, 10, 62);
		const cx = 48;
		const cy = 40;
		ctx.beginPath();
		ctx.arc(cx, cy, 32, 0, Math.PI * 2);
		ctx.fillStyle = "#FFFFFF";
		ctx.fill();
		ctx.lineWidth = 8;
		ctx.strokeStyle = "#DC2626";
		ctx.stroke();

		ctx.fillStyle = "#111827";
		ctx.beginPath();
		ctx.arc(cx, cy - 13, 5.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.lineWidth = 4.5;
		ctx.strokeStyle = "#111827";
		ctx.beginPath();
		ctx.moveTo(cx, cy - 6);
		ctx.lineTo(cx, cy + 8);
		ctx.moveTo(cx - 10, cy + 2);
		ctx.lineTo(cx + 10, cy - 2);
		ctx.moveTo(cx, cy + 8);
		ctx.lineTo(cx - 8, cy + 21);
		ctx.moveTo(cx, cy + 8);
		ctx.lineTo(cx + 8, cy + 21);
		ctx.stroke();

		ctx.strokeStyle = "#DC2626";
		ctx.lineWidth = 7;
		ctx.beginPath();
		ctx.moveTo(cx - 21, cy - 21);
		ctx.lineTo(cx + 21, cy + 21);
		ctx.stroke();
	});

	makeCanvasTexture(scene, "sign_one_way", 96, 128, (ctx) => {
		ctx.fillStyle = "#64748B";
		ctx.fillRect(43, 62, 10, 64);
		ctx.fillStyle = "#1D4ED8";
		ctx.strokeStyle = "#FFFFFF";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.roundRect(12, 18, 72, 42, 8);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#FFFFFF";
		ctx.beginPath();
		ctx.moveTo(22, 34);
		ctx.lineTo(56, 34);
		ctx.lineTo(56, 25);
		ctx.lineTo(76, 39);
		ctx.lineTo(56, 53);
		ctx.lineTo(56, 44);
		ctx.lineTo(22, 44);
		ctx.closePath();
		ctx.fill();
	});

	makeCanvasTexture(scene, "sign_warning_pedestrian", 96, 128, (ctx) => {
		ctx.fillStyle = "#64748B";
		ctx.fillRect(43, 66, 10, 60);
		ctx.fillStyle = "#FACC15";
		ctx.strokeStyle = "#DC2626";
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.moveTo(48, 10);
		ctx.lineTo(84, 68);
		ctx.lineTo(12, 68);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#111827";
		ctx.font = '900 22px "OpenHuninn", "Noto Sans TC", sans-serif';
		ctx.textAlign = "center";
		ctx.fillText("慢", 48, 59);
	});

	makeCanvasTexture(scene, "arcade_pillar_tex", 72, 92, (ctx) => {
		ctx.fillStyle = "#CBD5E1";
		ctx.strokeStyle = "#475569";
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.roundRect(8, 6, 56, 80, 8);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#94A3B8";
		ctx.fillRect(12, 68, 48, 16);
	});

	const recyclableVisuals: Record<
		RecyclableKind,
		{ bg: string; ring: string; label: string; sub: string }
	> = {
		pet_bottle: { bg: "#0284C7", ring: "#38BDF8", label: "PET", sub: "寶特瓶" },
		aluminum_can: { bg: "#0D9488", ring: "#5EEAD4", label: "ALU", sub: "鋁罐" },
		tin_can: { bg: "#4F46E5", ring: "#A5B4FC", label: "FE", sub: "鐵罐" },
		clean_cardboard: { bg: "#B45309", ring: "#FCD34D", label: "紙箱", sub: "乾淨紙" },
		glass_bottle: { bg: "#059669", ring: "#6EE7B7", label: "玻璃", sub: "玻璃瓶" },
		waste_battery: { bg: "#7C3AED", ring: "#DDD6FE", label: "電池", sub: "乾電池" },
		old_electronics: { bg: "#CA8A04", ring: "#FEF08A", label: "3C", sub: "廢筆電" },
	};

	for (const [kind, spec] of Object.entries(recyclableVisuals)) {
		makeCanvasTexture(scene, `item_rec_${kind}`, 84, 84, (ctx) => {
			ctx.beginPath();
			ctx.arc(42, 42, 37, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(16, 185, 129, 0.24)";
			ctx.fill();
			ctx.lineWidth = 4;
			ctx.strokeStyle = spec.ring;
			ctx.stroke();

			ctx.beginPath();
			ctx.roundRect(16, 14, 52, 54, 14);
			ctx.fillStyle = spec.bg;
			ctx.fill();
			ctx.lineWidth = 3;
			ctx.strokeStyle = "#FFFFFF";
			ctx.stroke();

			ctx.fillStyle = "#FFFFFF";
			ctx.font = '800 18px "OpenHuninn", "Noto Sans TC", sans-serif';
			ctx.textAlign = "center";
			ctx.fillText(spec.label, 42, 38);
			ctx.font = '700 13px "Noto Sans TC", sans-serif';
			ctx.fillStyle = "#FEF9C3";
			ctx.fillText(spec.sub, 42, 58);

			ctx.beginPath();
			ctx.arc(65, 19, 11, 0, Math.PI * 2);
			ctx.fillStyle = "#16A34A";
			ctx.fill();
			ctx.strokeStyle = "#FFFFFF";
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.fillStyle = "#FFFFFF";
			ctx.font = "900 13px sans-serif";
			ctx.fillText("♻", 65, 23);
		});
	}

	const trashVisuals: Record<ContaminantKind, { label: string }> = {
		greasy_lunchbox: { label: "油便當" },
		used_tissue: { label: "衛生紙" },
		cigarette_butt: { label: "菸蒂" },
		soiled_plastic_bag: { label: "髒塑袋" },
	};

	for (const [kind, spec] of Object.entries(trashVisuals)) {
		makeCanvasTexture(scene, `item_trash_${kind}`, 80, 80, (ctx) => {
			ctx.beginPath();
			ctx.arc(40, 40, 34, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(127, 29, 29, 0.30)";
			ctx.fill();
			ctx.setLineDash([5, 4]);
			ctx.lineWidth = 3;
			ctx.strokeStyle = "#EF4444";
			ctx.stroke();
			ctx.setLineDash([]);

			ctx.beginPath();
			ctx.roundRect(15, 17, 50, 46, 12);
			ctx.fillStyle = "#44403C";
			ctx.fill();
			ctx.strokeStyle = "#A8A29E";
			ctx.lineWidth = 2.5;
			ctx.stroke();

			ctx.fillStyle = "#FCA5A5";
			ctx.font = '700 13px "Noto Sans TC", sans-serif';
			ctx.textAlign = "center";
			ctx.fillText("一般垃圾", 40, 35);
			ctx.fillStyle = "#E7E5E4";
			ctx.font = '700 13px "OpenHuninn", "Noto Sans TC", sans-serif';
			ctx.fillText(spec.label, 40, 53);

			ctx.beginPath();
			ctx.arc(62, 18, 10, 0, Math.PI * 2);
			ctx.fillStyle = "#DC2626";
			ctx.fill();
			ctx.fillStyle = "#FFFFFF";
			ctx.font = "900 13px sans-serif";
			ctx.fillText("✕", 62, 22);
		});
	}
}
