/**
 * 把 dist/ 打成 dist.zip。
 *
 * 自己实现 zip（store 模式，不压缩），避免依赖 archiver 之类的包——
 * 产物只有 100KB 左右，压不压无所谓，而 OBR 上传走的是解压后的文件。
 *
 * zip 结构（store 模式，无 deflate）：
 *   [本地文件头][文件数据]... [中央目录]... [中央目录结束记录]
 */

import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve("dist");
const OUT = path.resolve("dist.zip");

/* ---------------- CRC32 ---------------- */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

/* ---------------- 递归收集文件 ---------------- */

/** @returns {string[]} 相对 dist 的 posix 路径，已排序 */
function walk(dir, base = dir) {
    const out = [];
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            out.push(...walk(full, base));
        } else {
            out.push(path.relative(base, full).split(path.sep).join("/"));
        }
    }
    return out;
}

/* ---------------- 字节工具 ---------------- */

const u16 = (n) => Buffer.from([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) => Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/* ---------------- 主流程 ---------------- */

if (!fs.existsSync(DIST)) {
    console.error("错误：dist/ 不存在，请先运行 vite build");
    process.exit(1);
}

const files = walk(DIST);
const locals = [];
const centrals = [];
let offset = 0;

// DOS 时间（固定值，避免每次打包产生字节差异）
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 29; // 2026-09-29

for (const rel of files) {
    const data = fs.readFileSync(path.join(DIST, rel));
    const nameBuf = Buffer.from(rel, "utf8");
    const crc = crc32(data);

    const local = Buffer.concat([
        u32(0x04034b50),        // 本地文件头签名
        u16(20),                // 需要版本
        u16(0x0800),            // 标志位：UTF-8 文件名
        u16(0),                 // 压缩方法：0 = store
        u16(DOS_TIME),
        u16(DOS_DATE),
        u32(crc),
        u32(data.length),       // 压缩后大小
        u32(data.length),       // 原始大小
        u16(nameBuf.length),
        u16(0),                 // 扩展字段长度
        nameBuf,
    ]);

    locals.push(local, data);

    centrals.push(
        Buffer.concat([
            u32(0x02014b50),    // 中央目录签名
            u16(20),            // 创建版本
            u16(20),            // 需要版本
            u16(0x0800),
            u16(0),
            u16(DOS_TIME),
            u16(DOS_DATE),
            u32(crc),
            u32(data.length),
            u32(data.length),
            u16(nameBuf.length),
            u16(0),             // 扩展字段
            u16(0),             // 注释
            u16(0),             // 起始磁盘
            u16(0),             // 内部属性
            u32(0),             // 外部属性
            u32(offset),        // 本地头偏移
            nameBuf,
        ])
    );

    offset += local.length + data.length;
}

const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),                     // 当前磁盘
    u16(0),                     // 中央目录起始磁盘
    u16(files.length),
    u16(files.length),
    u32(centralBuf.length),
    u32(offset),                // 中央目录偏移
    u16(0),                     // 注释长度
]);

const zip = Buffer.concat([...locals, centralBuf, eocd]);
fs.writeFileSync(OUT, zip);

/* ---------------- 报告 ---------------- */

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`已打包 ${files.length} 个文件 → dist.zip（${kb(zip.length)}）\n`);
let raw = 0;
for (const rel of files) {
    const size = fs.statSync(path.join(DIST, rel)).size;
    raw += size;
    console.log(`  ${rel.padEnd(34)} ${kb(size).padStart(9)}`);
}
console.log(`\n  原始合计 ${kb(raw)} → zip ${kb(zip.length)}`);
