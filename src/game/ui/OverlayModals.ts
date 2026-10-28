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
			"hero-subtitle",
			"穿梭台灣騎樓與紅磚巷弄，尋找可再利用寶物，避開髒污垃圾！直拿單手、橫拿雙手無縫暢玩。",
		);

		const guideTabs = el("div", "guide-tabs");
		const guidePanel = el("div", "guide-panel");

		const tabDefs: ReadonlyArray<{
			readonly id: string;
			readonly label: string;
			readonly items: ReadonlyArray<{
				readonly icon: string;
				readonly title: string;
				readonly desc: string;
				readonly tag?: { readonly type: "good" | "bad"; readonly text: string };
			}>;
		}> = [
			{
				id: "controls",
				label: "🎮 操作指南",
				items: [
					{
						icon: "🕹️",
						title: "角色移動",
						desc: "手機拖曳左下搖桿移動；電腦使用 W A S D 或方向鍵。",
					},
					{
						icon: "🟢",
						title: "撿取資收",
						desc: "靠近發光寶物點擊右下「撿資收」（電腦：Space 或 E）。",
					},
					{
						icon: "🔵",
						title: "推車與徒步",
						desc: "停在白線格/暫置區切換徒步；走近 2.3m 取車卸貨入車（電腦：C）。",
					},
					{
						icon: "📱",
						title: "直橫隨轉",
						desc: "單手直向漫遊、雙手橫向街機，局中任意旋轉無縫切換！",
					},
				],
			},
			{
				id: "recyclables",
				label: "♻️ 資收 vs 垃圾",
				items: [
					{
						icon: "⭕",
						title: "可再利用寶物",
						desc: "寶特瓶、鋁罐、紙箱、鐵罐、玻璃瓶、廢電池、3C 設備。",
						tag: { type: "good", text: "加分+減碳" },
					},
					{
						icon: "✨",
						title: "清・分・壓三連",
						desc: "各集滿一種清洗、分類、壓縮物品，觸發完美三連獎勵 +120 分！",
						tag: { type: "good", text: "COMBO" },
					},
					{
						icon: "❌",
						title: "一般髒污垃圾",
						desc: "油便當盒、衛生紙、菸蒂、髒塑膠袋。誤撿倒扣分數且中斷連段！",
						tag: { type: "bad", text: "嚴禁撿拾" },
					},
				],
			},
			{
				id: "rules",
				label: "⚖️ 街頭法規",
				items: [
					{
						icon: "🚦",
						title: "小綠人與行穿線",
						desc: "綠燈走行穿線安全過街；闖紅燈或穿越車道會被開單舉發！",
					},
					{
						icon: "🚒",
						title: "消防栓 5m 禁推車",
						desc: "推車推入 5m 紅圈立即舉發！先停在白線格再徒步快取（限逗留 3 秒）。",
					},
					{
						icon: "🛑",
						title: "無號誌巷口「停」",
						desc: "遇八角形「停」標誌先靜止 0.4 秒確認無車，逕自闖入會被開單！",
					},
					{
						icon: "📸",
						title: "自動抓拍拍立得",
						desc: "75 秒結算自動合成 Top-3 精彩照片，長按或點擊可存入手機相簿！",
					},
				],
			},
			{
				id: "credits",
				label: "🤝 開發與致敬",
				items: [
					{
						icon: "👨‍💻",
						title: "共同開發者",
						desc: "Tonny 與 Antigravity AI 共同協作開發，全流程負起架構品質與代碼維護責任。",
						tag: { type: "good", text: "PARTNER" },
					},
					{
						icon: "🧠",
						title: "AI 驅動模型",
						desc: "全鏈路多代理架構：Gemini 4 Argon (High) 形式驗證與反作弊 + Gemini 3.8 Flash (High)。",
						tag: { type: "good", text: "GEMINI" },
					},
					{
						icon: "🙏",
						title: "致敬 pstack 作者",
						desc: "特別致敬 pstack 開源技能作者！開源了極為強大的軟體工程技能體系，驅動雙代理競技、TLA+ 形式驗證、對抗審查與零註解落地！",
						tag: { type: "good", text: "TRIBUTE" },
					},
					{
						icon: "🛡️",
						title: "工程品質保證",
						desc: "13,752 狀態無反例、Playwright 雙引擎實測、Cloudflare Worker + D1 全端運行。",
					},
				],
			},
		];

		let activeTabId = "controls";

		const renderGuideContent = (tabId: string) => {
			activeTabId = tabId;
			guidePanel.replaceChildren();
			const activeDef = tabDefs.find((t) => t.id === tabId) ?? tabDefs[0];
			if (!activeDef) return;

			for (const it of activeDef.items) {
				const itemEl = el("div", "guide-item");
				const iconEl = el("span", "guide-icon", it.icon);
				const textEl = el("div", "guide-text");

				if (it.tag) {
					const badgeCls = it.tag.type === "good" ? "guide-badge-good" : "guide-badge-bad";
					textEl.appendChild(el("span", badgeCls, it.tag.text));
				}
				appendNodes(textEl, el("strong", "", it.title), document.createTextNode(it.desc));
				appendNodes(itemEl, iconEl, textEl);
				guidePanel.appendChild(itemEl);
			}

			const buttons = guideTabs.querySelectorAll<HTMLButtonElement>(".guide-tab");
			buttons.forEach((btn) => {
				if (btn.dataset.tabId === tabId) {
					btn.classList.add("active");
				} else {
					btn.classList.remove("active");
				}
			});
		};

		for (const def of tabDefs) {
			const tabBtn = el("button", "guide-tab", def.label);
			tabBtn.type = "button";
			tabBtn.dataset.tabId = def.id;
			if (def.id === activeTabId) {
				tabBtn.classList.add("active");
			}
			tabBtn.addEventListener("click", () => {
				renderGuideContent(def.id);
			});
			guideTabs.appendChild(tabBtn);
		}

		renderGuideContent(activeTabId);

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

		const creditBox = el("div", "start-credit-box");
		appendNodes(
			creditBox,
			el("span", "credit-tag", "共同開發"),
			document.createTextNode("Tonny × Antigravity AI · "),
			el("span", "credit-tag", "驅動模型"),
			document.createTextNode("Gemini 4 Argon & 3.8 Flash · "),
			el("span", "credit-tag", "特別致敬"),
			document.createTextNode("pstack 開源技能作者"),
		);

		appendNodes(btnRow, startBtn, rankBtn);
		appendNodes(info, badge, title, subtitle, guideTabs, guidePanel, btnRow, rankHolder, creditBox);
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
