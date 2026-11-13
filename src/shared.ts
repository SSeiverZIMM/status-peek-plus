/**
 * 共享的元数据键与读写工具
 *
 * 设计要点（2026-10-19 重构）：
 *  - **attachment 是唯一载体**。使用者自己上传图片到 ATTACHMENT 图层，
 *    拖到 token 上，描述与轮数就显示在这个 attachment 附近，随它移动。
 *  - 描述存该 attachment 自己的 metadata，天然随场景同步给房间内所有人，
 *    不依赖任何本地存储。
 *  - 持续轮数从**先攻扩展**写在 scene metadata 里的回合数推导
 *    （`com.initiative-tracker/combat`）。与已废弃的 statusTracker 无关。
 */

/* ------------------------------------------------------------------ */
/* attachment 上的状态数据                                             */
/* ------------------------------------------------------------------ */

/** 状态名（如「魅惑 Charmed」）。短文本，显示为标题。 */
export const META_NAME = "status-peek/name";
/** 规则富文本，Slate 节点数组。与先攻模块无关。 */
export const META_DESC = "status-peek/desc";
/** 规则纯文本备份（用于搜索/降级渲染/无富文本环境）。 */
export const META_DESC_PLAIN = "status-peek/desc-plain";
/** 创建时的持续轮数（数字）。0 或缺失 = 永久。 */
export const META_ROUNDS = "status-peek/rounds";
/** 施加时的回合数快照（用于计算剩余）。-1 = 未记录。 */
export const META_APPLIED_ROUND = "status-peek/applied-round";
/** 轮数已归零、状态过期。过期只标记不删除。 */
export const META_EXPIRED = "status-peek/expired";
/** 来源模板 id（用于「按模板批量施加」时回溯）。空 = 独立创建。 */
export const META_TEMPLATE_ID = "status-peek/template-id";
/** 状态配色（十六进制），用于浮层色条与标题着色 */
export const META_COLOR = "status-peek/color";

/** 是否有状态描述（用于右键菜单 filter 与快速扫描，避免解析富文本） */
export const META_HAS = "status-peek/has";

/** 描述文本长度上限（纯文本计） */
export const MAX_TEXT_LENGTH = 4000;
/** 状态名长度上限 */
export const MAX_NAME_LENGTH = 80;

/**
 * 状态配色的预设色板（十六进制）。
 *
 * 编辑模态框与素材库的颜色筛选共用这一份：编辑时从这里快速取色，
 * 筛选时固定列出这 9 个色点。自选色（取色器任意 HEX）不进来——
 * 库里有自选色时，筛选条会在这 9 个之后追加对应的色点。
 */
export const PRESET_COLORS = [
    "#ff00d0",
    "#e24b4a",
    "#ef9f27",
    "#ffff00",
    "#97c459",
    "#1d9e75",
    "#378add",
    "#7f77dd",
    "#b4b2a9",
];

/* ------------------------------------------------------------------ */
/* 统一素材库                */
/* ------------------------------------------------------------------ */

/**
 * 素材库条目的存放范围。
 *
 * 用户要求「逐条可选」：私有素材放本地，公共预设发布到房间。
 *   - `"local"` 浏览器 localStorage，只有自己看得见
 *   - `"scene"` 场景 metadata，房间内所有人可见
 */
export type ArchiveScope = "local" | "scene";

/**
 * 一条素材库记录 = 状态定义 + 可选图标 + 可选物件快照。
 *
 * 【为什么是合并的】
 * 旧版把「状态预设」与「图片存档」做成两个东西，导致同一个状态要分两处维护、
 * 套用和复用分成两步。这里合成一条：字段齐了，套用与存档就是同一个动作。
 */
export interface ArchiveEntry {
    id: string;
    /** 存哪里：私有 / 房间共享 */
    scope: ArchiveScope;
    /** 状态名 */
    name: string;
    /** Slate 富文本 */
    desc: unknown;
    /** 富文本的纯文本备份 */
    descPlain: string;
    /** 默认持续轮数，0 = 永久 */
    rounds: number;
    /** 配色（十六进制） */
    color: string;
    /** 图标图片 URL；空串 = 纯文字预设，不贴图 */
    imageUrl: string;
    /** 物件级快照（子物件与相对位置）。纯文字预设为 undefined。 */
    snapshot?: {
        layer: string;
        zIndex?: number;
        position: { x: number; y: number };
        name: string;
        /** 相对坐标的附件列表 */
        attachments: unknown;
        lastModified: string;
    };
    /** 最后更新时间，用于排序 */
    updatedAt: number;
}

/** 本地素材库的 localStorage 键名 */
export const STORAGE_KEY = "status-peek/archive/local";

/** 素材库版本号 */
export const ARCHIVE_VERSION = 1;

/**
 * 场景级：素材库
 *
 * 选scene 而非 localStorage 的原因：用户要求「房间内其他人能看到」。
 * scene metadata 由宿主同步给房间内全部客户端，天然共享。
 */
export const SCENE_LIBRARY_KEY = "status-peek/library";

/** 状态库版本号，便于将来迁移 */
export const LIBRARY_VERSION = 1;

/* ------------------------------------------------------------------ */
/* 先攻回合数                                                          */
/* ------------------------------------------------------------------ */

/**
 * 先攻扩展（obr-suite 的 initiative 模块）写在**场景 metadata**里的回合状态。
 *
 * 【为什么直接读别人的键】
 * 这是场景数据，不是对方的私有内存。任何扩展 `OBR.scene.getMetadata()` 都能读到，
 * 不需要对方配合广播协议，也不需要 import 它的代码。
 * 对方不装先攻扩展时这个键不存在 → readCombatRound 返回 null，本插件不做任何递减。
 */
export const COMBAT_STATE_KEY = "com.initiative-tracker/combat";

export interface CombatState {
    inCombat: boolean;
    round: number;
}

/** 读当前回合。不在战斗中、或先攻扩展未安装、或数据异常 → null。 */
export function readCombatRound(sceneMetadata: Record<string, unknown>): number | null {
    const raw = sceneMetadata[COMBAT_STATE_KEY];
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const state = raw as Partial<CombatState>;
    if (state.inCombat !== true) {
        return null;
    }
    const round = Number(state.round);
    if (!Number.isFinite(round) || round <= 0) {
        return null;
    }
    return Math.floor(round);
}

/* ------------------------------------------------------------------ */
/* attachment 上的状态读取                                             */
/* ------------------------------------------------------------------ */

export interface StatusPeekData {
    /** 状态名 */
    name: string;
    /** Slate 富文本 */
    desc: unknown;
    /** 纯文本备份 */
    descPlain: string;
    /** 创建时的持续轮数，0 = 永久 */
    rounds: number;
    /** 施加时的回合快照，-1 = 未记录 */
    appliedRound: number;
    /** 是否已过期 */
    expired: boolean;
    /** 来源模板 id */
    templateId: string;
    /** 配色（十六进制） */
    color: string;
    /** 是否有状态（用于快速过滤） */
    has: boolean;
}

export const EMPTY_PEEK: StatusPeekData = {
    name: "",
    desc: null,
    descPlain: "",
    rounds: 0,
    appliedRound: -1,
    expired: false,
    templateId: "",
    color: "#888780",
    has: false,
};

export function readPeek(metadata: Record<string, unknown>): StatusPeekData {
    const name = metadata[META_NAME];
    const descPlain = metadata[META_DESC_PLAIN];
    const rounds = metadata[META_ROUNDS];
    const appliedRound = metadata[META_APPLIED_ROUND];
    const expired = metadata[META_EXPIRED];
    const templateId = metadata[META_TEMPLATE_ID];
    const color = metadata[META_COLOR];
    const has = metadata[META_HAS];

    return {
        name: typeof name === "string" ? name.slice(0, MAX_NAME_LENGTH) : "",
        desc: metadata[META_DESC] ?? null,
        descPlain: typeof descPlain === "string" ? descPlain : "",
        rounds: Number.isFinite(rounds) ? Math.max(0, Math.floor(rounds as number)) : 0,
        appliedRound: Number.isFinite(appliedRound) ? Math.floor(appliedRound as number) : -1,
        expired: expired === true,
        templateId: typeof templateId === "string" ? templateId : "",
        color: typeof color === "string" ? color : "#888780",
        has: has === true,
    };
}

/**
 * 算某个状态此刻还剩几轮。
 *
 * @param rounds 创建时的轮数，0 = 永久
 * @param appliedRound 施加时的回合快照，-1 = 未记录
 * @param currentRound 当前回合；null = 先攻不在进行中
 * @returns 剩余轮数；null = 无法判定（永久，或缺少回合快照）
 *
 * 过期判定用的是「经过了几轮」：`current - applied >= rounds` 即到期。
 * 这样即便 GM 中途才施加，也不会被误判。
 */
export function remainingRounds(
    rounds: number,
    appliedRound: number,
    currentRound: number | null,
): number | null {
    if (rounds <= 0) {
        return null;
    }
    if (currentRound === null || appliedRound < 0) {
        // 不在战斗中或没记录快照：无法自动倒推，只显示原值
        return rounds;
    }
    const elapsed = currentRound - appliedRound;
    if (elapsed <= 0) {
        return rounds;
    }
    return Math.max(0, rounds - elapsed);
}

/** 生成写入状态的 metadata 补丁 */
export function writePeek(input: {
    name: string;
    desc: unknown;
    descPlain: string;
    rounds: number;
    appliedRound: number;
    templateId?: string;
    color?: string;
}): Record<string, unknown> {
    const name = input.name.trim().slice(0, MAX_NAME_LENGTH);
    // 规则文本保留内部换行，只 trim 首尾空白
    const plain = input.descPlain.trim().slice(0, MAX_TEXT_LENGTH);
    return {
        [META_NAME]: name,
        [META_DESC]: input.desc ?? null,
        [META_DESC_PLAIN]: plain,
        [META_ROUNDS]: Math.max(0, Math.floor(input.rounds)),
        [META_APPLIED_ROUND]: input.appliedRound,
        [META_TEMPLATE_ID]: input.templateId ?? "",
        [META_COLOR]: input.color ?? "#888780",
        [META_EXPIRED]: false,
        [META_HAS]: name.length > 0 || plain.length > 0,
    };
}

/** 生成清除状态的 metadata 补丁（附件本体保留，只清状态） */
export function clearPeek(): Record<string, unknown> {
    return {
        [META_NAME]: "",
        [META_DESC]: null,
        [META_DESC_PLAIN]: "",
        [META_ROUNDS]: 0,
        [META_APPLIED_ROUND]: -1,
        [META_TEMPLATE_ID]: "",
        [META_COLOR]: "#888780",
        [META_EXPIRED]: false,
        [META_HAS]: false,
    };
}

/* ------------------------------------------------------------------ */
/* 图层与扩展常量                                                      */
/* ------------------------------------------------------------------ */

/** 本扩展只接受这两类图层 */
export const TARGET_LAYERS = ["ATTACHMENT", "PROP"] as const;

export type TargetLayer = (typeof TARGET_LAYERS)[number];

export function isTargetLayer(layer: string): layer is TargetLayer {
    return (TARGET_LAYERS as readonly string[]).includes(layer);
}

/** hover 模式 id */
export const TOOL_MODE_ID = "status-peek-plus/mode/hover";
/** hover 时弹出的 popover id */
export const POPOVER_ID = "status-peek-plus/popover/peek";

/**
 * Owlbear 内置「移动」工具的 id。
 *
 * 【这是什么】
 * OBR 内置工具的 id 是宿主定的，命名规律 `rodeo.owlbear.tool/<名称>`：
 * move = 移动/拖动物件的工具，select = 选择，measure = 测量
 * （后两者分别见于 Stat Bubbles 与官方 ranges 扩展的源码）。
 *
 * 【为什么要显式挂到它上面】
 * createMode 注册的模式若不指定 activeTools，图标会出现在**所有**工具的
 * 顶栏里（官方教程原话："If we were to remove this filter then our custom
 * mode would be available to all tools"）。查看状态是个移动时才会用到的
 * 附属功能，挂到 move 工具的顶栏正合适。
 */
export const TOOL_MOVE_ID = "rodeo.owlbear.tool/move";

/**
 * 浮层页面向background 回报自身高度的广播频道。
 *
 * 【为什么不用 postMessage】
 * peek.html 跑在 popover 的 iframe 里，它的 parent 是**宿主页面**而不是本扩展的
 * background；SDK 没有把这类窗口消息转发回扩展的接口。
 * 只有 OBR.broadcast 能跨回background（同扩展LOCAL 通道）。
 */
export const BC_PEEK_RESIZE = "status-peek-plus/peek-resize";

/**
 * 编辑模态框 ID
 *
 * 【重要】必须与旧版 Status Peek 的 ID 不同！
 * 旧版用的是 `status-peek-edit-modal`，若相同，当旧扩展同时安装时，
 * OBR 会解析到旧扩展注册的 modal（指向旧域名），导致弹窗打不开。
 */
export const MODAL_EDIT_ID = "status-peek-plus-edit-modal";

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
 *   location.href = https://host/status-peek/background.html
 *   siblingUrl("edit.html") → https://host/status-peek/edit.html
 */
export function siblingUrl(file: string): string {
    if (typeof location === "undefined") {
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