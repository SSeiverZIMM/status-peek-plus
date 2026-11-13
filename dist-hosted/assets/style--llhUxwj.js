const e="spp-style",r=`
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
    color: #333;
  }

  /* ---------- tab 栏 ---------- */
  #tabs {
    flex: none; display: flex; border-bottom: 1px solid #e4e7ec;
  }
  #tabs .tab {
    flex: 1; padding: 9px 0; text-align: center; cursor: pointer;
    font-size: 13px; color: #8a94a6; border-bottom: 2px solid transparent;
    user-select: none;
  }
  #tabs .tab:hover { color: #555; }
  #tabs .tab.active {
    color: #2c5f7c; border-bottom-color: #2c5f7c; font-weight: 600;
  }

  /* ---------- 面板 ---------- */
  #panel { flex: 1; overflow-y: auto; padding: 12px; }
  .hint { color: #888; text-align: center; padding: 32px 16px; line-height: 1.8; }
  .hint b { color: #555; }

  /* ---------- 卡片 ---------- */
  .card {
    border: 1px solid #d8dce2; border-radius: 8px;
    padding: 10px 12px; margin-bottom: 10px; background: #fff;
  }
  .card-head {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  }
  .swatch {
    width: 10px; height: 10px; border-radius: 3px; flex: none;
    background: #2c5f7c;
  }
  .item-name {
    font-weight: 600; flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .item-text { white-space: pre-wrap; word-break: break-word; line-height: 1.65; }
  .no-desc { color: #999; font-style: italic; }

  /* ---------- 小按钮 ---------- */
  .btn {
    flex: none; border: 1px solid #c5ccd6; background: #f2f4f7; color: #333;
    border-radius: 5px; font-size: 12px; padding: 2px 8px; cursor: pointer;
    font-family: inherit;
  }
  .btn:hover { background: #e3e7ee; }
  .btn.primary { border-color: #9dbdd4; background: #eef4f9; color: #2c5f7c; }
  .btn.primary:hover { background: #e0ecf5; }
  .btn.danger { border-color: #e2b5b5; background: #fdf2f2; color: #a85050; }
  .btn.danger:hover { background: #fae8e8; }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn:disabled:hover { background: #f2f4f7; }

  /* ---------- 模板卡片 ---------- */
  .tpl-head {
    display: flex; align-items: center; gap: 9px; cursor: pointer;
  }
  .tpl-thumb {
    width: 36px; height: 36px; flex: none; border-radius: 6px;
    object-fit: contain; background: #f7f9fc; border: 1px solid #e4e7ec;
  }
  .tpl-meta { flex: 1; min-width: 0; }
  .tpl-name {
    font-weight: 600; font-size: 13px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tpl-sub { font-size: 11px; color: #99a0ac; margin-top: 2px; }
  .tpl-actions { display: flex; gap: 4px; flex: none; }
  .tpl-body {
    display: none; margin-top: 10px; padding-top: 10px;
    border-top: 1px solid #eef1f4;
  }
  .tpl-body.open { display: block; }
  .tpl-row {
    display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .tpl-label { font-size: 11.5px; color: #8a94a6; margin-right: 4px; }
  .tpl-toggle {
    border: 1px solid #c5ccd6; background: #f7f9fc; color: #5a6272;
    border-radius: 5px; font-size: 11.5px; padding: 3px 9px; cursor: pointer;
    font-family: inherit;
  }
  .tpl-toggle.on {
    border-color: #9dbdd4; background: #eef4f9; color: #2c5f7c; font-weight: 600;
  }
  .tpl-note { font-size: 11px; color: #99a0ac; line-height: 1.6; }
  .tpl-warn {
    font-size: 11px; color: #a85050; background: #fdf2f2;
    border: 1px solid #f0dada; border-radius: 5px;
    padding: 5px 8px; margin-bottom: 8px; line-height: 1.6;
  }
  .tpl-thumb-text {
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; cursor: default;
  }
  #creator {
    display: none; flex-direction: column; gap: 6px;
    padding: 8px 12px; border-bottom: 1px solid #eef1f4; flex: none;
  }
  #creator.open { display: flex; }
  #creator input, #creator textarea {
    border: 1px solid #d8dce2; border-radius: 6px;
    padding: 5px 8px; font-size: 12.5px; font-family: inherit;
    background: #fbfcfd; color: #333; resize: vertical;
  }
  #creator input:focus, #creator textarea:focus { outline: none; border-color: #9dbdd4; }
  #creator .tpl-row { margin-bottom: 0; }

  /* ---------- 顶部工具条 ---------- */
  #toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px; border-bottom: 1px solid #eef1f4; flex: none;
  }
  #search {
    flex: 1; min-width: 0; border: 1px solid #d8dce2; border-radius: 6px;
    padding: 5px 8px; font-size: 12.5px; font-family: inherit;
    background: #fbfcfd; color: #333;
  }
  #search:focus { outline: none; border-color: #9dbdd4; }
  #usage { font-size: 11px; color: #99a0ac; flex: none; }

  /* ---------- 底部 ---------- */
  #footer {
    flex: none; border-top: 1px solid #e4e7ec; padding: 8px 12px;
    color: #999; font-size: 12px; display: flex; justify-content: space-between;
  }
  #footer .mode { cursor: pointer; }

  /* ---------- 设置抽屉 ---------- */
  #settings {
    position: absolute; inset: 0; background: #fff;
    transform: translateX(-100%); transition: transform .2s ease-in-out;
    display: flex; flex-direction: column;
  }
  #settings.open { transform: translateX(0); }
  .set-head {
    display: flex; align-items: center; gap: 8px;
    padding: 12px; border-bottom: 1px solid #eef1f4;
  }
  .set-title { font-size: 14px; font-weight: 700; flex: 1; }
  .set-body { padding: 12px; overflow-y: auto; }
  .set-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0;
  }
  .set-item + .set-item { border-top: 1px solid #f2f4f7; }
  .set-desc { font-size: 11px; color: #99a0ac; margin-top: 3px; line-height: 1.5; }

  /* ---------- 编辑模态框 ---------- */
  .modal-wrap {
    display: flex; flex-direction: column; height: 100%; padding: 14px;
    background: #fff;
  }
  .modal-title {
    font-size: 14px; font-weight: 700; margin-bottom: 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .modal-sub { font-size: 11.5px; color: #8a94a6; margin-bottom: 10px; }
  .modal-label {
    font-size: 11.5px; color: #8a94a6; margin-bottom: 5px;
    display: flex; justify-content: space-between;
  }
  #text {
    flex: 1; min-height: 120px; resize: none;
    border: 1px solid #d8dce2; border-radius: 6px; padding: 9px 10px;
    font-family: inherit; font-size: 13px; line-height: 1.6;
    background: #fbfcfd; color: #333;
  }
  #text:focus { outline: none; border-color: #9dbdd4; background: #fff; }
  .modal-persist {
    margin-top: 12px; padding-top: 12px; border-top: 1px solid #eef1f4;
  }
  .modal-persist-row { display: flex; gap: 6px; align-items: center; }
  .modal-status {
    font-size: 11.5px; color: #8a94a6; margin-top: 7px;
  }
  .modal-status.on { color: #2c5f7c; font-weight: 600; }
  .modal-actions {
    display: flex; justify-content: flex-end; gap: 8px;
    margin-top: 12px; padding-top: 12px; border-top: 1px solid #eef1f4;
  }

  /* ---------- 深色模式（沿用 Status Peek 的 body.dark 覆盖法） ---------- */
  body.dark { background: #1c1f26; color: #d7dae0; }
  body.dark #tabs { border-bottom-color: #3a4150; }
  body.dark #tabs .tab { color: #7d8794; }
  body.dark #tabs .tab:hover { color: #b8bfc9; }
  body.dark #tabs .tab.active { color: #7fb3d5; border-bottom-color: #7fb3d5; }
  body.dark .hint { color: #777; }
  body.dark .hint b { color: #aaa; }
  body.dark .card { border-color: #3a4150; background: #23262e; }
  body.dark .item-text { color: #d7dae0; }
  body.dark .item-name { color: #f0f2f5; }
  body.dark .no-desc { color: #666; }
  body.dark .btn { background: #2e323c; border-color: #454b58; color: #ccd0d8; }
  body.dark .btn:hover { background: #383d48; }
  body.dark .btn.primary { background: #24323d; border-color: #3d5a6e; color: #8fc3e0; }
  body.dark .btn.primary:hover { background: #2b3c49; }
  body.dark .btn.danger { background: #3a2727; border-color: #5e3d3d; color: #d99b9b; }
  body.dark .btn.danger:hover { background: #452e2e; }
  body.dark .btn:disabled { background: #262a32; }
  body.dark .tpl-thumb { background: #2a2e37; border-color: #3a4150; }
  body.dark .tpl-sub { color: #6f7885; }
  body.dark .tpl-body { border-top-color: #2f3540; }
  body.dark .tpl-label { color: #7d8794; }
  body.dark .tpl-toggle { background: #262a32; border-color: #454b58; color: #a8b0bb; }
  body.dark .tpl-toggle.on { background: #24323d; border-color: #3d5a6e; color: #8fc3e0; }
  body.dark .tpl-note { color: #6f7885; }
  body.dark .tpl-warn { background: #3a2727; border-color: #5e3d3d; color: #d99b9b; }
  body.dark .tpl-thumb-text { background: #2a2e37; border-color: #3a4150; }
  body.dark #creator { border-bottom-color: #2f3540; }
  body.dark #creator input, body.dark #creator textarea {
    background: #262a32; border-color: #454b58; color: #ccd0d8;
  }
  body.dark #toolbar { border-bottom-color: #2f3540; }
  body.dark #search { background: #262a32; border-color: #454b58; color: #d7dae0; }
  body.dark #search:focus { border-color: #3d5a6e; background: #2a2e37; }
  body.dark #usage { color: #6f7885; }
  body.dark #footer { border-top-color: #3a4150; color: #777; }
  body.dark #settings { background: #1c1f26; }
  body.dark .set-head { border-bottom-color: #2f3540; }
  body.dark .set-item + .set-item { border-top-color: #2a2e37; }
  body.dark .set-desc { color: #6f7885; }
  body.dark .modal-wrap { background: #1c1f26; }
  body.dark .modal-sub { color: #7d8794; }
  body.dark .modal-label { color: #7d8794; }
  body.dark #text { background: #262a32; border-color: #454b58; color: #d7dae0; }
  body.dark #text:focus { border-color: #3d5a6e; background: #2a2e37; }
  body.dark .modal-persist { border-top-color: #2f3540; }
  body.dark .modal-status { color: #7d8794; }
  body.dark .modal-status.on { color: #8fc3e0; }
  body.dark .modal-actions { border-top-color: #2f3540; }
`;function d(){if(document.getElementById(e))return;const o=document.createElement("style");o.id=e,o.textContent=r,document.head.appendChild(o)}function t(o){document.body.classList.toggle("dark",o==="dark")}export{t as a,d as i};
