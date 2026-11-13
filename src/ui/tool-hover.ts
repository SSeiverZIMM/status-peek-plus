/**
 * hover 工具模式
 *
 * 【为什么需要工具模式】
 * SDK 3.1.0 的 187 条消息里没有任何 hover / pointermove / mouseover。
 * 官方文档 Tool 页原文：
 *   "Once a mode is active it will receive pointer events such as
 *    onToolMove and onToolDragMove."
 * —— 模式一旦激活，**纯移动（不按鼠标）**就会持续回调 onToolMove，
 *    事件里带 pointerPosition（光标世界坐标）与 target（光标下的物件）。
 *    这是悬浮显示唯一的可行路径。
 *
 * 【限制】
 * Owlbear 工具互斥单选：玩家切到别的工具/模式，悬浮立刻失效。
 * 这是宿主层面的约束，无法绕过。
 * 模式图标经 activeTools 限定到内置 move 工具，只在移动工具的顶栏显示。
 */

import OBR, { type Item, type ToolEvent } from "@owlbear-rodeo/sdk";
import {
    BC_PEEK_RESIZE,
    META_COLOR,
    META_HAS,
    POPOVER_ID,
    TOOL_MODE_ID,
    TOOL_MOVE_ID,
    readPeek,
    remainingRounds,
    readCombatRound,
    selfBaseUrl,
    siblingUrl,
} from "../shared";
import { buildCard, CARD_CSS, POPOVER_W, type PeekPayload } from "./peek-card";

/** 判定命中的物件是否带状态描述 */
function hasStatus(item: Item | undefined): item is Item {
    return !!item && item.metadata?.[META_HAS] === true;
}

/** 光标是否还在同一个物件上 —— 决定要不要收起浮层 */
let currentTargetId: string | null = null;
let popoverOpen = false;

/**
 * 上一次开浮层时的状态快照。
 *
 * 浮层内容里的「剩余轮数」依赖当前回合，回合推进后必须刷新；
 * 但 onToolMove 在纯移动时高频触发，不能每次都重开（会闪）。
 * 于是只在「回合变了」或「过期标记变了」时才重开。
 */
let openedAtRound: number | null = null;
let openedWithExpired = false;

/** 当前浮层的实际高度；用于回报去抖，避免与取整误差来回 setHeight */
let currentHeight: number | null = null;

/** 读当前回合；读不到返回 null（先攻不在战斗 / 未安装） */
async function fetchRound(): Promise<number | null> {
    try {
        return readCombatRound(await OBR.scene.getMetadata());
    } catch {
        return null;
    }
}

async function closePopover(): Promise<void> {
    if (!popoverOpen) return;
    popoverOpen = false;
    currentTargetId = null;
    currentHeight = null;
    try {
        await OBR.popover.close(POPOVER_ID);
    } catch {
        // 宿主可能已经把它关了，忽略
    }
}

/** 组装浮层数据 */
async function buildPayload(item: Item): Promise<{
    url: string;
    payload: PeekPayload;
} | null> {
    const peek = readPeek(item.metadata);

    let round: number | null = null;
    let diag = "";
    try {
        const sceneMeta = await OBR.scene.getMetadata();
        round = readCombatRound(sceneMeta);
        // 诊断：把场景 metadata 的键名打出来，便于排查回合数读不到的问题
        diag = `keys=[${Object.keys(sceneMeta).join(",")}] `;
    } catch (e) {
        diag = `getMetadata failed: ${String(e)} `;
    }

    const remaining = peek.expired
        ? 0
        : remainingRounds(peek.rounds, peek.appliedRound, round);

    console.log(
        `[status-peek] hover → rounds=${peek.rounds} applied=${peek.appliedRound} ` +
            `round=${String(round)} remaining=${String(remaining)} ${diag}`,
    );

    // 过期优先：已结束就显示已结束，剩余轮数没意义
    const payload: PeekPayload = {
        name: peek.name,
        desc: peek.desc as PeekPayload["desc"],
        descPlain: peek.descPlain,
        remaining: peek.expired ? null : remaining,
        rounds: peek.rounds,
        expired: peek.expired,
        color:
            (item.metadata?.[META_COLOR] as string | undefined) ?? "#888780",
    };

    const url = `${siblingUrl("peek.html")}#${encodeURIComponent(
        JSON.stringify(payload),
    )}`;

    return { url, payload };
}

/** 浮层与标记之间的间距（像素） */
const GAP = 12;
/* POPOVER_W 由 peek-card 提供，量高度与 open 必须用同一个值 */

/* ------------------------------------------------------------------ */
/* 离屏量高度                                                          */
/* ------------------------------------------------------------------ */

/**
 * 在 background 里离屏渲染一遍卡片，量出它真实的高度。
 *
 * 【为什么必须量，而不是猜】
 * `OBR.popover.open()` 要求**同步**给一个 height。给高了，页面渲染完才
 * 会被 setHeight 拉回去 —— 中间那一帧用户看到的就是卡片底下多出一截空框；
 * 给低了，文字会被裁掉。所以正确的做法是开之前就量准。
 *
 * 【为什么样式/构建要共用】
 * 这里量出来的数只有在排版规则与 peek.html **完全一致**时才有意义。
 * 故卡片构建与 CSS 都放在 ui/peek-card.ts，两边共用同一份。
 *
 * 【为什么量完不立刻删掉】
 * 富文本里可能有异步加载的图片，第一次量偏小。保留容器，等页面回报真实
 * 高度后再用 setHeight 修正即可，不必重排。
 */
let measureHost: HTMLDivElement | null = null;
const MEASURE_STYLE_ID = "spp-peek-measure-style";

function ensureMeasureHost(): HTMLDivElement {
    if (measureHost) return measureHost;

    if (!document.getElementById(MEASURE_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = MEASURE_STYLE_ID;
        style.textContent = CARD_CSS;
        document.head.appendChild(style);
    }

    const host = document.createElement("div");
    // scope 类承接 CARD_CSS；用 fixed + 移出视口的方式离屏，
    // 不能用 display:none —— 那样拿不到布局高度。
    host.className = "spp-peek-scope";
    host.style.cssText =
        "position:fixed; left:-10000px; top:0; visibility:hidden;" +
        "pointer-events:none; contain:layout style;";
    document.body.appendChild(host);
    measureHost = host;
    return host;
}

/** 量出卡片高度（像素，含 1px 余量抵消取整误差） */
function measureCardHeight(payload: PeekPayload): number {
    try {
        const host = ensureMeasureHost();
        // 宽度必须与 open() 时给宿主的完全一致，否则换行点不同、高度不同
        host.style.width = `${POPOVER_W}px`;
        const card = buildCard(payload);
        host.innerHTML = "";
        host.appendChild(card);
        return Math.ceil(card.getBoundingClientRect().height) + 1;
    } catch {
        // 量不出来就退回一个偏大的值：宁可多一截纯色，也不要裁掉文字
        return 220;
    }
}

/**
 * 计算浮层的锚点：标记的正上方偏左，浮层底部贴着标记顶部。
 *
 * 用 `OBR.viewport.transformPoint` 把标记的世界坐标转成屏幕坐标，
 * `anchorOrigin.vertical = BOTTOM` + `transformOrigin.vertical = BOTTOM`
 * 表示 anchorPosition.top 是浮层**底边**的 y。
 *
 * 所以：anchor.top = 标记屏幕顶边 - GAP，浮层就悬在标记上方 GAP 处。
 */
async function anchorAboveItem(
    item: Item,
): Promise<{ left: number; top: number }> {
    const fallback = { left: 0, top: 0 };
    try {
        const box = await OBR.scene.items.getItemBounds([item.id]);
        // center / min 都是世界坐标
        const centerScreen = await OBR.viewport.transformPoint(box.center);
        const minScreen = await OBR.viewport.transformPoint(box.min);

        // 水平：以标记中心为基准，卡片居中对齐，并夹在视口内
        const vw = await OBR.viewport.getWidth();
        const left = Math.max(
            8,
            Math.min(vw - POPOVER_W - 8, centerScreen.x - POPOVER_W / 2),
        );

        // 垂直：标记顶边（屏幕 y）再往上抬 GAP。
        // anchorOrigin.vertical=BOTTOM 表示 top 是浮层**底边**，故直接用顶边。
        const top = minScreen.y - GAP;

        // 顶部越界时翻到标记下方，避免浮层跑到画面外看不见
        if (top < 8) {
            const maxScreen = await OBR.viewport.transformPoint(box.max);
            return { left, top: maxScreen.y + GAP };
        }
        return { left, top };
    } catch {
        return fallback;
    }
}

async function openPopover(item: Item, position: { x: number; y: number }): Promise<void> {
    const built = await buildPayload(item);
    if (!built) return;

    const anchor = await anchorAboveItem(item);
    // 坐标取不到时退回光标位置
    const finalAnchor =
        anchor.left === 0 && anchor.top === 0
            ? { left: position.x, top: position.y }
            : anchor;

    // 开之前先离屏量出真实高度。这一步是「打开瞬间不闪出空框」的关键：
    // open() 必须同步给height，给不准就会先显示一帧再被拉回去。
    const height = measureCardHeight(built.payload);

    try {
        await OBR.popover.open({
            id: POPOVER_ID,
            url: built.url,
            width: POPOVER_W,
            height,
            anchorReference: "POSITION",
            anchorPosition: finalAnchor,
            // vertical = BOTTOM：anchorPosition.top 是浮层**底边**的 y
            anchorOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
            transformOrigin: { horizontal: "LEFT", vertical: "BOTTOM" },
            hidePaper: true,
            disableClickAway: true,
        });
        popoverOpen = true;
        // 记录当前高度，好让页面回报的第一帧不会被去抖吃掉
        currentHeight = height;
        openedAtRound = await fetchRound();
        openedWithExpired = readPeek(item.metadata).expired;
    } catch {
        popoverOpen = false;
    }
}

/**
 * 处理一次指针移动。
 *
 * 命中带描述的物件 → 开浮层；否则收起。
 *
 * 同一物件上默认**不重开**浮层：onToolMove 在纯移动时高频触发，
 * 每次都 popover.open 会闪到无法忍受。
 * 只有当「回合数变了」或「过期标记变了」才重开，
 * 这样剩余轮数既能保持准确，又不会每动一下鼠标就闪一次。
 */
async function handleMove(event: ToolEvent): Promise<void> {
    const item = hasStatus(event.target) ? event.target : undefined;

    if (!item) {
        await closePopover();
        return;
    }

    if (popoverOpen && currentTargetId === item.id) {
        const round = await fetchRound();
        const expiredNow = readPeek(item.metadata).expired;
        if (round === openedAtRound && expiredNow === openedWithExpired) {
            return;
        }
    }

    await closePopover();
    currentTargetId = item.id;
    await openPopover(item, event.pointerPosition);
}

export async function installHoverMode(): Promise<void> {
    await OBR.tool.createMode({
        id: TOOL_MODE_ID,
        icons: [
            {
                icon: `${selfBaseUrl()}icon-v3.svg`,
                label: "查看状态描述",
                // 【为什么必须加这个 filter】
                // 不带 filter 的模式图标会出现在所有工具的顶栏里，
                // 把测量、绘图这些无关工具的顶栏也塞满。
                // 限定到内置 move 工具后，只有移动工具时才显示。
                filter: {
                    activeTools: [TOOL_MOVE_ID],
                },
            },
        ],
        // 不阻止拖动，允许玩家在查看模式下仍能拖东西
        onToolMove: (_context, event) => {
            void handleMove(event);
        },
        onToolDown: (_context, event) => {
            // 按下时也刷新一次：此时 target 一定是精确命中的物件
            void handleMove(event);
        },
        onActivate: () => {
            void closePopover();
        },
        onDeactivate: () => {
            void closePopover();
        },
    });
}

/** 收到浮层页面的高度回报 */
export function onPopoverResize(height: number): void {
    if (!popoverOpen || !Number.isFinite(height) || height <= 0) return;
    // 差值过小就不再调，避免与 1px 的取整误差来回抖动
    if (Math.abs((currentHeight ?? 0) - height) < 2) return;
    currentHeight = height;
    void OBR.popover.setHeight(POPOVER_ID, height);
}

/** 外部（如回合变化）主动收起浮层 */
export function closePopoverIfOpen(): Promise<void> {
    return closePopover();
}

/**
 * 监听 popover iframe 报回来的高度。
 *
 * 【为什么必须在这里接】
 * peek.html 用 `parent.postMessage` 回报真实高度，但 popover iframe 的 parent
 * 是**宿主页面**，不是本background。SDK 没有把这类消息转发回来的接口，
 * 只能靠宿主把扩展的消息重新广播回来 —— 即 OBR.broadcast 的 LOCAL 通道。
 */
export function listenForResize(): () => void {
    return OBR.broadcast.onMessage(BC_PEEK_RESIZE, (event) => {
        // 回调收到的是 { data, connectionId }，数据在 event.data 里
        const h = (event.data as { height?: unknown } | undefined)?.height;
        if (typeof h === "number") {
            onPopoverResize(h);
        }
    });
}