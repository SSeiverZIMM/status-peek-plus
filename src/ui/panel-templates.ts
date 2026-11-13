/**
 * [保存模板] 面板
 *
 * 把 Persistent Tokens 的 Action.tsx / TokenCard.tsx / Settings.tsx
 * 重写为原生 DOM。功能保留：卡片列表、类型切换、属性开关、重命名、
 * 删除、容量显示、导入导出、右键菜单开关。
 * 砍掉：模糊搜索（改为普通子串过滤）、弹窗自适应高度。
 */

import OBR from "@owlbear-rodeo/sdk";
import {
    invertPersistedProperties,
    isPersistedTokenArray,
    isTextStatus,
    persistedTokenFull,
    persistedTokenGetLastModified,
    persistedTokenGetMetadata,
    persistedTokenGetName,
    persistedTokenKey,
    PERSISTED_PROPERTIES,
    type PersistedProperty,
    type PersistedToken,
    type PersistenceType,
} from "../persist/model";
import {
    addTextStatus,
    getTokens,
    importTokens,
    isContextMenuEnabled,
    removeToken,
    setContextMenuEnabled,
    setDisabledProperties,
    setName,
    setType,
    STORAGE_LIMIT_BYTES,
    subscribe,
} from "../persist/store";
import { readPeek, writePeek } from "../shared";
import type { Item } from "@owlbear-rodeo/sdk";

let query = "";
let expandedKey: string | null = null;
let settingsOpen = false;
let creatorOpen = false;
let bound = false;
/** 最近一次渲染时的完整选中项（卡片内重绘时使用） */
let selectedCache: readonly Item[] = [];

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

/** 粗略估算持久化数据占用字节数（UTF-8） */
function estimateBytes(pt: PersistedToken): number {
    try {
        return new TextEncoder().encode(JSON.stringify(pt)).length;
    } catch {
        return 0;
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(d: Date): string {
    try {
        return d.toLocaleString("zh-CN", { hour12: false });
    } catch {
        return String(d);
    }
}

const PROPERTY_LABELS: Record<PersistedProperty, string> = {
    METADATA: "元数据",
    ATTACHMENTS: "附件",
};

const PROPERTY_HINTS: Record<PersistedProperty, string> = {
    METADATA: "物件的自定义数据（含描述文本）",
    ATTACHMENTS: "挂在物件上的子物件（相对位置一起保存）",
};

/* ------------------------------------------------------------------ */
/* 主渲染                                                              */
/* ------------------------------------------------------------------ */

export function renderTemplatePanel(
    panel: HTMLDivElement,
    footerCount: HTMLSpanElement,
    selected: readonly Item[],
): void {
    panel.innerHTML = "";

    selectedCache = selected;

    const tokens = getTokens();
    const totalBytes = tokens.reduce((s, t) => s + estimateBytes(t), 0);

    footerCount.textContent = `${formatSize(totalBytes)} / 5 MB`;

    // 套用目标：贴纸 → CHARACTER 层；纯文字 → ATTACHMENT 层
    const characterSel = selected.filter((i) => i.layer === "CHARACTER");
    const attachmentSel = selected.filter((i) => i.layer === "ATTACHMENT");

    // --- 工具条 ---
    const bar = el("div");
    bar.id = "toolbar";

    const search = el("input") as HTMLInputElement;
    search.id = "search";
    search.type = "text";
    search.placeholder = "搜索模板…";
    search.value = query;
    search.addEventListener("input", () => {
        query = search.value;
        renderList(list, tokens, characterSel, attachmentSel);
    });
    bar.appendChild(search);

    const usage = el("span", undefined, `${tokens.length} 项`);
    usage.id = "usage";
    bar.appendChild(usage);

    const newTextBtn = el("button", "btn", "新建文字状态");
    newTextBtn.title = "只保存一段描述文本（不关联图片），之后可一键套用到选中的附件上";
    newTextBtn.addEventListener("click", () => {
        creatorOpen = !creatorOpen;
        renderCreator(creatorBox);
    });
    bar.appendChild(newTextBtn);

    const dlBtn = el("button", "btn", "导出");
    dlBtn.title = "把全部模板导出为 JSON 文件";
    dlBtn.addEventListener("click", exportJson);
    bar.appendChild(dlBtn);

    const ulBtn = el("button", "btn", "导入");
    ulBtn.title = "从 JSON 文件导入模板";
    ulBtn.addEventListener("click", () => fileInput.click());
    bar.appendChild(ulBtn);

    const setBtn = el("button", "btn", "设置");
    setBtn.addEventListener("click", () => {
        settingsOpen = true;
        renderSettings();
    });
    bar.appendChild(setBtn);

    panel.appendChild(bar);

    // 隐藏的文件输入
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", importJson);
    bar.appendChild(fileInput);

    // --- 纯文字状态创建器 ---
    const creatorBox = el("div");
    creatorBox.id = "creator";
    panel.appendChild(creatorBox);
    renderCreator(creatorBox);

    // --- 列表容器 ---
    const list = el("div");
    list.id = "tpl-list";
    panel.appendChild(list);

    renderList(list, tokens, characterSel, attachmentSel);

    // --- 设置抽屉 ---
    renderSettings();

    // 只绑定一次订阅
    if (!bound) {
        bound = true;
        subscribe(() => {
            // 存储变化时重新渲染整个面板
            const p = document.getElementById("panel") as HTMLDivElement | null;
            const c = document.getElementById("count") as HTMLSpanElement | null;
            if (p && c) {
                renderTemplatePanel(p, c, selected);
            }
        });
    }
}

/* ------------------------------------------------------------------ */
/* 纯文字状态创建器                                                    */
/* ------------------------------------------------------------------ */

function renderCreator(box: HTMLElement): void {
    box.innerHTML = "";
    box.classList.toggle("open", creatorOpen);
    if (!creatorOpen) {
        return;
    }

    const nameInput = el("input") as HTMLInputElement;
    nameInput.placeholder = "状态名称（如：潜行中）";
    nameInput.maxLength = 50;

    const textArea = el("textarea") as HTMLTextAreaElement;
    textArea.placeholder = "描述文本…";
    textArea.maxLength = 4000;
    textArea.rows = 3;

    const row = el("div", "tpl-row");
    const saveBtn = el("button", "btn primary", "保存");
    saveBtn.addEventListener("click", () => {
        const name = nameInput.value.trim();
        const text = textArea.value.trim();
        if (!name) {
            void OBR.notification.show("请填写状态名称", "WARNING");
            return;
        }
        if (!text) {
            void OBR.notification.show("请填写描述文本", "WARNING");
            return;
        }
        addTextStatus(name, text);
        creatorOpen = false;
        renderCreator(box);
        void OBR.notification.show(`已保存文字状态「${name}」`, "SUCCESS");
    });
    const cancelBtn = el("button", "btn", "取消");
    cancelBtn.addEventListener("click", () => {
        creatorOpen = false;
        renderCreator(box);
    });
    row.append(saveBtn, cancelBtn);

    box.append(nameInput, textArea, row);
}

/* ------------------------------------------------------------------ */
/* 列表                                                                */
/* ------------------------------------------------------------------ */

function renderList(
    list: HTMLElement,
    tokens: readonly PersistedToken[],
    characterSel: readonly Item[],
    attachmentSel: readonly Item[],
): void {
    list.innerHTML = "";

    if (tokens.length === 0) {
        const empty = el("div", "hint");
        empty.innerHTML =
            "<b>还没有保存的存档</b><br/>" +
            "在「附件描述」页选中物件后，<br/>点卡片上的「存档」按钮即可。<br/>" +
            "也可以用上方「新建文字状态」创建纯文字状态。";
        list.appendChild(empty);
        return;
    }

    const q = query.trim().toLowerCase();
    const filtered = q
        ? tokens.filter((t) =>
              persistedTokenGetName(t).toLowerCase().includes(q),
          )
        : tokens;

    if (filtered.length === 0) {
        list.appendChild(el("div", "hint", "没有匹配的模板。"));
        return;
    }

    for (const pt of filtered) {
        list.appendChild(buildCard(pt, characterSel, attachmentSel));
    }
}

function buildCard(
    pt: PersistedToken,
    characterSel: readonly Item[],
    attachmentSel: readonly Item[],
): HTMLElement {
    const key = persistedTokenKey(pt);
    const name = persistedTokenGetName(pt);
    const textOnly = isTextStatus(pt);
    const isOpen = expandedKey === key;

    const card = el("div", "card");

    // --- 头部 ---
    const head = el("div", "tpl-head");

    if (textOnly) {
        const thumb = el("div", "tpl-thumb tpl-thumb-text", "📝");
        thumb.title = "纯文字状态";
        head.appendChild(thumb);
    } else {
        const thumb = document.createElement("img");
        thumb.className = "tpl-thumb";
        thumb.src = key;
        thumb.alt = name;
        thumb.title = "点击在画布中定位";
        thumb.addEventListener("click", (e) => {
            e.stopPropagation();
            void focusInScene(key);
        });
        head.appendChild(thumb);
    }

    const meta = el("div", "tpl-meta");
    meta.appendChild(el("div", "tpl-name", name));
    const sub = el("div", "tpl-sub");
    const typeLabel = textOnly
        ? "纯文字状态"
        : pt.type === "UNIQUE"
          ? "唯一"
          : "模板";
    const size = formatSize(estimateBytes(pt));
    sub.textContent = `${typeLabel} · ${size}`;
    meta.appendChild(sub);
    head.appendChild(meta);

    const inScene = !textOnly && isKeyInScene(key, selectedCache);
    const badge = el("span", "tpl-sub", inScene ? "场景中" : "");
    if (inScene) {
        head.appendChild(badge);
    }

    head.addEventListener("click", () => {
        expandedKey = isOpen ? null : key;
        const parent = card.parentElement;
        if (parent) {
            const panel = document.getElementById("panel") as HTMLDivElement;
            const count = document.getElementById("count") as HTMLSpanElement;
            renderTemplatePanel(panel, count, selectedCache);
        }
    });
    card.appendChild(head);

    // --- 展开区 ---
    const body = el("div", `tpl-body${isOpen ? " open" : ""}`);

    // --- 套用按钮（v1.2 核心变更） ---
    const applyRow = el("div", "tpl-row");
    if (textOnly) {
        const applyBtn = el("button", "btn primary", "套用到选中附件");
        const targets = `已选 ${attachmentSel.length} 个附件`;
        applyBtn.title = `把这段描述文本写入选中的 ATTACHMENT 层物件（${targets}）。只写描述，不建立存档绑定——同一状态可以用不同图片表示。`;
        applyBtn.disabled = attachmentSel.length === 0;
        applyBtn.addEventListener("click", () => {
            void applyTextToAttachments(pt, attachmentSel);
        });
        applyRow.append(applyBtn, el("span", "tpl-sub", targets));
    } else {
        const applyBtn = el("button", "btn primary", "贴到选中角色");
        const targets = `已选 ${characterSel.length} 个角色`;
        applyBtn.title = `把这张状态贴纸作为附件贴到选中的角色 token 上（${targets}），描述文本随贴纸一起写入。`;
        applyBtn.disabled = characterSel.length === 0;
        applyBtn.addEventListener("click", () => {
            void applyStickerToCharacters(pt, characterSel);
        });
        applyRow.append(applyBtn, el("span", "tpl-sub", targets));
    }
    body.appendChild(applyRow);

    // 类型切换与属性开关只对贴纸存档有意义
    if (!textOnly) {
        // 类型切换
        const typeRow = el("div", "tpl-row");
        typeRow.appendChild(el("span", "tpl-label", "模式"));
        for (const t of ["UNIQUE", "TEMPLATE"] as PersistenceType[]) {
            const btn = el(
                "button",
                `tpl-toggle${pt.type === t ? " on" : ""}`,
                t === "UNIQUE" ? "唯一（自动同步）" : "模板（手动更新）",
            );
            btn.title =
                t === "UNIQUE"
                    ? "该物件在场景中的改动会自动回写到存档"
                    : "关闭自动同步：只在点「存档」按钮时更新存档数据";
            btn.addEventListener("click", () => {
                setType(key, t);
            });
            typeRow.appendChild(btn);
        }
        body.appendChild(typeRow);

        // 唯一模式的告警
        if (pt.type === "UNIQUE" && (countInScene(key, selectedCache) ?? 0) > 1) {
            const warn = el(
                "div",
                "tpl-warn",
                "场景中有多个使用同一图片的物件，自动同步以「最近修改的那个」为准。",
            );
            body.appendChild(warn);
        }

        // 属性开关
        const propRow = el("div", "tpl-row");
        propRow.appendChild(el("span", "tpl-label", "保存内容"));
        const enabled = invertPersistedProperties(pt.disabledProperties);
        for (const p of PERSISTED_PROPERTIES) {
            const on = enabled.includes(p);
            const btn = el(
                "button",
                `tpl-toggle${on ? " on" : ""}`,
                PROPERTY_LABELS[p],
            );
            btn.title = PROPERTY_HINTS[p];
            btn.addEventListener("click", () => {
                const next = on
                    ? enabled.filter((x) => x !== p)
                    : [...enabled, p];
                setDisabledProperties(key, invertPersistedProperties(next));
            });
            propRow.appendChild(btn);
        }
        body.appendChild(propRow);
    }

    // 【v1.1】原本这里还有个「覆盖为当前状态」按钮，已删除：
    // 存档统一走「附件描述」页卡片上的「存档」按钮，且唯一存档会自动回写，
    // 这个按钮既冗余又会绕过模式设置。
    const actionRow = el("div", "tpl-row");

    const renameBtn = el("button", "btn", "重命名");
    renameBtn.addEventListener("click", () => {
        const next = prompt("新名称：", name);
        if (next && next.length < 50) {
            setName(key, next.trim());
        }
    });
    actionRow.appendChild(renameBtn);

    const delBtn = el("button", "btn danger", "删除");
    delBtn.addEventListener("click", () => {
        if (window.confirm(`删除模板「${name}」？`)) {
            removeToken(key);
        }
    });
    actionRow.appendChild(delBtn);

    body.appendChild(actionRow);

    // 时间戳
    const time = el(
        "div",
        "tpl-note",
        `最后更新：${formatDate(persistedTokenGetLastModified(pt))}`,
    );
    body.appendChild(time);

    card.appendChild(body);
    return card;
}

/** 该图片 URL 是否出现在当前选中项中 */
function isKeyInScene(key: string, selected: readonly Item[]): boolean {
    return selected.some(
        (i) => (i as { image?: { url?: string } }).image?.url === key,
    );
}

function countInScene(key: string, selected: readonly Item[]): number {
    return selected.filter(
        (i) => (i as { image?: { url?: string } }).image?.url === key,
    ).length;
}

/* ------------------------------------------------------------------ */
/* 套用（v1.2 核心逻辑）                                                */
/* ------------------------------------------------------------------ */

/**
 * 纯文字状态 → 写到选中的 ATTACHMENT 物件上。
 *
 * 只写描述 metadata，**不做任何存档绑定**：同一状态允许用不同图片表示，
 * 因此这是「复制文本」而非「关联模板」。
 */
async function applyTextToAttachments(
    pt: PersistedToken,
    attachments: readonly Item[],
): Promise<void> {
    const text = readPeek(persistedTokenGetMetadata(pt)).text;
    if (!text) {
        void OBR.notification.show("该状态没有描述文本", "WARNING");
        return;
    }
    const patch = writePeek(text);
    try {
        await OBR.scene.items.updateItems(
            attachments.map((a) => a.id),
            (drafts) => {
                for (const d of drafts) {
                    Object.assign(d.metadata, patch);
                }
            },
        );
        void OBR.notification.show(
            `已套用「${persistedTokenGetName(pt)}」到 ${attachments.length} 个附件`,
            "SUCCESS",
        );
    } catch (e) {
        void OBR.notification.show(
            `套用失败：${e instanceof Error ? e.message : String(e)}`,
            "ERROR",
        );
    }
}

/**
 * 带图标的贴纸存档 → 作为新附件贴到选中的角色 token 上。
 *
 * 用存档快照里的图片内容（尺寸随原贴纸）新建一个 ATTACHMENT 层物件，
 * 挂到角色上、叠在角色上层，描述文本随 metadata 一起写入。
 */
async function applyStickerToCharacters(
    pt: PersistedToken,
    characters: readonly Item[],
): Promise<void> {
    if (!persistedTokenFull(pt)) {
        void OBR.notification.show(
            "该存档是旧版格式，缺少完整快照，无法贴上",
            "ERROR",
        );
        return;
    }
    const snap = pt.token;
    const img = snap.image as {
        url: string;
        width?: number;
        height?: number;
        mime?: string;
    };
    if (typeof img?.url !== "string" || !img.url) {
        void OBR.notification.show("该存档没有图片，无法贴上", "ERROR");
        return;
    }

    const w = typeof img.width === "number" && img.width > 0 ? img.width : 150;
    const h =
        typeof img.height === "number" && img.height > 0 ? img.height : 150;
    const presetMeta = persistedTokenGetMetadata(pt);

    const created: Item[] = [];
    for (const char of characters) {
        // position 是包围盒左上角：角色中心 = position + 半宽高
        const cw = (char as { width?: number }).width ?? 0;
        const chh = (char as { height?: number }).height ?? 0;
        const centerX = char.position.x + cw / 2;
        const centerY = char.position.y + chh / 2;

        const sticker = {
            id: crypto.randomUUID(),
            type: "IMAGE",
            layer: "ATTACHMENT",
            name: snap.name,
            position: { x: centerX - w / 2, y: centerY - h / 2 },
            width: w,
            height: h,
            scale: { x: 1, y: 1 },
            rotation: 0,
            visible: true,
            locked: false,
            attachedTo: char.id,
            zIndex: (char.zIndex ?? 0) + 1,
            metadata: { ...presetMeta },
            image: {
                url: img.url,
                width: typeof img.width === "number" ? img.width : w,
                height: typeof img.height === "number" ? img.height : h,
                mime: typeof img.mime === "string" ? img.mime : "image/png",
            },
            grid: { offset: { x: 0, y: 0 }, dpi: 1 },
            text: {
                type: "PLAIN",
                plainText: "",
                richText: [],
            },
            textItemType: "IMAGE",
        } as unknown as Item;
        created.push(sticker);
    }

    try {
        await OBR.scene.items.addItems(created);
        void OBR.notification.show(
            `已把「${persistedTokenGetName(pt)}」贴到 ${characters.length} 个角色上`,
            "SUCCESS",
        );
    } catch (e) {
        void OBR.notification.show(
            `贴上失败：${e instanceof Error ? e.message : String(e)}`,
            "ERROR",
        );
    }
}

/** 在画布中选中并聚焦该图片对应的物件 */
async function focusInScene(url: string): Promise<void> {
    const items = await OBR.scene.items.getItems(
        (i) =>
            i.type === "IMAGE" &&
            (i as { image?: { url?: string } }).image?.url === url,
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
/* 导入 / 导出                                                         */
/* ------------------------------------------------------------------ */

function exportJson(): void {
    const data = JSON.stringify(getTokens(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `附件描述-模板-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target?.result;
        try {
            if (typeof text !== "string") {
                throw new Error("无法读取文件内容");
            }
            const parsed: unknown = JSON.parse(text);
            if (!isPersistedTokenArray(parsed) || parsed.length < 1) {
                throw new Error("文件格式不正确，应为模板数组");
            }
            importTokens(parsed);
            void OBR.notification.show(
                `已导入 ${parsed.length} 项模板`,
                "SUCCESS",
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            void OBR.notification.show(`导入失败：${msg}`, "ERROR");
        }
    };
    reader.readAsText(file);
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function renderSettings(): void {
    let box = document.getElementById("settings");
    if (!box) {
        box = el("div");
        box.id = "settings";
        document.body.appendChild(box);
    }
    box.innerHTML = "";
    box.classList.toggle("open", settingsOpen);

    const head = el("div", "set-head");
    const back = el("button", "btn", "返回");
    back.addEventListener("click", () => {
        settingsOpen = false;
        renderSettings();
    });
    head.appendChild(back);
    head.appendChild(el("div", "set-title", "设置"));
    box.appendChild(head);

    const body = el("div", "set-body");

    const item = el("div", "set-item");
    const labelWrap = el("div");
    labelWrap.appendChild(el("div", undefined, "启用右键菜单"));
    labelWrap.appendChild(
        el(
            "div",
            "set-desc",
            "关闭后，画布上右键物件不再出现「附件描述」入口。",
        ),
    );
    item.appendChild(labelWrap);
    const toggle = el(
        "button",
        `tpl-toggle${isContextMenuEnabled() ? " on" : ""}`,
        isContextMenuEnabled() ? "已开启" : "已关闭",
    );
    toggle.addEventListener("click", () => {
        setContextMenuEnabled(!isContextMenuEnabled());
        renderSettings();
    });
    item.appendChild(toggle);
    body.appendChild(item);

    const storageItem = el("div", "set-item");
    const sw = el("div");
    sw.appendChild(el("div", undefined, "存储位置"));
    sw.appendChild(
        el(
            "div",
            "set-desc",
            `浏览器本地存储，上限 ${formatSize(STORAGE_LIMIT_BYTES)}。清除浏览器数据会一并删除，建议定期导出备份。`,
        ),
    );
    storageItem.appendChild(sw);
    body.appendChild(storageItem);

    body.appendChild(
        el(
            "div",
            "tpl-note",
            "\n本扩展仅为 PROP / ATTACHMENT 图层物件提供描述与持久化。\n",
        ),
    );

    box.appendChild(body);
}
