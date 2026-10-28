#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ROOT_ID = "55a1a5e1-f68c-468e-b68c-eb2c7ba3cbdf";
const DEFAULT_APP_DATA = "/Users/tonny/.gemini/antigravity-cli";
const ROOT_MODEL_NAME = "Gemini 4 Argon (High)";

const args = process.argv.slice(2);
const cleanArgString = (value, fallback) =>
	String(value ?? fallback).trim().replace(/^"+|"+$/g, "");

const getFlag = (name, fallback) => {
	const idx = args.indexOf(name);
	return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const rootId = getFlag(
	"--conversation-id",
	process.env.AGY_CONVERSATION_ID ?? DEFAULT_ROOT_ID,
);
const appDataDir = getFlag("--app-data-dir", DEFAULT_APP_DATA);
const outDir = path.resolve(process.cwd(), ".audit");

const resolveModelLabel = (typeName, requestedModel, isRoot) => {
	if (isRoot) return ROOT_MODEL_NAME;
	const base =
		!requestedModel || requestedModel === "inherit"
			? `${ROOT_MODEL_NAME} [inherit]`
			: requestedModel === "pro"
				? "Gemini Pro [explicit]"
				: requestedModel === "flash"
					? "Gemini Flash [explicit]"
					: requestedModel === "flash_lite"
						? "Gemini Flash-Lite [explicit]"
						: `${requestedModel}`;
	if (typeName === "image-generator") {
		return `${base} + Built-in Image Generation Model`;
	}
	return base;
};

const visited = new Set();
const records = [];

const uuidRegex =
	/"conversationId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;

const inspectConversation = (meta) => {
	if (visited.has(meta.conversationId)) return;
	visited.add(meta.conversationId);

	const transcriptPath = path.join(
		appDataDir,
		"brain",
		meta.conversationId,
		".system_generated",
		"logs",
		"transcript.jsonl",
	);

	if (!fs.existsSync(transcriptPath)) {
		records.push({
			...meta,
			exists: false,
			steps: 0,
			inputTokens: 0,
			cacheReadTokens: 0,
			outputTokens: 0,
			uncachedIoTokens: 0,
			totalTokens: 0,
			generatedImages: 0,
			lastTimestamp: "",
		});
		return;
	}

	const rawLines = fs
		.readFileSync(transcriptPath, "utf8")
		.split(/\r?\n/)
		.filter(Boolean);

	let steps = 0;
	let inputTokens = 0;
	let cacheReadTokens = 0;
	let outputTokens = 0;
	let generatedImages = 0;
	let lastTimestamp = "";

	const pendingSubagentCalls = [];
	const discoveredChildren = [];

	for (const line of rawLines) {
		const step = JSON.parse(line);
		if (typeof step.created_at === "string") {
			lastTimestamp = step.created_at;
		}
		if (step.type === "PLANNER_RESPONSE") {
			steps += 1;
			inputTokens += Number(step.input_tokens ?? 0);
			cacheReadTokens += Number(step.cache_read_tokens ?? 0);
			outputTokens += Number(step.output_tokens ?? 0);

			if (Array.isArray(step.tool_calls)) {
				for (const call of step.tool_calls) {
					const fnName = call?.name ?? call?.function?.name ?? "";
					const rawArgs = call?.args ?? call?.arguments ?? call?.function?.arguments ?? {};
					const parsedArgs =
						typeof rawArgs === "string"
							? (() => {
									try {
										return JSON.parse(rawArgs);
									} catch {
										return {};
									}
								})()
							: rawArgs;

					if (fnName.includes("invoke_subagent")) {
						pendingSubagentCalls.push({
							typeName: cleanArgString(parsedArgs.TypeName, "subagent"),
							role: cleanArgString(parsedArgs.Role, "Delegate"),
							requestedModel: cleanArgString(parsedArgs.Model, "inherit"),
						});
					}
					if (
						meta.typeName === "image-generator" &&
						(fnName.includes("generate_image") || fnName.includes("image"))
					) {
						generatedImages += 1;
					}
				}
			}
		}

		if (typeof step.content === "string" && step.content.includes("conversationId")) {
			for (const match of step.content.matchAll(uuidRegex)) {
				const childId = match[1];
				if (childId && childId !== meta.conversationId) {
					const callInfo = pendingSubagentCalls.shift() ?? {
						typeName: "subagent",
						role: "Delegate",
						requestedModel: "inherit",
					};
					discoveredChildren.push({
						conversationId: childId,
						parentConversationId: meta.conversationId,
						typeName: callInfo.typeName,
						role: callInfo.role,
						model: resolveModelLabel(
							callInfo.typeName,
							callInfo.requestedModel,
							false,
						),
					});
				}
			}
		}
	}

	const uncachedIoTokens = inputTokens + outputTokens;
	const totalTokens = inputTokens + cacheReadTokens + outputTokens;

	records.push({
		...meta,
		exists: true,
		steps,
		inputTokens,
		cacheReadTokens,
		outputTokens,
		uncachedIoTokens,
		totalTokens,
		generatedImages,
		lastTimestamp,
	});

	for (const child of discoveredChildren) {
		inspectConversation(child);
	}
};

inspectConversation({
	conversationId: rootId,
	parentConversationId: "root",
	typeName: "main-orchestrator",
	role: "pstack Lead Orchestrator",
	model: resolveModelLabel("main-orchestrator", "inherit", true),
});

const summary = records.reduce(
	(acc, r) => {
		acc.conversations += 1;
		acc.steps += r.steps;
		acc.inputTokens += r.inputTokens;
		acc.cacheReadTokens += r.cacheReadTokens;
		acc.outputTokens += r.outputTokens;
		acc.uncachedIoTokens += r.uncachedIoTokens;
		acc.totalTokens += r.totalTokens;
		acc.generatedImages += r.generatedImages;
		return acc;
	},
	{
		conversations: 0,
		steps: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		outputTokens: 0,
		uncachedIoTokens: 0,
		totalTokens: 0,
		generatedImages: 0,
	},
);

const byModel = new Map();
for (const r of records) {
	const cur = byModel.get(r.model) ?? {
		model: r.model,
		agents: 0,
		steps: 0,
		inputTokens: 0,
		cacheReadTokens: 0,
		outputTokens: 0,
		uncachedIoTokens: 0,
		totalTokens: 0,
	};
	cur.agents += 1;
	cur.steps += r.steps;
	cur.inputTokens += r.inputTokens;
	cur.cacheReadTokens += r.cacheReadTokens;
	cur.outputTokens += r.outputTokens;
	cur.uncachedIoTokens += r.uncachedIoTokens;
	cur.totalTokens += r.totalTokens;
	byModel.set(r.model, cur);
}

fs.mkdirSync(outDir, { recursive: true });
const tsvHeader = [
	"conversation_id",
	"type",
	"role",
	"model",
	"steps",
	"input_tokens",
	"cache_read_tokens",
	"output_tokens",
	"uncached_io_tokens",
	"total_tokens",
	"last_timestamp",
].join("\t");

const tsvRows = records.map((r) =>
	[
		r.conversationId,
		r.typeName,
		r.role,
		r.model,
		r.steps,
		r.inputTokens,
		r.cacheReadTokens,
		r.outputTokens,
		r.uncachedIoTokens,
		r.totalTokens,
		r.lastTimestamp,
	].join("\t"),
);
tsvRows.push(
	[
		"TOTAL",
		"all",
		`${summary.conversations} conversations`,
		`${byModel.size} model tiers`,
		summary.steps,
		summary.inputTokens,
		summary.cacheReadTokens,
		summary.outputTokens,
		summary.uncachedIoTokens,
		summary.totalTokens,
		new Date().toISOString(),
	].join("\t"),
);

fs.writeFileSync(
	path.join(outDir, "token-usage.tsv"),
	`${tsvHeader}\n${tsvRows.join("\n")}\n`,
	"utf8",
);
fs.writeFileSync(
	path.join(outDir, "token-usage.json"),
	JSON.stringify(
		{
			measuredAt: new Date().toISOString(),
			measurementBoundaryNote:
				"Counts exact step telemetry persisted in transcript.jsonl across root and all child subagents up to script execution time. The final closing assistant message in the root conversation flushes after turn completion.",
			summary,
			byModel: Array.from(byModel.values()),
			records,
		},
		null,
		2,
	),
	"utf8",
);

const fmt = (n) => n.toLocaleString("en-US");
console.log("## Token & Model Usage Ledger");
console.log("");
console.log(
	"| Role | Type | Conversation ID | Model | Steps | Input (Uncached) | Cache Read | Output | Total Processed |",
);
console.log("|---|---|---|---|---:|---:|---:|---:|---:|");
for (const r of records) {
	console.log(
		`| ${r.role} | \`${r.typeName}\` | \`${r.conversationId.slice(0, 8)}\` | ${r.model} | ${fmt(r.steps)} | ${fmt(r.inputTokens)} | ${fmt(r.cacheReadTokens)} | ${fmt(r.outputTokens)} | ${fmt(r.totalTokens)} |`,
	);
}
console.log(
	`| **Grand Total** | **${summary.conversations} agents** | **all** | **${byModel.size} model groups** | **${fmt(summary.steps)}** | **${fmt(summary.inputTokens)}** | **${fmt(summary.cacheReadTokens)}** | **${fmt(summary.outputTokens)}** | **${fmt(summary.totalTokens)}** |`,
);
