import type { SessionId } from "../src/shared/contracts.ts";

export type SessionGrant = {
	readonly sessionId: SessionId;
	readonly alias: string;
	readonly seed: number;
	readonly issuedAtMs: number;
	readonly roundDurationMs: number;
};

const encoder = new TextEncoder();
const HEX_64_RE = /^[0-9a-fA-F]{64}$/;

function encodeUtf8Buffer(text: string): ArrayBuffer {
	const view = encoder.encode(text);
	const out = new ArrayBuffer(view.byteLength);
	new Uint8Array(out).set(view);
	return out;
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		const byte = bytes[i] ?? 0;
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

function hexToBytes(hex: string): Uint8Array | null {
	if (!HEX_64_RE.test(hex)) {
		return null;
	}
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		const offset = i * 2;
		out[i] = Number.parseInt(hex.slice(offset, offset + 2), 16);
	}
	return out;
}

function timingSafeEqualBytes(expected: Uint8Array, candidate: Uint8Array | null): boolean {
	const fallback = new Uint8Array(expected.length);
	const target = candidate !== null && candidate.length === expected.length ? candidate : fallback;
	let diff = candidate !== null && candidate.length === expected.length ? 0 : 1;
	for (let i = 0; i < expected.length; i++) {
		diff |= (expected[i] ?? 0) ^ (target[i] ?? 0);
	}
	return diff === 0;
}

function serializeSessionGrant(grant: SessionGrant): string {
	return JSON.stringify([
		grant.sessionId,
		grant.alias,
		grant.seed,
		grant.issuedAtMs,
		grant.roundDurationMs,
	]);
}

async function computeHmacSha256Bytes(secret: string, message: string): Promise<Uint8Array> {
	const key = await globalThis.crypto.subtle.importKey(
		"raw",
		encodeUtf8Buffer(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sigBuffer = await globalThis.crypto.subtle.sign(
		"HMAC",
		key,
		encodeUtf8Buffer(message),
	);
	return new Uint8Array(sigBuffer);
}

export async function signSessionGrant(secret: string, grant: SessionGrant): Promise<string> {
	const digest = await computeHmacSha256Bytes(secret, serializeSessionGrant(grant));
	return bytesToHex(digest);
}

export async function verifySessionGrantSignature(
	secret: string,
	grant: SessionGrant,
	signatureHex: string,
): Promise<boolean> {
	const expected = await computeHmacSha256Bytes(secret, serializeSessionGrant(grant));
	const candidate = hexToBytes(signatureHex.trim());
	return timingSafeEqualBytes(expected, candidate);
}

export async function hashClientIp(secret: string, rawIp: string): Promise<string> {
	const normalizedIp = rawIp.trim().toLowerCase() || "unknown";
	const salted = `taiwan-recycle-ip-v1:${secret}:${normalizedIp}`;
	const digestBuffer = await globalThis.crypto.subtle.digest("SHA-256", encodeUtf8Buffer(salted));
	return bytesToHex(new Uint8Array(digestBuffer));
}
