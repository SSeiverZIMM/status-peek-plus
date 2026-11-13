/**
 * peek.html 的样式注入
 *
 * 卡片样式本体在 ui/peek-card.ts（与 background 的离屏测量共用），
 * 这里只负责把它套到本页面结构上。
 *
 * 【html/body 必须不透明且与卡片同色】
 * iframe 的高度由 background 预先量准，但万一量错了（比如富文本里有
 * 异步加载的图片），多出来的那截若是透明就会直接透出宿主画布，
 * 表现为「黑边」。铺上同色底色后，最坏情况只是卡片偏高一点。
 */

import { CARD_CSS } from "./peek-card";

const STYLE_ID = "status-peek-peek-style";

const CSS = `
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; overflow: hidden;
  width: 100%; height: 100%;
  /* 兜底底色：主题变量未就绪时至少是浅色，不至于透明露画布 */
  background: #fff;
}
/* scope 类挂在 body 上，承接 CARD_CSS（与 background 的离屏测量容器同名同规则） */
body { display: flex; align-items: flex-start; }
#root { width: 100%; }
${CARD_CSS}
`;

/** 注入样式（幂等），并给 body 挂上量高度用的 scope 类 */
export function injectPeekStyle(): void {
    document.body.classList.add("spp-peek-scope");
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
}