/**
 * 附件坐标转换
 *
 * 直接搬自 desain/owlbear-persistence (GPL-3.0) 的 src/action/processAttachments.ts
 * 逻辑未改动，仅去掉对 Token 类型的强依赖（改为传入最小必要字段）。
 */

import type { Item } from "@owlbear-rodeo/sdk";

/** 附件直接挂在根节点（不属于任何物件的相对坐标）时的 attachedTo 值 */
export const ATTACHED_TO_ROOT = "ROOT";

interface Positioned {
    id: string;
    position: { x: number; y: number };
    zIndex: number;
}

/**
 * 把绝对坐标的附件转换成相对于物件的坐标，便于存储。
 * 存储时减去物件位置与 zIndex，恢复时再加回来。
 */
export function processAttachments(
    anchor: Positioned,
    attachments?: readonly Readonly<Item>[],
): Item[] | undefined {
    if (!attachments) {
        return attachments as undefined;
    }
    return attachments.map((attachment) => ({
        ...attachment,
        attachedTo:
            attachment.attachedTo === anchor.id
                ? ATTACHED_TO_ROOT
                : attachment.attachedTo,
        zIndex: attachment.zIndex - anchor.zIndex,
        position: {
            x: attachment.position.x - anchor.position.x,
            y: attachment.position.y - anchor.position.y,
        },
    }));
}

/**
 * 把相对坐标的附件还原成绝对坐标，并为每个附件生成新 ID。
 * attachedTo 为 "ROOT" 的附件会重新挂到目标物件上。
 */
export function restoreAttachments(
    anchor: Positioned,
    attachments?: readonly Readonly<Item>[],
): Item[] | undefined {
    if (!attachments) {
        return attachments as undefined;
    }

    const idMap = new Map<string, string>();
    idMap.set(ATTACHED_TO_ROOT, anchor.id);
    for (const attachment of attachments) {
        idMap.set(attachment.id, crypto.randomUUID());
    }

    return attachments.map((attachment) => ({
        ...attachment,
        attachedTo: attachment.attachedTo
            ? idMap.get(attachment.attachedTo)
            : undefined,
        zIndex: attachment.zIndex + anchor.zIndex,
        id: idMap.get(attachment.id) ?? attachment.id,
        position: {
            x: attachment.position.x + anchor.position.x,
            y: attachment.position.y + anchor.position.y,
        },
    }));
}
