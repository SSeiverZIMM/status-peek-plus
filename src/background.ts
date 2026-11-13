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

/**
 * 【v1.2 变更】「新物件自动套用存档」机制已移除。
 *
 * 原机制按图片 URL 匹配：新拖出的物件若与某条存档同图，自动回写描述。
 * 实际使用中暴露两个问题：① attachment 物件贴到角色上的时序里套用不稳定；
 * ② 同图不同用途的场景会误套用（如 NOTE 层物件也被写入描述）。
 *
 * 取而代之的是模板页的显式「套用」按钮：
 *  - 带图标的贴纸存档 → 一键贴到选中的角色 token 上
 *  - 纯文字状态 → 套用到选中的 ATTACHMENT 物件上
 * 见 src/ui/panel-templates.ts。
 *
 * 保留的是 UNIQUE 模式的「回写」：场景中物件的变化自动更新到它对应的存档，
 * 这是存档数据的维护机制，与套用无关。
 */
async function handleItemsChange(items: Item[]): Promise<void> {
    const prev = lastItems;
    lastItems = items;

    if (prev.length === 0) {
        return;
    }

    syncUniqueTokens(items, prev);
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
