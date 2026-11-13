/**
 * @owlbear-rodeo/sdk 的 Node 测试打桩
 *
 * 只实现被测模块真正调用到的接口。场景 metadata 与 items 都是内存存储，
 * 用来验证 archive.ts / apply.ts 的行为，不模拟任何网络。
 *
 * 【为什么状态挂 globalThis】
 * esbuild 的 alias 会把这个文件的内容**内联**进每个 bundle，
 * 如果状态定义在模块作用域，archive.js 内一份、apply.js 内一份、
 * 测试再 import 原文件还有一份 —— 三方各写各的，互相看不见。
 * 挂 globalThis 后所有副本共享同一份存储。
 */

const state = (globalThis.__sppObrStub ??= {
    meta: new Map(),
    items: [],
});

const metaStore = state.meta;
const items = state.items;

function clone(v) {
    return JSON.parse(JSON.stringify(v));
}

const OBR = {
    scene: {
        getMetadata: async () => clone(Object.fromEntries(metaStore)),
        setMetadata: async (patch) => {
            for (const [k, v] of Object.entries(patch)) {
                metaStore.set(k, clone(v));
            }
        },
        onMetadataChange: () => () => {},
        items: {
            getItems: async (ids) => {
                const set = new Set(ids);
                return items.filter((i) => set.has(i.id)).map(clone);
            },
            updateItems: async (ids, updater) => {
                const targets = items.filter((i) => ids.includes(i.id));
                const drafts = targets.map(clone);
                updater(drafts);
                // 把草稿的改动写回原件（模拟宿主的 update 语义）
                for (const d of drafts) {
                    const i = items.findIndex((x) => x.id === d.id);
                    if (i >= 0) items[i] = d;
                }
            },
            getItemAttachments: async (ids) => {
                const set = new Set(ids);
                return items
                    .filter((i) => set.has(i.attachedTo))
                    .map(clone);
            },
            getItemBounds: async (ids) => {
                const set = new Set(ids);
                const hit = items.filter((i) => set.has(i.id));
                return {
                    min: { x: 0, y: 0 },
                    max: { x: 1, y: 1 },
                    center: { x: 0.5, y: 0.5 },
                    width: 1,
                    height: 1,
                    count: hit.length,
                };
            },
            addItems: async (added) => {
                for (const a of added) items.push(clone(a));
            },
        },
    },
    player: {
        getSelection: async () => [],
    },
    notification: {
        show: async () => {},
    },
};

/** 测试专用：直接查看内存里的 items */
export const __items = items;
/** 测试专用：清空 items */
export function __resetItems() {
    items.length = 0;
}
/** 测试专用：清空场景 metadata */
export function __resetMeta() {
    metaStore.clear();
}

export default OBR;
export { OBR };
