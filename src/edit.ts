/**
 * 状态描述编辑面板（模态框）
 *
 * GM 在这里写：状态名、规则文本、持续轮数、配色。
 * 保存时把**当前回合快照**一起写进 metadata，作为轮数倒推的起点。
 *
 * 【入口】全部走左侧 action 面板的卡片按钮，不依赖右键菜单。
 */

import OBR from "@owlbear-rodeo/sdk";
import {
    MAX_NAME_LENGTH,
    MAX_TEXT_LENGTH,
    MODAL_EDIT_ID,
    PRESET_COLORS,
    clearPeek,
    readPeek,
    writePeek,
} from "./shared";
import { currentRound } from "./rounds";
import { injectStyle } from "./ui/style";
import { watchTheme } from "./ui/theme";

injectStyle();

const params = new URLSearchParams(window.location.search);
const ids = (params.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const titleEl = document.getElementById("target") as HTMLDivElement;
const subEl = document.getElementById("sub") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const nameInput = document.getElementById("name") as HTMLInputElement;
const nameCounter = document.getElementById("name-counter") as HTMLSpanElement;
const textarea = document.getElementById("text") as HTMLTextAreaElement;
const counter = document.getElementById("counter") as HTMLSpanElement;
const roundsInput = document.getElementById("rounds") as HTMLInputElement;
const colorInput = document.getElementById("color") as HTMLInputElement;
const presetsEl = document.getElementById("presets") as HTMLDivElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;

function buildPresets(): void {
    presetsEl.innerHTML = "";
    for (const c of PRESET_COLORS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "swatch";
        b.style.background = c;
        b.title = c;
        b.dataset.color = c;
        b.addEventListener("click", () => {
            colorInput.value = c;
            updateSwatchSelection();
        });
        presetsEl.appendChild(b);
    }
    updateSwatchSelection();
}

/** 给与当前颜色一致的色标加选中环（仅限固定色标，自选色不在此列） */
function updateSwatchSelection(): void {
    const cur = colorInput.value.toLowerCase();
    for (const b of presetsEl.querySelectorAll<HTMLButtonElement>(".swatch")) {
        b.classList.toggle(
            "selected",
            (b.dataset.color ?? "").toLowerCase() === cur,
        );
    }
}

function updateCounters(): void {
    textarea.value = textarea.value.slice(0, MAX_TEXT_LENGTH);
    counter.textContent = `${textarea.value.length} / ${MAX_TEXT_LENGTH}`;
    nameCounter.textContent = `${nameInput.value.length} / ${MAX_NAME_LENGTH}`;
}

async function load(): Promise<void> {
    if (ids.length === 0) {
        titleEl.textContent = "（未选择物件）";
        return;
    }

    const items = await OBR.scene.items.getItems(ids);
    const first = items.find((i) => readPeek(i.metadata).has) ?? items[0];

    if (first) {
        const peek = readPeek(first.metadata);
        nameInput.value = peek.name;
        textarea.value = peek.descPlain;
        roundsInput.value = String(peek.rounds);
        colorInput.value = /^#[0-9a-f]{6}$/i.test(peek.color) ? peek.color : "#ff00d0";
        updateSwatchSelection();

        titleEl.textContent =
            items.length > 1
                ? `${items.length} 个标记`
                : first.name || "（未命名物件）";
        subEl.textContent =
            items.length > 1 ? "将写入相同的状态" : `图层：${first.layer}`;
    }

    const round = await currentRound();
    if (round === null) {
        statusEl.textContent =
            "先攻扩展当前不在战斗中——轮数会照填。" +
            "等战斗开始时会自动以那一刻的回合作为计数起点。";
    } else {
        statusEl.textContent = `先攻当前第 ${round} 轮 · 保存时以此为计数起点。`;
    }
    if (round === null) {
        // 不在战斗中：轮数仍然保留，但快照留空，等 backfill 回填
        roundsInput.disabled = false;
    }

    updateCounters();
}

async function save(): Promise<void> {
    if (ids.length === 0) {
        await OBR.modal.close(MODAL_EDIT_ID);
        return;
    }

    const rounds = Math.max(0, Math.floor(Number(roundsInput.value) || 0));
    const round = await currentRound();

    const patch = writePeek({
        name: nameInput.value,
        // 纯文本入库；富文本版本由 hover 浮层的富文本编辑器单独写入时才会非 null。
        // 这里保持 null，让读取端回落到纯文本，不会出现「改了文本但富文本还是旧的」。
        desc: null,
        descPlain: textarea.value,
        rounds,
        // 轮数为 0（永久）时不记快照，避免后续误判
        appliedRound: rounds > 0 ? (round ?? -1) : -1,
        color: colorInput.value,
    });

    await OBR.scene.items.updateItems(ids, (items) => {
        for (const item of items) {
            Object.assign(item.metadata, patch);
        }
    });
    await OBR.modal.close(MODAL_EDIT_ID);
}

async function clearStatus(): Promise<void> {
    if (ids.length === 0) return;
    const ok = window.confirm("清除这些标记上的状态描述？\n\n（图片标记本身会保留）");
    if (!ok) return;
    await OBR.scene.items.updateItems(ids, (items) => {
        for (const item of items) {
            Object.assign(item.metadata, clearPeek());
        }
    });
    await OBR.modal.close(MODAL_EDIT_ID);
}

nameInput.addEventListener("input", updateCounters);
textarea.addEventListener("input", updateCounters);
roundsInput.addEventListener("input", () => {
    const v = Number(roundsInput.value);
    if (!Number.isFinite(v) || v < 0) roundsInput.value = "0";
});

textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void save();
    }
});
saveBtn.addEventListener("click", () => void save());
cancelBtn.addEventListener("click", () => void OBR.modal.close(MODAL_EDIT_ID));
clearBtn.addEventListener("click", () => void clearStatus());

buildPresets();

OBR.onReady(() => {
    void load();
    nameInput.focus();

    void watchTheme();
});