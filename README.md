# 附件描述 —— 合并版扩展

Status Peek 与 Persistent Tokens 的功能合并版，外观完全沿用 Status Peek 风格。

> **许可证：GPL-3.0-only。** 本项目合并了上游 GPL 代码，因此整体以 GPL-3.0
> 发布。版权与衍生改动说明见 [NOTICE](NOTICE)，第三方组件声明见
> [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

---


## 已知限制

1. **存储上限 5MB** —— 浏览器 localStorage 的硬限制。面板顶部实时显示占用。清除浏览器数据会一并删除，**建议定期用「导出」备份**。
2. **同一图片的多个物件** —— 持久化以图片 URL 为标识（同一张图的所有副本共享一份存档，
   **无法给每张副本存不同的描述**）。场景中存在多个副本时，自动同步以「最近修改的那个」
   为准。若需要各自不同的描述，只能换用不同的图片。
3. **仅 GM 可用** —— 玩家端只读，看不到任何管理入口。
4. **旧版 Status Peek 数据不会自动迁移** —— 描述文本存在物件 metadata 里，物件本身不受影响；但 PT 的模板数据需从旧扩展导出后再导入本扩展。

---


## 许可证与致谢

### 本项目的许可

**GPL-3.0-only** —— 全文见 [LICENSE](LICENSE)。

本项目合并了以 GPL-3.0 发布的上游代码，因此整体构成衍生作品，必须以同一
许可分发。这意味着你可以自由使用、修改、再分发，但**再分发时必须一并提供
源代码并保留同样的许可**。

### 上游致谢

持久化功能改编自 [desain/owlbear-persistence](https://github.com/desain/owlbear-persistence)
（作者 **desain**，GNU GPL v3，基准提交 `18ff272`）。详细的衍生文件清单、
改动内容与功能差异见 [NOTICE](NOTICE)。

上游 LICENSE 使用的是 GNU 官方模板，未填写具体版权行；其 README 声明为
"GNU GPLv3"。故本项目标注为 **GPL-3.0-only**，**未声明 "or later"**，
以免超出原作者实际授予的许可范围。

### 第三方组件

构建产物中内联了若干第三方组件，其版权声明与许可全文见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
