/**
 * 套用素材：把一条素材库记录放到画布上
 *
 * 【为什么单独一个文件】
 * 「套用」在旧版里散落在两个面板里，且两边行为不一致（状态库只写文字、
 * 存档只记快照）。现在两者合成同一个动作：把一条记录变成画布上的物件，
 * 所以逻辑集中在这里，两个面板共用。
 */

import OBR, { buildImage, type Item } from "@owlbear-rodeo/sdk";
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
    /** 失败/跳过的具体原因（v2.0.2 起，供通知展示） */
    errors: string[];
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
    const result: ApplyResult = {
        created: 0,
        reused: 0,
        written: 0,
        failed: 0,
        errors: [],
    };
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
        if (result.failed > 0) {
            result.errors.push(
                `纯文字状态只能套用到附件（ATTACHMENT 层）物件，` +
                    `${result.failed} 个非附件目标已跳过`,
            );
        }
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

    // --- 带图标：优先全量克隆场景里的同图实例 ---
    // 【v2.0.4】不再按字段拼装（image/grid/scale 的渲染模型太容易踩偏），
    // 直接复制一条真实实例的全部字段——渲染结果与场景所见完全一致。
    // 尺寸定位用 getItemBounds（渲染后真实包围盒），同样不依赖模型。
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
        const dupId: string | undefined = dup?.id;

        if (dup) {
            await OBR.scene.items.updateItems([dup.id], (drafts) => {
                for (const d of drafts) Object.assign(d.metadata, patch);
            });
            result.reused++;
            continue;
        }

        // 场景里找同图实例作为克隆母本（排除目标自身与已复用的 dup）
        const sources = (await OBR.scene.items
            .getItems(
                (i: Item) =>
                    imageUrlOf(i) === entry.imageUrl &&
                    i.id !== target.id &&
                    i.id !== dupId,
            )
            .catch(() => [] as Item[])) as Item[];
        const source = sources[0];

        const targetBounds = await OBR.scene.items
            .getItemBounds([target.id])
            .catch(() => undefined);
        const tgtCx = targetBounds
            ? targetBounds.center.x
            : target.position.x;
        const tgtCy = targetBounds
            ? targetBounds.center.y
            : target.position.y;

        if (source) {
            // 全量克隆：除 id/挂载/位置/层级/描述外全部照抄母本
            const srcBounds = await OBR.scene.items
                .getItemBounds([source.id])
                .catch(() => undefined);
            const srcW = srcBounds ? srcBounds.width : 0;
            const srcH = srcBounds ? srcBounds.height : 0;
            const clone = {
                ...source,
                id: crypto.randomUUID(),
                attachedTo: target.id,
                zIndex: (target.zIndex ?? 0) + 1,
                metadata: { ...source.metadata, ...patch },
                position: { x: tgtCx - srcW / 2, y: tgtCy - srcH / 2 },
            } as unknown as Item;
            try {
                await OBR.scene.items.addItems([clone]);
                result.created++;
            } catch (e) {
                result.failed++;
                result.errors.push(
                    `创建贴图附件失败：${e instanceof Error ? e.message : String(e)}`,
                );
                console.error("[状态描述] 克隆附件失败", e);
            }
            continue;
        }

        // 场景里没有母本 → buildImage 构造（渲染 1 格，居中）
        const visual = await resolveStickerVisual(entry);
        const sceneDpi = await OBR.scene.grid.getDpi().catch(() => 150);
        console.log(
            "[状态描述] 贴纸采用参数:",
            JSON.stringify({ visual, 目标: target.name || target.id }),
        );
        try {
            const item = buildImage({ ...visual.image }, {
                offset: { ...visual.grid.offset },
                dpi: visual.grid.dpi,
            })
                .layer("ATTACHMENT")
                .scale({ x: visual.scale.x, y: visual.scale.y })
                .build();
            item.attachedTo = target.id;
            const renderedW =
                (visual.image.width / visual.grid.dpi) *
                sceneDpi *
                visual.scale.x;
            const renderedH =
                (visual.image.height / visual.grid.dpi) *
                sceneDpi *
                visual.scale.y;
            item.position = {
                x: tgtCx - renderedW / 2,
                y: tgtCy - renderedH / 2,
            };
            item.zIndex = (target.zIndex ?? 0) + 1;
            item.name = entry.name || "状态图标";
            item.metadata = { ...patch };
            (item as { lastModified?: string }).lastModified =
                new Date().toISOString();
            await OBR.scene.items.addItems([item as unknown as Item]);
            result.created++;
        } catch (e) {
            result.failed++;
            result.errors.push(
                `创建贴图附件失败：${e instanceof Error ? e.message : String(e)}`,
            );
            console.error("[状态描述] 创建附件失败", e);
        }
    }

    return result;
}

/**
 * 解析贴纸的完整视觉参数（image + grid + scale）。
 *
 * 渲染尺寸 = (image.width ÷ grid.dpi) × 场景格距 × scale——三者缺一不可：
 * grid.dpi 给 1 会让一张 1024px 的原图铺满上千个格子（「贴出来巨大」的元凶）。
 *
 * 解析顺序：
 *   1. 场景里同图实例 → image/grid/scale 全量复刻，与场景所见完全一致；
 *   2. 条目快照（绑定时的状态；旧条目无 grid → 按图宽折算渲染 1 格）；
 *   3. 加载图片取自然尺寸 → 渲染 1 格。
 */
async function resolveStickerVisual(entry: ArchiveEntry): Promise<{
    image: { url: string; width: number; height: number; mime: string };
    grid: { offset: { x: number; y: number }; dpi: number };
    scale: { x: number; y: number };
}> {
    // 1) 场景同图实例：全量复刻
    const items = await OBR.scene.items
        .getItems((i: Item) => imageUrlOf(i) === entry.imageUrl)
        .catch(() => [] as Item[]);
    console.log(
        "[状态描述] 贴图解析:",
        JSON.stringify({
            imageUrl: entry.imageUrl,
            场景同图实例数: items.length,
            实例参数: items.slice(0, 1).map((it) => ({
                position: it.position,
                image: (it as { image?: unknown }).image,
                grid: (it as { grid?: unknown }).grid,
                scale: (it as { scale?: unknown }).scale,
            }))[0],
            快照参数: entry.snapshot ?? null,
        }),
    );
    for (const it of items) {
        const ic = (
            it as {
                image?: {
                    url?: string;
                    width?: number;
                    height?: number;
                    mime?: string;
                };
                grid?: { offset?: { x: number; y: number }; dpi?: number };
                scale?: { x: number; y: number };
            }
        ).image
            ? it
            : null;
        if (!ic) continue;
        const image = (
            ic as unknown as {
                image?: {
                    url?: string;
                    width?: number;
                    height?: number;
                    mime?: string;
                };
            }
        ).image;
        if (
            typeof image?.width !== "number" ||
            image.width <= 0 ||
            typeof image.height !== "number" ||
            image.height <= 0
        ) {
            continue;
        }
        const grid = (
            ic as { grid?: { offset?: { x: number; y: number }; dpi?: number } }
        ).grid;
        const scale = (
            ic as { scale?: { x: number; y: number } }
        ).scale;
        return {
            image: {
                url: entry.imageUrl,
                width: image.width,
                height: image.height,
                mime: typeof image.mime === "string" ? image.mime : "image/png",
            },
            grid:
                grid && typeof grid.dpi === "number" && grid.dpi > 0
                    ? {
                          offset: { ...(grid.offset ?? { x: 0, y: 0 }) },
                          dpi: grid.dpi,
                      }
                    : { offset: { x: 0, y: 0 }, dpi: image.width },
            scale:
                scale && typeof scale.x === "number"
                    ? {
                          x: scale.x,
                          y: typeof scale.y === "number" ? scale.y : scale.x,
                      }
                    : { x: 1, y: 1 },
        };
    }

    // 2) 条目快照
    const snapImg = entry.snapshot?.image;
    if (snapImg && snapImg.width > 0 && snapImg.height > 0) {
        const g = entry.snapshot?.grid;
        return {
            image: snapImg,
            grid:
                g && g.dpi > 0
                    ? { offset: { ...(g.offset ?? { x: 0, y: 0 }) }, dpi: g.dpi }
                    : { offset: { x: 0, y: 0 }, dpi: snapImg.width },
            scale: entry.snapshot?.scale ?? { x: 1, y: 1 },
        };
    }

    // 3) 加载图片取自然尺寸 → 渲染 1 格
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
    return {
        image: {
            url: entry.imageUrl,
            width: dims.w,
            height: dims.h,
            mime: "image/png",
        },
        grid: { offset: { x: 0, y: 0 }, dpi: dims.w || 150 },
        scale: { x: 1, y: 1 },
    };
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