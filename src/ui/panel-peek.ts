/**
 * [状态] 面板 —— 画布上选中物件的状态查看/编辑
 *
 * 与 [素材库] 的分工：
 *   本面板管「画布上现在有什么」——选中什么、状态是什么、怎么改
 *   素材库管「有哪些可复用的」——存、套用、发布
 * 两者通过ArchiveEntry 串起来：这里改完可以「存为素材」，
 * 素材库里也可以「套用到选中」。
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
    MODAL_EDIT_ID,
    readCombatRound,
    readPeek,
    remainingRounds,
    siblingUrl,
} from "../shared";
import { reviveExpired } from "../rounds";
import { captureFromItem, findById, listAll } from "../archive";
import { applyEntry } from "../apply";
import type { ArchiveEntry } from "../shared";

export interface PeekPanelCtx {
    role: "GM" | "PLAYER";
    selected: readonly Item[];
    panel: HTMLDivElement;
    footerCount: HTMLSpanElement;
}

/** 打开统一编辑面板 */
export function openEdit(ids: readonly string[]): void {
    if (ids.length === 0) {
        return;
    }
    void OBR.modal.open({
        id: MODAL_EDIT_ID,
        url: `${siblingUrl("edit.html")}?ids=${encodeURIComponent(ids.join(","))}`,
        width: 420,
        height: 460,
        hidePaper: true,
    });
}

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

/* ------------------------------------------------------------------ */
/* 回合数缓存                                                          */
/* ------------------------------------------------------------------ */

let lastRound: number | null | undefined = undefined;
let roundPromise: Promise<number | null> | null = null;

function loadRound(): Promise<number | null> {
    roundPromise ??= (async () => {
        try {
            return readCombatRound(await OBR.scene.getMetadata());
        } catch {
            return null;
        }
    })();
    return roundPromise;
}

/** 供 action.ts 在回合变化时强制重算 */
export function invalidateRoundCache(): void {
    lastRound = undefined;
    roundPromise = null;
}

/* ------------------------------------------------------------------ */
/* 套用                                                                */
/* ------------------------------------------------------------------ */

/** GM 的「从素材库套用」按钮组 */
async function buildArchivePicker(
    itemIds: readonly string[],
): Promise<HTMLDivElement> {
    const box = el("div", "lib-picker");
    const entries = await listAll();

    if (entries.length === 0) {
        box.appendChild(el("div", "hint", "素材库是空的，先到「素材库」页新建。"));
        return box;
    }

    const sel = document.createElement("select");
    sel.className = "lib-select";
    for (const e of entries) {
        const o = document.createElement("option");
        o.value = e.id;
        const rounds = e.rounds > 0 ? ` · ${e.rounds}轮` : " · 不限";
        const img = e.imageUrl ? " · 含图标" : "";
        const scope = e.scope === "scene" ? " · 房间" : "";
        o.textContent = `${e.name || "（未命名）"}${rounds}${img}${scope}`;
        sel.appendChild(o);
    }

    const apply = el("button", "btn primary", "套用");
    apply.addEventListener("click", () => {
        void (async () => {
            const entry: ArchiveEntry | undefined = await findById(sel.value);
            if (!entry) {
                void OBR.notification.show("素材库中已无此条目", "ERROR");
                return;
            }
            const r = await applyEntry(entry, itemIds);
            const done = r.created + r.reused + r.written;
            void OBR.notification.show(
                r.failed > 0
                    ? `已套用 ${done}/${itemIds.length} 个（${r.failed} 个失败）`
                    : `已套用到 ${done} 个目标`,
                r.failed > 0 ? "WARNING" : "SUCCESS",
            );
        })();
    });

    box.appendChild(sel);
    box.appendChild(apply);
    return box;
}

/* ------------------------------------------------------------------ */
/* 主渲染                                                              */
/* ------------------------------------------------------------------ */

export function renderPeekPanel(ctx: PeekPanelCtx): void {
    void loadRound().then((round) => {
        if (lastRound === round) return;
        lastRound = round;
        renderCards(ctx, round);
    });
    renderCards(ctx, lastRound ?? null);
}

function renderCards(ctx: PeekPanelCtx, round: number | null): void {
    const { role, selected, panel, footerCount } = ctx;

    panel.innerHTML = "";
    footerCount.textContent =
        selected.length === 0 ? "未选中" : `已选 ${selected.length} 项`;

    if (selected.length === 0) {
        const tip = el("div", "hint");
        tip.innerHTML =
            "<b>点击画布上的状态标记</b><br/>" +
            "即可在此查看、编辑它的状态。<br/><br/>" +
            "玩家端：切到工具栏的<b>「查看状态描述」</b>模式，<br/>" +
            "鼠标移到标记上就会弹出说明。<br/><br/>" +
            (role === "GM" ? "GM：选中标记后点「编辑」即可填写规则文本。" : "");
        panel.appendChild(tip);
        return;
    }

    for (const item of selected) {
        panel.appendChild(buildItemCard(item, role, round));
    }

    // --- GM：从素材库批量套用 ---
    if (role === "GM" && selected.length > 0) {
        const ids = selected.map((i) => i.id);
        const pickerSlot = el("div", "lib-picker-slot");
        let built = false;

        const toggle = el("button", "btn", "从素材库套用…");
        toggle.addEventListener("click", () => {
            if (built) {
                pickerSlot.innerHTML = "";
                built = false;
                toggle.textContent = "从素材库套用…";
                return;
            }
            built = true;
            toggle.textContent = "收起";
            void buildArchivePicker(ids).then((box) => {
                pickerSlot.innerHTML = "";
                pickerSlot.appendChild(box);
            });
        });

        panel.appendChild(toggle);
        panel.appendChild(pickerSlot);
    }
}

function buildItemCard(
    item: Item,
    role: "GM" | "PLAYER",
    round: number | null,
): HTMLElement {
    const peek = readPeek(item.metadata);
    const card = el("div", `card${peek.expired ? " card-expired" : ""}`);

    const head = el("div", "card-head");
    const swatch = el("span", "swatch");
    if (/^#[0-9a-f]{6}$/i.test(peek.color)) {
        swatch.style.background = peek.color;
    }
    head.appendChild(swatch);
    head.appendChild(el("span", "item-name", peek.name || item.name || "（未命名标记）"));

    if (role === "GM") {
        if (peek.expired) {
            const reviveBtn = el("button", "btn primary", "续期");
            reviveBtn.title = "清除「已结束」标记，并把施加回合重置为当前回合重新计数";
            reviveBtn.addEventListener("click", () => {
                void reviveExpired([item.id]).then(() => {
                    void OBR.notification.show("已续期", "SUCCESS");
                });
            });
            head.appendChild(reviveBtn);
        }

        // 存为素材：这就是旧版独立的「存档」按钮，现在并入素材库模型
        const saveBtn = el("button", "btn", "存为素材");
        saveBtn.title =
            "把这个标记存进素材库（名字、规则文本、轮数、配色、图片与子物件位置），" +
            "以后可以一键套用到别的目标上";
        saveBtn.addEventListener("click", () => {
            void (async () => {
                try {
                    const attachments = (
                        await OBR.scene.items.getItemAttachments([item.id])
                    ).filter((a) => a.id !== item.id);
                    const e = await captureFromItem(item, "local", attachments);
                    if (!e) {
                        void OBR.notification.show("该物件没有图片地址，无法存为素材", "WARNING");
                        return;
                    }
                    void OBR.notification.show(
                        `已存入素材库：${e.name || "未命名"}`,
                        "SUCCESS",
                    );
                } catch (err) {
                    void OBR.notification.show(
                        `存入失败：${err instanceof Error ? err.message : String(err)}`,
                        "ERROR",
                    );
                }
            })();
        });
        head.appendChild(saveBtn);

        const editBtn = el("button", "btn", peek.has ? "编辑" : "设置");
        editBtn.title = "编辑状态名、规则文本与持续轮数";
        editBtn.addEventListener("click", () => openEdit([item.id]));
        head.appendChild(editBtn);
    }

    card.appendChild(head);

    const text = el("div", `item-text${peek.has ? "" : " no-desc"}`);
    text.textContent = peek.has ? peek.descPlain : "（暂无状态描述）";
    card.appendChild(text);

    if (peek.has && (peek.rounds > 0 || peek.expired)) {
        const foot = el("div", "item-foot");
        if (peek.expired) {
            foot.appendChild(el("span", "pill expired-pill", "已结束"));
        } else {
            const left = remainingRounds(peek.rounds, peek.appliedRound, round);
            foot.appendChild(
                el(
                    "span",
                    `pill${left === null ? " muted" : ""}`,
                    left === null
                        ? `持续 ${peek.rounds} 轮`
                        : `剩 ${left} / ${peek.rounds} 轮`,
                ),
            );
        }
        card.appendChild(foot);
    }

    return card;
}