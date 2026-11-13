/**
 * [素材库] 面板 —— 状态预设与图片存档，已合并
 *
 * 【这一版合并掉了什么】
 * 旧版有两条并列的东西：
 *   「状态库」存状态定义（场景数据，房间共享）
 *   「图片存档」存物件快照（浏览器本地，仅自己可见）
 * 用起来别扭：同一个状态要分两处维护，套用和复用分成两步。
 *
 * 现在合并为一条 `ArchiveEntry`（见 archive.ts）：
 *   名字 / 规则文本 / 轮数 / 配色 / 图标 / 子物件快照 —— 全在一处。
 * 「套用」= 把这条放到画布上；「存档」= 把画布上现成的收进来。同一件事的两面。
 *
 * 每条自己选存哪里：
 *   私有（localStorage）—— 只有自己看得见
 *   房间（scene metadata）—— 所有人可见
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
    MAX_NAME_LENGTH,
    MAX_TEXT_LENGTH,
    PRESET_COLORS,
    type ArchiveEntry,
    type ArchiveScope,
} from "../shared";
import {
    captureFromItem,
    deleteEntry,
    downloadJson,
    exportJson,
    importJson,
    listAll,
    moveScope,
    upsertEntry,
} from "../archive";
import { applyEntry } from "../apply";

const HEX = /^#[0-9a-f]{6}$/i;

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

let entries: ArchiveEntry[] = [];
let expandedId: string | null = null;

/* 筛选状态记在模块级：增删条目会整面板重画，筛选词与选中色不能丢 */
let filterColor: string | null = null;
let filterText = "";

async function reload(): Promise<void> {
    entries = await listAll();
}

/* ------------------------------------------------------------------ */
/* 编辑表单                                                            */
/* ------------------------------------------------------------------ */

function scopeToggle(
    scope: ArchiveScope,
    onChange: (s: ArchiveScope) => void,
): HTMLElement {
    const row = el("div", "tpl-row");
    row.appendChild(el("span", "tpl-label", "存到"));
    for (const s of ["local", "scene"] as ArchiveScope[]) {
        const btn = el(
            "button",
            `tpl-toggle${scope === s ? " on" : ""}`,
            s === "local" ? "私有（仅自己）" : "房间（所有人可见）",
        );
        btn.title =
            s === "local"
                ? "存浏览器本地。换电脑、换房间都没有，别人也看不到。"
                : "存场景数据。房间内所有玩家都能看到并套用这条素材。";
        btn.addEventListener("click", () => onChange(s));
        row.appendChild(btn);
    }
    return row;
}

function buildEditor(
    entry: ArchiveEntry | null,
    onDone: () => void,
): HTMLDivElement {
    const wrap = el("div", "lib-editor");

    let scope: ArchiveScope = entry?.scope ?? "local";
    let imageUrl = entry?.imageUrl ?? "";

    /* --- 绑定图片 --- */
    const bindRow = el("div", "lib-bind");
    const thumbBox = el("div");

    const rebuildThumb = (): void => {
        thumbBox.innerHTML = "";
        if (imageUrl) {
            const img = document.createElement("img");
            img.className = "lib-thumb";
            img.src = imageUrl;
            img.alt = "绑定图标";
            img.title = "点击清除绑定";
            img.addEventListener("click", () => {
                imageUrl = "";
                rebuildThumb();
                syncHint();
            });
            thumbBox.appendChild(img);
        } else {
            const ph = el("div", "lib-thumb empty", "＋");
            ph.title = "未绑定图标";
            thumbBox.appendChild(ph);
        }
    };

    rebuildThumb();

    const pickBtn = el("button", "btn", "用选中物件的图");
    pickBtn.title =
        "读取画布上当前选中物件的图片地址作为图标。" +
        "绑定后套用时会自动把图贴到目标 token 上，并记住它的子物件与相对位置。";
    pickBtn.addEventListener("click", () => {
        void (async () => {
            try {
                const ids = (await OBR.player.getSelection()) ?? [];
                const items = ids.length > 0 ? await OBR.scene.items.getItems(ids) : [];
                const url = items
                    .map((i) => (i as { image?: { url?: string } }).image?.url)
                    .find((u): u is string => typeof u === "string" && u.length > 0);
                if (!url) {
                    void OBR.notification.show("请先在画布上选中一个图片物件", "WARNING");
                    return;
                }
                imageUrl = url;
                rebuildThumb();
                syncHint();
            } catch (e) {
                void OBR.notification.show(
                    `读取选中物件失败：${e instanceof Error ? e.message : String(e)}`,
                    "ERROR",
                );
            }
        })();
    });

    const bindHint = el("div", "tpl-note");
    const syncHint = (): void => {
        bindHint.textContent = imageUrl
            ? "已绑定图标：套用时自动贴图，并记住子物件位置。"
            : "未绑定图标：套用时只写入文字与轮数，适合批量施加。";
    };
    syncHint();

    bindRow.appendChild(thumbBox);
    bindRow.appendChild(pickBtn);

    /* --- 文本字段 --- */
    const nameInput = el("input") as HTMLInputElement;
    nameInput.type = "text";
    nameInput.placeholder = "状态名，例如：魅惑Charmed";
    nameInput.maxLength = MAX_NAME_LENGTH;
    nameInput.value = entry?.name ?? "";

    const descInput = el("textarea") as HTMLTextAreaElement;
    descInput.placeholder =
        "规则文本，例如：被魅惑生物不能攻击魅惑者，其造成伤害的能力或魔法效应也不能以魅惑者为目标。";
    descInput.value = entry?.descPlain ?? "";

    const roundsInput = el("input") as HTMLInputElement;
    roundsInput.type = "number";
    roundsInput.min = "0";
    roundsInput.step = "1";
    roundsInput.value = String(entry?.rounds ?? 3);

    const colorInput = el("input") as HTMLInputElement;
    colorInput.type = "color";
    colorInput.value =
        entry && HEX.test(entry.color) ? entry.color : "#ff00d0";

    const row = el("div", "lib-row");
    row.appendChild(roundsInput);
    row.appendChild(el("span", "lib-hint", "轮（0 = 不限）"));
    row.appendChild(colorInput);

    // 「存到」这一行要在切换后重画以更新高亮，
    // 所以包一层 holder，重画时替换 holder 里的内容
    const scopeSlot = el("div");
    const paintScope = (): void => {
        scopeSlot.innerHTML = "";
        scopeSlot.appendChild(
            scopeToggle(scope, (s) => {
                scope = s;
                paintScope();
            }),
        );
    };
    paintScope();

    /* --- 保存 --- */
    const actions = el("div", "lib-actions");

    const save = el("button", "btn primary", entry ? "保存修改" : "添加到素材库");
    save.addEventListener("click", () => {
        void (async () => {
            const name = nameInput.value.trim().slice(0, MAX_NAME_LENGTH);
            const descPlain = descInput.value.trim().slice(0, MAX_TEXT_LENGTH);
            // 没有任何内容就不让存，避免素材库里堆空条目
            if (!name && !descPlain && !imageUrl) {
                void OBR.notification.show("至少填状态名或绑定一张图", "WARNING");
                return;
            }
            await upsertEntry({
                // upsertEntry 内部会为空 id 分配新 id
                id: entry?.id ?? "",
                scope,
                name,
                desc: entry?.desc ?? null,
                descPlain,
                rounds: Math.max(0, Math.floor(Number(roundsInput.value) || 0)),
                color: colorInput.value,
                imageUrl,
                // 换scope 时快照跟着搬；否则保留原来的
                snapshot: entry?.snapshot,
                updatedAt: Date.now(),
            });
            void OBR.notification.show("已保存到素材库", "SUCCESS");
            onDone();
        })();
    });

    const cancel = el("button", "btn", "取消");
    cancel.addEventListener("click", onDone);

    actions.appendChild(cancel);
    actions.appendChild(save);

    wrap.appendChild(bindRow);
    wrap.appendChild(bindHint);
    wrap.appendChild(nameInput);
    wrap.appendChild(descInput);
    wrap.appendChild(row);
    wrap.appendChild(scopeSlot);
    wrap.appendChild(actions);

    return wrap;
}

/* ------------------------------------------------------------------ */
/* 卡片                                                                */
/* ------------------------------------------------------------------ */

function buildCard(
    entry: ArchiveEntry,
    onDone: () => void,
    readOnly: boolean,
): HTMLElement {
    const card = el("div", "card");
    const head = el("div", "card-head");

    if (entry.imageUrl) {
        const img = document.createElement("img");
        img.className = "lib-thumb";
        img.src = entry.imageUrl;
        img.alt = entry.name;
        img.title = "点击在画布中定位";
        img.addEventListener("click", (e) => {
            e.stopPropagation();
            void focusInScene(entry.imageUrl);
        });
        head.appendChild(img);
    }

    const swatch = el("span", "swatch");
    if (HEX.test(entry.color)) swatch.style.background = entry.color;
    head.appendChild(swatch);
    head.appendChild(el("span", "item-name", entry.name || "（未命名）"));

    // 作用域徽章：一眼看出这条是私有的还是房间共享的
    head.appendChild(
        el(
            "span",
            "pill muted",
            entry.scope === "scene" ? "房间共享" : "仅自己",
        ),
    );

    const editBtn = el("button", "btn", "编辑");
    const delBtn = el("button", "btn danger", "删除");

    const slot = el("div");
    const isOpen = expandedId === entry.id;

    editBtn.addEventListener("click", () => {
        if (slot.firstChild) {
            slot.innerHTML = "";
            expandedId = null;
            editBtn.textContent = "编辑";
            return;
        }
        expandedId = entry.id;
        editBtn.textContent = "收起";
        slot.appendChild(buildEditor(entry, onDone));
    });

    delBtn.addEventListener("click", () => {
        if (!window.confirm(`从素材库删除「${entry.name || "未命名"}」？`)) return;
        void deleteEntry(entry.id).then(onDone);
    });

    // 玩家只读：不给改。GM 发布的房间预设他们要能看到、能套用，
    // 但编辑/删除/发布是 GM 的职权。
    if (!readOnly) {
        head.appendChild(editBtn);
        head.appendChild(delBtn);
    }
    card.appendChild(head);

    if (entry.descPlain) {
        card.appendChild(el("div", "item-text", entry.descPlain));
    }

    const foot = el("div", "item-foot");
    foot.appendChild(
        el(
            "span",
            `pill${entry.rounds > 0 ? "" : " muted"}`,
            entry.rounds > 0 ? `默认 ${entry.rounds} 轮` : "持续不限",
        ),
    );
    foot.appendChild(
        el("span", "pill muted", entry.imageUrl ? "含图标" : "仅文字"),
    );
    card.appendChild(foot);

    // --- 快速操作：套用到选中 ---
    const applyBtn = el("button", "btn primary", "套用到选中");
    applyBtn.title = "把这条素材套用到当前选中的物件上：带图标的贴纸会贴到角色/物件上；纯文字状态仅支持 ATTACHMENT 层物件";
    applyBtn.addEventListener("click", () => {
        void (async () => {
            const ids = (await OBR.player.getSelection()) ?? [];
            if (ids.length === 0) {
                void OBR.notification.show("请先在画布上选中目标", "WARNING");
                return;
            }
const r = await applyEntry(entry, ids);
            const done = r.created + r.reused + r.written;
            void OBR.notification.show(
                r.failed > 0
                    ? `已套用 ${done}/${ids.length} 个（${r.failed} 个失败）`
                    : `已套用到 ${done} 个目标`,
                r.failed > 0 ? "WARNING" : "SUCCESS",
            );
            onDone();
        })();
    });

    // --- 快速操作：存到房间/ 转为私有 ---
    const scopeBtn = el(
        "button",
        "btn",
        entry.scope === "scene" ? "转为私有" : "发布到房间",
    );
    scopeBtn.title =
        entry.scope === "scene"
            ? "从房间共享里移除，只有自己看得见"
            : "发布到场景数据，房间内所有人可见并可套用";
    scopeBtn.addEventListener("click", () => {
        void moveScope(entry.id, entry.scope === "scene" ? "local" : "scene").then(
            onDone,
        );
    });

    const actions = el("div", "tpl-row");
    actions.appendChild(applyBtn);
    if (!readOnly) {
        actions.appendChild(scopeBtn);
    }
    card.appendChild(actions);

    card.appendChild(slot);
    if (isOpen) {
        slot.appendChild(buildEditor(entry, onDone));
        editBtn.textContent = "收起";
    }
    return card;
}

/** 在画布中选中并聚焦该图片对应的物件 */
async function focusInScene(url: string): Promise<void> {
    const items = await OBR.scene.items.getItems(
        (i) => i.type === "IMAGE" && (i as { image?: { url?: string } }).image?.url === url,
    );
    if (items.length === 0) {
        void OBR.notification.show("画布中没有使用该图片的物件", "WARNING");
        return;
    }
    const ids = items.map((i) => i.id);
    const bounds = await OBR.scene.items.getItemBounds(ids);
    await Promise.all([
        OBR.player.select(ids),
        OBR.viewport.animateToBounds(bounds),
    ]);
}

/* ------------------------------------------------------------------ */
/* 主渲染                                                              */
/* ------------------------------------------------------------------ */

/**
 * 渲染素材库面板。
 *
 * 列表上方带筛选 / 搜索条：搜索框匹配名称与规则文本，
 * 颜色 chips 按条目的配色筛选——固定列出编辑模态框那 9 个预设色，
 * 库里有预设外的自选色时按条数追加在后。筛选状态跨重画保持。
 *
 * @param readOnly 玩家端传 true：能看、能套用 GM 发布的房间预设，
 *                 但收存 / 新建 / 编辑 / 删除 / 发布 / 导入导出全部隐藏。
 */
export async function renderArchivePanel(
    panel: HTMLDivElement,
    footerCount: HTMLSpanElement,
    readOnly = false,
): Promise<void> {
    await reload();
    panel.innerHTML = "";

    const localCount = entries.filter((e) => e.scope === "local").length;
    const sceneCount = entries.length - localCount;
    footerCount.textContent = readOnly
        ? `房间预设 ${sceneCount} 条`
        : `素材 ${entries.length} 条（房间 ${sceneCount} · 私有 ${localCount}）`;

    // --- 从画布收存 ---
    const saveBtn = el("button", "btn primary lib-add", "＋ 把选中物件存为素材");
    saveBtn.title =
        "读取画布上当前选中的物件（含它已填好的状态），存进素材库以便复用。";
    saveBtn.addEventListener("click", () => {
        void (async () => {
            try {
                const ids = (await OBR.player.getSelection()) ?? [];
                if (ids.length === 0) {
                    void OBR.notification.show("请先在画布上选中一个物件", "WARNING");
                    return;
                }
                const items: Item[] = await OBR.scene.items.getItems(ids);
                let saved = 0;
                for (const item of items) {
                    const attachments = (
                        await OBR.scene.items.getItemAttachments([item.id])
                    ).filter((a) => a.id !== item.id);
                    const e = await captureFromItem(item, "local", attachments);
                    if (e) saved++;
                }
                void OBR.notification.show(
                    saved > 0 ? `已存入 ${saved} 条素材` : "选中的物件没有图片地址",
                    saved > 0 ? "SUCCESS" : "WARNING",
                );
                await renderArchivePanel(panel, footerCount, readOnly);
            } catch (err) {
                void OBR.notification.show(
                    `存入失败：${err instanceof Error ? err.message : String(err)}`,
                    "ERROR",
                );
            }
        })();
    });
    if (!readOnly) panel.appendChild(saveBtn);

    // --- 新建纯文字条目 ---
    let editorOpen = false;
    const editorSlot = el("div");
    const addBtn = el("button", "btn lib-add", "＋ 新建文字预设");
    addBtn.addEventListener("click", () => {
        if (editorOpen) return;
        editorOpen = true;
        addBtn.style.display = "none";
        editorSlot.innerHTML = "";
        editorSlot.appendChild(
            buildEditor(null, () => {
                editorOpen = false;
                addBtn.style.display = "";
                editorSlot.innerHTML = "";
                void renderArchivePanel(panel, footerCount, readOnly);
            }),
        );
        panel.insertBefore(editorSlot, addBtn.nextSibling);
    });
    if (!readOnly) {
        panel.appendChild(addBtn);
        panel.appendChild(editorSlot);
    }

    // --- 导入导出 ---
    const io = el("div", "lib-io");

    const exportBtn = el("button", "btn", "导出");
    exportBtn.title = "把全部素材（房间 + 私有）导出为 JSON 文件";
    exportBtn.addEventListener("click", () => {
        void (async () => {
            const json = await exportJson();
            const stamp = new Date().toISOString().slice(0, 10);
            downloadJson(`状态描述-素材库-${stamp}.json`, json);
        })();
    });

    const importBtn = el("button", "btn", "导入");
    importBtn.title = "从 JSON 文件导入素材";
    importBtn.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.addEventListener("change", () => {
            const file = input.files?.[0];
            if (!file) return;
            void (async () => {
                try {
                    const text = await file.text();
                    const r = await importJson(text);
                    void OBR.notification.show(
                        `导入完成：新增 ${r.added}，覆盖 ${r.updated}`,
                        "SUCCESS",
                    );
                    await renderArchivePanel(panel, footerCount);
                } catch (e) {
                    void OBR.notification.show(
                        `导入失败：${e instanceof Error ? e.message : String(e)}`,
                        "ERROR",
                    );
                }
            })();
        });
        input.click();
    });

    io.appendChild(exportBtn);
    io.appendChild(importBtn);
    if (!readOnly) panel.appendChild(io);

    // --- 条目列表 ---
    if (entries.length === 0) {
        panel.appendChild(
            el("div", "hint", readOnly ? "GM 还没有发布房间预设。" : "素材库还是空的。"),
        );
        return;
    }

    const onDone = (): void => {
        expandedId = null;
        void renderArchivePanel(panel, footerCount, readOnly);
    };

    // 玩家只看得到房间共享的条目（本地私有条目在他们机器上本来就不存在，
    // 但若同一浏览器既是 GM 又切到玩家视角，也不该把私有素材暴露出去）
    const visible = readOnly ? entries.filter((e) => e.scope === "scene") : entries;

    /* ---------------- 筛选 / 搜索条 ---------------- */

    // 统计每种颜色的条数（tooltip 与追加自选色用）
    const colorCounts = new Map<string, number>();
    for (const e of visible) {
        if (!HEX.test(e.color)) continue;
        const c = e.color.toLowerCase();
        colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
    }
    // 色板 = 固定的 9 个预设色（与编辑模态框同一份，用户熟悉的那套）；
    // 库里有预设之外的自选色时，按条数多少追加在后面，否则自选色永远筛不到
    const presetSet = new Set(PRESET_COLORS);
    const extras = [...colorCounts.keys()]
        .filter((c) => !presetSet.has(c))
        .sort((a, b) => (colorCounts.get(b) ?? 0) - (colorCounts.get(a) ?? 0) || a.localeCompare(b));
    const palette = [...PRESET_COLORS, ...extras];
    // 自愈：选中的颜色已不在色板上（自选色条目被删完）就复位到「全部」。
    // 预设色固定显示，条数归零也保留色点，不触发复位。
    if (filterColor !== null && !palette.includes(filterColor)) filterColor = null;

    const chipRefs: { el: HTMLButtonElement; color: string | null }[] = [];
    const listBox = el("div");
    const countLabel = el("div", "lib-filter-count");

    const matches = (e: ArchiveEntry): boolean => {
        if (filterColor !== null && e.color.toLowerCase() !== filterColor) {
            return false;
        }
        const q = filterText.trim().toLowerCase();
        if (!q) return true;
        return (
            e.name.toLowerCase().includes(q) ||
            e.descPlain.toLowerCase().includes(q)
        );
    };

    // 只重画列表区：搜索框正在输入，整面板重画会把焦点抢掉
    const paintList = (): void => {
        const matched = visible.filter(matches);
        listBox.innerHTML = "";
        for (const entry of matched) {
            listBox.appendChild(buildCard(entry, onDone, readOnly));
        }
        const filtering = filterColor !== null || filterText.trim().length > 0;
        countLabel.textContent = filtering
            ? `匹配 ${matched.length} / ${visible.length} 条`
            : `共 ${visible.length} 条`;
        if (matched.length === 0) {
            const empty = el("div", "hint", "没有匹配的素材");
            const reset = el("button", "btn", "清除筛选");
            reset.style.marginTop = "10px";
            reset.addEventListener("click", () => {
                filterText = "";
                filterColor = null;
                void renderArchivePanel(panel, footerCount, readOnly);
            });
            empty.appendChild(reset);
            listBox.appendChild(empty);
        }
    };

    const filterBar = el("div", "lib-filter");

    const searchInput = el("input") as HTMLInputElement;
    searchInput.type = "text";
    searchInput.className = "lib-search";
    searchInput.placeholder = "搜索名称或规则文本…";
    searchInput.value = filterText;
    searchInput.addEventListener("input", () => {
        filterText = searchInput.value;
        paintList();
    });

    const chipsRow = el("div", "lib-chips");
    const addChip = (
        color: string | null,
        dot: string | null,
        label: string,
        title: string,
    ): void => {
        const chip = el("button", "chip") as HTMLButtonElement;
        chip.type = "button";
        if (dot) {
            const d = el("span", "dot");
            d.style.background = dot;
            chip.appendChild(d);
        } else {
            chip.textContent = label;
        }
        chip.title = title;
        chip.classList.toggle("on", filterColor === color);
        chip.addEventListener("click", () => {
            filterColor = color;
            for (const c of chipRefs) {
                c.el.classList.toggle("on", c.color === color);
            }
            paintList();
        });
        chipRefs.push({ el: chip, color });
        chipsRow.appendChild(chip);
    };

    addChip(null, null, "全部", "显示全部素材");
    for (const color of palette) {
        addChip(color, color, "", `${color} · ${colorCounts.get(color) ?? 0} 条`);
    }

    filterBar.appendChild(searchInput);
    filterBar.appendChild(chipsRow);
    filterBar.appendChild(countLabel);
    panel.appendChild(filterBar);
    panel.appendChild(listBox);

    paintList();
}

/** 供 action.ts 在外部改动后强制重载 */
export function invalidateArchiveCache(): void {
    expandedId = null;
}