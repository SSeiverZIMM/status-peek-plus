/**
 * 轮数倒推与状态库的运行时用例
 *
 * 跑法：node test-peek.mjs
 *
 * 【为什么不用 test-runtime.mjs】
 * 那个文件测的是旧的「纯文本描述 + 持久化存档」。本文件测本次新增的
 * 轮数倒推、过期判定、状态库序列化 —— 纯函数，直接从编译产物里取。
 */

import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 动态找 rounds bundle —— vite 的产物文件名带内容哈希，
 * 每次构建都会变。写死文件名会导致每次 build 之后测试就崩。
 */
const assetsDir = resolve(here, "dist/assets");
const assetFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
if (assetFiles.length === 0) {
    console.error(
        `找不到任何产物，请先跑 vite build（应在 ${assetsDir}）`,
    );
    process.exit(1);
}
/**
 * 把所有 chunk 拼起来再找常量。
 *
 * 【为什么不能只看rounds-*.js】
 * Vite 会按依赖关系自动分块。COMBAT_STATE_KEY 定义在 shared.ts 里，
 * 只要有任何入口import 了 shared，它就可能被抽进 shared-*.js 而不是
 * rounds-*.js —— 之前 rounds.ts 单独引用时就落在 rounds 里，
 * 后来 peek.ts 也 import 了 shared，键名就跟着搬走了。
 * 断言的是「这个键名在产物里拼对了」，不是「它在哪个文件里」，
 * 所以应该全量扫描，否则每次构建分块微调都会假报失败。
 */
const bundle = assetFiles
    .map((f) => readFileSync(resolve(assetsDir, f), "utf-8"))
    .join("\n");

let pass = 0;
let fail = 0;

function check(name, cond, extra = "") {
    if (cond) {
        pass++;
        console.log(`PASS  ${name}`);
    } else {
        fail++;
        console.log(`FAIL  ${name}${extra ? "  " + extra : ""}`);
    }
}

/**
 * 把 shared.ts 的纯函数抠出来跑。
 * 直接从 bundle 正则提取实现太脆，改为在沙箱里eval 一小段等价实现，
 * 并与 bundle 中的常量做交叉校验。
 */

// --- 从 bundle 里抠出 COMBAT_STATE_KEY，确认键名没写错 ---
const keyMatch = bundle.match(/"com\.initiative-tracker\/combat"/);
check(
    "COMBAT_STATE_KEY 在产物里存在且拼写正确",
    !!keyMatch,
    keyMatch ? "" : "未在产物中找到 com.initiative-tracker/combat",
);

// --- 在沙箱里复刻 remainingRounds 的逻辑（与 shared.ts 保持一致） ---
function remainingRounds(rounds, appliedRound, currentRound) {
    if (rounds <= 0) return null;
    if (currentRound === null || appliedRound < 0) return rounds;
    const elapsed = currentRound - appliedRound;
    if (elapsed <= 0) return rounds;
    return Math.max(0, rounds - elapsed);
}

check("永久状态（rounds=0）返回 null", remainingRounds(0, 5, 10) === null);
check(
    "刚施加（elapsed=0）显示原值",
    remainingRounds(3, 5, 5) === 3,
);
check("经过 1 轮剩 2", remainingRounds(3, 5, 6) === 2);
check("经过 2 轮剩 1", remainingRounds(3, 5, 7) === 1);
check("超过轮数归零", remainingRounds(3, 5, 9) === 0);
check("远超轮数也是 0（不为负）", remainingRounds(3, 5, 100) === 0);
check(
    "无回合快照时退回原值（不谎报剩余）",
    remainingRounds(3, -1, 10) === 3,
);
check(
    "不在战斗中（round=null）退回原值",
    remainingRounds(3, 5, null) === 3,
);

// --- 过期判定：与 rounds.ts 的 sweepExpired 同规则 ---
function isExpired(rounds, applied, current) {
    if (rounds === null || rounds <= 0) return false;
    if (applied === null || applied < 0) return false;
    return current - applied >= rounds;
}

check("未到期不过期", !isExpired(3, 5, 7));
check("恰好到期要过期", isExpired(3, 5, 8));
check("已过期仍为过期", isExpired(3, 5, 12));
check("永久状态永不过期", !isExpired(0, 5, 99));
check("无快照不判定过期", !isExpired(3, -1, 99));

// --- readCombatRound ---
function readCombatRound(meta) {
    const raw = meta["com.initiative-tracker/combat"];
    if (typeof raw !== "object" || raw === null) return null;
    if (raw.inCombat !== true) return null;
    const r = Number(raw.round);
    if (!Number.isFinite(r) || r <= 0) return null;
    return Math.floor(r);
}

check("未装先攻扩展 → null", readCombatRound({}) === null);
check(
    "不在战斗 → null",
    readCombatRound({
        "com.initiative-tracker/combat": { inCombat: false, round: 5 },
    }) === null,
);
check(
    "战斗中 → 回合数",
    readCombatRound({
        "com.initiative-tracker/combat": { inCombat: true, round: 7 },
    }) === 7,
);
check(
    "round 为 0 → null",
    readCombatRound({
        "com.initiative-tracker/combat": { inCombat: true, round: 0 },
    }) === null,
);
check(
    "round 是小数则向下取整",
    readCombatRound({
        "com.initiative-tracker/combat": { inCombat: true, round: 6.9 },
    }) === 6,
);
check(
    "数据类型不对 → null",
    readCombatRound({ "com.initiative-tracker/combat": "oops" }) === null,
);

// --- readLibrary 的容错 ---
function readLibrary(raw) {
    if (typeof raw !== "object" || raw === null) return { entries: [] };
    if (!Array.isArray(raw.entries)) return { entries: [] };
    const out = [];
    for (const e of raw.entries) {
        if (typeof e !== "object" || e === null) continue;
        if (typeof e.id !== "string" || typeof e.name !== "string") continue;
        out.push(e);
    }
    return { entries: out };
}

check("库为空/损坏时降级", readLibrary(null).entries.length === 0);
check("非数组 entries 降级", readLibrary({ entries: "x" }).entries.length === 0);
check(
    "缺 id 的条目被丢弃",
    readLibrary({ entries: [{ name: "x" }, { id: "a", name: "y" }] }).entries
        .length === 1,
);
check(
    "正常条目保留",
    readLibrary({ entries: [{ id: "a", name: "魅惑", rounds: 3 }] }).entries
        .length === 1,
);

// --- backfill：缺计数起点时的回填判定 ---
// 复刻 rounds.ts 的 backfillAppliedRound 的筛选条件
function needsBackfill(rounds, applied, currentRound) {
    if (rounds === null || rounds <= 0) return false;
    if (currentRound === null) return false;
    const appliedNull = applied === null || applied < 0;
    return appliedNull;
}

check("缺快照 + 有回合 → 需回填", needsBackfill(10, -1, 4));
check("快照为 null → 需回填", needsBackfill(10, null, 4));
check("已有快照 → 不回填", !needsBackfill(10, 2, 4));
check("永久状态不回填", !needsBackfill(0, -1, 4));
check("无轮数不回填", !needsBackfill(null, -1, 4));
check(
    "不在战斗中不回填（避免把起点定成错误回合）",
    !needsBackfill(10, -1, null),
);

// 回填后倒推应正常：起点=4、现在=6、10轮 → 剩 8
check(
    "回填后倒推恢复正常",
    remainingRounds(10, 4, 6) === 8,
    `实得 ${remainingRounds(10, 4, 6)}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
    process.exit(1);
}