/**
 * 后台入口
 *
 * 职责：
 *  - 注册 hover 工具模式（GM 与玩家都要，用于在光标处看状态描述）
 *  - GM 专属：右键菜单（可选快捷入口）+ 持久化自动同步
 *  - 全员：监听先攻回合变化，把到期的状态标记为「已结束」
 */

import OBR, { type ContextMenuContext, type Item } from "@owlbear-rodeo/sdk";
import { MODAL_EDIT_ID, isTargetLayer, selfBaseUrl, siblingUrl, readCombatRound } from "./shared";
import { installHoverMode, closePopoverIfOpen, listenForResize } from "./ui/tool-hover";
import { watchRounds, backfillAppliedRound } from "./rounds";
import { applyToNewItems } from "./apply";

/**
 * 右键菜单 ID
 *
 * 【重要】加 `-plus` 后缀与旧版 Status Peek 区分，避免两个扩展同时安装时
 * 菜单注册冲突（旧版 id 为 `status-peek/contextMenu/edit`）。
 */
const ID_CONTEXTMENU_EDIT = "status-peek-plus/contextMenu/edit";

/**
 * 右键菜单图标路径。
 *
 * 【依据】SDK 源码 `lib/common/normalize.js`：
 *
 *     normalizeUrl(url) = url.startsWith("http") ? url : window.location.origin + url
 *
 * 而 `ContextMenuApi.register()` 注册前会调用 `normalizeIconPaths()` 逐个过一遍。
 * 因此三种写法的实际结果：
 *
 *     `${selfBaseUrl()}icon-v3.svg`  → https://host/status-peek/icon-v3.svg   ✓ 原样使用
 *     "/status-peek/icon-v3.svg"     → origin + 路径                          ✓ 但子目录被写死
 *     "./icon-v3.svg"                → https://host./icon-v3.svg              ✗ 点怼进主机名
 *                                                                              （ERR_CERT_COMMON_NAME_INVALID）
 *
 * 这里用 selfBaseUrl() 动态推导自身所在目录，**换域名、换子目录都不用改代码**。
 */
function contextMenuIcon(): string {
    return `${selfBaseUrl()}icon-v3.svg`;
}

/** 只取 ATTACHMENT / PROP 图层的物件 */
function targetIds(items: readonly Item[]): string[] {
    return items.filter((i) => isTargetLayer(i.layer)).map((i) => i.id);
}

/** 打开统一编辑面板 */
function openEditModal(ids: readonly string[]): void {
    if (ids.length === 0) {
        return;
    }
    void OBR.modal.open({
        id: MODAL_EDIT_ID,
        url: `${siblingUrl("edit.html")}?ids=${encodeURIComponent(ids.join(","))}`,
        width: 420,
        height: 460,
        hidePaper: true,
    });
}

/** 注册右键菜单：每个受支持的图层一个 icon 变体（OBR 的 filter 不支持跨图层 or） */
async function installContextMenus(): Promise<void> {
    await OBR.contextMenu.create({
        id: ID_CONTEXTMENU_EDIT,
        icons: [
            {
                icon: contextMenuIcon(),
                label: "编辑状态",
                filter: {
                    roles: ["GM"],
                    min: 1,
                    every: [{ key: "layer", value: "ATTACHMENT" }],
                },
            },
            {
                icon: contextMenuIcon(),
                label: "编辑状态",
                filter: {
                    roles: ["GM"],
                    min: 1,
                    every: [{ key: "layer", value: "PROP" }],
                },
            },
        ],
        onClick: (context: ContextMenuContext) => {
            openEditModal(targetIds(context.items));
        },
    });
}

/* ------------------------------------------------------------------ */
/* 新物件套用素材                                                       */
/* ------------------------------------------------------------------ */

let lastItems: Item[] = [];
let applying = false;

/**
 * 物件变化时：给新物件套用素材库里对应的条目。
 *
 * 这是「素材库」的核心自动化价值：用户从素材库拖出一张图，
 * 若库里有关于这张图的条目，状态（含轮数起点）与子物件位置会自动恢复。
 *
 * 【为什么只处理新增】
 * 套用会写物件，写又会触发 onChange；若对所有物件反复套用容易形成回环。
 * 只认「上次快照里没有的 id」即可断环。
 *
 * 【为什么不再自动回写】
 * 旧版有个「唯一模式自动同步」：物件在场景中被改动后自动回写存档。
 * 合并后去掉了 —— 素材库是「模板」而不是「活文档」，
 * GM 改一个字就悄悄改掉素材太容易失控。需要更新时在面板里
 * 手动「存为素材」即可，行为更可预期。
 */
async function handleItemsChange(items: Item[]): Promise<void> {
    const prev = lastItems;
    lastItems = items;

    // 基线为空说明场景刚加载完，此时不套用（否则会把库里的东西倒灌进旧场景）
    if (prev.length === 0 || applying) {
        return;
    }

    const prevIds = new Set(prev.map((i) => i.id));
    const added = items.filter((i) => !prevIds.has(i.id));
    if (added.length === 0) {
        return;
    }

    applying = true;
    try {
        await applyToNewItems(added);
    } catch (e) {
        console.warn("[status-peek] 新物件套用素材失败", e);
    } finally {
        applying = false;
    }
}

OBR.onReady(() => {
    void (async () => {
        // hover 模式：GM 和玩家都需要（玩家端的主要用途）
        await installHoverMode();

        // 浮层页面用它回报真实高度，好把 popover 收到刚好容纳卡片。
        // 少这一句，iframe 会比卡片高，多出来的透明区域就看着像「黑边」。
        listenForResize();

        // 监听先攻回合变化 → 到期标记为「已结束」。
        // 写入只在 GM 侧做（见 rounds.ts），玩家侧仅用于浮层刷新。
        watchRounds(() => {
            // 回合变了，若浮层还开着则让它下次移动时重建
            void closePopoverIfOpen();
        });

        const role = await OBR.player.getRole();

        // GM 启动时立刻补一次计数起点。
        // 【为什么必须有这次主动调用】
        // watchRounds 只在 metadata「发生变化」时回调。若先攻扩展早已在战斗、
        // 而状态是在开打前挂上的，appliedRound 是空的，此后 metadata 未必再变，
        // 就会一直漏补 → 状态永远不倒数。启动时主动跑一次最保险。
        if (role === "GM") {
            void (async () => {
                try {
                    const meta = await OBR.scene.getMetadata();
                    const filled = await backfillAppliedRound(readCombatRound(meta));
                    if (filled > 0) {
                        console.log(
                            `[status-peek] 启动时已为 ${filled} 个状态回填计数起点`,
                        );
                    }
                } catch (e) {
                    console.warn("[status-peek] 启动回填失败", e);
                }
            })();
        }

        // 新物件套用素材：GM 与玩家都要监听。
    // GM 发布的房间预设必须让玩家也能自动恢复，否则玩家看到的
    // 是「GM 那边有状态，我这边没有」。
    if (await OBR.scene.isReady()) {
        lastItems = await OBR.scene.items.getItems();
        void OBR.scene.items.onChange((items) => {
            void handleItemsChange(items);
        });
    } else {
        OBR.scene.onReadyChange((ready) => {
            if (ready) {
                void OBR.scene.items.getItems().then((items) => {
                    lastItems = items;
                });
            }
        });
        void OBR.scene.items.onChange((items) => {
            void handleItemsChange(items);
        });
    }

    if (role !== "GM") {
        return;
    }

    // 以下都是 GM 专属
    await installContextMenus();
    })();
});
