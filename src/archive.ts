/**
 * 统一素材库（存档 + 状态预设，同一份模型）
 *
 * 【为什么合并】
 * 之前是两块东西：
 *   -「状态库」= 状态的定义（名字/文本/轮数/配色），存场景数据，房间共享
 *   - 「图片存档」= 某张图的物件快照，存浏览器本地，仅自己可见
 * 用起来要「先在状态库建预设→ 再套用→ 想复用还得手动存档」，
 * 三步才能把一个状态放到图上，且两边字段各管一半、没有一条记录是完整的。
 *
 * 现在一条`ArchiveEntry` 同时具备：
 *   - 状态定义（名字 / 规则文本 / 轮数 / 配色）
 *   - 可选图标（imageUrl）
 *   - 可选的物件快照（子物件与相对位置）
 * 「套用」和「存档」都是对同一份数据的读写，不再是两个概念。
 *
 * 【每条自己选存哪里】
 * 用户要求逐条可选，所以每条带一个 `scope`：
 *   - `"local"`  → 浏览器 localStorage，只有自己看得见（私有素材）
 *   - `"scene"`  → 场景 metadata，房间内所有人可见（公共预设）
 * 两种 scope 各自维护一份完整列表，读的时候合并、按 id 区分。
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
    ARCHIVE_VERSION,
    LIBRARY_VERSION,
    MAX_NAME_LENGTH,
    MAX_TEXT_LENGTH,
    SCENE_LIBRARY_KEY,
    STORAGE_KEY,
    readPeek,
    type ArchiveEntry,
    type ArchiveScope,
} from "./shared";
import { processAttachments, restoreAttachments } from "./persist/attachments";

export type { ArchiveEntry, ArchiveScope };

/* ------------------------------------------------------------------ */
/* 校验与读整份                                                        */
/* ------------------------------------------------------------------ */

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 生成一个短且不易撞的 id */
export function newId(): string {
    const rand = Math.random().toString(36).slice(2, 8);
    return `s_${Date.now().toString(36)}_${rand}`;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * 校验并补齐一条记录，损坏数据直接丢弃。
 *
 * 【为什么校验这么严】
 * 素材库的数据可能来自三个方向：用户手改的 JSON、跨房间同步来的场景数据、
 * 以及旧版本遗留的存档格式。任何一处脏数据都不该让整个面板打不开。
 */
export function sanitizeEntry(raw: unknown): ArchiveEntry | null {
    if (!isObject(raw)) return null;

    const id = typeof raw.id === "string" ? raw.id : "";
    const name = typeof raw.name === "string" ? raw.name : "";
    // scope：导入的旧格式可能没有，一律按「私有」收下，
    // 由用户在面板里再决定是否发布到房间。
    const scope: ArchiveScope = raw.scope === "scene" ? "scene" : "local";
    if (!id) return null;

    const roundRaw = Number(raw.rounds);
    const imageUrl = typeof raw.imageUrl === "string" ? raw.imageUrl : "";

    // snapshot：只挑认识的字段，缺的一律补默认值。
    // 直接信任原始对象会把 Record<string,unknown> 灌进类型里，
    // 后面读 snapshot.position 时全是不安全的 unknown。
    let snapshot: ArchiveEntry["snapshot"];
    if (isObject(raw.snapshot)) {
        const s = raw.snapshot;
        const pos = isObject(s.position) ? s.position : {};
        // 绑定图标的图片内容（含尺寸与 MIME）——套用贴图时必需
        const img = isObject(s.image) ? s.image : {};
        snapshot = {
            layer: typeof s.layer === "string" ? s.layer : "ATTACHMENT",
            zIndex: typeof s.zIndex === "number" ? s.zIndex : undefined,
            position: {
                x: typeof pos.x === "number" ? pos.x : 0,
                y: typeof pos.y === "number" ? pos.y : 0,
            },
            name: typeof s.name === "string" ? s.name : "",
            image:
                typeof img.url === "string" && img.url
                    ? {
                          url: img.url,
                          width: typeof img.width === "number" ? img.width : 0,
                          height:
                              typeof img.height === "number" ? img.height : 0,
                          mime:
                              typeof img.mime === "string"
                                  ? img.mime
                                  : "image/png",
                      }
                    : undefined,
            grid: isObject(s.grid)
                ? {
                      offset: isObject(s.grid.offset)
                          ? {
                                x: typeof s.grid.offset.x === "number"
                                    ? s.grid.offset.x
                                    : 0,
                                y: typeof s.grid.offset.y === "number"
                                    ? s.grid.offset.y
                                    : 0,
                            }
                          : { x: 0, y: 0 },
                      dpi: typeof s.grid.dpi === "number" ? s.grid.dpi : 1,
                  }
                : undefined,
            scale: isObject(s.scale)
                ? {
                      x: typeof s.scale.x === "number" ? s.scale.x : 1,
                      y: typeof s.scale.y === "number" ? s.scale.y : 1,
                  }
                : undefined,
            attachments: s.attachments ?? [],
            lastModified:
                typeof s.lastModified === "string"
                    ? s.lastModified
                    : new Date().toISOString(),
        };
    }

    return {
        id,
        scope,
        name,
        desc: raw.desc ?? null,
        descPlain: typeof raw.descPlain === "string" ? raw.descPlain : "",
        rounds: Number.isFinite(roundRaw)
            ? Math.max(0, Math.floor(roundRaw))
            : 0,
        color:
            typeof raw.color === "string" && HEX.test(raw.color)
                ? raw.color
                : "#888780",
        imageUrl,
        snapshot,
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    };
}

export function sanitizeList(raw: unknown): ArchiveEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: ArchiveEntry[] = [];
    for (const e of raw) {
        const s = sanitizeEntry(e);
        if (s) out.push(s);
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* 本地（localStorage）                                                 */
/* ------------------------------------------------------------------ */

/**
 * 旧版（v0.x / v1.x）的 localStorage 键。
 *
 * 旧结构：`{ contextMenuEnabled, tokens: [{ type, token: { id, name, metadata, image: { url }, lastModified } }] }`
 * 转换逻辑与「导入老版导出 JSON」共用 convertLegacyEntry —— 本来就是同一种数据，
 * 没必要写两遍。
 */
const LEGACY_KEY = "com.desain.persistence/localStorage";

/**
 * 一次性迁移旧版存档。
 *
 * 只搬「本地」部分：旧版的场景级状态库本来就存在 scene metadata 里，
 * 键名与新版一致（`status-peek/library`），无需处理。
 * 搬完即删旧键，避免每次启动都重复合并。
 */
function migrateLegacy(): void {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(LEGACY_KEY);
    } catch {
        return;
    }
    if (!raw) return;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // 旧数据本身已损坏：没有迁移价值，直接清掉
        try {
            localStorage.removeItem(LEGACY_KEY);
        } catch {
            /* 忽略 */
        }
        return;
    }

    const tokens = isObject(parsed) && Array.isArray(parsed.tokens) ? parsed.tokens : [];
    const migrated: ArchiveEntry[] = [];
    for (const t of tokens) {
        const e = convertLegacyEntry(t);
        if (e) migrated.push(e);
    }

    if (migrated.length > 0) {
        // 直接读新键当前内容合并（不能再走 loadLocalFresh，会递归回来）
        let current: ArchiveEntry[] = [];
        try {
            const rawNew = localStorage.getItem(STORAGE_KEY);
            if (rawNew) {
                const parsedNew: unknown = JSON.parse(rawNew);
                current = sanitizeList(
                    isObject(parsedNew) ? parsedNew.entries : parsedNew,
                );
            }
        } catch {
            current = [];
        }
        const have = new Set(current.map((e) => e.id));
        const merged = [...current];
        for (const e of migrated) {
            if (!have.has(e.id)) merged.push(e);
        }
        saveLocal(merged);
        console.log(`[状态描述] 已从旧版存档迁移 ${migrated.length} 条素材`);
    }

    try {
        localStorage.removeItem(LEGACY_KEY);
    } catch {
        /* 忽略：下次启动会再试 */
    }
}

/**
 * 本地列表的内存副本。
 *
 * 【为什么每次写前都要重读】
 * action / background 各自跑在独立 iframe 里，各持一份内存副本。
 * 若基于旧副本做全量写回，后写的会把先写的整个覆盖掉 ——
 * 表现就是「有时能保存有时不能」「存了过一会儿又没了」。
 * 所以所有写操作都必须先从磁盘重新载入。
 */
let localCache: ArchiveEntry[] = [];
let loaded = false;

/**
 * 强制从磁盘重读本地列表。
 *
 * 【为什么写操作必须用这个而不是 loadLocal】
 * action / background 各自跑在独立 iframe 里，各持一份内存副本。
 * 若基于旧副本做全量写回，后写的会把先写的整个覆盖掉 ——
 * 表现就是「有时能保存有时不能」「存了过一会儿又没了」。
 * 所以所有写操作都必须先从磁盘重新载入。
 */
function loadLocalFresh(): ArchiveEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed: unknown = JSON.parse(raw);
            // 新版是 { entries: [] }；旧版是裸数组，两种都认
            localCache = sanitizeList(
                isObject(parsed) ? parsed.entries : parsed,
            );
        } else {
            localCache = [];
        }
    } catch (e) {
        console.warn("[状态描述] 读取本地素材库失败，已重置", e);
        localCache = [];
    }
    // 旧版存档搬迁：幂等靠「旧键存在与否」判断（搬完即删），
    // 没有旧键时这一步只是一次 getItem，开销可忽略。
    migrateLegacy();
    loaded = true;
    return localCache;
}

function loadLocal(): ArchiveEntry[] {
    return loaded ? localCache : loadLocalFresh();
}

function saveLocal(entries: readonly ArchiveEntry[]): void {
    localCache = [...entries];
    loaded = true;
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: ARCHIVE_VERSION, entries: localCache }),
        );
    } catch (e) {
        console.warn("[状态描述] 写入本地素材库失败（可能超出容量）", e);
    }
}

// 其他 iframe 写入后，同步本 iframe 的副本
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
            loaded = false;
            loadLocal();
        }
    });
}

/* ------------------------------------------------------------------ */
/* 场景（scene metadata）                                               */
/* ------------------------------------------------------------------ */

async function loadScene(): Promise<ArchiveEntry[]> {
    try {
        const meta = await OBR.scene.getMetadata();
        const raw = meta[SCENE_LIBRARY_KEY];
        if (!isObject(raw)) return [];
        return sanitizeList(raw.entries);
    } catch {
        return [];
    }
}

/**
 * 写场景列表。
 *
 * 【只改自己那一个键】
 * setMetadata 是按 key 合并写入的，但这里仍显式只传 SCENE_LIBRARY_KEY，
 * 避免任何情况下误改房间内其他扩展（如先攻的 combat 键）的数据。
 */
async function saveScene(entries: readonly ArchiveEntry[]): Promise<void> {
    await OBR.scene.setMetadata({
        [SCENE_LIBRARY_KEY]: {
            version: LIBRARY_VERSION,
            entries: [...entries],
        },
    });
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

/** 读某一scope 的全量列表 */
export async function listByScope(scope: ArchiveScope): Promise<ArchiveEntry[]> {
    return scope === "local" ? loadLocal() : loadScene();
}

/**
 * 读全部条目（两种 scope 合并）。
 *
 * 排序：先按更新时间倒序（同一次操作内的条目聚在一起），新的在前。
 */
export async function listAll(): Promise<ArchiveEntry[]> {
    const [local, scene] = await Promise.all([loadLocal(), loadScene()]);
    return [...local, ...scene].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 同 listAll，但本地部分强制重读磁盘（含旧版存档迁移检查）。
 *
 * 导入前的「已有哪些条目」统计要用这个：同一 iframe 里先前的读写
 * 可能让缓存比磁盘旧，按缓存统计会把已存在的条目误报成新增。
 */
export async function listAllFresh(): Promise<ArchiveEntry[]> {
    const [local, scene] = await Promise.all([loadLocalFresh(), loadScene()]);
    return [...local, ...scene].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findById(
    id: string,
): Promise<ArchiveEntry | undefined> {
    const all = await listAll();
    return all.find((e) => e.id === id);
}

/**
 * 按图片 URL 找条目。
 *
 * 这是「以后从素材库拖出同一张图，自动恢复状态」的查找依据。
 * 同一张图可能同时有local 与 scene 两条（用户分别建过），
 * 此时**优先 scene**——公共预设应当覆盖私有条目，
 * 否则别人看不到的效果会在自己这儿意外生效。
 *
 * 【为什么这里强制重读磁盘】
 * 唯一调用方是 background iframe 里的 applyToNewItems（拖图自动恢复）。
 * 用户是在 action iframe（右侧栏）里维护素材库的，两边各持一份内存副本；
 * 若沿用缓存，background 读到的可能是上次加载时的旧列表，
 * 表现为「刚收存的图，拖出来却不恢复状态」。拖图是低频操作，
 * 多读一次 localStorage 的代价可以忽略，换来确定性。
 */
export async function findByImage(
    imageUrl: string,
): Promise<ArchiveEntry | undefined> {
    const all = await listAllFresh();
    const hits = all.filter((e) => e.imageUrl === imageUrl);
    return hits.find((e) => e.scope === "scene") ?? hits[0];
}

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

/** 新增或按 id 覆盖一条 */
export async function upsertEntry(
    entry: Omit<ArchiveEntry, "updatedAt"> & { updatedAt?: number },
): Promise<ArchiveEntry> {
    const full: ArchiveEntry = {
        ...entry,
        id: entry.id || newId(),
        updatedAt: entry.updatedAt ?? Date.now(),
    };

    // list 只用来判断 id 是否已存在；真正写入前都要重新载入，
    // 否则会把其他 iframe 刚写进去的条目覆盖掉。
    if (full.scope === "local") {
        const cur = loadLocalFresh();
        const i = cur.findIndex((e) => e.id === full.id);
        if (i >= 0) cur[i] = full;
        else cur.push(full);
        saveLocal(cur);
    } else {
        const cur = await loadScene();
        const i = cur.findIndex((e) => e.id === full.id);
        if (i >= 0) cur[i] = full;
        else cur.push(full);
        await saveScene(cur);
    }

    return full;
}

export async function deleteEntry(id: string): Promise<void> {
    const local = loadLocalFresh();
    const inLocal = local.some((e) => e.id === id);
    if (inLocal) {
        saveLocal(local.filter((e) => e.id !== id));
        return;
    }
    const scene = await loadScene();
    if (scene.some((e) => e.id === id)) {
        await saveScene(scene.filter((e) => e.id !== id));
    }
}

/**
 * 把一条从 local 改到 scene（或反向）—— 界面上那个「发布到房间」开关。
 *
 * 实现方式是「从旧scope 删掉、在新 scope 加一条」，id 保持不变，
 * 这样已经套用过这条的物件仍能通过 templateId回溯。
 */
export async function moveScope(
    id: string,
    to: ArchiveScope,
): Promise<void> {
    const all = await listAll();
    const entry = all.find((e) => e.id === id);
    if (!entry || entry.scope === to) return;

    await deleteEntry(id);
    await upsertEntry({ ...entry, scope: to, updatedAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* 从画布物件建条目                                                     */
/* ------------------------------------------------------------------ */

/**
 * 把画布上一个现成的物件收进素材库。
 *
 * 这是「存档」在新模型下的含义：不再是一个独立功能，
 * 而是「把这个状态标记存下来，以后好复用」。
 */
export async function captureFromItem(
    item: Item,
    scope: ArchiveScope,
    attachments?: Item[],
): Promise<ArchiveEntry | null> {
    const url = (item as { image?: { url?: string } }).image?.url;
    if (typeof url !== "string" || !url) {
        return null;
    }

    const peek = readPeek(item.metadata);

    const all = await listAll();
    // 同一张图已有条目就更新它，避免图库里出现两张一样的图
    const existing = all.find(
        (e) => e.imageUrl === url && e.scope === scope,
    );

    return upsertEntry({
        // upsertEntry 内部会为空 id 分配新 id
        id: existing?.id ?? "",
        scope,
        name: (peek.name || item.name || "").slice(0, MAX_NAME_LENGTH),
        desc: peek.desc,
        descPlain: peek.descPlain.slice(0, MAX_TEXT_LENGTH),
        rounds: peek.rounds,
        color: peek.color,
        imageUrl: url,
        snapshot: {
            layer: item.layer,
            zIndex: item.zIndex,
            position: item.position,
            name: item.name,
            // 图标完整图片内容（含尺寸与 MIME）：套用贴图时必需，
            // 否则新建的 attachment 缺尺寸会渲染成不可见
            image: (
                item as {
                    image?: {
                        url: string;
                        width: number;
                        height: number;
                        mime: string;
                    };
                }
            ).image,
            grid: (
                item as { grid?: { offset: { x: number; y: number }; dpi: number } }
            ).grid,
            scale: (
                item as { scale?: { x: number; y: number } }
            ).scale,
            // 附件存相对坐标：processAttachments 会减去宿主位置并把
            // attachedTo 换成 ROOT，restoreAttachments 再还原。
            attachments: processAttachmentsSafe(item, attachments),
            lastModified: item.lastModified ?? new Date().toISOString(),
        },
        updatedAt: Date.now(),
    });
}

/** 包一层 try：附件换算失败不该让整个存档失败 */
function processAttachmentsSafe(
    anchor: Item,
    attachments?: Item[],
): unknown {
    if (!attachments || attachments.length === 0) return [];
    try {
        return processAttachments(anchor, attachments) ?? [];
    } catch (e) {
        console.warn("[状态描述] 附件相对坐标换算失败，已跳过附件", e);
        return [];
    }
}

/**
 * 把条目里的附件还原成绝对坐标的物件数组（供 addItems 用）。
 *
 * 没有附件时返回空数组 —— 调用方可以直接展开。
 */
export function restoreSnapshotAttachments(
    entry: ArchiveEntry,
    anchor: { id: string; position: { x: number; y: number }; zIndex: number },
): Item[] {
    const raw = entry.snapshot?.attachments;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    try {
        return restoreAttachments(anchor, raw as Item[]) ?? [];
    } catch (e) {
        console.warn("[状态描述] 附件还原失败", e);
        return [];
    }
}

/* ------------------------------------------------------------------ */
/* JSON 导入导出                                                       */
/* ------------------------------------------------------------------ */

export interface ImportResult {
    added: number;
    updated: number;
}

/**
 * 导出为 JSON 字符串。
 *
 * 带一层信封，方便将来加字段而不破坏旧导入：
 *   { "format": "status-peek-archive", "version": 1, "entries": [...] }
 *
 * 两种 scope 都会导出（导出的是「我这一侧的完整素材库」），
 * 导入时条目自带 scope，因此也能借导入把公共预设拉进本地。
 */
export async function exportJson(): Promise<string> {
    const entries = await listAll();
    return JSON.stringify(
        { format: "status-peek-archive", version: ARCHIVE_VERSION, entries },
        null,
        2,
    );
}

/**
 * 把 v0.x 老版导出条目转换成 ArchiveEntry。
 *
 * 【这是什么格式】
 * 最早版本的导出（例：`附件描述-模板-2026-10-19.json`）长这样：
 * ```
 * [{ "type": "UNIQUE",
 *    "token": { "id", "name", "layer", "metadata": { "status-peek/text": "…" },
 *               "image": { "url" }, "position", "zIndex", "lastModified" },
 *    "attachments": [] }]
 * ```
 * 与新模型的差异：
 *   - 状态文本在 `metadata["status-peek/text"]`（单一字段，没有 name/rounds/color 拆分）
 *   - 名字在 `token.name`（不在 metadata 里）
 *   - 没有 scope、没有 desc/descPlain 之分、没有轮数概念
 *
 * 新格式条目（没有 token 包裹、没有 status-peek/text）返回 null，
 * 调用方按原值走 sanitizeEntry。
 *
 * v1.x 的 localStorage 存档也走这个函数：那种 metadata 里是新键
 * （name/desc-plain/rounds/color），readPeek 能直接读出来。
 */
export function convertLegacyEntry(raw: unknown): ArchiveEntry | null {
    // 兼容两种包裹：{type, token, attachments} 或裸 token 对象
    const wrapped = isObject(raw) && isObject(raw.token) ? raw.token : raw;
    if (!isObject(wrapped)) return null;

    const id = typeof wrapped.id === "string" ? wrapped.id : "";
    const url =
        isObject(wrapped.image) && typeof wrapped.image.url === "string"
            ? wrapped.image.url
            : "";
    if (!id || !url) return null;

    const meta = isObject(wrapped.metadata)
        ? (wrapped.metadata as Record<string, unknown>)
        : {};
    const peek = readPeek(meta);
    const legacyText =
        typeof meta["status-peek/text"] === "string"
            ? (meta["status-peek/text"] as string)
            : "";

    const name =
        peek.name ||
        (typeof wrapped.name === "string" ? wrapped.name : "");

    return {
        id,
        // 老版没有「发布到房间」的概念，一律按私有收下，由用户自己决定是否发布
        scope: "local",
        name: name.slice(0, MAX_NAME_LENGTH),
        // 老版没有富文本，desc 留空；渲染时 descPlain 会兜底
        desc: null,
        descPlain: (peek.descPlain || legacyText).slice(0, MAX_TEXT_LENGTH),
        rounds: peek.rounds,
        color: peek.color,
        imageUrl: url,
        // 老版附件（若有）坐标语义与新版相对坐标不同，但空数组无影响；
        // 原样收着，比直接丢弃多一分保住的可能
        snapshot:
            isObject(raw) && Array.isArray(raw.attachments)
                ? {
                      layer:
                          typeof wrapped.layer === "string" ? wrapped.layer : "ATTACHMENT",
                      position: isObject(wrapped.position)
                          ? {
                                x:
                                    typeof wrapped.position.x === "number"
                                        ? wrapped.position.x
                                        : 0,
                                y:
                                    typeof wrapped.position.y === "number"
                                        ? wrapped.position.y
                                        : 0,
                            }
                          : { x: 0, y: 0 },
                      name: typeof wrapped.name === "string" ? wrapped.name : "",
                      attachments: raw.attachments,
                      lastModified:
                          typeof wrapped.lastModified === "string"
                              ? wrapped.lastModified
                              : new Date().toISOString(),
                  }
                : undefined,
        updatedAt:
            typeof wrapped.lastModified === "string"
                ? Date.parse(wrapped.lastModified) || 0
                : 0,
    };
}

/**
 * 导入 JSON。
 *
 * 宽容处理，认三种格式：
 *   1. 新版信封  `{ "format": "status-peek-archive", "entries": [...] }`
 *   2. 新版裸数组 / 旧版「状态库」entries 数组（缺字段补默认值）
 *   3. **v0.x 老版导出**（`{type, token, attachments}` 包裹）——自动转换
 * 同一 id 视为覆盖更新；id 缺失的条目会被重新分配 id。
 */
export async function importJson(text: string): Promise<ImportResult> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("不是合法的 JSON");
    }

    let rawEntries: unknown;
    if (Array.isArray(parsed)) {
        rawEntries = parsed;
    } else if (isObject(parsed)) {
        if (
            parsed.format !== undefined &&
            parsed.format !== "status-peek-archive" &&
            parsed.format !== "status-peek-library"
        ) {
            throw new Error(`不是状态描述的素材库文件（format=${String(parsed.format)}）`);
        }
        rawEntries = parsed.entries;
    } else {
        throw new Error("无法识别的文件结构");
    }

    if (!Array.isArray(rawEntries)) {
        throw new Error("缺少 entries 数组");
    }

    // 老版条目先转换；认不出的原样进 sanitizeEntry
    const incoming = sanitizeList(
        rawEntries.map((e) => convertLegacyEntry(e) ?? e),
    );
    if (incoming.length === 0) {
        throw new Error("没有可导入的有效条目");
    }

    const existing = await listAllFresh();
    const byId = new Map(existing.map((e) => [`${e.scope}/${e.id}`, e]));

    let added = 0;
    let updated = 0;

    // 按 scope 分组批量写，避免每条都写一次存储
    const touched: Record<ArchiveScope, ArchiveEntry[]> = {
        local: [],
        scene: [],
    };

    for (const e of incoming) {
        const key = `${e.scope}/${e.id}`;
        if (byId.has(key)) updated++;
        else added++;
        touched[e.scope].push(e);
    }

    for (const scope of ["local", "scene"] as ArchiveScope[]) {
        const batch = touched[scope];
        if (batch.length === 0) continue;

        if (scope === "local") {
            const cur = loadLocalFresh();
            const idx = new Map(cur.map((e, i) => [e.id, i]));
            for (const e of batch) {
                const i = idx.get(e.id);
                if (i === undefined) cur.push(e);
                else cur[i] = e;
            }
            saveLocal(cur);
        } else {
            const cur = await loadScene();
            const idx = new Map(cur.map((e, i) => [e.id, i]));
            for (const e of batch) {
                const i = idx.get(e.id);
                if (i === undefined) cur.push(e);
                else cur[i] = e;
            }
            await saveScene(cur);
        }
    }

    return { added, updated };
}

/** 触发浏览器下载（导出用） */
export function downloadJson(filename: string, content: string): void {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}