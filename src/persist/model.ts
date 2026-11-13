/**
 * 持久化数据模型
 *
 * 改编自 desain/owlbear-persistence (GPL-3.0) 的 src/state/PersistedToken.ts
 * 改动：去掉 immer / owlbear-utils 依赖，改写成纯函数 + 普通 TS 类型。
 */

import type { Item, Metadata } from "@owlbear-rodeo/sdk";

/** 可持久化的属性。已按需求砍掉 TEXT / DESCRIPTION（桌面物件通常没有这两项）。 */
export const PERSISTED_PROPERTIES = ["METADATA", "ATTACHMENTS"] as const;

export type PersistedProperty = (typeof PERSISTED_PROPERTIES)[number];

export function isPersistedProperty(p: unknown): p is PersistedProperty {
    const all: readonly unknown[] = PERSISTED_PROPERTIES;
    return all.includes(p);
}

/** 已启用的属性 → 被禁用的属性（两者互为补集） */
export function invertPersistedProperties(
    props?: readonly PersistedProperty[],
): PersistedProperty[] {
    return PERSISTED_PROPERTIES.filter((p) => !props?.includes(p));
}

/** 持久化模式：unique = 物件变更自动回写；template = 手动更新模板 */
export type PersistenceType = "TEMPLATE" | "UNIQUE";

export function isPersistenceType(t: unknown): t is PersistenceType {
    return t === "TEMPLATE" || t === "UNIQUE";
}

interface PersistedTokenBase {
    readonly attachments?: Item[];
    /** 不参与恢复的属性。数组而非 Set，为了序列化。 */
    readonly disabledProperties?: PersistedProperty[];
    /** 所属分组。undefined 视为无分组。 */
    readonly groups?: string[];
    readonly type: PersistenceType;
    /**
     * 纯文字状态：只保存描述文本，不关联图片。
     * 套用行为与贴纸存档不同（写到选中的 ATTACHMENT 物件上）。
     */
    readonly textOnly?: boolean;
}

/** 旧版（v1）数据格式，保留兼容读取 */
interface PersistDataV1 {
    readonly name: string;
    readonly metadata: Metadata;
    readonly lastModified: number;
    readonly imageUrl: string;
}

/** 现版（v2）数据格式 */
interface PersistDataV2 {
    readonly token: Readonly<PersistedTokenData>;
}

/** 被持久化的物件快照。只保留我们真正需要的字段。 */
export interface PersistedTokenData {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly layer: string;
    readonly metadata: Metadata;
    readonly image: { url: string };
    readonly position?: { x: number; y: number };
    readonly zIndex?: number;
    readonly lastModified?: string;
    readonly [key: string]: unknown;
}

export type PersistedToken = PersistedTokenBase &
    (PersistDataV1 | PersistDataV2);

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
    return typeof v === "string";
}

function containsImplies(
    o: Record<string, unknown>,
    key: string,
    check: (v: unknown) => boolean,
): boolean {
    return !(key in o) || check(o[key]);
}

/** 校验任意值是否为合法的持久化项 */
export function isPersistedToken(t: unknown): t is PersistedToken {
    if (!isObject(t)) {
        return false;
    }

    const hasBase =
        containsImplies(
            t,
            "attachments",
            (a) => Array.isArray(a),
        ) &&
        containsImplies(
            t,
            "groups",
            (g) => Array.isArray(g) && g.every(isString),
        ) &&
        containsImplies(t, "textOnly", (v) => typeof v === "boolean") &&
        "type" in t &&
        isPersistenceType(t.type);

    if (!hasBase) {
        return false;
    }

    // v2：有 token 字段
    if ("token" in t && isObject(t.token)) {
        const tok = t.token;
        return (
            isString(tok.id) &&
            isString(tok.name) &&
            isObject(tok.metadata) &&
            isObject(tok.image) &&
            isString((tok.image as Record<string, unknown>).url)
        );
    }

    // v1：有 name / metadata / lastModified / imageUrl
    return (
        "name" in t &&
        isString(t.name) &&
        "metadata" in t &&
        isObject(t.metadata) &&
        "lastModified" in t &&
        typeof t.lastModified === "number" &&
        "imageUrl" in t &&
        isString(t.imageUrl)
    );
}

export function isPersistedTokenArray(a: unknown): a is PersistedToken[] {
    return Array.isArray(a) && a.every(isPersistedToken);
}

/** 是否为 v2 格式（带完整 token 快照） */
export function persistedTokenFull(
    pt: PersistedToken,
): pt is PersistedTokenBase & PersistDataV2 {
    return "token" in pt;
}

/** 是否为纯文字状态（只保存描述文本，无图片） */
export function isTextStatus(pt: PersistedToken): boolean {
    return pt.textOnly === true;
}

/** 持久化项的唯一键 —— 统一为图片 URL */
export function persistedTokenKey(pt: PersistedToken): string {
    return persistedTokenFull(pt) ? pt.token.image.url : pt.imageUrl;
}

export function persistedTokenGetName(pt: PersistedToken): string {
    return persistedTokenFull(pt) ? pt.token.name : pt.name;
}

export function persistedTokenSetName(pt: PersistedToken, name: string): void {
    if (persistedTokenFull(pt)) {
        (pt.token as { name: string }).name = name;
    } else {
        (pt as { name: string }).name = name;
    }
}

export function persistedTokenGetMetadata(pt: PersistedToken): Metadata {
    return persistedTokenFull(pt) ? pt.token.metadata : pt.metadata;
}

export function persistedTokenGetLastModified(pt: PersistedToken): Date {
    return persistedTokenFull(pt)
        ? new Date(pt.token.lastModified ?? 0)
        : new Date(pt.lastModified);
}

export function dateLte(a: string | Date, b: string | Date): boolean {
    const da = typeof a === "string" ? new Date(a) : a;
    const db = typeof b === "string" ? new Date(b) : b;
    return da.getTime() <= db.getTime();
}
