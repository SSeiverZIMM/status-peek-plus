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
    persistedTokenGetLastModified,
    persistedTokenGetName,
    persistedTokenKey,
    PERSISTED_PROPERTIES,
    type PersistedProperty,
    type PersistedToken,
    type PersistenceType,
} from "../persist/model";
import {
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
import type { Item } from "@owlbear-rodeo/sdk";

let query = "";
let expandedKey: string | null = null;
let settingsOpen = false;
let bound = false;

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

    const tokens = getTokens();
    const totalBytes = tokens.reduce((s, t) => s + estimateBytes(t), 0);

    footerCount.textContent = `${formatSize(totalBytes)} / 5 MB`;

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
        renderList(list, tokens, selected);
    });
    bar.appendChild(search);

    const usage = el("span", undefined, `${tokens.length} 项`);
    usage.id = "usage";
    bar.appendChild(usage);

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

    // --- 列表容器 ---
    const list = el("div");
    list.id = "tpl-list";
    panel.appendChild(list);

    renderList(list, tokens, selected);

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
/* 列表                                                                */
/* ------------------------------------------------------------------ */

function renderList(
    list: HTMLElement,
    tokens: readonly PersistedToken[],
    selected: readonly Item[],
): void {
    list.innerHTML = "";

    if (tokens.length === 0) {
        const empty = el("div", "hint");
        empty.innerHTML =
            "<b>还没有保存的存档</b><br/>" +
            "在「附件描述」页选中物件后，<br/>点卡片上的「存档」按钮即可。";
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
        list.appendChild(buildCard(pt, selected));
    }
}

function buildCard(pt: PersistedToken, selected: readonly Item[]): HTMLElement {
    const key = persistedTokenKey(pt);
    const name = persistedTokenGetName(pt);
    const isOpen = expandedKey === key;

    const card = el("div", "card");

    // --- 头部 ---
    const head = el("div", "tpl-head");

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

    const meta = el("div", "tpl-meta");
    meta.appendChild(el("div", "tpl-name", name));
    const sub = el("div", "tpl-sub");
    const typeLabel = pt.type === "UNIQUE" ? "唯一" : "模板";
    const size = formatSize(estimateBytes(pt));
    sub.textContent = `${typeLabel} · ${size}`;
    meta.appendChild(sub);
    head.appendChild(meta);

    const inScene = isKeyInScene(key, selected);
    const badge = el(
        "span",
        "tpl-sub",
        inScene ? "场景中" : "",
    );
    if (inScene) {
        head.appendChild(badge);
    }

    head.addEventListener("click", () => {
        expandedKey = isOpen ? null : key;
        const parent = card.parentElement;
        if (parent) {
            const panel = document.getElementById("panel") as HTMLDivElement;
            const count = document.getElementById("count") as HTMLSpanElement;
            renderTemplatePanel(panel, count, selected);
        }
    });

    card.appendChild(head);

    // --- 展开区 ---
    const body = el("div", `tpl-body${isOpen ? " open" : ""}`);

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
    if (pt.type === "UNIQUE" && (countInScene(key, selected) ?? 0) > 1) {
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
