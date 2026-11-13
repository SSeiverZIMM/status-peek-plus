/**
 * 主题适配：跟随 Owlbear 原生界面的明暗与配色
 *
 * 【为什么不能自己判断明暗】
 * SDK 的 `Theme.mode` 是**大写**的 `"DARK" | "LIGHT"`。旧代码写的是
 * `mode === "dark"`，永远为false —— 深色模式从来没生效过。
 *
 * 【为什么不只切一个 class】
 * 用户要求「匹配枭熊原生界面」。宿主主题是可以被用户自定义的（primary 色、
 * 背景深浅都由用户的 Owlbear 设置决定），写死一套深色配色只会「像」深色，
 * 不会「是」。所以这里把宿主给的颜色原样注入成 CSS 变量，
 * 样式表全部改用 var()，这样换主题色时本扩展会跟着变。
 */

import OBR, { type Theme } from "@owlbear-rodeo/sdk";

/** 主色在当前明暗下该取哪个变体 */
function accent(theme: Theme): string {
    return theme.mode === "DARK"
        ? theme.primary.light
        : theme.primary.dark;
}

/**
 * 混合出「主色的低透明度版本」，用于描边与淡底。
 *
 * 优先用 `color-mix()`（能得到真正跟随主题的半透明主色）；
 * 万一宿主浏览器不支持（很老的 WebView），退回一个不依赖 color-mix 的
 * 近似值 —— 用主题的暗色文字色来混，至少明暗层次是对的，不会整块透明。
 */
function tint(hex: string, percent: number, fallback: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
        if (CSS.supports("color", "color-mix(in srgb, red 50%, transparent)")) {
            return `color-mix(in srgb, ${hex} ${percent}%, transparent)`;
        }
    }
    return fallback;
}

/**
 * 把宿主主题写进 CSS 变量并切 body.dark。
 *
 * 幂等，可重复调用（主题切换时宿主会再回调一次）。
 */
export function applyTheme(theme: Theme): void {
    const dark = theme.mode === "DARK";
    document.body.classList.toggle("dark", dark);

    const root = document.documentElement;
    const set = (name: string, value: string): void => {
        root.style.setProperty(name, value);
    };

    // 页面底色用 default，卡片/输入框用 paper —— 与宿主自身的层次一致
    set("--spp-bg", theme.background.default);
    set("--spp-surface", theme.background.paper);
    set("--spp-text", theme.text.primary);
    set("--spp-text-2", theme.text.secondary);
    set("--spp-text-3", theme.text.disabled);

    const a = accent(theme);
    set("--spp-accent", a);
    // 主色上的可读文字色，直接用宿主给的contrastText
    set("--spp-on-accent", theme.primary.contrastText);

    // 描边与淡底。老浏览器退回到用文字色混的近似值。
    const line = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)";
    const wash = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)";
    set("--spp-line", tint(a, 26, line));
    set("--spp-line-2", tint(a, 45, line));
    set("--spp-wash", tint(a, 12, wash));
    set("--spp-wash-2", tint(a, 7, wash));
    set("--spp-wash-hover", tint(a, 20, wash));
}

/** 读当前主题并应用；宿主主题变化时自动跟随，返回取消订阅函数 */
export async function watchTheme(): Promise<VoidFunction> {
    applyTheme(await OBR.theme.getTheme());
    return OBR.theme.onChange(applyTheme);
}