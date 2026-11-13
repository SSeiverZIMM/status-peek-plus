/**
 * [附件描述] 面板
 *
 * 来自 Status Peek 的 action.ts，改为可复用的渲染函数。
 * 新增：每张卡片右侧的「保存 / 取消」小按钮（持久化快捷入口）。
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { MODAL_EDIT_ID, readPeek, siblingUrl } from "../shared";
import {
    addTextStatus,
    findByKey,
    getTokens,
    persist,
    removeToken,
} from "../persist/store";
import { persistedTokenKey, persistedTokenGetName } from "../persist/model";

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

/**
 * 保存该物件为「唯一存档」（全插件唯一的存档入口）
 *
 * 不传 type —— 默认即 UNIQUE：物件在场景中的后续改动会自动回写。
 * 保存结果会明确通知，避免旧版那种「点了没反应」的静默失败。
 */
async function quickPersist(item: Item): Promise<void> {
    const attachments = (
        await OBR.scene.items.getItemAttachments([item.id])
    ).filter((a) => a.id !== item.id);

    const result = persist([{ token: item, attachments }]);

    if (result.saved > 0) {
        void OBR.notification.show(
            `已存档：「${item.name || "未命名物件"}」`,
            "SUCCESS",
        );
    } else {
        void OBR.notification.show(
            `存档失败：${result.skipped[0]?.reason ?? "未知原因"}`,
            "ERROR",
        );
    }
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

export function renderPeekPanel(ctx: PeekPanelCtx): void {
    const { role, selected, panel, footerCount } = ctx;

    panel.innerHTML = "";

    footerCount.textContent =
        selected.length === 0 ? "未选中" : `已选 ${selected.length} 项`;

    if (selected.length === 0) {
        const tip = el("div", "hint");
        tip.innerHTML =
            "<b>点击画布上的物件</b><br/>即可在此查看它的描述。<br/><br/>" +
            (role === "GM"
                ? "右键物件 →「附件描述」<br/>可编写规则文本。<br/>选中物件后点卡片上的「存档」<br/>即可跨场景复用。"
                : "带描述的物件由主持人配置。");
        panel.appendChild(tip);
        return;
    }

    for (const item of selected) {
        const peek = readPeek(item.metadata);
        const card = el("div", "card");

        // --- 头部 ---
        const head = el("div", "card-head");
        const swatch = el("span", "swatch");
        const name = el("span", "item-name", item.name || "（未命名物件）");
        head.appendChild(swatch);
        head.appendChild(name);

        if (role === "GM") {
            // 持久化快捷按钮
            const url = (item as { image?: { url?: string } }).image?.url;
            const persisted =
                typeof url === "string" ? findByKey(url) : undefined;

            const saveBtn = el(
                "button",
                `btn ${persisted ? "danger" : "primary"}`,
                persisted ? "取消存档" : "存档",
            );
            saveBtn.title = persisted
                ? `取消存档「${persistedTokenGetName(persisted)}」`
                : "保存为唯一存档：之后从素材库拖出同一张图片会自动带上描述，在场景中的改动也会自动回写";
            saveBtn.addEventListener("click", () => {
                if (persisted) {
                    const ok = window.confirm(
                        `取消持久化「${persistedTokenGetName(persisted)}」？\n\n该物件将不再作为模板保存。`,
                    );
                    if (ok) {
                        removeToken(persistedTokenKey(persisted));
                        void OBR.notification.show("已取消持久化", "SUCCESS");
                    }
                } else {
                    void quickPersist(item);
                }
            });
            head.appendChild(saveBtn);

            // 存为纯文字状态（v1.2）：只保存描述文本，不关联图片
            const textBtn = el("button", "btn", "存为文字状态");
            textBtn.title = "只保存该物件的描述文本（不关联图片），之后可从模板页一键套用到任意附件上";
            textBtn.addEventListener("click", () => {
                const cur = readPeek(item.metadata);
                if (!cur.has || !cur.text) {
                    void OBR.notification.show(
                        "该物件还没有描述文本，请先「编辑」写入",
                        "WARNING",
                    );
                    return;
                }
                const name =
                    item.name || `文字状态 ${cur.text.slice(0, 10)}`;
                addTextStatus(name, cur.text);
                void OBR.notification.show(
                    `已保存文字状态「${name}」`,
                    "SUCCESS",
                );
            });
            head.appendChild(textBtn);

            // 编辑按钮
            const editBtn = el("button", "btn", peek.has ? "编辑" : "设置");
            editBtn.title = "编辑描述文本";
            editBtn.addEventListener("click", () => openEdit([item.id]));
            head.appendChild(editBtn);
        }

        card.appendChild(head);

        // --- 描述正文 ---
        const text = el("div", `item-text${peek.has ? "" : " no-desc"}`);
        text.textContent = peek.has ? peek.text : "（暂无描述）";
        card.appendChild(text);

        panel.appendChild(card);
    }
}

/** 当前已保存的模板数量（供面板底部展示） */
export function templateCount(): number {
    return getTokens().length;
}
