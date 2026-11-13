/**
 * 本地自测服务器
 *
 * 【为什么不能用 python -m http.server】
 * 1. 它不发送任何 CORS 响应头。Owlbear 宿主页在 owlbear.rodeo，
 *    扩展资源在 localhost，属于跨域，浏览器会把 200 的响应直接丢弃，
 *    控制台表现为 "Failed to fetch"。
 * 2. 它是单线程的，同时拉多个 js 会互相阻塞。
 *
 * 用法：node serve-local.mjs [端口]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "dist");
const PORT = Number(process.argv[2] ?? 5282);

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
};

http
    .createServer((req, res) => {
        // 关键：允许任意源读响应
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const urlPath = decodeURIComponent(
            (req.url ?? "/").split("?")[0].split("#")[0],
        );
        const rel = urlPath === "/" ? "/manifest.json" : urlPath;
        const file = path.join(DIST, path.normalize(rel));

        // 防目录穿越
        if (!file.startsWith(DIST)) {
            res.writeHead(403);
            res.end("forbidden");
            return;
        }

        fs.readFile(file, (err, buf) => {
            if (err) {
                console.log(`404 ${rel}`);
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("not found");
                return;
            }
            const ext = path.extname(file).toLowerCase();
            res.writeHead(200, {
                "Content-Type": MIME[ext] ?? "application/octet-stream",
                "Cache-Control": "no-store",
            });
            res.end(buf);
            console.log(`200 ${rel}`);
        });
    })
    .listen(PORT, "127.0.0.1", () => {
        console.log(`状态描述本地服务已启动：http://localhost:${PORT}/`);
        console.log(`安装地址：            http://localhost:${PORT}/manifest.json`);
    });
