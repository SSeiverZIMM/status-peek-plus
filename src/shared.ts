/**
 * 共享的元数据键与读写工具
 *
 * 来自 Status Peek（用户自有代码）：status-peek/text、status-peek/has
 * 新增持久化相关的命名空间。
 */

/** 描述文本 */
export const METADATA_TEXT = "status-peek/text";
/** 是否有描述（用于右键菜单 filter，避免遍历文本） */
export const METADATA_HAS = "status-peek/has";

/**
 * 编辑模态框 ID
 *
 * 【重要】必须与旧版 Status Peek 的 ID 不同！
 * 旧版用的是 `status-peek-edit-modal`，若相同，当旧扩展同时安装时，
 * OBR 会解析到旧扩展注册的 modal（指向旧域名），导致弹窗打不开。
 */
export const MODAL_EDIT_ID = "status-peek-plus-edit-modal";

/** 本扩展只接受这两类图层 */
export const TARGET_LAYERS = ["ATTACHMENT", "PROP"] as const;

export type TargetLayer = (typeof TARGET_LAYERS)[number];

export function isTargetLayer(layer: string): layer is TargetLayer {
    return (TARGET_LAYERS as readonly string[]).includes(layer);
}

export interface PeekData {
    text: string;
    has: boolean;
}

/** 从 metadata 读取描述（对未知数据安全） */
export function readPeek(metadata: Record<string, unknown>): PeekData {
    const text = metadata[METADATA_TEXT];
    const has = metadata[METADATA_HAS];
    return {
        text: typeof text === "string" ? text : "",
        has: has === true,
    };
}

/** 生成写入描述的 metadata 补丁 */
export function writePeek(text: string): Record<string, unknown> {
    const trimmed = text.trim();
    return {
        [METADATA_TEXT]: trimmed,
        [METADATA_HAS]: trimmed.length > 0,
    };
}

/** 生成清除描述的 metadata 补丁 */
export function clearPeek(): Record<string, unknown> {
    return {
        [METADATA_TEXT]: "",
        [METADATA_HAS]: false,
    };
}

/** 描述文本长度上限 */
export const MAX_TEXT_LENGTH = 4000;

/* ------------------------------------------------------------------ */
/* 自身资源 URL 解析                                                    */
/* ------------------------------------------------------------------ */

/**
 * 把同目录的兄弟文件解析成**绝对 URL**。
 *
 * 为什么必须绝对：OBR 处理 `./xxx` 这类相对路径时，是以**域名根**为基准
 * 拼接的（实测确认，报错日志里出现 `https://域名./icon.svg` 这种既丢了
 * 子目录、又带尾点的地址），而不是以 manifest 的 URL 为基准。所以子目录
 * 部署下相对路径必然 404。
 *
 * 这里用 `location.href` 动态推导，避免把域名/目录名硬编码进代码：
 *   background.html / action.html 等页面自己的 URL 就是基准，
 *   同目录的兄弟文件直接 replace 文件名即可。
 *
 *   location.href = https://host/status-peek/background.html
 *   siblingUrl("edit.html") → https://host/status-peek/edit.html
 */
export function siblingUrl(file: string): string {
    if (typeof location === "undefined") {
        // 非浏览器环境（测试桩）退化为相对路径
        return `./${file}`;
    }
    return location.href.replace(/[^/]*$/, file);
}

/** 自身扩展根目录的绝对 URL（末尾带 /） */
export function selfBaseUrl(): string {
    if (typeof location === "undefined") {
        return "./";
    }
    return location.href.replace(/[^/]*$/, "");
}
