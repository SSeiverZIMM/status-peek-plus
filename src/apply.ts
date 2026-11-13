/**
 * 套用素材：把一条素材库记录放到画布上
 *
 * 【为什么单独一个文件】
 * 「套用」在旧版里散落在两个面板里，且两边行为不一致（状态库只写文字、
 * 存档只记快照）。现在两者合成同一个动作：把一条记录变成画布上的物件，
 * 所以逻辑集中在这里，两个面板共用。
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
    META_HAS,
    writePeek,
    type ArchiveEntry,
} from "./shared";
import { currentRound } from "./rounds";
import { findByImage, restoreSnapshotAttachments } from "./archive";

/** 目标物件的图片地址 */
function imageUrlOf(item: Item): string | undefined {
    const u = (item as { image?: { url?: string } }).image?.url;
    return typeof u === "string" ? u : undefined;
}

/** 由条目生成状态 metadata 补丁 */
export function peekPatchOf(
    entry: ArchiveEntry,
    appliedRound: number,
): Record<string, unknown> {
    return writePeek({
        name: entry.name,
        desc: entry.desc,
        descPlain: entry.descPlain,
        rounds: entry.rounds,
        // 轮数为 0（永久）时不记快照
        appliedRound: entry.rounds > 0 ? appliedRound : -1,
        templateId: entry.id,
        color: entry.color,
    });
}

export interface ApplyResult {
    /** 新建出来的 attachment id */
    created: number;
    /** 复用了已存在的 attachment id */
    reused: number;
    /** 纯文字预设：直接写到目标物件上的数量 */
    written: number;
    /** 没处理的（读不到图层等） */
    failed: number;
}

/**
 * 把一条素材套用到给定的物件上。
 *
 * 三种情况：
 *   1. **纯文字预设**（无 imageUrl）→ 把状态写到目标的 metadata。
 *      【v2.0.1】目标仅限 ATTACHMENT 层，其他层跳过（用户规则）。
 *   2. **带图标**→ 在目标 token 上新建（或复用）一个 ATTACHMENT 图层物件，
 *      把状态写在**图**上。符合「attachment 是唯一载体」这个前提：
 *      状态必须挂在图上，跟着它移动。
 *      【v2.0.1】新建时补全图片尺寸与 MIME（缺失会渲染成不可见），
 *      并把贴纸居中放在目标 token 上。
 *   3. 目标自己就是那张图 → 直接写它。
 */
export async function applyEntry(
    entry: ArchiveEntry,
    targetIds: readonly string[],
): Promise<ApplyResult> {
    const result: ApplyResult = { created: 0, reused: 0, written: 0, failed: 0 };
    if (targetIds.length === 0) return result;

    const round = await currentRound();
    const patch = peekPatchOf(entry, round ?? -1);
    const targets = await OBR.scene.items
        .getItems([...targetIds])
        .catch(() => [] as Item[]);

    // --- 纯文字预设：仅限 ATTACHMENT 层（v2.0.1） ---
    if (!entry.imageUrl) {
        const okTargets = targets.filter((t) => t.layer === "ATTACHMENT");
        result.failed = targets.length - okTargets.length;
        if (okTargets.length > 0) {
            await OBR.scene.items.updateItems(
                okTargets.map((t) => t.id),
                (drafts) => {
                    for (const d of drafts) Object.assign(d.metadata, patch);
                },
            );
            result.written = okTargets.length;
        }
        return result;
    }

    // --- 带图标：解析完整图片内容（尺寸/MIME 缺失会渲染成不可见） ---
    const imgContent = await resolveImageContent(entry);

    for (const target of targets) {
        // 目标自己就是那张图
        if (imageUrlOf(target) === entry.imageUrl) {
            await OBR.scene.items.updateItems([target.id], (drafts) => {
                for (const d of drafts) Object.assign(d.metadata, patch);
            });
            result.reused++;
            continue;
        }

        // 找该token 下是否已有同图的 attachment，有就复用（避免叠图）
        const existing = await OBR.scene.items.getItemAttachments([target.id]);
        const dup = existing.find((a) => imageUrlOf(a) === entry.imageUrl);

        if (dup) {
            await OBR.scene.items.updateItems([dup.id], (drafts) => {
                for (const d of drafts) Object.assign(d.metadata, patch);
            });
            result.reused++;
            continue;
        }

        // 新建 attachment：居中放在目标 token 上
        const tW = (target as { width?: number }).width ?? 0;
        const tH = (target as { height?: number }).height ?? 0;
        const centerX = target.position.x + tW / 2;
        const centerY = target.position.y + tH / 2;
        const newId = crypto.randomUUID();
        try {
            await OBR.scene.items.addItems([
                {
                    id: newId,
                    type: "IMAGE",
                    layer: "ATTACHMENT",
                    attachedTo: target.id,
                    position: {
                        x: centerX - imgContent.width / 2,
                        y: centerY - imgContent.height / 2,
                    },
                    zIndex: (target.zIndex ?? 0) + 1,
                    name: entry.name || "状态图标",
                    // 完整图片内容：缺尺寸在枭熊里渲染成不可见
                    image: { ...imgContent },
                    metadata: { ...patch },
                    lastModified: new Date().toISOString(),
                } as unknown as Item,
            ]);
            result.created++;
        } catch {
            result.failed++;
        }
    }

    return result;
}

/**
 * 解析素材图标的完整图片内容（width/height/mime）。
 *
 * 解析顺序：条目快照 → 场景里同图实例 → 加载图片取自然尺寸。
 * 没有尺寸的图片在枭熊里会渲染成不可见——这是「attachment 套不上」的元凶。
 */
async function resolveImageContent(entry: ArchiveEntry): Promise<{
    url: string;
    width: number;
    height: number;
    mime: string;
}> {
    const fallback = {
        url: entry.imageUrl,
        width: 150,
        height: 150,
        mime: "image/png",
    };

    // 1) 条目快照里存的图标内容
    const snapImg = entry.snapshot?.image;
    if (snapImg && snapImg.width > 0 && snapImg.height > 0) {
        return snapImg;
    }

    // 2) 场景里找同图实例，借用它的图片内容
    const items = await OBR.scene.items
        .getItems((i) => imageUrlOf(i) === entry.imageUrl)
        .catch(() => [] as Item[]);
    for (const it of items) {
        const ic = (
            it as {
                image?: {
                    url?: string;
                    width?: number;
                    height?: number;
                    mime?: string;
                };
            }
        ).image;
        if (
            ic &&
            typeof ic.width === "number" &&
            ic.width > 0 &&
            typeof ic.height === "number" &&
            ic.height > 0
        ) {
            return {
                url: entry.imageUrl,
                width: ic.width,
                height: ic.height,
                mime: typeof ic.mime === "string" ? ic.mime : "image/png",
            };
        }
    }

    // 3) 兜底：直接加载图片取自然尺寸
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const im = new Image();
        im.onload = () =>
            resolve({
                w: im.naturalWidth || 150,
                h: im.naturalHeight || 150,
            });
        im.onerror = () => resolve({ w: 150, h: 150 });
        im.src = entry.imageUrl;
        setTimeout(() => resolve({ w: 150, h: 150 }), 3000);
    });
    return { ...fallback, width: dims.w, height: dims.h };
}

/**
 * 给新拖进场景的物件恢复状态。
 *
 * 这是「素材库」在合并后最核心的自动化价值：用户从素材库拖出一张图，
 * 若素材库里有关于这张图的条目，状态（含轮数起点）自动写回。
 *
 * 【为什么只处理新增】本函数会写物件，写又会触发 onChange；
 * 若对所有物件反复套用，容易形成回环。只认「上次快照里没有的 id」即可断环。
 */
export async function applyToNewItems(
    added: readonly Item[],
): Promise<void> {
    if (added.length === 0) return;

    const candidates = added.filter(
        (i) => i.type === "IMAGE" && (i.layer === "PROP" || i.layer === "ATTACHMENT"),
    );
    if (candidates.length === 0) return;

    const round = await currentRound();

    for (const token of candidates) {
        const url = imageUrlOf(token);
        if (!url) continue;

        // 按图片 URL 找条目（findByImage 内部优先 scene）
        const entry = await findByImage(url);
        if (!entry) continue;

        const patch = peekPatchOf(entry, round ?? -1);

        // 仅当物件还没有状态时才写，避免覆盖 GM 刚手动改过的内容
        const alreadyHas = token.metadata?.[META_HAS] === true;
        if (!alreadyHas) {
            await OBR.scene.items.updateItems([token.id], (drafts) => {
                for (const d of drafts) Object.assign(d.metadata, patch);
            });
        }

        // 恢复子物件（快照里存的相对位置附件）
        const restorable = restoreSnapshotAttachments(entry, {
            id: token.id,
            position: token.position,
            zIndex: token.zIndex ?? 0,
        });
        if (restorable.length > 0) {
            const existing = await OBR.scene.items.getItemAttachments([token.id]);
            const have = new Set(existing.map((a) => a.id));
            const toAdd = restorable.filter((a) => !have.has(a.id));
            if (toAdd.length > 0) {
                await OBR.scene.items.addItems(toAdd);
            }
        }
    }
}