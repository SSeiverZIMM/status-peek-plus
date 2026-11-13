/**
 * 统一设计语言
 *
 * 所有颜色一律走 `var(--spp-*)`，由 ui/theme.ts 从 Owlbear 宿主主题注入。
 * 这样明暗与主题色都由宿主决定，本扩展只是跟随，不再自带一套配色。
 *
 * 变量含义：
 *   --spp-bg页面底色（宿主 background.default）
 *   --spp-surface卡片 / 输入框（宿主 background.paper）
 *   --spp-text / --spp-text-2 / --spp-text-3三级文字
 *   --spp-accent主色，--spp-on-accent主色上的文字
 *   --spp-line / --spp-line-2 两级描边
 *   --spp-wash / --spp-wash-2 主色淡底
 */

export const STYLE_ID = "spp-style";

export const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--spp-bg);
    color: var(--spp-text);
  }

  /* ---------- tab 栏 ---------- */
  #tabs {
    flex: none; display: flex; border-bottom: 1px solid var(--spp-line);
  }
  #tabs .tab {
    flex: 1; padding: 9px 0; text-align: center; cursor: pointer;
    font-size: 13px; color: var(--spp-text-2);
    border-bottom: 2px solid transparent;
    user-select: none;
  }
  #tabs .tab:hover { color: var(--spp-text); }
  #tabs .tab.active {
    color: var(--spp-accent); border-bottom-color: var(--spp-accent);
    font-weight: 600;
  }

  /* ---------- 面板 ---------- */
  #panel { flex: 1; overflow-y: auto; padding: 12px; }
  .hint { color: var(--spp-text-2); text-align: center; padding: 32px 16px; line-height: 1.8; }
  .hint b { color: var(--spp-text); }

  /* ---------- 卡片 ---------- */
  .card {
    border: 1px solid var(--spp-line); border-radius: 8px;
    padding: 10px 12px; margin-bottom: 10px;
    background: var(--spp-surface);
  }
  .card-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  }
  .swatch {
    width: 10px; height: 10px; border-radius: 3px; flex: none;
    background: var(--spp-accent);
  }
  .item-name {
    font-weight: 600; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .item-text { white-space: pre-wrap; word-break: break-word; line-height: 1.65; }
  .no-desc { color: var(--spp-text-3); font-style: italic; }

  /* ---------- 卡片上的轮数徽章 ---------- */
  .item-foot { margin-top: 8px; }
  .pill {
    display: inline-block; font-size: 11.5px; line-height: 1;
    padding: 5px 9px; border-radius: 999px;
    background: var(--spp-wash-2); color: var(--spp-text);
  }
  .pill.muted { background: var(--spp-wash-2); color: var(--spp-text-3); }
  .pill.expired-pill {
    background: var(--spp-wash-2); color: var(--spp-text-3); text-decoration: line-through;
  }
  .card-expired { opacity: 0.7; }

  /* ---------- 小按钮 ---------- */
  .btn {
    flex: none; border: 1px solid var(--spp-line-2);
    background: var(--spp-surface); color: var(--spp-text);
    border-radius: 5px; font-size: 12px; padding: 2px 8px; cursor: pointer;
    font-family: inherit;
  }
  .btn:hover { background: var(--spp-wash-2); }
  .btn.primary {
    border-color: var(--spp-accent);
    background: var(--spp-wash);
    color: var(--spp-accent);
  }
  .btn.primary:hover { background: var(--spp-wash-hover); }
  .btn.danger { border-color: #a85050; background: #fdf2f2; color: #a85050; }
  .btn.danger:hover { background: #fae8e8; }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn:disabled:hover { background: var(--spp-surface); }

  /* 危险按钮在深色下用深底浅字 */
  body.dark .btn.danger { background: #3a2727; border-color: #5e3d3d; color: #d99b9b; }
  body.dark .btn.danger:hover { background: #452e2e; }

  /* ---------- 模板卡片 ---------- */
  .tpl-head {
    display: flex; align-items: center; gap: 9px; cursor: pointer;
  }
  .tpl-thumb {
    width: 36px; height: 36px; flex: none; border-radius: 6px;
    object-fit: contain; background: var(--spp-wash-2);
    border: 1px solid var(--spp-line);
  }
  .tpl-meta { flex: 1; min-width: 0; }
  .tpl-name {
    font-weight: 600; font-size: 13px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tpl-sub { font-size: 11px; color: var(--spp-text-3); margin-top: 2px; }
  .tpl-actions { display: flex; gap: 4px; flex: none; }
  .tpl-body {
    display: none; margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--spp-line);
  }
  .tpl-body.open { display: block; }
  .tpl-row {
    display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .tpl-label { font-size: 11.5px; color: var(--spp-text-2); margin-right: 4px; }
  .tpl-toggle {
    border: 1px solid var(--spp-line-2);
    background: var(--spp-surface); color: var(--spp-text-2);
    border-radius: 5px; font-size: 11.5px; padding: 3px 9px; cursor: pointer;
    font-family: inherit;
  }
  .tpl-toggle.on {
    border-color: var(--spp-accent);
    background: var(--spp-wash);
    color: var(--spp-accent); font-weight: 600;
  }
  .tpl-note { font-size: 11px; color: var(--spp-text-3); line-height: 1.6; }
  .tpl-warn {
    font-size: 11px; color: #a85050; background: #fdf2f2;
    border: 1px solid #f0dada; border-radius: 5px;
    padding: 5px 8px; margin-bottom: 8px; line-height: 1.6;
  }
  body.dark .tpl-warn { background: #3a2727; border-color: #5e3d3d; color: #d99b9b; }

  /* ---------- 顶部工具条 ---------- */
  #toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px; border-bottom: 1px solid var(--spp-line); flex: none;
  }
  #search {
    flex: 1; min-width: 0; border: 1px solid var(--spp-line);
    border-radius: 6px; padding: 5px 8px;
    font-size: 12.5px; font-family: inherit;
    background: var(--spp-surface); color: var(--spp-text);
  }
  #search:focus { outline: none; border-color: var(--spp-accent); }
  #usage { font-size: 11px; color: var(--spp-text-3); flex: none; }

  /* ---------- 底部 ---------- */
  #footer {
    flex: none; border-top: 1px solid var(--spp-line); padding: 8px 12px;
    color: var(--spp-text-3); font-size: 12px;
    display: flex; justify-content: space-between;
  }
  #footer .mode { cursor: pointer; }

  /* ---------- 设置抽屉 ---------- */
  #settings {
    position: absolute; inset: 0; background: var(--spp-bg);
    transform: translateX(-100%); transition: transform .2s ease-in-out;
    display: flex; flex-direction: column;
  }
  #settings.open { transform: translateX(0); }
  .set-head {
    display: flex; align-items: center; gap: 8px;
    padding: 12px; border-bottom: 1px solid var(--spp-line);
  }
  .set-title { font-size: 14px; font-weight: 700; flex: 1; }
  .set-body { padding: 12px; overflow-y: auto; }
  .set-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0;
  }
  .set-item + .set-item { border-top: 1px solid var(--spp-line); }
  .set-desc { font-size: 11px; color: var(--spp-text-3); margin-top: 3px; line-height: 1.5; }

  /* ---------- 编辑模态框 ---------- */
  .modal-wrap {
    display: flex; flex-direction: column; height: 100%; padding: 14px;
    background: var(--spp-bg); color: var(--spp-text);
  }
  .modal-title {
    font-size: 14px; font-weight: 700; margin-bottom: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .modal-sub { font-size: 11.5px; color: var(--spp-text-2); margin-bottom: 10px; }
  .modal-label {
    font-size: 11.5px; color: var(--spp-text-2); margin-bottom: 5px;
    display: flex; justify-content: space-between;
  }
  #text {
    flex: 1; min-height: 120px; resize: none;
    border: 1px solid var(--spp-line); border-radius: 6px; padding: 9px 10px;
    font-family: inherit; font-size: 13px; line-height: 1.6;
    background: var(--spp-surface); color: var(--spp-text);
  }
  #text:focus { outline: none; border-color: var(--spp-accent); }
  .modal-persist {
    margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--spp-line);
  }
  .modal-persist-row { display: flex; gap: 6px; align-items: center; }
  .modal-status { font-size: 11.5px; color: var(--spp-text-2); margin-top: 7px; }
  .modal-status.on { color: var(--spp-accent); font-weight: 600; }

  /* ---------- 编辑表单新增控件 ---------- */
  .hint-inline { color: var(--spp-text-3); font-style: italic; }
  #name, #rounds {
    width: 100%; border: 1px solid var(--spp-line); border-radius: 6px;
    padding: 8px 10px; font-family: inherit; font-size: 13px;
    background: var(--spp-surface); color: var(--spp-text);
    margin-bottom: 12px;
  }
  #name:focus, #rounds:focus { outline: none; border-color: var(--spp-accent); }
  .color-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  #color { display: none; }
  .presets .swatch.selected {
    outline: 2px solid var(--spp-accent); outline-offset: 1px;
  }
  .presets { display: flex; flex-wrap: wrap; gap: 5px; }
  .presets .swatch {
    width: 20px; height: 20px; border-radius: 5px; cursor: pointer;
    border: 1px solid rgba(128,128,128,0.35); padding: 0;
  }
  .presets .swatch:hover { transform: scale(1.12); }

  /* ---------- 状态库 ---------- */
  .lib-add { width: 100%; margin: 4px 0 8px; }
  .lib-io { display: flex; gap: 8px; margin-bottom: 12px; }
  .lib-io .btn { flex: 1; }

  /* ---------- 素材库筛选 / 搜索 ---------- */
  .lib-filter { margin-bottom: 12px; }
  .lib-search {
    width: 100%; border: 1px solid var(--spp-line); border-radius: 6px;
    padding: 6px 9px; font-size: 12.5px; font-family: inherit;
    background: var(--spp-surface); color: var(--spp-text);
    margin-bottom: 8px;
  }
  .lib-search:focus { outline: none; border-color: var(--spp-accent); }
  .lib-chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .lib-filter .chip {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 26px; height: 26px; padding: 0 10px;
    border: 1px solid var(--spp-line-2); border-radius: 999px;
    background: var(--spp-surface); color: var(--spp-text-2);
    font-size: 11.5px; cursor: pointer; font-family: inherit;
  }
  .lib-filter .chip:hover { background: var(--spp-wash-2); }
  .lib-filter .chip.on {
    border-color: var(--spp-accent); background: var(--spp-wash);
    color: var(--spp-accent); font-weight: 600;
  }
  .lib-filter .chip .dot {
    width: 14px; height: 14px; border-radius: 5px; flex: none;
    border: 1px solid rgba(128,128,128,0.35);
  }
  .lib-filter-count { font-size: 11px; color: var(--spp-text-3); margin-top: 7px; }
  .lib-editor {
    border: 1px solid var(--spp-line); border-radius: 8px; padding: 10px;
    margin-bottom: 10px; background: var(--spp-surface);
  }
  .lib-editor input[type="text"], .lib-editor textarea, .lib-editor input[type="number"] {
    width: 100%; border: 1px solid var(--spp-line); border-radius: 6px;
    padding: 8px 10px; font-family: inherit; font-size: 13px;
    background: var(--spp-bg); color: var(--spp-text); margin-bottom: 8px;
  }
  .lib-editor textarea { min-height: 90px; resize: vertical; line-height: 1.6; }
  .lib-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .lib-row input[type="number"] { width: 70px; margin-bottom: 0; }
  .lib-row input[type="color"] {
    width: 34px; height: 28px; padding: 0;
    border: 1px solid var(--spp-line);
    border-radius: 6px; background: none; cursor: pointer;
  }
  .lib-hint { font-size: 11.5px; color: var(--spp-text-3); flex: 1; }
  .lib-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .lib-picker { display: flex; gap: 8px; margin: 8px 0 4px; align-items: center; }
  .lib-select {
    flex: 1; min-width: 0; border: 1px solid var(--spp-line); border-radius: 6px;
    padding: 7px 9px; font-family: inherit; font-size: 13px;
    background: var(--spp-surface); color: var(--spp-text);
  }
  .lib-picker-slot:empty { display: none; }
  .modal-actions {
    display: flex; justify-content: flex-end; gap: 8px;
    margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--spp-line);
  }

  /* ---------- 绑定图片（状态库与存档的合并点） ---------- */
  .lib-thumb {
    width: 40px; height: 40px; flex: none; border-radius: 8px;
    object-fit: contain; background: var(--spp-wash-2);
    border: 1px solid var(--spp-line); cursor: pointer;
  }
  .lib-thumb.empty {
    display: flex; align-items: center; justify-content: center;
    color: var(--spp-text-3); font-size: 18px;
  }
  .lib-bind { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .lib-bind .lib-thumb { width: 48px; height: 48px; }
`;

/** 把样式表注入文档（幂等） */
export function injectStyle(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
}

export { applyTheme } from "./theme";