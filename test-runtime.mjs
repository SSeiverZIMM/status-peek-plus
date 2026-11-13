/**
 * 运行时验证：在 Node 里真实加载构建产物，验证核心逻辑。
 *
 * 做法：为被压缩的模块建立一个「源码版」等价的测试入口 —— 直接用源码
 * （通过 vite 的 lib 模式另建一份可测产物代价太高），改为：
 *  1. 用 tsx/esbuild 把 src 编译成 ESM 供 Node import
 *  2. 打桩 @owlbear-rodeo/sdk 与 localStorage
 *  3. 调用 store 的真实函数，断言行为
 *
 * 这里采用更稳的方式：用 esbuild 的 build API 把 src 打包成一份
 * 可被 Node 直接 import 的 ESM（external 掉 SDK），再注入桩。
 */

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(ROOT, ".test-build");

let pass = 0;
let fail = 0;
function ok(cond, label) {
    if (cond) {
        pass++;
        console.log("  ✓ " + label);
    } else {
        fail++;
        console.log("  ✗ " + label);
    }
}
function eq(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        pass++;
        console.log("  ✓ " + label);
    } else {
        fail++;
        console.log("  ✗ " + label + "  期望 " + e + " 实得 " + a);
    }
}

/* ---------------- 打桩环境 ---------------- */

// localStorage 桩
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};

// crypto.randomUUID 由 Node 22 原生提供

/* ---------------- 打包 src ---------------- */

fs.mkdirSync(TMP, { recursive: true });

await build({
    entryPoints: {
        store: path.join(ROOT, "src/persist/store.ts"),
        model: path.join(ROOT, "src/persist/model.ts"),
        attachments: path.join(ROOT, "src/persist/attachments.ts"),
        shared: path.join(ROOT, "src/shared.ts"),
    },
    outdir: TMP,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    // SDK 是唯一外部依赖，测试里用不到它的实际调用
    external: ["@owlbear-rodeo/sdk"],
    logLevel: "error",
});

const storeUrl = pathToFileURL(path.join(TMP, "store.js")).href;
const modelUrl = pathToFileURL(path.join(TMP, "model.js")).href;
const attUrl = pathToFileURL(path.join(TMP, "attachments.js")).href;
const sharedUrl = pathToFileURL(path.join(TMP, "shared.js")).href;

const S = await import(storeUrl);
const M = await import(modelUrl);
const A = await import(attUrl);
const SH = await import(sharedUrl);

/* ---------------- 测试数据 ---------------- */

function imgToken(id, url, name, extra = {}) {
    return {
        id,
        name,
        type: "IMAGE",
        layer: "PROP",
        metadata: {},
        image: { url },
        position: { x: 100, y: 200 },
        zIndex: 5,
        lastModified: new Date().toISOString(),
        ...extra,
    };
}

/* ================= 测试开始 ================= */

console.log("\n=== 1. 存储：保存与读取 ===");
S.load();
eq(S.getTokens().length, 0, "初始为空");

const t1 = imgToken("tok1", "https://x/a.png", "火焰陷阱");
S.persist([{ token: t1, type: "TEMPLATE" }]);
eq(S.getTokens().length, 1, "保存后 1 项");
eq(S.getTokens()[0].type, "TEMPLATE", "类型为 TEMPLATE");
eq(M.persistedTokenGetName(S.getTokens()[0]), "火焰陷阱", "名称正确");
ok(S.findByKey("https://x/a.png") !== undefined, "按 URL 能查到");
ok(S.findByKey("https://x/nope.png") === undefined, "不存在的 URL 查不到");

console.log("\n=== 2. 持久化写入 localStorage ===");
const raw = localStorage.getItem(S.STORAGE_KEY);
ok(typeof raw === "string" && raw.includes("火焰陷阱"), "已落盘到 localStorage");
const parsed = JSON.parse(raw);
eq(parsed.tokens.length, 1, "落盘数据含 1 项");
eq(parsed.contextMenuEnabled, true, "contextMenuEnabled 一并落盘");

console.log("\n=== 3. 重新载入（模拟刷新页面） ===");
S.load();
eq(S.getTokens().length, 1, "重载后仍为 1 项");
eq(M.persistedTokenGetName(S.getTokens()[0]), "火焰陷阱", "名称保留");

console.log("\n=== 4. 更新已有模板 ===");
const t1b = imgToken("tok1", "https://x/a.png", "火焰陷阱改名");
S.persist([{ token: t1b, type: "TEMPLATE" }]);
eq(S.getTokens().length, 1, "仍为 1 项（未重复添加）");
eq(M.persistedTokenGetName(S.getTokens()[0]), "火焰陷阱改名", "名称已更新");

console.log("\n=== 5. 已存在项再次保存：刷新快照并保留原模式 ===");
S.setType("https://x/a.png", "UNIQUE");
eq(S.getTokens()[0].type, "UNIQUE", "类型已切换为 UNIQUE");
// 旧版在这里会静默跳过（「UNIQUE 项不重复保存」），导致用户点了没反应
S.persist([{ token: imgToken("tok1", "https://x/a.png", "再次保存"), type: "TEMPLATE" }]);
eq(S.getTokens().length, 1, "仍为 1 项");
eq(M.persistedTokenGetName(S.getTokens()[0]), "再次保存", "已存在项被刷新（不再静默跳过）");
eq(S.getTokens()[0].type, "UNIQUE", "刷新时保留原有模式，不被请求值覆盖");

console.log("\n=== 6. 重命名 / 属性开关 ===");
S.setName("https://x/a.png", "新名字");
eq(M.persistedTokenGetName(S.getTokens()[0]), "新名字", "重命名生效");

S.setDisabledProperties("https://x/a.png", ["METADATA"]);
eq(S.getTokens()[0].disabledProperties, ["METADATA"], "禁用属性已写入");
eq(M.invertPersistedProperties(["METADATA"]), ["ATTACHMENTS"], "补集计算正确");
eq(M.invertPersistedProperties(undefined), ["METADATA", "ATTACHMENTS"], "undefined 视为全启用");

console.log("\n=== 7. 删除 ===");
S.removeToken("https://x/a.png");
eq(S.getTokens().length, 0, "删除后为空");
eq(localStorage.getItem(S.STORAGE_KEY).includes("新名字"), false, "落盘数据同步清除");

console.log("\n=== 8. 附件：相对坐标与还原 ===");
const token = imgToken("tokA", "https://x/t.png", "锚点");
token.position = { x: 100, y: 200 };
token.zIndex = 10;

const att = {
    id: "att1",
    name: "子物件",
    type: "IMAGE",
    layer: "ATTACHMENT",
    metadata: {},
    attachedTo: "tokA",
    position: { x: 150, y: 260 },
    zIndex: 15,
};

const processed = A.processAttachments(token, [att]);
eq(processed[0].position, { x: 50, y: 60 }, "相对坐标 = 绝对 - 锚点");
eq(processed[0].zIndex, 5, "相对 zIndex = 15 - 10");
eq(processed[0].attachedTo, "ROOT", "挂到锚点自身的附件被改写为 ROOT");

const restored = A.restoreAttachments(token, processed);
eq(restored[0].position, { x: 150, y: 260 }, "还原后坐标一致");
eq(restored[0].zIndex, 15, "还原后 zIndex 一致");
eq(restored[0].attachedTo, "tokA", "ROOT 重新映射回锚点 id");
ok(restored[0].id !== "att1", "还原时生成了新 ID（避免冲突）");

console.log("\n=== 9. 关键用例：附件坐标往返不变（数据完整性的核心） ===");
const roundTrip = A.restoreAttachments(token, A.processAttachments(token, [att]));
eq(roundTrip[0].position, att.position, "坐标往返后完全一致");
eq(roundTrip[0].zIndex, att.zIndex, "zIndex 往返后完全一致");

console.log("\n=== 10. 数据格式校验 ===");
ok(M.isPersistedToken({ type: "TEMPLATE", token: { id: "a", name: "b", metadata: {}, image: { url: "u" } } }), "合法的 v2 数据通过校验");
ok(M.isPersistedToken({ type: "UNIQUE", name: "n", metadata: {}, lastModified: 1, imageUrl: "u" }), "合法的 v1 数据（向后兼容）通过校验");
ok(!M.isPersistedToken({ type: "BOGUS", token: {} }), "非法 type 被拒");
ok(!M.isPersistedToken(null), "null 被拒");
ok(!M.isPersistedToken({ type: "TEMPLATE" }), "缺少数据体被拒");
ok(M.isPersistedTokenArray([]), "空数组算合法数组");
ok(!M.isPersistedTokenArray([{ type: "TEMPLATE" }]), "含非法项被拒");

console.log("\n=== 11. 描述文本读写（Status Peek 原有逻辑） ===");
const md = {};
Object.assign(md, SH.writePeek("  持续 3 轮  "));
eq(SH.readPeek(md), { text: "持续 3 轮", has: true }, "写入时 trim 且标记 has");
Object.assign(md, SH.clearPeek());
eq(SH.readPeek(md), { text: "", has: false }, "清除后为空");
eq(SH.readPeek({}), { text: "", has: false }, "空 metadata 安全返回");
eq(SH.readPeek({ "status-peek/text": 123 }), { text: "", has: false }, "非字符串文本被忽略");

console.log("\n=== 12. 图层过滤 ===");
ok(SH.isTargetLayer("PROP"), "PROP 是目标图层");
ok(SH.isTargetLayer("ATTACHMENT"), "ATTACHMENT 是目标图层");
ok(!SH.isTargetLayer("CHARACTER"), "CHARACTER 不是目标图层");
ok(!SH.isTargetLayer("MAP"), "MAP 不是目标图层");

console.log("\n=== 13. keyUsage 统计（UNIQUE 去重判断） ===");
const scene = [
    imgToken("a", "https://x/same.png", "A"),
    imgToken("b", "https://x/same.png", "B"),
    imgToken("c", "https://x/other.png", "C"),
];
const usage = S.getKeyUsage(scene);
eq(usage.get("https://x/same.png"), 2, "同图出现 2 次");
eq(usage.get("https://x/other.png"), 1, "另一图出现 1 次");

console.log("\n=== 14. 损坏数据自愈 ===");
localStorage.setItem(S.STORAGE_KEY, "{ 这不是合法 JSON");
S.load();
eq(S.getTokens().length, 0, "损坏数据被安全重置为空（不崩溃）");

localStorage.setItem(S.STORAGE_KEY, JSON.stringify({ tokens: "不是数组" }));
S.load();
eq(S.getTokens().length, 0, "tokens 非数组时安全降级");

console.log("\n=== 15. 导入合并 ===");
S.load();
S.importTokens([
    { type: "TEMPLATE", token: { id: "i1", name: "导入A", metadata: {}, image: { url: "https://x/i1.png" } } },
]);
eq(S.getTokens().length, 1, "导入 1 项");
S.importTokens([
    { type: "UNIQUE", token: { id: "i1", name: "导入A改", metadata: {}, image: { url: "https://x/i1.png" } } },
]);
eq(S.getTokens().length, 1, "同 URL 导入时覆盖而非新增");
eq(S.getTokens()[0].type, "UNIQUE", "覆盖后类型已更新");

console.log("\n=== 16. 新建存档默认为「唯一」模式 ===");
localStorage.setItem(S.STORAGE_KEY, JSON.stringify({ contextMenuEnabled: true, tokens: [] }));
S.load();
eq(S.getTokens().length, 0, "已清空");
const r16 = S.persist([{ token: imgToken("u1", "https://x/uniq.png", "默认模式物件") }]);
eq(r16.saved, 1, "返回 saved=1");
eq(r16.skipped.length, 0, "无跳过项");
eq(S.getTokens()[0].type, "UNIQUE", "不传 type 时默认 UNIQUE（唯一存档）");

console.log("\n=== 17. 跨 iframe 写入不互相覆盖（核心修复）===");
// 模拟两个 iframe 各持一份内存副本：本 iframe 载入时看到 2 条
localStorage.setItem(S.STORAGE_KEY, JSON.stringify({
    contextMenuEnabled: true,
    tokens: [
        { type: "UNIQUE", token: { id: "x1", name: "另一iframe-A", metadata: {}, image: { url: "https://x/o1.png" } } },
        { type: "UNIQUE", token: { id: "x2", name: "另一iframe-B", metadata: {}, image: { url: "https://x/o2.png" } } },
    ],
}));
S.load();
eq(S.getTokens().length, 2, "本 iframe 载入到 2 条");

// 另一个 iframe 随后又存了第 3 条 —— 本 iframe 的内存副本对此一无所知
localStorage.setItem(S.STORAGE_KEY, JSON.stringify({
    contextMenuEnabled: true,
    tokens: [
        { type: "UNIQUE", token: { id: "x1", name: "另一iframe-A", metadata: {}, image: { url: "https://x/o1.png" } } },
        { type: "UNIQUE", token: { id: "x2", name: "另一iframe-B", metadata: {}, image: { url: "https://x/o2.png" } } },
        { type: "UNIQUE", token: { id: "x3", name: "另一iframe-C", metadata: {}, image: { url: "https://x/o3.png" } } },
    ],
}));

// 本 iframe 基于「陈旧内存」再存一条：旧实现会用旧副本整份写回，把 C 冲掉
const r17 = S.persist([{ token: imgToken("mine1", "https://x/mine.png", "本iframe新增") }]);
eq(r17.saved, 1, "本次保存成功");
eq(S.getTokens().length, 4, "写入前重新载入，另一 iframe 的新增未被冲掉");
ok(S.findByKey("https://x/o3.png") !== undefined, "另一 iframe 后续存的 C 仍在");
ok(S.findByKey("https://x/mine.png") !== undefined, "本 iframe 存的也在");

console.log("\n=== 18. 同一张图多实例：自动同步取最近修改的那个 ===");
localStorage.setItem(S.STORAGE_KEY, JSON.stringify({
    contextMenuEnabled: true,
    tokens: [
        { type: "UNIQUE", token: { id: "d1", name: "火把", metadata: { "status-peek/text": "初始" }, image: { url: "https://x/dup.png" }, lastModified: "2020-01-01T00:00:00.000Z" } },
    ],
}));
S.load();

const dupBefore = imgToken("d1", "https://x/dup.png", "火把", {
    lastModified: "2021-01-01T00:00:00.000Z",
    metadata: { "status-peek/text": "旧描述" },
});
const dupAfter = imgToken("d1", "https://x/dup.png", "火把", {
    lastModified: "2022-01-01T00:00:00.000Z",
    metadata: { "status-peek/text": "新描述" },
});
const dupOther = imgToken("d2", "https://x/dup.png", "火把副本", {
    lastModified: "2021-06-01T00:00:00.000Z",
    metadata: {},
});

// 场景里这份图出现了 2 次（usage=2）：旧实现会直接跳过，永远不同步
S.syncUniqueTokens([dupAfter, dupOther], [dupBefore, dupOther]);
eq(
    M.persistedTokenGetMetadata(S.getTokens()[0])["status-peek/text"],
    "新描述",
    "多实例时按最近修改的实例回写（旧版会整个跳过）",
);

/* ---------------- 汇总 ---------------- */

console.log("\n=== 19. 纯文字状态（v1.2 套用逻辑）===");
S.load();
const before = S.getTokens().length;
const ts = S.addTextStatus("潜行中", "移动时不发出声音，察觉检定有优势。");
ok(S.getTokens().length === before + 1, "新增 1 项");
ok(M.isTextStatus(S.getTokens().at(-1)), "textOnly 旗标为真");
ok(S.findByKey(ts.imageUrl) !== undefined, "按合成键（text:uuid）能查到");
ok(
  M.persistedTokenGetMetadata(S.getTokens().at(-1))["status-peek/has"] === true,
  "描述已写入 metadata"
);
ok(
  M.isPersistedToken(S.getTokens().at(-1)),
  "条目通过 isPersistedToken 校验（可导入导出）"
);

console.log("\n" + "=".repeat(46));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(46));

// 清理测试产物
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
