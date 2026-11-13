/**
 * 轮数联动与过期标记
 *
 * 【数据来源】先攻扩展（obr-suite 的 initiative 模块）把回合数写在
 * **场景 metadata** 的 `com.initiative-tracker/combat` 里，结构：
 *     { inCombat: boolean, preparing: boolean, round: number }
 * 这是场景数据而非对方私有内存 → 直接 `OBR.scene.getMetadata()` 读，
 * 不需要它配合广播协议，也不需要 import 它的代码。
 *
 * 【与已废弃模块的关系】完全不碰 `com.obr-suite/status*` 任何键。
 * 那个 statusTracker 已被作者半废弃，这里不依赖它、也不去协调它。
 *
 * 【过期策略：只标记，不删除】
 * 轮数归零时把 attachment 的 `expired` 置 true，浮层显示「已结束」。
 * attachment 本体和 GM 的图片保留，由 GM 自行决定何时清掉。
 */

import OBR, { type Item } from "@owlbear-rodeo/sdk";
import {
    COMBAT_STATE_KEY,
    META_APPLIED_ROUND,
    META_EXPIRED,
    META_HAS,
    META_ROUNDS,
    readCombatRound,
} from "./shared";

/** 上一轮观察到的回合数，用于判断回合是否真的推进了 */
let lastRound: number | null = null;
/** 上次扫描时是否处于战斗中 */
let wasInCombat = false;

function num(v: unknown): number | null {
    return Number.isFinite(v) ? (v as number) : null;
}

/**
 * 扫描全部带轮数的状态 attachment，把已到期的标记为过期。
 *
 * 只在 GM 侧执行：过期是场景数据变更，必须由 GM 写入，
 * 玩家端同时写会撞车（SDK 的 metadata 没有乐观锁）。
 *
 * @returns 本次被标记为过期的物件数
 */
export async function sweepExpired(currentRound: number | null): Promise<number> {
    if (currentRound === null) {
        // 不在战斗中：不推进过期判定，避免战斗间隙误伤
        return 0;
    }

    const candidates = await OBR.scene.items.getItems((item: Item) => {
        if (item.metadata?.[META_HAS] !== true) return false;
        if (item.metadata?.[META_EXPIRED] === true) return false;
        const rounds = num(item.metadata?.[META_ROUNDS]);
        if (rounds === null || rounds <= 0) return false;
        return true;
    });

    if (candidates.length === 0) return 0;

    const expiredIds: string[] = [];
    for (const item of candidates) {
        const rounds = num(item.metadata[META_ROUNDS]) ?? 0;
        const applied = num(item.metadata[META_APPLIED_ROUND]);
        // 没记录施加回合 → 无法判定何时到期，不动它
        if (applied === null || applied < 0) continue;
        if (currentRound - applied >= rounds) {
            expiredIds.push(item.id);
        }
    }

    if (expiredIds.length === 0) return 0;

    await OBR.scene.items.updateItems(expiredIds, (drafts) => {
        for (const d of drafts) {
            d.metadata[META_EXPIRED] = true;
        }
    });

    return expiredIds.length;
}

/**
 * 重置过期标记。
 *
 * GM 手动「续期」或「重新施加」时调用：把过期状态清掉并把施加回合
 * 重置为当前回合，等于重新开始计。
 */
export async function reviveExpired(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    let currentRound: number | null = null;
    try {
        currentRound = readCombatRound(await OBR.scene.getMetadata());
    } catch {
        currentRound = null;
    }

    await OBR.scene.items.updateItems(ids as string[], (drafts) => {
        for (const d of drafts) {
            d.metadata[META_EXPIRED] = false;
            d.metadata[META_APPLIED_ROUND] = currentRound ?? -1;
        }
    });
}

/**
 * 回填缺失的「施加回合」快照。
 *
 * 【为什么需要】
 * GM 常常在**战斗开始之前**就把状态挂上去（或者先攻扩展尚未安装/不在战斗中），
 * 这时 `currentRound()` 返回 null，我们写进 metadata 的 appliedRound 是 -1。
 * 而 `remainingRounds` 一旦看到 -1 就永远返回原值 —— 状态从此再也不倒数，
 * 表现为「10/10 永远不变」。
 *
 * 【怎么补】
 * 第一次读到有效回合时，把它当作计数起点（等价于「从此刻起算 N 轮」）。
 * 语义上比「GM 保存那一刻」更贴近玩家的直觉，也不会突然把状态判成已过期。
 *
 * @returns 被回填的物件数
 */
export async function backfillAppliedRound(currentRound: number | null): Promise<number> {
    if (currentRound === null) return 0;

    const candidates = await OBR.scene.items.getItems((item: Item) => {
        if (item.metadata?.[META_HAS] !== true) return false;
        const rounds = num(item.metadata?.[META_ROUNDS]);
        if (rounds === null || rounds <= 0) return false;
        const applied = num(item.metadata?.[META_APPLIED_ROUND]);
        return applied === null || applied < 0;
    });

    if (candidates.length === 0) return 0;

    await OBR.scene.items.updateItems(
        candidates.map((c) => c.id),
        (drafts) => {
            for (const d of drafts) {
                d.metadata[META_APPLIED_ROUND] = currentRound;
            }
        },
    );

    return candidates.length;
}

/**
 * 启动监听。
 *
 * 监听 scene metadata 变化：回合推进、或战斗开始/结束时做一次过期扫描。
 * GM 与玩家都装监听 —— 玩家侧不写数据，只用于让浮层里的剩余轮数实时更新。
 *
 * @param onRoundChange 回合变化回调（供 hover 浮层刷新用）
 */
export function watchRounds(onRoundChange?: (round: number | null) => void): () => void {
    return OBR.scene.onMetadataChange((metadata) => {
        const state = metadata[COMBAT_STATE_KEY];
        const inCombat =
            typeof state === "object" &&
            state !== null &&
            (state as { inCombat?: unknown }).inCombat === true;
        const round = readCombatRound(metadata);

        console.log(
            `[status-peek] metadata变化 inCombat=${String(inCombat)} round=${String(round)} ` +
                `keys=[${Object.keys(metadata).join(",")}]`,
        );

        const changed = round !== lastRound || inCombat !== wasInCombat;
        lastRound = round;
        wasInCombat = inCombat;
        if (!changed) return;

        onRoundChange?.(round);

        // 只有 GM 写入过期标记
        void (async () => {
            const role = await OBR.player.getRole();
            if (role !== "GM") return;
            try {
                // 先补上缺失的计数起点，否则这些状态永远不会倒数
                const filled = await backfillAppliedRound(round);
                if (filled > 0) {
                    console.log(`[status-peek] 已为 ${filled} 个状态回填计数起点`);
                }
                const n = await sweepExpired(round);
                if (n > 0) {
                    void OBR.notification.show(
                        `${n} 个状态已到期（已标记为「已结束」）`,
                        "INFO",
                    );
                }
            } catch (e) {
                console.warn("[status-peek] 回合处理失败", e);
            }
        })();
    });
}

/** 当前回合，供 GM 保存状态时打时间戳 */
export async function currentRound(): Promise<number | null> {
    try {
        return readCombatRound(await OBR.scene.getMetadata());
    } catch {
        return null;
    }
}