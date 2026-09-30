"""生成 THIRD-PARTY-NOTICES.md —— 从 node_modules 机械提取，避免手工誊抄出错。"""

import glob
import io
import json
import os

# 实际被内联进 dist/ 产物中的运行时依赖（构建工具链不计入分发范围）
PACKAGES = ["@owlbear-rodeo/sdk", "events", "immer", "js-base64", "uuid"]

PROJECT_VERSION = "1.1.0"


def repo_url(pkg_json):
    repo = pkg_json.get("repository")
    if isinstance(repo, dict):
        return repo.get("url", "")
    if isinstance(repo, str):
        return repo
    return pkg_json.get("homepage", "")


def license_text(pkg_dir):
    cands = sorted(
        glob.glob(os.path.join(pkg_dir, "LICENSE*"))
        + glob.glob(os.path.join(pkg_dir, "LICENCE*"))
    )
    if not cands:
        return "（该包未附带 LICENSE 文件，许可信息见其 package.json）"
    with io.open(cands[0], encoding="utf-8", errors="replace") as fh:
        return fh.read().rstrip()


def main():
    lines = [
        "# 第三方组件声明 / Third-Party Notices",
        "",
        "本扩展的构建产物（`dist/`）内联打包了以下第三方组件。",
        "依照各自许可的要求，其版权声明与许可全文附录于此。",
        "",
        f"- 对应项目版本：status-peek-plus {PROJECT_VERSION}",
        "- 依赖版本锁定：见 `package-lock.json`",
        "",
        "这些组件与本项目自身的代码一同被打包进 `dist/assets/*.js`，",
        "因此随扩展一起分发，需要保留其声明。",
        "",
        "---",
        "",
    ]

    summary = []
    for name in PACKAGES:
        pkg_dir = os.path.join("node_modules", name)
        with io.open(os.path.join(pkg_dir, "package.json"), encoding="utf-8") as fh:
            pkg_json = json.load(fh)

        version = pkg_json.get("version", "?")
        license_id = pkg_json.get("license", "?")
        url = repo_url(pkg_json)
        summary.append((name, version, license_id))

        lines += [f"## {name}", ""]
        lines.append(f"- 版本：{version}")
        lines.append(f"- 许可：{license_id}")
        if url:
            lines.append(f"- 来源：{url}")
        lines += ["", "```", license_text(pkg_dir), "```", "", "---", ""]

    with io.open("THIRD-PARTY-NOTICES.md", "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))

    print("已生成 THIRD-PARTY-NOTICES.md，字节:", os.path.getsize("THIRD-PARTY-NOTICES.md"))
    print()
    print("=== 收录清单 ===")
    for name, version, license_id in summary:
        print(f"  {name:26} {version:10} {license_id}")


if __name__ == "__main__":
    main()
