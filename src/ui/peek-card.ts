/**
 * 浮层卡片的构建与样式（peek.html 与 background 共用）
 *
 * 【为什么要抽到一处】
 * popover 的 `open()` 必须**同步给一个高度**，不给就会按内容撑开或者沿用
 * 上次的值 —— 无论哪种，都会先显示一帧再被 `setHeight` 修正，那一帧就是
 * 用户看到的「底部空框边缘」。
 *
 * 唯一的根治办法是：**开之前就量准**。但量高度需要用与 peek.html
 * 完全相同的排版规则去渲染一遍，所以卡片构建 + 样式必须共用，
 * 否则量出来的数和实际渲染对不上，误差又变成另一种闪。
 */

import type { RichText } from "@owlbear-rodeo/sdk";

/** 浮层宽度（open 时给宿主，量高度时也要用同一个值） */
export const POPOVER_W = 320;

export interface PeekPayload {
    /** 状态名 */
    name: string;
    /** Slate 富文本 */
    desc: RichText | null;
    /** 纯文本备份 */
    descPlain: string;
    /** 剩余轮数；null = 永久或无法判定 */
    remaining: number | null;
    /** 原始轮数 */
    rounds: number;
    /** 是否过期 */
    expired: boolean;
    /** 十六进制配色 */
    color: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * 把 Slate 节点渲染成 DOM。
 *
 * 只支持 SDK TextContent 里定义的那几种节点（heading-one/two、paragraph、
 * bulleted/numbered-list、list-item），其余一律降级为纯文本，
 * 避免使用者从别的工具粘来奇怪结构时整块炸掉。
 */
function renderRichText(nodes: RichText | null, plain: string): DocumentFragment {
    const frag = document.createDocumentFragment();

    if (!Array.isArray(nodes) || nodes.length === 0) {
        frag.appendChild(el("p", "body", plain));
        return frag;
    }

    for (const node of nodes) {
        if (typeof node !== "object" || node === null) continue;

        // FormattedText —— 顶层裸文本
        if ("text" in node && typeof (node as { text: unknown }).text === "string") {
            frag.appendChild(renderFormatted(node));
            continue;
        }

        if (!("type" in node) || !("children" in node)) continue;
        const typed = node as unknown as {
            type: string;
            children: Array<Record<string, unknown>>;
        };
        const children = Array.isArray(typed.children) ? typed.children : [];

        switch (typed.type) {
            case "heading-one":
                frag.appendChild(el("h1", "h", inlineAll(children)));
                break;
            case "heading-two":
                frag.appendChild(el("h2", "h", inlineAll(children)));
                break;
            case "paragraph": {
                const p = el("p", "body");
                for (const c of children) p.appendChild(renderFormatted(c));
                frag.appendChild(p);
                break;
            }
            case "bulleted-list":
            case "numbered-list": {
                const list = el(typed.type === "numbered-list" ? "ol" : "ul");
                for (const item of children) {
                    const li = el("li");
                    if (item && typeof item === "object" && "children" in item) {
                        const kids = (item as unknown as {
                            children: Array<Record<string, unknown>>;
                        }).children;
                        for (const k of Array.isArray(kids) ? kids : []) {
                            li.appendChild(renderFormatted(k));
                        }
                    }
                    list.appendChild(li);
                }
                frag.appendChild(list);
                break;
            }
            default:
                // 未知节点：把里面的纯文本捞出来
                frag.appendChild(el("p", "body", inlineAll(children)));
        }
    }

    return frag;
}

/** 渲染一个 FormattedText 节点（含加粗/斜体/下划线） */
function renderFormatted(node: unknown): DocumentFragment {
    const frag = document.createDocumentFragment();

    if (typeof node === "string") {
        frag.appendChild(document.createTextNode(node));
        return frag;
    }
    if (typeof node !== "object" || node === null) return frag;

    const n = node as {
        text?: unknown;
        bold?: unknown;
        italic?: unknown;
        underline?: unknown;
    };
    if (typeof n.text !== "string") return frag;

    let target: Node = document.createTextNode(n.text);
    const wrap = (tag: "b" | "i" | "u"): DocumentFragment => {
        const f = document.createDocumentFragment();
        const e = document.createElement(tag);
        e.appendChild(target);
        f.appendChild(e);
        return f;
    };

    if (n.bold === true) target = wrap("b");
    if (n.italic === true) target = wrap("i");
    if (n.underline === true) target = wrap("u");

    frag.appendChild(target);
    return frag;
}

/** 顶层纯文本拼接，用于 heading 之类只需文字的地方 */
function inlineAll(children: Array<Record<string, unknown>>): string {
    let out = "";
    for (const c of children) {
        if (typeof c?.text === "string") out += c.text;
    }
    return out;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * 构建卡片的轮数行。
 *
 * 四态互斥、措辞唯一 —— 调试期若两种状态显示同一句话，
 * 会让人误判问题出在数据层还是渲染层（踩过这个坑）。
 */
function buildFoot(payload: PeekPayload): HTMLElement {
    const foot = el("div", "foot");
    if (payload.expired) {
        foot.appendChild(el("span", "pill expired-pill", "已结束"));
    } else if (payload.rounds <= 0) {
        foot.appendChild(el("span", "pill muted", "持续：不限"));
    } else if (payload.remaining === null) {
        // 读不到回合数（先攻不在战斗 / 缺快照）。明确说明，不谎报剩余。
        foot.appendChild(
            el("span", "pill muted", `持续：${payload.rounds} 轮（未倒数）`),
        );
    } else if (payload.remaining > 0) {
        foot.appendChild(
            el("span", "pill", `剩 ${payload.remaining} / ${payload.rounds} 轮`),
        );
    } else {
        foot.appendChild(el("span", "pill expired-pill", "本轮到期"));
    }
    return foot;
}

/** 构建整张卡片（不含外层 #root） */
export function buildCard(payload: PeekPayload): HTMLElement {
    const card = el("div", `card${payload.expired ? " expired" : ""}`);

    // 左侧色条用状态库里的颜色
    const bar = el("div", "bar");
    bar.style.background = HEX.test(payload.color) ? payload.color : "#888780";
    card.appendChild(bar);

    const body = el("div", "body-wrap");

    if (payload.name) {
        const h = el("div", "title", payload.name);
        h.style.color = HEX.test(payload.color) ? payload.color : "";
        body.appendChild(h);
    }

    const desc = el("div", "desc");
    desc.appendChild(renderRichText(payload.desc, payload.descPlain));
    body.appendChild(desc);

    body.appendChild(buildFoot(payload));

    card.appendChild(body);
    return card;
}

/**
 * 卡片样式。
 *
 * 用 `.spp-peek-scope` 包一层，作用域化后同一份CSS 既能注入 peek.html 的
 * body（量高度与实际渲染必须是同一套规则），也能注入 background 里那个
 * 离屏测量容器，不会互相污染。
 *
 * 注意：**不能给 .card / #root 加 flex: 1 撑满**。一旦卡片高度等于容器
 * 高度，background 就再也量不出「内容到底多高」，open 时只能瞎猜，
 * 于是又会闪出一截空的iframe。
 */
export const CARD_CSS = `
.spp-peek-scope {
  margin: 0; padding: 0; overflow: hidden;
  width: 100%; height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px; line-height: 1.6;
}
.spp-peek-scope .card {
  width: 100%;
  display: flex; align-items: stretch;
  background: var(--spp-surface, #fff);
  border: 1px solid var(--spp-line, rgba(0,0,0,0.15));
  border-radius: 12px;
  overflow: hidden;
}
.spp-peek-scope .card.expired { opacity: 0.72; }
.spp-peek-scope .bar { width: 4px; flex: 0 0 4px; }
.spp-peek-scope .body-wrap { flex: 1; min-width: 0; padding: 10px 14px 10px 12px; }
.spp-peek-scope .title {
  font-size: 15px; font-weight: 500; line-height: 1.4;
  margin-bottom: 6px; word-break: break-word;
}
.spp-peek-scope .h {
  font-size: 14px; font-weight: 500; margin: 8px 0 4px; line-height: 1.4;
}
.spp-peek-scope .h:first-child { margin-top: 0; }
.spp-peek-scope .desc {
  font-size: 13px; line-height: 1.6;
  color: var(--spp-text-2, #444441); word-break: break-word;
}
.spp-peek-scope .desc p { margin: 0 0 6px; }
.spp-peek-scope .desc p:last-child { margin-bottom: 0; }
.spp-peek-scope .desc ul, .spp-peek-scope .desc ol { margin: 4px 0 6px; padding-left: 18px; }
.spp-peek-scope .desc li { margin: 2px 0; }
.spp-peek-scope .foot { margin-top: 10px; }
.spp-peek-scope .pill {
  display: inline-block; font-size: 12px; line-height: 1;
  padding: 5px 9px; border-radius: 999px;
  background: var(--spp-wash-2, rgba(0,0,0,0.06)); color: var(--spp-text, #2c2c2a);
}
.spp-peek-scope .pill.muted {
  background: var(--spp-wash-2, rgba(0,0,0,0.04)); color: var(--spp-text-3, #5f5e5a);
}
.spp-peek-scope .pill.expired-pill {
  background: var(--spp-wash-2, rgba(0,0,0,0.05));
  color: var(--spp-text-3, #5f5e5a); text-decoration: line-through;
}
`;