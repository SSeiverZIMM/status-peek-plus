/**
 * 持久化存储
 *
 * 改编自 desain/owlbear-persistence (GPL-3.0) 的 src/state/usePlayerStorage.ts
 * 重大改动：去掉 Zustand / immer / React 依赖，改为「localStorage + 内存副本 +
 * 变更回调」的极简模型。因为本插件所有 UI 都是原生 DOM 手动重绘的，
 * 不需要响应式订阅系统。
 */

import type { Item } from "@owlbear-rodeo/sdk";
import { processAttachments } from "./attachments";
import {
    dateLte,
    persistedTokenKey,
    type PersistedToken,
    type PersistenceType,
} from "./model";

/** localStorage 键名（沿用 PT 的命名空间，方便旧数据迁移） */
export const STORAGE_KEY = "com.desain.persistence/localStorage";

/** localStorage 容量上限（浏览器普遍为 5MB） */
export const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

interface StoredShape {
    contextMenuEnabled: boolean;
    tokens: PersistedToken[];
}

let state: StoredShape = {
    contextMenuEnabled: true,
    tokens: [],
};

type Listener = () => void;
const listeners: Listener[] = [];

/** 订阅存储变更。返回取消订阅函数。 */
export function subscribe(fn: Listener): VoidFunction {
    listeners.push(fn);
    return () => {
        const i = listeners.indexOf(fn);
        if (i > -1) {
            listeners.splice(i, 1);
        }
    };
}

function notify() {
    for (const fn of listeners) {
        try {
            fn();
        } catch (e) {
            console.warn("[附件描述] 订阅回调出错", e);
        }
    }
}

/** 从 localStorage 载入。解析失败时重置为空，避免整个面板崩掉。 */
export function load(): void {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return;
        }
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            return;
        }
        const obj = parsed as Record<string, unknown>;
        state = {
            contextMenuEnabled:
                typeof obj.contextMenuEnabled === "boolean"
                    ? obj.contextMenuEnabled
                    : true,
            tokens: Array.isArray(obj.tokens)
                ? (obj.tokens as PersistedToken[])
                : [],
        };
    } catch (e) {
        console.warn("[附件描述] 读取本地存储失败，已重置", e);
        state = { contextMenuEnabled: true, tokens: [] };
    }
}

function save(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("[附件描述] 写入本地存储失败（可能超出容量）", e);
    }
}

/**
 * 写入前先从 localStorage 重新载入。
 *
 * 【为什么必须】本扩展的 action / background 各自运行在独立的 iframe 里，
 * 每个 iframe 都持有一份 `state` 内存副本。若各自基于旧副本做全量写回，
 * 后写的那份会整个覆盖掉先写的 —— 表现就是「有时能保存有时不能」、
 * 「存了但过一会儿没了」。
 *
 * 所有变更操作都必须先调它，保证基于磁盘上的最新数据修改。
 */
function beginWrite(): void {
    load();
}

// 其他 iframe 写入后，同步本 iframe 的副本并重绘 UI。
// （storage 事件只在「其他」同源文档中触发，不会在本文档内自触发）
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
            load();
            notify();
        }
    });
}

/* ------------------------------------------------------------------ */
/* 读取                                                                */
/* ------------------------------------------------------------------ */

export function getTokens(): readonly PersistedToken[] {
    return state.tokens;
}

export function isContextMenuEnabled(): boolean {
    return state.contextMenuEnabled;
}

/** 按 key（图片 URL）查找持久化项 */
export function findByKey(key: string): PersistedToken | undefined {
    return state.tokens.find((t) => persistedTokenKey(t) === key);
}

/** 统计同一图片 URL 在场景中的出现次数（用于 UNIQUE 模式去重判断） */
export function getKeyUsage(items: readonly Item[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const item of items) {
        if (item.type !== "IMAGE") {
            continue;
        }
        const url = (item as { image?: { url?: string } }).image?.url;
        if (typeof url === "string") {
            map.set(url, (map.get(url) ?? 0) + 1);
        }
    }
    return map;
}

/* ------------------------------------------------------------------ */
/* 写入                                                                */
/* ------------------------------------------------------------------ */

export function setContextMenuEnabled(enabled: boolean): void {
    beginWrite();
    state.contextMenuEnabled = enabled;
    save();
    notify();
}

export interface PersistRequest {
    token: Item;
    /**
     * 持久化模式。**默认 UNIQUE（唯一存档）**：物件在场景中的改动会自动回写。
     * 显式传 TEMPLATE 才会用「手动更新」模式。
     */
    type?: PersistenceType;
    attachments?: Item[];
}

/** 保存结果，供 UI 给出明确反馈（避免静默失败） */
export interface PersistResult {
    /** 成功写入的条数 */
    saved: number;
    /** 被跳过的原因（物件名 → 原因） */
    skipped: readonly { name: string; reason: string }[];
}

/**
 * 保存一个或多个物件为持久化项。
 *
 * 行为（v1.1 起，改为「总是成功」）：
 * - 已存在：刷新快照，**保留其原有的模式**（用户在模板页手动设过的模式不被覆盖）
 * - 不存在：新增，模式用请求值，缺省为 **UNIQUE**
 * - 物件没有图片地址：跳过并记入 skipped（由调用方提示用户）
 *
 * 旧版在此处有三个静默失败分支（UNIQUE 跳过 / TEMPLATE→UNIQUE 空转 /
 * 无 image.url 直接 continue），是「有时能保存有时不能」的成因之一。
 */
export function persist(requests: readonly PersistRequest[]): PersistResult {
    beginWrite();

    let saved = 0;
    const skipped: { name: string; reason: string }[] = [];

    for (const { token, type = "UNIQUE", attachments } of requests) {
        const url = (token as { image?: { url?: string } }).image?.url;
        if (typeof url !== "string") {
            skipped.push({
                name: token.name || "未命名物件",
                reason: "不是图片物件（没有图片地址），无法作为存档",
            });
            continue;
        }

        const lastModified = token.lastModified ?? new Date().toISOString();
        const idx = state.tokens.findIndex(
            (t) => persistedTokenKey(t) === url,
        );
        const existing = state.tokens[idx];

        if (existing) {
            state.tokens[idx] = buildPersisted(
                existing,
                token,
                lastModified,
                attachments,
            );
        } else {
            state.tokens.push(
                buildPersisted(
                    { type, disabledProperties: undefined, groups: undefined },
                    token,
                    lastModified,
                    attachments,
                ),
            );
        }
        saved++;
    }

    if (saved > 0) {
        save();
        notify();
    }

    return { saved, skipped };
}

/** 组装一条持久化数据 */
function buildPersisted(
    base: Pick<PersistedToken, "type" | "disabledProperties" | "groups">,
    token: Item,
    lastModified: string,
    attachments?: Item[],
): PersistedToken {
    const snapshot = {
        id: token.id,
        name: token.name,
        type: token.type,
        layer: token.layer,
        metadata: token.metadata,
        image: (token as { image?: unknown }).image ?? { url: "" },
        position: token.position,
        zIndex: token.zIndex,
        lastModified,
    };

    return {
        type: base.type,
        groups: base.groups,
        disabledProperties: base.disabledProperties,
        token: snapshot,
        attachments: processAttachments(token, attachments),
    } as PersistedToken;
}

export function setType(key: string, type: PersistenceType): void {
    beginWrite();
    const t = findByKey(key);
    if (t) {
        (t as { type: PersistenceType }).type = type;
        save();
        notify();
    }
}

export function setName(key: string, name: string): void {
    beginWrite();
    const t = findByKey(key);
    if (t) {
        if ("token" in t) {
            (t.token as { name: string }).name = name;
        } else {
            (t as { name: string }).name = name;
        }
        save();
        notify();
    }
}

export function setDisabledProperties(
    key: string,
    disabledProperties: PersistedToken["disabledProperties"],
): void {
    beginWrite();
    const t = findByKey(key);
    if (t) {
        (t as { disabledProperties?: unknown }).disabledProperties =
            disabledProperties;
        save();
        notify();
    }
}

/** 取消持久化（删除） */
export function removeToken(key: string): void {
    beginWrite();
    const idx = state.tokens.findIndex((t) => persistedTokenKey(t) === key);
    if (idx > -1) {
        state.tokens.splice(idx, 1);
        save();
        notify();
    }
}

/** 导入（合并式，同 key 覆盖） */
export function importTokens(tokens: readonly PersistedToken[]): void {
    beginWrite();
    for (const token of tokens) {
        const key = persistedTokenKey(token);
        const idx = state.tokens.findIndex(
            (t) => persistedTokenKey(t) === key,
        );
        if (idx > -1) {
            state.tokens[idx] = token;
        } else {
            state.tokens.push(token);
        }
    }
    save();
    notify();
}

/* ------------------------------------------------------------------ */
/* 唯一模式自动同步                                                    */
/* ------------------------------------------------------------------ */

interface UpdatableUnique {
    tokenId: string;
    key: string;
    lastModified: string;
}

/**
 * 场景物件变化时调用。
 *
 * 找出「属于某个 UNIQUE 持久化项」的物件链，把最新状态回写到持久化数据里。
 * 若同一图片 URL 在场景中出现多次，则跳过（避免歧义）。
 */
export function syncUniqueTokens(
    items: readonly Item[],
    prevItems: readonly Item[],
): void {
    beginWrite();

    if (state.tokens.length === 0) {
        return;
    }

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const prevMap = new Map(prevItems.map((i) => [i.id, i]));
    const keyUsage = getKeyUsage(items);

    /**
     * 按「图片 URL」聚合待回写项（旧版按 tokenId 聚合）。
     * 同一张图在场景中有多份时，保留最近修改的那份 —— 这样道具图被复用
     * 也不会让自动同步整个停摆。
     */
    const pending = new Map<string, UpdatableUnique>();

    const mark = (u: UpdatableUnique) => {
        const old = pending.get(u.key);
        if (!old || dateLte(old.lastModified, u.lastModified)) {
            pending.set(u.key, { ...u });
        }
    };

    /** 沿 attachedTo 链向上走，找出所有 UNIQUE 持久化的祖先 */
    const walkUniqueAncestors = function* (
        startId: string,
        lastModified: string,
    ): Generator<UpdatableUnique> {
        const visited = new Set<string>();
        let cur = itemMap.get(startId);
        while (cur && !visited.has(cur.id)) {
            visited.add(cur.id);
            if (cur.type === "IMAGE") {
                const url = (cur as { image?: { url?: string } }).image?.url;
                if (typeof url === "string") {
                    const pt = findByKey(url);
                    if (pt && pt.type === "UNIQUE") {
                        yield {
                            tokenId: cur.id,
                            key: url,
                            lastModified,
                        };
                    }
                }
            }
            cur = cur.attachedTo ? itemMap.get(cur.attachedTo) : undefined;
        }
    };

    // 新增或变更的物件 → 标记其 UNIQUE 祖先需要回写
    for (const item of items) {
        const prev = prevMap.get(item.id);
        const lm = item.lastModified ?? new Date().toISOString();
        if (prev && dateLte(lm, prev.lastModified ?? lm)) {
            continue;
        }
        for (const u of walkUniqueAncestors(item.id, lm)) {
            // 新物件还没拿到最终 metadata，跳过自身
            if (!prev && u.tokenId === item.id) {
                continue;
            }
            mark(u);
        }
    }

    // 被删除的物件 → 其 UNIQUE 祖先也需要回写（附件少了）
    for (const item of prevItems) {
        if (itemMap.has(item.id)) {
            continue;
        }
        for (const u of walkUniqueAncestors(item.id, new Date().toISOString())) {
            mark(u);
        }
    }

    let changed = false;
    for (const u of pending.values()) {
        const usage = keyUsage.get(u.key) ?? 0;
        if (usage > 1) {
            console.warn(
                `[附件描述] 「${u.key}」在场景中有 ${usage} 个实例，按最近修改的那个回写`,
            );
        }

        const live = itemMap.get(u.tokenId);
        const pt = findByKey(u.key);
        if (!live || !pt) {
            continue;
        }

        // 取该物件的全部附件（含挂链上游）
        const attachments = collectAttachments(items, live);
        const idx = state.tokens.findIndex(
            (t) => persistedTokenKey(t) === u.key,
        );
        if (idx > -1) {
            state.tokens[idx] = buildPersisted(
                pt,
                live,
                u.lastModified,
                attachments,
            );
            changed = true;
        }
    }

    if (changed) {
        save();
        notify();
    }
}

/** 收集挂在某物件下的全部附件（排除物件自身） */
function collectAttachments(
    items: readonly Item[],
    root: Item,
): Item[] {
    const byParent = new Map<string, Item[]>();
    for (const item of items) {
        if (!item.attachedTo) {
            continue;
        }
        const list = byParent.get(item.attachedTo) ?? [];
        list.push(item);
        byParent.set(item.attachedTo, list);
    }

    const out: Item[] = [];
    const queue = [root.id];
    const seen = new Set<string>();
    while (queue.length > 0) {
        const parent = queue.shift()!;
        if (seen.has(parent)) {
            continue;
        }
        seen.add(parent);
        for (const child of byParent.get(parent) ?? []) {
            if (child.id === root.id) {
                continue;
            }
            out.push(child);
            queue.push(child.id);
        }
    }
    return out;
}
