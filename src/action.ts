/**
 * action 面板入口 —— 两个 tab：[附件描述] [保存模板]
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { load, subscribe } from "./persist/store";
import { applyTheme, injectStyle } from "./ui/style";
import { renderPeekPanel, type PeekPanelCtx } from "./ui/panel-peek";
import { renderTemplatePanel } from "./ui/panel-templates";

type TabId = "peek" | "templates";

let role: "GM" | "PLAYER" = "PLAYER";
let selectionIds: string[] = [];
let activeTab: TabId = "peek";

const panel = document.getElementById("panel") as HTMLDivElement;
const countEl = document.getElementById("count") as HTMLSpanElement;
const modeBtn = document.getElementById("mode-btn") as HTMLSpanElement;

function currentCtx(selected: readonly Item[]): PeekPanelCtx {
    return { role, selected, panel, footerCount: countEl };
}

async function refresh(): Promise<void> {
    const selected: Item[] =
        selectionIds.length > 0
            ? await OBR.scene.items.getItems(selectionIds)
            : [];
    const targets = selected.filter(
        (i) => i.layer === "ATTACHMENT" || i.layer === "PROP",
    );

    if (activeTab === "peek") {
        renderPeekPanel(currentCtx(targets));
    } else {
        renderTemplatePanel(panel, countEl, targets);
    }
}

function updateModeBtn(): void {
    modeBtn.textContent = role === "GM" ? "GM 模式" : "玩家模式";
}

function switchTab(tab: TabId): void {
    if (activeTab === tab) {
        return;
    }
    activeTab = tab;
    for (const el of document.querySelectorAll<HTMLElement>("#tabs .tab")) {
        el.classList.toggle("active", el.dataset.tab === tab);
    }
    void refresh();
}

function initTabs(): void {
    const tabs = document.getElementById("tabs");
    if (!tabs) {
        return;
    }
    for (const el of tabs.querySelectorAll<HTMLElement>(".tab")) {
        el.addEventListener("click", () => {
            switchTab((el.dataset.tab ?? "peek") as TabId);
        });
    }
}

OBR.onReady(async () => {
    injectStyle();
    initTabs();

    role = await OBR.player.getRole();
    const cur = await OBR.player.getSelection();
    if (Array.isArray(cur)) {
        selectionIds = cur;
    }

    load();
    // 玩家无需看到模板 tab
    if (role !== "GM") {
        const t = document.querySelector<HTMLElement>('[data-tab="templates"]');
        if (t) {
            t.style.display = "none";
        }
    }

    updateModeBtn();
    await refresh();

    // 存储变化 → 重绘当前面板。
    // 不能只在 templates 页刷新：在「附件描述」页点存档后，
    // 卡片按钮要立刻从「存档」翻成「取消存档」，否则用户会以为没存上。
    subscribe(() => {
        void refresh();
    });

    OBR.player.onChange((player) => {
        const changed =
            JSON.stringify(player.selection ?? []) !==
                JSON.stringify(selectionIds) || player.role !== role;
        selectionIds = player.selection ?? [];
        role = player.role;
        if (changed) {
            updateModeBtn();
            void refresh();
        }
    });

    OBR.scene.items.onChange(() => {
        void refresh();
    });

    OBR.theme.onChange((theme) => applyTheme(theme.mode));
    const theme = await OBR.theme.getTheme();
    applyTheme(theme.mode);
});

/** 供 ui 模块调用：编辑后触发重绘 */
export function requestRefresh(): void {
    void refresh();
}
