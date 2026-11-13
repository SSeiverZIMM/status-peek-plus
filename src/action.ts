/**
 * action 面板入口 —— 两个 tab：[状态] [素材库]
 *
 * 旧版是三个（状态 / 状态库 / 图片存档）。后两个已合并为「素材库」：
 * 状态预设与图片存档本来就是同一件事的两面，拆开只会让同一个状态
 * 要在两处维护、套用和复用分成两步。
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { injectStyle } from "./ui/style";
import { watchTheme } from "./ui/theme";
import {
    renderPeekPanel,
    invalidateRoundCache,
    type PeekPanelCtx,
} from "./ui/panel-peek";
import { renderArchivePanel } from "./ui/panel-archive";

type TabId = "peek" | "archive";

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
        // 玩家进素材库是只读的：能看、能套用 GM 发布的房间预设
        await renderArchivePanel(panel, countEl, role !== "GM");
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

    // 主题跟随宿主：先应用一次，之后宿主切主题自动跟随
    void watchTheme();

    role = await OBR.player.getRole();
    const cur = await OBR.player.getSelection();
    if (Array.isArray(cur)) {
        selectionIds = cur;
    }

    updateModeBtn();
    await refresh();

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

    // 回合推进 → 剩余轮数会变，清缓存重算
    OBR.scene.onMetadataChange(() => {
        invalidateRoundCache();
        void refresh();
    });
});

/** 供 ui 模块调用：编辑后触发重绘 */
export function requestRefresh(): void {
    void refresh();
}