/**
 * 编辑面板（模态框）—— 只负责「写描述文本」
 *
 * 【v1.1 变更】底部原来的「保存为模板 / 取消持久化」按钮已移除。
 * 原因：① 存档入口分散在两处，冗余；② 本 iframe 从不载入持久化存储，
 * 在这里点保存会基于空数据写回，把其它地方存的存档整个冲掉。
 * 现在存档统一在左侧 action 面板「附件描述」页的卡片按钮上操作。
 */

import OBR from "@owlbear-rodeo/sdk";
import {
    MAX_TEXT_LENGTH,
    MODAL_EDIT_ID,
    readPeek,
    writePeek,
} from "./shared";
import { applyTheme, injectStyle } from "./ui/style";

injectStyle();

const params = new URLSearchParams(window.location.search);
const ids = (params.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const titleEl = document.getElementById("target") as HTMLDivElement;
const subEl = document.getElementById("sub") as HTMLDivElement;
const textarea = document.getElementById("text") as HTMLTextAreaElement;
const counter = document.getElementById("counter") as HTMLSpanElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement;

function updateCounter(): void {
    counter.textContent = `${textarea.value.length} / ${MAX_TEXT_LENGTH}`;
}

async function load(): Promise<void> {
    if (ids.length === 0) {
        titleEl.textContent = "（未选择物件）";
        return;
    }

    const items = await OBR.scene.items.getItems(ids);
    const first = items.find((i) => readPeek(i.metadata).has) ?? items[0];

    if (first) {
        textarea.value = readPeek(first.metadata).text;
        titleEl.textContent =
            items.length > 1
                ? `${items.length} 个物件`
                : first.name || "（未命名物件）";
        subEl.textContent =
            items.length > 1 ? "将写入相同的描述文本" : `图层：${first.layer}`;
    }

    updateCounter();
}

async function save(): Promise<void> {
    if (ids.length === 0) {
        await OBR.modal.close(MODAL_EDIT_ID);
        return;
    }
    const patch = writePeek(textarea.value);
    await OBR.scene.items.updateItems(ids, (items) => {
        for (const item of items) {
            Object.assign(item.metadata, patch);
        }
    });
    await OBR.modal.close(MODAL_EDIT_ID);
}

textarea.addEventListener("input", updateCounter);
textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void save();
    }
});
saveBtn.addEventListener("click", () => void save());
cancelBtn.addEventListener("click", () => void OBR.modal.close(MODAL_EDIT_ID));

OBR.onReady(() => {
    void load();
    textarea.focus();

    void OBR.theme.getTheme().then((t) => applyTheme(t.mode));
    OBR.theme.onChange((t) => applyTheme(t.mode));
});
