import {
	deriveCo2SavedGrams,
	deriveContaminantCount,
	deriveRecycledCount,
	deriveViolationCount,
	type LeaderboardResponse,
	type LeaderboardScope,
} from "../../shared/contracts.ts";
import type { RunState } from "../../domain/types.ts";
import { fetchLeaderboard, submitRunScore } from "../api/LeaderboardClient.ts";
import {
	shareOrDownloadPolaroid,
	type ComposedPolaroid,
} from "../capture/PolaroidCompositor.ts";
import type { OrientationUsed } from "../../shared/contracts.ts";

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function appendNodes(parent: Node, ...children: readonly Node[]): void {
	for (const child of children) {
		parent.appendChild(child);
	}
}

function renderLeaderboardTableInto(
	container: HTMLElement,
	data: LeaderboardResponse | null,
	selfSessionId?: string,
): void {
	container.replaceChildren();
	if (!data) {
		container.appendChild(
			el("p", "", "排行榜連線讀取中，或目前為本地練習環境。"),
		);
		return;
	}

	if (data.callerPlacement.kind === "ranked") {
		const banner = el(
			"div",
			"signboard-badge",
			`本局名次 第 #${data.callerPlacement.rank} 名（領先全場 ${data.callerPlacement.percentile}% 資收達人）`,
		);
		banner.style.marginBottom = "8px";
		container.appendChild(banner);
	}

	if (data.entries.length === 0) {
		container.appendChild(
			el("p", "", "今日尚無紀錄，成為第一位登榜的台灣資收達人吧！"),
		);
		return;
	}

	const table = el("table", "leaderboard-table");
	const thead = el("thead");
	const hr = el("tr");
	appendNodes(
		hr,
		el("th", "", "#"),
		el("th", "", "匿名街頭代號"),
		el("th", "num", "得分"),
		el("th", "num", "資收件數"),
		el("th", "num", "合規率"),
		el("th", "num", "減碳(g)"),
	);
	thead.appendChild(hr);
	table.appendChild(thead);

	const tbody = el("tbody");
	for (const row of data.entries) {
		const tr = el(
			"tr",
			selfSessionId && row.sessionId === selfSessionId ? "leaderboard-row-self" : "",
		);
		appendNodes(
			tr,
			el("td", "num", String(row.rank)),
			el("td", "", row.alias),
			el("td", "num", String(row.score)),
			el("td", "num", String(row.recycledCount)),
			el("td", "num", `${row.complianceRate}%`),
			el("td", "num", `${row.co2SavedGrams}g`),
		);
		tbody.appendChild(tr);
	}
	table.appendChild(tbody);
	container.appendChild(table);
}

export class OverlayModals {
	private readonly root: HTMLElement;

	public constructor(root: HTMLElement) {
		this.root = root;
	}

	public clear(): void {
		this.root.replaceChildren();
	}

	public showStartModal(callbacks: {
		readonly onStart: () => void;
	}): void {
		this.clear();
		const backdrop = el("div", "modal-backdrop");
		backdrop.dataset.testid = "start-modal";

		const card = el("div", "taiwan-card");
		const layout = el("div", "hero-layout");

		const visual = el("div", "hero-visual");
		const heroImg = el("img");
		heroImg.src = "/assets/street/hero-taiwan-alley.jpg";
		heroImg.alt = "台灣街頭巷弄資收實景插畫";
		visual.appendChild(heroImg);

		const info = el("div");
		const badge = el("span", "signboard-badge", "資源循環再利用 · 嚴守交通法規");
		const title = el("h1", "game-title", "巷弄尋寶：台灣資收達人");
		const subtitle = el(
			"p",
			"",
			"穿梭台灣騎樓與紅磚巷弄，去彩繪變電箱、消防栓與號誌桿旁尋找「可再利用資收寶物」，小心避開一般髒污垃圾！手機直拿單手、橫拿雙手皆可無縫暢玩。",
		);
		subtitle.style.margin = "4px 0 10px";
		subtitle.style.fontSize = "0.88rem";
		subtitle.style.color = "#CBD5E1";
		subtitle.style.lineHeight = "1.45";

		const pills = el("div", "rule-pills");
		const ruleData: ReadonlyArray<readonly [string, string]> = [
			["小綠人與斑馬線", "綠燈走行穿線過街，切勿闖紅燈或穿越車道"],
			["消防栓 5m 禁推車", "推車先停白線或黃線(限3秒)，再徒步快取寶物"],
			["無號誌巷口「停」", "遇八角形停標誌先停頓 0.4 秒確認來車"],
			["撿資收 ≠ 撿垃圾", "寶特瓶/鋁罐/紙箱/3C 可再利用，油便當與菸蒂扣分"],
		];
		for (const [head, desc] of ruleData) {
			const pill = el("div", "rule-pill");
			appendNodes(pill, el("strong", "", head), document.createTextNode(desc));
			pills.appendChild(pill);
		}

		const btnRow = el("div");
		btnRow.style.display = "flex";
		btnRow.style.gap = "10px";
		btnRow.style.flexWrap = "wrap";

		const startBtn = el("button", "btn-primary", "開始台灣街頭尋寶（75 秒）");
		startBtn.dataset.testid = "start-game-btn";
		startBtn.addEventListener("click", () => {
			this.clear();
			callbacks.onStart();
		});

		const rankBtn = el("button", "btn-secondary", "查看街頭匿名排行榜");
		rankBtn.dataset.testid = "open-leaderboard-btn";
		rankBtn.style.width = "100%";

		const rankHolder = el("div");
		rankHolder.style.marginTop = "10px";
		rankHolder.style.display = "none";

		rankBtn.addEventListener("click", () => {
			const showing = rankHolder.style.display === "block";
			if (showing) {
				rankHolder.style.display = "none";
				return;
			}
			rankHolder.style.display = "block";
			rankHolder.textContent = "讀取排行榜中...";
			void fetchLeaderboard("daily").then((res) => {
				renderLeaderboardTableInto(rankHolder, res);
			});
		});

		appendNodes(btnRow, startBtn, rankBtn);
		appendNodes(info, badge, title, subtitle, pills, btnRow, rankHolder);
		appendNodes(layout, visual, info);
		card.appendChild(layout);
		backdrop.appendChild(card);
		this.root.appendChild(backdrop);
	}

	public showGameOverModal(params: {
		readonly finalState: RunState;
		readonly orientationUsed: OrientationUsed;
		readonly polaroids: readonly ComposedPolaroid[];
		readonly buildSubmission: (alias: string) => ReturnType<
			typeof import("../../domain/legal-engine.ts").toSubmitScorePayload
		>;
		readonly onPlayAgain: () => void;
	}): void {
		this.clear();
		const backdrop = el("div", "modal-backdrop");
		backdrop.dataset.testid = "gameover-modal";

		const card = el("div", "taiwan-card");

		const badge = el("span", "signboard-badge", "街頭巡迴結算 · 資源再生報告");
		const title = el("h2", "game-title", `總得分 ${params.finalState.score} 分`);
		title.dataset.testid = "final-score-heading";

		const recycledCount = deriveRecycledCount(params.finalState.recyclableTallies);
		const co2Grams = deriveCo2SavedGrams(params.finalState.recyclableTallies);
		const violations = deriveViolationCount(params.finalState.violationTallies);
		const contaminants = deriveContaminantCount(params.finalState.contaminantTallies);
		const totalActions = recycledCount + violations + contaminants;
		const complianceRate =
			totalActions === 0 ? 100 : Math.round((recycledCount / totalActions) * 100);

		const statsGrid = el("div", "rule-pills");
		const summaryStats: ReadonlyArray<readonly [string, string]> = [
			["可再利用資收物", `${recycledCount} 件（清分壓三連 ${params.finalState.combo.triadsCompleted} 次）`],
			["累積減碳貢獻", `${co2Grams} 公克 CO₂e`],
			["交通與分類合規率", `${complianceRate}%（違規 ${violations} 次 / 誤撿垃圾 ${contaminants} 次）`],
			["遊玩握持模式", params.orientationUsed === "both" ? "直橫雙向無縫切換" : params.orientationUsed === "landscape" ? "橫向雙手街機" : "直向單手漫遊"],
		];
		for (const [k, v] of summaryStats) {
			const box = el("div", "rule-pill");
			appendNodes(box, el("strong", "", k), document.createTextNode(v));
			statsGrid.appendChild(box);
		}

		const polaroidTitle = el(
			"h3",
			"",
			`本局自動精選精彩瞬間（共 ${params.polaroids.length} 張，可存入手機相簿）`,
		);
		polaroidTitle.style.fontFamily = "var(--font-display)";
		polaroidTitle.style.margin = "14px 0 6px";
		polaroidTitle.style.color = "#FDE68A";

		const gallery = el("div", "polaroid-strip");
		gallery.dataset.testid = "polaroid-gallery";

		for (const shot of params.polaroids) {
			const item = el("div", "polaroid-item");
			const img = el("img");
			img.src = shot.dataUrl;
			img.alt = shot.meta.badgeZh;
			img.dataset.testid = "polaroid-image";

			const actions = el("div", "polaroid-actions");
			const dlLink = el("a", "", "下載 PNG 留存");
			dlLink.href = shot.dataUrl;
			dlLink.download = shot.filename;
			dlLink.dataset.testid = "polaroid-download-btn";

			const shareBtn = el("button", "", "分享 / 存入照片");
			shareBtn.type = "button";
			shareBtn.addEventListener("click", () => {
				void shareOrDownloadPolaroid(shot);
			});

			appendNodes(actions, dlLink, shareBtn);
			appendNodes(item, img, actions);
			gallery.appendChild(item);
		}

		const lbSection = el("div");
		lbSection.dataset.testid = "leaderboard-panel";
		lbSection.style.marginTop = "16px";
		lbSection.style.paddingTop = "14px";
		lbSection.style.borderTop = "1px solid rgba(255,255,255,0.14)";

		const lbHeading = el("h3", "", "台灣街頭匿名排行榜");
		lbHeading.style.fontFamily = "var(--font-display)";
		lbHeading.style.margin = "0 0 8px";

		const aliasRow = el("div");
		aliasRow.style.display = "flex";
		aliasRow.style.gap = "8px";
		aliasRow.style.marginBottom = "10px";

		const aliasInput = el("input", "alias-input");
		aliasInput.type = "text";
		aliasInput.maxLength = 16;
		aliasInput.value = params.finalState.alias;
		aliasInput.placeholder = "輸入匿名街頭稱號（免註冊零個資）";
		aliasInput.dataset.testid = "alias-input";

		const submitBtn = el("button", "btn-secondary", "更新代號並送出成績");
		submitBtn.dataset.testid = "submit-score-btn";
		submitBtn.style.whiteSpace = "nowrap";

		appendNodes(aliasRow, aliasInput, submitBtn);

		const scopeRow = el("div");
		scopeRow.style.display = "flex";
		scopeRow.style.gap = "8px";
		scopeRow.style.marginBottom = "8px";

		const dailyTab = el("button", "btn-secondary", "今日街頭榜");
		dailyTab.dataset.testid = "tab-daily";
		const allTimeTab = el("button", "btn-secondary", "歷史總榜");
		allTimeTab.dataset.testid = "tab-alltime";
		appendNodes(scopeRow, dailyTab, allTimeTab);

		const statusMsg = el("p", "", "正在自動登錄匿名排行榜...");
		statusMsg.dataset.testid = "leaderboard-status";
		statusMsg.style.fontSize = "0.82rem";
		statusMsg.style.color = "#6EE7B7";
		statusMsg.style.margin = "4px 0 8px";

		const tableHolder = el("div");
		tableHolder.dataset.testid = "leaderboard-table-holder";

		let activeScope: LeaderboardScope = "daily";

		const loadScope = async (scope: LeaderboardScope) => {
			activeScope = scope;
			const res = await fetchLeaderboard(scope, params.finalState.sessionId);
			renderLeaderboardTableInto(tableHolder, res, params.finalState.sessionId);
		};

		const doSubmit = async () => {
			submitBtn.disabled = true;
			const chosenAlias = aliasInput.value.trim() || params.finalState.alias;
			const payload = params.buildSubmission(chosenAlias);
			const result = await submitRunScore(payload);
			if (result.ok) {
				const recordedAlias =
					result.leaderboard.callerPlacement.kind === "ranked"
						? result.leaderboard.callerPlacement.entry.alias
						: chosenAlias;
				aliasInput.value = recordedAlias;
				statusMsg.textContent = `已以「${recordedAlias}」登錄匿名排行榜！`;
				renderLeaderboardTableInto(
					tableHolder,
					result.leaderboard,
					params.finalState.sessionId,
				);
			} else {
				statusMsg.textContent = `排行榜狀態：${result.reason}`;
				await loadScope(activeScope);
			}
			submitBtn.disabled = false;
		};

		submitBtn.addEventListener("click", () => {
			void doSubmit();
		});
		dailyTab.addEventListener("click", () => {
			void loadScope("daily");
		});
		allTimeTab.addEventListener("click", () => {
			void loadScope("all_time");
		});

		const againBtn = el("button", "btn-primary", "再巡一趟台灣巷弄");
		againBtn.dataset.testid = "play-again-btn";
		againBtn.style.marginTop = "14px";
		againBtn.addEventListener("click", () => {
			this.clear();
			params.onPlayAgain();
		});

		appendNodes(lbSection, lbHeading, aliasRow, scopeRow, statusMsg, tableHolder);
		appendNodes(card, badge, title, statsGrid, polaroidTitle, gallery, lbSection, againBtn);
		backdrop.appendChild(card);
		this.root.appendChild(backdrop);

		void doSubmit();
	}
}
