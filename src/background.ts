/**
 * 后台入口
 *
 * 合并了两个插件的右键菜单：
 *  - Status Peek：「附件描述」（打开统一编辑面板）
 *  - Persistent Tokens 的持久化操作已移入 action 面板卡片按钮，不再占用右键
 */

import OBR, { type ContextMenuContext, type Item } from "@owlbear-rodeo/sdk";
import { MODAL_EDIT_ID, isTargetLayer, selfBaseUrl, siblingUrl } from "./shared";
import { load, syncUniqueTokens } from "./persist/store";
import { applyPersisted } from "./persist/apply";

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
                label: "附件描述",
                filter: {
                    roles: ["GM"],
                    min: 1,
                    every: [{ key: "layer", value: "ATTACHMENT" }],
                },
            },
            {
                icon: contextMenuIcon(),
                label: "附件描述",
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
/* 唯一模式自动同步                                                    */
/* ------------------------------------------------------------------ */

let lastItems: Item[] = [];
let syncing = false;

/**
 * 对新加入场景的物件套用持久化存档。
 *
 * 这是「存档能在下次拖出同一张图片时自动恢复」的关键一步：
 * 用户为某张图片存了模板后，即便场景里的物件全被删除，
 * 再次拖出该图片时，这里会把存档里的 metadata（含 status-peek/text）写回物件。
 *
 * 【为什么只处理新增】applyPersisted 自身会写物件，写又会触发 onChange；
 * 若对所有物件反复套用，容易形成回环。只认「上次快照里没有的 id」即可断环。
 */
async function applyToNewItems(items: Item[], prev: Item[]): Promise<void> {
    // prev 为空说明这是首次拉取基线，场景里的物件都算「已存在」，不该套用
    if (prev.length === 0) {
        return;
    }

    const prevIds = new Set(prev.map((i) => i.id));
    const added = items.filter((i) => !prevIds.has(i.id));
    if (added.length === 0) {
        return;
    }

    await applyPersisted(added);
}

/** 物件变化时：先给新物件套用存档，再把 UNIQUE 项的最新状态回写 */
async function handleItemsChange(items: Item[]): Promise<void> {
    const prev = lastItems;
    // 基线始终保持最新，避免 applyPersisted 引发的变更让后续判断失真
    lastItems = items;

    if (syncing) {
        return;
    }

    // 场景首次加载时 prev 为空，此时不触发（避免把空数据写进去）
    if (prev.length === 0) {
        return;
    }

    syncing = true;
    try {
        await applyToNewItems(items, prev);
        syncUniqueTokens(items, prev);
    } finally {
        syncing = false;
    }
}

OBR.onReady(() => {
    // 只有 GM 需要右键菜单与自动同步
    void (async () => {
        const role = await OBR.player.getRole();
        if (role !== "GM") {
            return;
        }

        // 载入本地存储（在注册菜单前，保证菜单 filter 里的数据是最新的）
        load();

        await installContextMenus();

        // 初次拉取当前场景物件作为基线
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
    })();
});
