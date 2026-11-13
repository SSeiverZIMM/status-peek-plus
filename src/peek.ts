/**
 * [状态描述] hover 浮层
 *
 * 由hover 工具模式弹出的只读卡片。数据通过 URL hash 传入。
 *
 * 传参用 URL hash 而非 query：popover 的 URL 由后台脚本拼装，
 * hash 里放 JSON 更省事，且不会和 background 的 query 混淆。
 *
 * 【本页面的职责被刻意压缩到最小】
 * 卡片的构建与样式都在 ui/peek-card.ts —— 因为 background 需要用
 * **完全相同的排版**先离屏量一遍高度，才能在 open() 时给出准确高度，
 * 避免先显示一帧再被 setHeight 拉回去（那一帧就是用户看到的空框边缘）。
 * 本页面只负责：解析 hash → 调buildCard → 量一次真实高度回报给 background。
 */

import OBR from "@owlbear-rodeo/sdk";
import { BC_PEEK_RESIZE } from "./shared";
import { injectPeekStyle } from "./ui/style-peek";
import { applyTheme } from "./ui/theme";
import { buildCard, type PeekPayload } from "./ui/peek-card";

injectPeekStyle();

function parseHash(): PeekPayload | null {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) {
        return null;
    }
    try {
        const obj = JSON.parse(decodeURIComponent(raw));
        if (typeof obj !== "object" || obj === null) {
            return null;
        }
        return obj as PeekPayload;
    } catch {
        return null;
    }
}

function render(payload: PeekPayload): void {
    const root = document.getElementById("root");
    if (!root) return;
    root.innerHTML = "";

    const card = buildCard(payload);
    root.appendChild(card);

    /**
     * 回报真实高度，让 background 用 setHeight 修正。
     *
     * 正常情况下 background 已经预先量准了，这一步只是兜底
     * （富文本里若有异步加载的图片，实际高度会比我预量的更高）。
     *
     * 用 `parent.postMessage` 是**无效**的：popover iframe 的 parent
     * 是宿主页面，SDK 不会把窗口消息转发回扩展 background，
     * 只能靠 OBR.broadcast 的 LOCAL 通道。
     */
    function report(): void {
        const h = Math.ceil(card.getBoundingClientRect().height) + 1;
        try {
            void OBR.broadcast.sendMessage(
                BC_PEEK_RESIZE,
                { height: h },
                { destination: "LOCAL" },
            );
        } catch {
            // OBR 不可用时静默忽略：CSS 已铺同色底色，不至于露出画布
        }
    }
    requestAnimationFrame(report);
    // 富文本可能带异步字体/图片，等一拍再报一次
    setTimeout(report, 120);
}

const payload = parseHash();

// 主题跟随宿主。浮层每次打开都是同一个 iframe，这里应用一次即可；
// 宿主中途切主题时也顺手订阅上。
OBR.onReady(() => {
    void OBR.theme.getTheme().then(applyTheme);
    OBR.theme.onChange(applyTheme);
});

if (payload) {
    render(payload);
} else {
    const root = document.getElementById("root");
    if (root) root.innerHTML = "";
}