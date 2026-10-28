import type { NonEmpty } from "../src/shared/contracts.ts";

const TAIWAN_STREETS: NonEmpty<string> = [
	"赤峰街",
	"永康巷",
	"大稻埕",
	"鹿港老街",
	"鹽埕埔",
	"迪化街",
	"神農街",
	"寶藏巖",
	"模範街",
	"新富町",
	"九份豎崎",
	"安平古堡",
	"民生巷",
	"萬華剝皮",
	"北投溫泉",
	"淡水重建",
];

const RECYCLE_TITLES: NonEmpty<string> = [
	"資收達人",
	"鋁罐獵人",
	"分類王",
	"環保伯",
	"紙箱俠",
	"壓瓶高手",
	"淨街職人",
	"減碳先鋒",
	"鐵罐捕手",
	"玻璃達人",
	"寶特神手",
	"電池守護",
];

const EMERGENCY_ALIAS = "巷弄資收員 #1001";

const HTML_TAG_RE = /<[^>]*>/g;
const ANGLE_BRACKET_RE = /[<>]/g;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g;
const WHITESPACE_RE = /\s+/g;

const TW_MOBILE_RE = /(?:^|\D)(?:09\d{2}|\+?886[-\s.]?9\d{2})[-\s.]?\d{3}[-\s.]?\d{3}(?:\D|$)/;
const TW_NATIONAL_ID_RE = /[A-Za-z][1289]\d{8}/;
const URL_OR_DOMAIN_RE = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|tw|net|org|io|edu|gov)\b)/i;

function mixUint32(value: number): number {
	let h = value >>> 0;
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b) >>> 0;
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35) >>> 0;
	h ^= h >>> 16;
	return h >>> 0;
}

function clampUtf16Length(input: string, maxUnits: number): string {
	let acc = "";
	for (const char of input) {
		if (acc.length + char.length > maxUnits) {
			break;
		}
		acc += char;
	}
	return acc.trim();
}

function stripUnsafeText(input: string): string {
	return input
		.replace(HTML_TAG_RE, "")
		.replace(ANGLE_BRACKET_RE, "")
		.replace(CONTROL_CHAR_RE, "")
		.replace(WHITESPACE_RE, " ")
		.trim();
}

function containsPiiPattern(input: string): boolean {
	if (input.includes("@")) {
		return true;
	}
	if (TW_MOBILE_RE.test(input) || TW_NATIONAL_ID_RE.test(input) || URL_OR_DOMAIN_RE.test(input)) {
		return true;
	}
	const digitCount = input.replace(/\D/g, "").length;
	return digitCount >= 7;
}

export function generateTaiwanStreetAlias(seed: number): string {
	const h1 = mixUint32(seed ^ 0x9e3779b9);
	const h2 = mixUint32(h1 ^ 0x7f4a7c15);
	const h3 = mixUint32(h2 ^ 0x94d049bb);

	const street = TAIWAN_STREETS[h1 % TAIWAN_STREETS.length] ?? TAIWAN_STREETS[0];
	const title = RECYCLE_TITLES[h2 % RECYCLE_TITLES.length] ?? RECYCLE_TITLES[0];
	const badge = 1000 + (h3 % 9000);

	return `${street}${title} #${badge}`;
}

export function sanitizePlayerAlias(raw: string | undefined, fallback: string): string {
	const cleanedFallback = clampUtf16Length(stripUnsafeText(fallback), 16);
	const safeFallback =
		cleanedFallback.length >= 2 && !containsPiiPattern(cleanedFallback)
			? cleanedFallback
			: EMERGENCY_ALIAS;

	if (raw === undefined) {
		return safeFallback;
	}

	const cleaned = stripUnsafeText(raw);
	if (cleaned.length < 2 || containsPiiPattern(cleaned)) {
		return safeFallback;
	}

	const clamped = clampUtf16Length(cleaned, 16);
	return clamped.length >= 2 ? clamped : safeFallback;
}
