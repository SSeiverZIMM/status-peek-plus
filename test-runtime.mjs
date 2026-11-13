/**
 * 运行时验证：在 Node 里真实加载源码，验证统一素材库的核心逻辑。
 *
 * 做法：
 *  1. 用 esbuild 把 src 下的模块打包成 Node 可 import 的 ESM，
 *     `@owlbear-rodeo/sdk` 用 alias 指到 test/obr-stub.mjs（内存桩）
 *  2. 打桩 localStorage
 *  3. 调用 archive / apply / shared / attachments 的真实函数，断言行为
 *
 * 【为什么必须真跑】
 * 素材库的两个 scope（localStorage / scene metadata）、跨 iframe 重读、
 * 附件相对坐标换算，都是「编译过了但逻辑错了」的高发区。
 */

import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 从脚本自身位置推导项目根目录（项目目录被搬迁过，硬编码路径会失效）
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(ROOT, ".test-build");
const STUB = path.join(ROOT, "test/obr-stub.mjs");

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

const lsStore = new Map();
globalThis.localStorage = {
    getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
    setItem: (k, v) => lsStore.set(k, String(v)),
    removeItem: (k) => {
        lsStore.delete(k);
    },
    clear: () => lsStore.clear(),
};

/* ---------------- 打包 src ---------------- */

fs.mkdirSync(TMP, { recursive: true });

await build({
    entryPoints: {
        archive: path.join(ROOT, "src/archive.ts"),
        apply: path.join(ROOT, "src/apply.ts"),
        attachments: path.join(ROOT, "src/persist/attachments.ts"),
        shared: path.join(ROOT, "src/shared.ts"),
        rounds: path.join(ROOT, "src/rounds.ts"),
    },
    outdir: TMP,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    alias: { "@owlbear-rodeo/sdk": STUB },
    logLevel: "error",
});

const load = (n) => import(pathToFileURL(path.join(TMP, n + ".js")).href);
const A = await load("archive");
const AP = await load("apply");
const AT = await load("attachments");
const SH = await load("shared");
const R = await load("rounds");
const stub = await import(pathToFileURL(STUB).href);

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

function baseEntry(over = {}) {
    return {
        id: "e1",
        scope: "local",
        name: "魅惑Charmed",
        desc: null,
        descPlain: "被魅惑生物不能攻击魅惑者。",
        rounds: 3,
        color: "#ff00d0",
        imageUrl: "",
        updatedAt: 0,
        ...over,
    };
}

/* ================= 测试开始 ================= */

console.log("\n=== 1. sanitizeEntry 校验 ===");
eq(A.sanitizeEntry(baseEntry()).name, "魅惑Charmed", "合法条目通过");
eq(A.sanitizeEntry(null), null, "null 被拒");
eq(A.sanitizeEntry({ name: "没有 id" }), null, "缺 id 被拒");
eq(A.sanitizeEntry({ id: "x", name: "n" }).rounds, 0, "缺轮数补 0");
eq(A.sanitizeEntry({ id: "x", name: "n" }).color, "#888780", "缺配色补默认");
eq(A.sanitizeEntry({ id: "x", name: "n" }).scope, "local", "缺 scope 按私有收下");
eq(A.sanitizeEntry({ id: "x", name: "n", scope: "scene" }).scope, "scene", "scene 保留");
eq(A.sanitizeEntry({ id: "x", name: "n", rounds: "abc" }).rounds, 0, "轮数非数字补 0");
eq(A.sanitizeEntry({ id: "x", name: "n", rounds: 2.7 }).rounds, 2, "轮数向下取整");
eq(A.sanitizeEntry({ id: "x", name: "n", color: "red" }).color, "#888780", "非法配色回退默认");
ok(A.sanitizeEntry({ id: "x", name: "n" }).snapshot === undefined, "无快照时为 undefined");
ok(A.sanitizeEntry({ id: "x", name: "n", snapshot: "垃圾" }).snapshot === undefined, "快照非对象被忽略");

console.log("\n=== 2. 本地 scope：增 / 查 / 删 ===");
lsStore.clear();
await A.deleteEntry("e1"); // 确保干净
eq((await A.listByScope("local")).length, 0, "初始为空");
await A.upsertEntry(baseEntry());
eq((await A.listByScope("local")).length, 1, "写入后 1 条");
await A.upsertEntry(baseEntry({ name: "改名" }));
eq((await A.listByScope("local")).length, 1, "同 id 覆盖不重复");
eq((await A.listByScope("local"))[0].name, "改名", "覆盖生效");
ok((await A.findById("e1")) !== undefined, "findById 命中");
ok((await A.findById("不存在")) === undefined, "findById 未命中返回 undefined");
await A.deleteEntry("e1");
eq((await A.listByScope("local")).length, 0, "删除后为空");

console.log("\n=== 3. 场景 scope：写入与读取 ===");
eq((await A.listByScope("scene")).length, 0, "初始为空");
await A.upsertEntry(baseEntry({ id: "s1", scope: "scene", name: "房间预设" }));
eq((await A.listByScope("scene")).length, 1, "场景写入成功");
eq((await A.listByScope("local")).length, 0, "不影响本地列表");

console.log("\n=== 4. listAll 合并两种 scope ===");
await A.upsertEntry(baseEntry({ id: "l1", name: "私有条目", updatedAt: 100 }));
await A.upsertEntry(baseEntry({ id: "s2", scope: "scene", name: "房间条目", updatedAt: 200 }));
const all = await A.listAll();
eq(all.length, 3, "合并后 3 条");
eq(all[0].id, "s2", "按 updatedAt 倒序（新的在前）");

console.log("\n=== 5. 跨 iframe：写入前重读，不互相覆盖 ===");
lsStore.clear();
// 另一个 iframe 刚写了一条，本 iframe 的内存副本还不知道
lsStore.set(
    A.STORAGE_KEY ?? "status-peek/archive/local",
    JSON.stringify({
        version: 1,
        entries: [baseEntry({ id: "other", name: "别的iframe存的" })],
    }),
);
await A.upsertEntry(baseEntry({ id: "mine", name: "本iframe存的" }));
const after = await A.listByScope("local");
eq(after.length, 2, "另一 iframe 的条目未被冲掉");
ok(after.some((e) => e.id === "other"), "别人的还在");
ok(after.some((e) => e.id === "mine"), "自己的也在");

console.log("\n=== 6. moveScope：私有 <-> 房间 ===");
lsStore.clear();
stub.__resetMeta();
await A.upsertEntry(baseEntry({ id: "m1", name: "待发布" }));
eq((await A.findById("m1")).scope, "local", "初始为私有");
await A.moveScope("m1", "scene");
eq((await A.findById("m1")).scope, "scene", "发布后为房间");
eq((await A.listByScope("local")).length, 0, "本地列表已移除");
eq((await A.listByScope("scene")).length, 1, "场景列表新增");
eq((await A.findById("m1")).id, "m1", "id 保持不变（套用过的物件可回溯）");
await A.moveScope("m1", "local");
eq((await A.findById("m1")).scope, "local", "可转回私有");
await A.moveScope("m1", "local"); // 幂等
eq((await A.findById("m1")).scope, "local", "重复转同一 scope 无副作用");

console.log("\n=== 7. findByImage：同图双 scope 时优先房间 ===");
lsStore.clear();
await A.upsertEntry(baseEntry({ id: "p1", scope: "local", imageUrl: "https://x/dup.png", name: "私有版" }));
await A.upsertEntry(baseEntry({ id: "p2", scope: "scene", imageUrl: "https://x/dup.png", name: "房间版" }));
eq((await A.findByImage("https://x/dup.png")).name, "房间版", "优先返回 scene 条目");
eq((await A.findByImage("https://x/only-local.png")), undefined, "查不到返回 undefined");

console.log("\n=== 8. captureFromItem：把画布物件收成素材 ===");
lsStore.clear();
eq(await A.captureFromItem(imgToken("c1", "", "无图"), "local"), null, "无图片地址返回 null");
const item = imgToken("c2", "https://x/fire.png", "火焰陷阱");
item.metadata = Object.assign(
    item.metadata,
    SH.writePeek({
        name: "火焰陷阱",
        desc: null,
        descPlain: "踩中后 2d6 火焰伤害。",
        rounds: 2,
        appliedRound: 3,
        color: "#ff8800",
    }),
);
const cap = await A.captureFromItem(item, "local");
ok(cap !== null, "收存成功");
eq(cap.imageUrl, "https://x/fire.png", "图标 URL 记下");
eq(cap.name, "火焰陷阱", "状态名从物件读取");
eq(cap.descPlain, "踩中后 2d6 火焰伤害。", "规则文本读取");
eq(cap.rounds, 2, "轮数读取");
eq(cap.color, "#ff8800", "配色读取");
eq((await A.listByScope("local")).length, 1, "入库 1 条");
// 同图同 scope 再次收存：更新而不是新增
const cap2 = await A.captureFromItem(imgToken("c3", "https://x/fire.png", "改名后的陷阱"), "local");
eq((await A.listByScope("local")).length, 1, "同图同 scope 不重复添加");
eq(cap2.id, cap.id, "复用了原条目 id");
eq((await A.findById(cap.id)).name, "改名后的陷阱", "内容已刷新");

console.log("\n=== 9. 附件：相对坐标与还原 ===");
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
const processed = AT.processAttachments(token, [att]);
eq(processed[0].position, { x: 50, y: 60 }, "相对坐标 = 绝对 - 锚点");
eq(processed[0].zIndex, 5, "相对 zIndex = 15 - 10");
eq(processed[0].attachedTo, "ROOT", "挂到锚点自身的附件被改写为 ROOT");
const restored = AT.restoreAttachments(token, processed);
eq(restored[0].position, { x: 150, y: 260 }, "还原后坐标一致");
eq(restored[0].zIndex, 15, "还原后 zIndex 一致");
eq(restored[0].attachedTo, "tokA", "ROOT 重新映射回锚点 id");
ok(restored[0].id !== "att1", "还原时生成新 ID（避免冲突）");

console.log("\n=== 10. 关键用例：附件坐标往返不变 ===");
const roundTrip = AT.restoreAttachments(token, AT.processAttachments(token, [att]));
eq(roundTrip[0].position, att.position, "坐标往返后完全一致");
eq(roundTrip[0].zIndex, att.zIndex, "zIndex 往返后完全一致");

console.log("\n=== 11. 快照附件存取（经素材库）===");
lsStore.clear();
const withAtt = imgToken("snap1", "https://x/snap.png", "带子物件的图标");
const child = {
    id: "child1",
    name: "数字角标",
    type: "TEXT",
    layer: "ATTACHMENT",
    metadata: {},
    attachedTo: "snap1",
    position: { x: 130, y: 210 },
    zIndex: 6,
};
const snapEntry = await A.captureFromItem(withAtt, "local", [child]);
const restoredChildren = A.restoreSnapshotAttachments(snapEntry, {
    id: "new-anchor",
    position: { x: 1000, y: 2000 },
    zIndex: 0,
});
eq(restoredChildren.length, 1, "还原出 1 个子物件");
eq(restoredChildren[0].attachedTo, "new-anchor", "子物件挂到新锚点");
// 相对偏移保持：130-100=30，还原后 1000+30=1030
eq(restoredChildren[0].position, { x: 1030, y: 2010 }, "相对偏移随新锚点平移");

console.log("\n=== 12. 导出 / 导入 ===");
lsStore.clear();
stub.__resetMeta();
await A.upsertEntry(baseEntry({ id: "x1", name: "导出A" }));
await A.upsertEntry(baseEntry({ id: "x2", scope: "scene", name: "导出B" }));
const json = await A.exportJson();
const parsed = JSON.parse(json);
eq(parsed.format, "status-peek-archive", "导出带格式标识");
eq(parsed.entries.length, 2, "导出全部条目");
eq(parsed.entries.filter((e) => e.scope === "scene").length, 1, "scope 一并导出");

// 导入到干净环境
lsStore.clear();
stub.__resetMeta();
const r = await A.importJson(json);
eq(r.added, 2, "新增 2 条");
eq(r.updated, 0, "无覆盖");
eq((await A.listAll()).length, 2, "导入后共 2 条");
// 重复导入 = 覆盖
const r2 = await A.importJson(json);
eq(r2.added, 0, "重复导入无新增");
eq(r2.updated, 2, "重复导入全部按 id 覆盖");
eq((await A.listAll()).length, 2, "覆盖后总数不变");
// 导入旧版格式（裸数组、无 scope）
const r3 = await A.importJson(
    JSON.stringify([{ id: "old1", name: "旧版条目", descPlain: "老数据" }]),
);
eq(r3.added, 1, "旧版裸数组格式可导入");
eq((await A.findById("old1")).scope, "local", "旧版条目按私有收下");
// 坏文件
let threw = false;
try {
    await A.importJson("{ 这不是 JSON");
} catch {
    threw = true;
}
ok(threw, "非法 JSON 抛错");
threw = false;
try {
    await A.importJson(JSON.stringify({ format: "别的插件", entries: [] }));
} catch {
    threw = true;
}
ok(threw, "format 不匹配抛错");

console.log("\n=== 12b. 导入 v0.x 老版导出（status-peek/text 格式）===");
lsStore.clear();
stub.__resetMeta();
// 结构完全照抄用户的老版导出文件：{type, token:{metadata:{"status-peek/text"}}, attachments:[]}
const legacyExport = [
    {
        type: "UNIQUE",
        token: {
            id: "21f94214-6435-4cfa-b906-af4958be7af2",
            name: "目盲 Blinded",
            type: "IMAGE",
            layer: "ATTACHMENT",
            metadata: {
                "status-peek/text": "看不见：你无法视物，且会自动失败于任何需要视觉的属性检定。\n攻击影响：以你为目标的攻击检定具有优势，而你进行的攻击检定具有劣势。",
                "status-peek/has": true,
            },
            image: {
                width: 64,
                height: 64,
                mime: "image/webp",
                url: "https://images.owlbear.rodeo/x/items/blinded.webp",
            },
            position: { x: 4350, y: -900 },
            zIndex: 1790774963764,
            lastModified: "2026-09-30T13:29:23.764Z",
        },
        attachments: [],
    },
    {
        type: "UNIQUE",
        token: {
            id: "b58e8715-b1e0-47c5-acbc-3e5f68b19a44",
            name: "魅惑 Charmed",
            type: "IMAGE",
            layer: "ATTACHMENT",
            metadata: {
                "status-peek/text": "无法伤害魅惑源： 你无法攻击魅惑源。",
                "status-peek/has": true,
            },
            image: {
                url: "https://images.owlbear.rodeo/x/items/charmed.webp",
            },
            position: { x: 4425, y: -825 },
            zIndex: 1790774983342,
            lastModified: "2026-09-30T13:29:53.985Z",
        },
        attachments: [],
    },
    { type: "UNIQUE", token: { id: "坏数据", name: "没有图" } }, // 无 image.url，应被丢弃
];
const rLegacy = await A.importJson(JSON.stringify(legacyExport));
eq(rLegacy.added, 2, "老版导出导入 2 条（坏数据被丢弃）");
const eBlind = await A.findById("21f94214-6435-4cfa-b906-af4958be7af2");
eq(eBlind.name, "目盲 Blinded", "名字从 token.name 读取");
eq(
    eBlind.descPlain,
    "看不见：你无法视物，且会自动失败于任何需要视觉的属性检定。\n攻击影响：以你为目标的攻击检定具有优势，而你进行的攻击检定具有劣势。",
    "规则文本从 status-peek/text 读取（含换行）",
);
eq(eBlind.imageUrl, "https://images.owlbear.rodeo/x/items/blinded.webp", "图标 URL 保留");
eq(eBlind.rounds, 0, "老版没有轮数概念 → 0（永久）");
eq(eBlind.color, "#888780", "老版没有配色 → 默认");
eq(eBlind.scope, "local", "老版一律按私有收下");
eq(eBlind.desc, null, "老版没有富文本 → desc 为 null（渲染走纯文本兜底）");
// 老版条目可直接套用
stub.__resetItems();
stub.__items.push(imgToken("tgtL", "", "老版套用目标"));
const resL = await AP.applyEntry(eBlind, ["tgtL"]);
eq(resL.created, 1, "老版条目可正常套用（贴图 + 写状态）");
eq(stub.__items.find((i) => i.id !== "tgtL").metadata["status-peek/name"], "目盲 Blinded", "套用后状态名正确");
eq(
    stub.__items.find((i) => i.id !== "tgtL").metadata["status-peek/desc-plain"],
    eBlind.descPlain,
    "套用后规则文本完整",
);
// 拖出同图能自动恢复（findByImage 认老版导入的条目）
stub.__items.length = 0;
stub.__items.push(imgToken("dragL", "https://images.owlbear.rodeo/x/items/charmed.webp", "拖出的老图"));
await AP.applyToNewItems([stub.__items[0]]);
eq(stub.__items[0].metadata["status-peek/name"], "魅惑 Charmed", "老版导入的图拖出时自动恢复状态");

console.log("\n=== 13. 状态读写（shared.peek）===");
const md = {};
Object.assign(
    md,
    SH.writePeek({
        name: "  魅惑Charmed  ",
        desc: null,
        descPlain: "  被魅惑生物不能攻击魅惑者。  ",
        rounds: 3,
        appliedRound: 5,
        color: "#ff00d0",
    }),
);
eq(SH.readPeek(md).name, "魅惑Charmed", "状态名写入时 trim");
eq(SH.readPeek(md).descPlain, "被魅惑生物不能攻击魅惑者。", "规则文本写入时 trim");
eq(SH.readPeek(md).rounds, 3, "轮数写入");
eq(SH.readPeek(md).appliedRound, 5, "施加回合快照写入");
eq(SH.readPeek(md).color, "#ff00d0", "配色写入");
eq(SH.readPeek(md).has, true, "有内容时 has=true");
Object.assign(md, SH.clearPeek());
eq(SH.readPeek(md).has, false, "清除后 has=false");
eq(SH.readPeek({}).has, false, "空 metadata 安全返回");
eq(SH.readPeek({ "status-peek/name": 123 }).name, "", "非字符串状态名被忽略");

console.log("\n=== 14. 剩余轮数计算 ===");
eq(SH.remainingRounds(3, 5, 6), 2, "当前 6 / 施加 5 / 持续 3 → 剩 2");
eq(SH.remainingRounds(3, 5, 5), 3, "同一回合不消耗");
eq(SH.remainingRounds(3, 5, 8), 0, "超过持续轮数归零");
eq(SH.remainingRounds(0, 5, 8), null, "永久状态返回 null");
eq(SH.remainingRounds(3, -1, 8), 3, "无快照时只显示原值");
eq(SH.remainingRounds(3, 5, null), 3, "不在战斗中只显示原值");

console.log("\n=== 15. 先攻回合读取 ===");
eq(SH.readCombatRound({}), null, "无先攻数据返回 null");
eq(SH.readCombatRound({ "com.initiative-tracker/combat": { inCombat: false, round: 3 } }), null, "未开战返回 null");
eq(SH.readCombatRound({ "com.initiative-tracker/combat": { inCombat: true, round: 0 } }), null, "round=0 返回 null");
eq(SH.readCombatRound({ "com.initiative-tracker/combat": { inCombat: true, round: 4 } }), 4, "开战中读取回合");

console.log("\n=== 16. 图层过滤 ===");
ok(SH.isTargetLayer("PROP"), "PROP 是目标图层");
ok(SH.isTargetLayer("ATTACHMENT"), "ATTACHMENT 是目标图层");
ok(!SH.isTargetLayer("CHARACTER"), "CHARACTER 不是目标图层");
ok(!SH.isTargetLayer("MAP"), "MAP 不是目标图层");

console.log("\n=== 17. 套用：纯文字预设直接写目标 metadata ===");
stub.__resetItems();
stub.__resetMeta();
lsStore.clear();
const entry = await A.upsertEntry(baseEntry({ id: "t1", imageUrl: "", rounds: 2 }));
const targets = [imgToken("tgt1", "", "怪物A"), imgToken("tgt2", "", "怪物B")];
stub.__items.push(...targets);
const res = await AP.applyEntry(entry, ["tgt1", "tgt2"]);
eq(res.written, 2, "两个目标都写了");
eq(res.created, 0, "无新建");
eq(res.reused, 0, "无复用");
eq(res.failed, 0, "无失败");
eq(stub.__items[0].metadata["status-peek/name"], "魅惑Charmed", "状态名已写入");
eq(stub.__items[0].metadata["status-peek/rounds"], 2, "轮数已写入");
eq(stub.__items[0].metadata["status-peek/template-id"], "t1", "模板 id 已写入");
eq(stub.__items[0].metadata["status-peek/has"], true, "has 标记已写入");

console.log("\n=== 18. 套用：带图标则新建 ATTACHMENT 物件 ===");
stub.__resetItems();
const iconEntry = await A.upsertEntry(
    baseEntry({ id: "t2", imageUrl: "https://x/icon.png", name: "中毒" }),
);
const token2 = imgToken("tgt3", "", "怪物C");
stub.__items.push(token2);
const res2 = await AP.applyEntry(iconEntry, ["tgt3"]);
eq(res2.created, 1, "新建了 1 个 attachment");
eq(stub.__items.length, 2, "场景里多了 1 个物件");
const created = stub.__items.find((i) => i.id !== "tgt3");
eq(created.layer, "ATTACHMENT", "挂在 ATTACHMENT 图层");
eq(created.attachedTo, "tgt3", "附着到目标 token");
eq(created.image.url, "https://x/icon.png", "图片地址正确");
eq(created.metadata["status-peek/name"], "中毒", "状态写在图（附件）上");
eq(created.position.x, token2.position.x, "初始位置与目标重合");
eq(created.zIndex, token2.zIndex + 1, "zIndex 盖在目标之上");

console.log("\n=== 19. 套用：目标下已有同图附件则复用（不叠图）===");
const res3 = await AP.applyEntry(iconEntry, ["tgt3"]);
eq(res3.reused, 1, "复用了已有附件");
eq(stub.__items.length, 2, "没有新增第二个");
eq(stub.__items.find((i) => i.id !== "tgt3").metadata["status-peek/name"], "中毒", "状态被刷新");

console.log("\n=== 20. 套用：目标自己就是那张图则直接写 ===");
stub.__resetItems();
const selfItem = imgToken("tgt4", "https://x/icon.png", "它就是图标本体");
stub.__items.push(selfItem);
const res4 = await AP.applyEntry(iconEntry, ["tgt4"]);
eq(res4.reused, 1, "复用自身");
eq(res4.created, 0, "没有新建");
eq(stub.__items[0].metadata["status-peek/name"], "中毒", "状态写在自身 metadata 上");

console.log("\n=== 21. 新拖入的物件自动恢复状态 ===");
// 关键场景：条目是「另一个 bundle」（action iframe）写进去的，
// 本 bundle（background iframe）此前已读过本地列表、内存副本是旧的。
// 上一版 findByImage 沿用缓存，这里会静默失败（拖图不恢复状态）。
stub.__resetItems();
await A.upsertEntry(
    baseEntry({
        id: "t3",
        imageUrl: "https://x/auto.png",
        name: "自动恢复",
        descPlain: "拖出来就带上状态",
        rounds: 4,
    }),
);
const dragged = imgToken("drag1", "https://x/auto.png", "刚拖进来的");
stub.__items.push(dragged);
await AP.applyToNewItems([dragged]);
eq(stub.__items[0].metadata["status-peek/name"], "自动恢复", "状态自动写回");
eq(stub.__items[0].metadata["status-peek/rounds"], 4, "轮数自动写回");
eq(stub.__items[0].metadata["status-peek/template-id"], "t3", "模板 id 记录来源");

console.log("\n=== 22. 已有状态的物件不被自动恢复覆盖 ===");
stub.__items[0].metadata["status-peek/name"] = "GM 手动改过";
stub.__items[0].metadata["status-peek/has"] = true;
await AP.applyToNewItems([stub.__items[0]]);
eq(stub.__items[0].metadata["status-peek/name"], "GM 手动改过", "手动修改不被覆盖");

console.log("\n=== 23. 新拖入但素材库没有的图：静默跳过 ===");
stub.__resetItems();
const unknown = imgToken("drag2", "https://x/unknown.png", "陌生图");
stub.__items.push(unknown);
await AP.applyToNewItems([unknown]);
eq(stub.__items[0].metadata["status-peek/has"], undefined, "不写任何状态");

console.log("\n=== 24. 旧版存档一次性迁移 ===");
// 旧键结构：{ contextMenuEnabled, tokens: [{ type, token: {...} }] }
lsStore.clear();
stub.__resetMeta();
lsStore.set(
    "com.desain.persistence/localStorage",
    JSON.stringify({
        contextMenuEnabled: true,
        tokens: [
            {
                type: "UNIQUE",
                token: {
                    id: "legacy1",
                    name: "旧版火焰陷阱",
                    metadata: {
                        "status-peek/name": "旧版火焰陷阱",
                        "status-peek/desc-plain": "踩中后 2d6 火焰伤害。",
                        "status-peek/rounds": 2,
                        "status-peek/color": "#ff8800",
                        "status-peek/has": true,
                    },
                    image: { url: "https://x/legacy.png" },
                    lastModified: "2026-01-02T03:04:05.000Z",
                },
            },
            { type: "TEMPLATE", token: { id: "", name: "坏数据" } }, // 无 id，应被丢弃
        ],
    }),
);
// 首次读本地列表时触发迁移
const migrated = await A.listAllFresh();
eq(migrated.length, 1, "迁移出 1 条有效素材");
eq(migrated[0].id, "legacy1", "id 保留");
eq(migrated[0].imageUrl, "https://x/legacy.png", "图标 URL 保留");
eq(migrated[0].descPlain, "踩中后 2d6 火焰伤害。", "规则文本迁移");
eq(migrated[0].rounds, 2, "轮数迁移");
eq(migrated[0].color, "#ff8800", "配色迁移");
eq(migrated[0].scope, "local", "旧存档一律按私有收下");
eq(lsStore.has("com.desain.persistence/localStorage"), false, "旧键已删除（不重复迁移）");
// 迁移后的条目可正常套用
eq((await A.findByImage("https://x/legacy.png")).name, "旧版火焰陷阱", "迁移后可按图找到");

/* ---------------- 汇总 ---------------- */

console.log("\n" + "=".repeat(46));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log("=".repeat(46));

// 清理测试产物
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
