/**
 * 应用持久化数据到场景物件
 *
 * 改编自 desain/owlbear-persistence (GPL-3.0) 的 src/action/applyPersisted.ts
 * 改动：从 store 模块直接读取，去掉 Zustand 依赖。
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { restoreAttachments } from "./attachments";
import {
    dateLte,
    persistedTokenGetLastModified,
    persistedTokenGetMetadata,
    type PersistedToken,
} from "./model";
import { findByKey } from "./store";

/** 判断持久化数据是否比场景中的物件更新（仅对 UNIQUE 模式有意义） */
function isNewerUniqueToken(token: Item, pt: PersistedToken): boolean {
    return (
        pt.type === "UNIQUE" &&
        !dateLte(persistedTokenGetLastModified(pt), token.lastModified ?? 0)
    );
}

/** 把持久化的属性写进物件 */
function updateFromPersisted(
    overwriteTemplates: boolean,
    token: Item,
    pt: PersistedToken,
): void {
    const canClobber =
        overwriteTemplates || isNewerUniqueToken(token, pt);

    if (pt.disabledProperties?.includes("METADATA")) {
        return;
    }

    for (const [key, value] of Object.entries(persistedTokenGetMetadata(pt))) {
        // 可以覆盖的条件：允许覆盖，或该键尚不存在
        if (canClobber || !(key in token.metadata)) {
            (token.metadata as Record<string, unknown>)[key] = value;
        }
    }
}

/**
 * 把持久化数据应用到给定物件。
 *
 * @param items             目标物件
 * @param overwriteTemplates 是否覆盖模板（true = 强制重置为模板状态）
 */
export async function applyPersisted(
    items: readonly Item[],
    overwriteTemplates = false,
): Promise<void> {
    if (items.length === 0) {
        return;
    }

    const candidates = items.filter(
        (i) => i.type === "IMAGE" && (i.layer === "PROP" || i.layer === "ATTACHMENT"),
    );
    if (candidates.length === 0) {
        return;
    }

    const updates = new Map<string, PersistedToken>();
    const attachmentsToDelete: string[] = [];
    const attachmentsToAdd: Item[] = [];

    for (const token of candidates) {
        const url = (token as { image?: { url?: string } }).image?.url;
        if (typeof url !== "string") {
            continue;
        }
        const pt = findByKey(url);
        if (!pt) {
            continue;
        }

        updates.set(token.id, pt);

        const existing = (
            await OBR.scene.items.getItemAttachments([token.id])
        ).filter((a) => a.id !== token.id);

        const canReplace =
            overwriteTemplates ||
            existing.length === 0 ||
            isNewerUniqueToken(token, pt);

        if (!pt.disabledProperties?.includes("ATTACHMENTS") && canReplace) {
            attachmentsToDelete.push(...existing.map((a) => a.id));
            attachmentsToAdd.push(
                ...(restoreAttachments(token, pt.attachments) ?? []),
            );
        }
    }

    if (updates.size === 0) {
        return;
    }

    await Promise.all([
        OBR.scene.items.updateItems([...updates.keys()], (list) => {
            for (const token of list) {
                const pt = updates.get(token.id);
                if (pt) {
                    updateFromPersisted(overwriteTemplates, token, pt);
                }
            }
        }),
        attachmentsToDelete.length > 0
            ? OBR.scene.items.deleteItems(attachmentsToDelete)
            : Promise.resolve(),
        attachmentsToAdd.length > 0
            ? OBR.scene.items.addItems(attachmentsToAdd)
            : Promise.resolve(),
    ]);
}
