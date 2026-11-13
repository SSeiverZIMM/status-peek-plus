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
 *   1. **纯文字预设**（无 imageUrl）→ 直接把状态写到目标物件的 metadata。
 *      适合「选中 5 个怪物批量施加同一个效果」。
 *   2. **带图标**→ 在目标 token 上新建（或复用）一个 ATTACHMENT 图层物件，
 *      把状态写在**图**上。符合「attachment 是唯一载体」这个前提：
 *      状态必须挂在图上，跟着它移动。
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

    // --- 纯文字预设 ---
    if (!entry.imageUrl) {
        await OBR.scene.items.updateItems([...targetIds], (drafts) => {
            for (const d of drafts) Object.assign(d.metadata, patch);
        });
        result.written = targetIds.length;
        return result;
    }

    const targets = await OBR.scene.items.getItems([...targetIds]);

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

        // 新建 attachment
        const newId = crypto.randomUUID();
        try {
            await OBR.scene.items.addItems([
                {
                    id: newId,
                    type: "IMAGE",
                    layer: "ATTACHMENT",
                    attachedTo: target.id,
                    position: { x: target.position.x, y: target.position.y },
                    zIndex: (target.zIndex ?? 0) + 1,
                    name: entry.name || "状态图标",
                    // Item 类型里没有 image 字段（宿主运行时的扩展字段）
                    image: { url: entry.imageUrl },
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