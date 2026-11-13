import { defineConfig, loadEnv, type Plugin } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";

/**
 * 部署基准 URL
 * ---------------------------------------------------------------
 * 必须指向「扩展文件所在的目录」，**以 / 结尾**，例如：
 *
 *   https://example.com/status-peek/
 *   https://status-peek.example.com/
 *
 * 为什么不能写相对路径：OBR 处理 `./xxx` 这类相对路径时，是以**域名根**
 * 为基准拼接的（实测确认：报错日志里出现过 `https://域名./icon.svg` 这种
 * 既丢掉子目录、又把 `.` 怼进主机名的地址，直接触发 SSL 证书错误），
 * 而不是以 manifest 的 URL 为基准。所以子目录部署下相对路径必然失败。
 * 这里统一产出绝对 URL。
 *
 * 配置方式：在项目根目录建 `.env.local`（已被 .gitignore 忽略）写入
 *   VITE_DEPLOY_BASE=https://example.com/status-peek/
 * 可直接复制 `.env.example` 改名。
 */
const DEV_FALLBACK = "http://localhost:5173/";

function resolveDeployBase(value: string | undefined, mode: string): string {
    const raw = value?.trim();

    if (raw) {
        return raw.endsWith("/") ? raw : `${raw}/`;
    }

    // 本地开发允许兜底，便于直接 `npm run dev` 起服务
    if (mode === "development") {
        console.warn(
            `\n[附件描述] 未设置 VITE_DEPLOY_BASE，已回退到 ${DEV_FALLBACK}` +
                `\n           如需在 OBR 中调试请改 .env.local。\n`,
        );
        return DEV_FALLBACK;
    }

    throw new Error(
        "\n[构建中止] 未设置 VITE_DEPLOY_BASE。\n\n" +
            "  它是扩展部署后的绝对基准 URL，必须以 / 结尾。\n" +
            "  把 .env.example 复制为 .env.local，填入你自己的地址：\n\n" +
            "      VITE_DEPLOY_BASE=https://example.com/status-peek/\n\n" +
            "  改完重新执行 npm run build。\n",
    );
}

/**
 * 构建期生成 manifest.json
 *
 * 源文件 `manifest.template.json` 里的 {{BASE}} / {{VERSION}} 会被替换，
 * 避免把部署域名硬编码进仓库（谁 clone 都只需要改自己的 .env.local）。
 * 版本号统一取自 package.json，避免两处手工同步漂移。
 */
function manifestPlugin(deployBase: string, version: string): Plugin {
    return {
        name: "obr-manifest",
        generateBundle() {
            const template = readFileSync(
                resolve(__dirname, "manifest.template.json"),
                "utf-8",
            );
            const output = template
                .replaceAll("{{BASE}}", deployBase)
                .replaceAll("{{VERSION}}", version);

            // 提前校验，避免产出非法 JSON
            JSON.parse(output);

            this.emitFile({
                type: "asset",
                fileName: "manifest.json",
                source: output,
            });
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, __dirname, "VITE_");
    const deployBase = resolveDeployBase(
        env.VITE_DEPLOY_BASE || process.env.VITE_DEPLOY_BASE,
        mode,
    );
    const version: string = JSON.parse(
        readFileSync(resolve(__dirname, "package.json"), "utf-8"),
    ).version;

    return {
        base: deployBase,
        plugins: [manifestPlugin(deployBase, version)],
        build: {
            // 禁用内联，OBR 的 iframe 环境对内联资源支持不佳
            assetsInlineLimit: 0,
            rollupOptions: {
                input: {
                    background: resolve(__dirname, "background.html"),
                    action: resolve(__dirname, "action.html"),
                    edit: resolve(__dirname, "edit.html"),
                    peek: resolve(__dirname, "peek.html"),
                },
            },
        },
    };
});
