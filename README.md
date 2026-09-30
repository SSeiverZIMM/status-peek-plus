# 附件描述 —— 合并版扩展

Status Peek 与 Persistent Tokens 的功能合并版，外观完全沿用 Status Peek 风格。

> **许可证：GPL-3.0-only。** 本项目合并了上游 GPL 代码，因此整体以 GPL-3.0
> 发布。版权与衍生改动说明见 [NOTICE](NOTICE)，第三方组件声明见
> [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

---

## 一、构建配置

产物里的资源引用**全部是绝对 URL**，基准地址由环境变量提供。

> ⚠️ **不要用 `./` 开头的相对路径。** OBR SDK 内部（`lib/common/normalize.js`）
> 处理非 `http` 开头的路径时，会直接拼到 `window.location.origin` 之后，而
> `origin` 末尾没有斜杠：`./icon.svg` → `https://host./icon.svg`（点被怼进
> 主机名）→ SSL 证书校验失败 → 图标不显示、弹窗打不开。

把 `.env.example` 复制为 `.env.local`（已被 gitignore），填入你的部署地址，
**必须以 `/` 结尾**：

```bash
VITE_DEPLOY_BASE=https://example.com/status-peek/
```

该值用于两处：

1. 生成 `dist/manifest.json` 的 `icon` / `action.popover` / `background_url`
2. 生成 `dist/*.html` 里引用的 `assets/*.js` 绝对路径

`manifest.json` **不是手写的** —— 它由 `manifest.template.json` 在构建时填充
`{{BASE}}`（部署地址）与 `{{VERSION}}`（取自 `package.json`，避免两处手工同步
漂移）生成。换域名只需改 `.env.local`，不必碰任何源码。

未设置该变量时，生产构建会**直接中止并给出提示**，避免产出地址错误的包。

---

## 二、部署

### 放在独立子目录

如果同一个站点还托管着别的 OBR 扩展（例如 Master Loot），**必须**放到子目录，
否则根目录的 `manifest.json` / `action.html` / `background.html` / `icon.svg`
会互相覆盖，导致原有扩展失效。

```
站点根目录
├── manifest.json          ← 其他扩展（不要动）
├── action.html            ← 其他扩展
├── icon.svg               ← 其他扩展
├── assets/                ← 其他扩展
│
└── status-peek/           ← 本扩展放这里
    ├── manifest.json
    ├── action.html
    ├── background.html
    ├── edit.html
    ├── icon-v3.svg
    └── assets/
```

把 `dist/` 目录下的**全部 11 个文件**（含 `assets/` 子目录）原样上传到 `status-peek/` 下。

上传后访问 `https://你的域名/status-peek/manifest.json` 能正常显示 JSON（而非弹出下载）即成功。

**安装扩展**：把 `https://你的域名/status-peek/manifest.json` 填进 Owlbear Rodeo 的扩展地址栏。

> ⚠️ 静态托管后台**不要开启「访问控制 / 私有访问」**，否则 OBR 的 iframe 无法加载页面。
>
> 若之前装过 Status Peek，建议先卸载旧的，避免两个扩展的右键菜单重复。

---

## 三、功能

### 1. 附件描述（第一个 tab）

沿用 Status Peek 原有行为，只对 **PROP / ATTACHMENT** 两个图层的物件生效。

- **GM**：右键物件 →「附件描述」→ 在弹出面板里写规则文本
- **玩家**：点选画布上的物件，action 面板自动显示其描述
- 描述存在物件的 metadata 里（`status-peek/text`），**不往画布添加任何文字物件**

### 2. 保存模板（第二个 tab）

来自 Persistent Tokens 的跨场景持久化能力，作用域收窄为 PROP / ATTACHMENT 图层。

**存档只有一个入口：**

| 入口 | 操作 |
|---|---|
| action 面板卡片 | 选中物件后，卡片右侧点「存档」（再点一次「取消存档」即删除） |

> 编辑面板（右键 →「附件描述」）只负责**写描述文本**，不提供存档按钮 —— 存档入口
> 分散在两处会造成冗余，且弹窗所在的 iframe 不持有存储副本，在那儿存会冲掉已有存档。

**模式：**

- **唯一（默认）** —— 存一份快照，且该物件在场景中的后续改动会**自动回写**。
  从素材库重新拖出同一张图片的物件时，会自动带上这份 metadata 与附件。
- **模板** —— 关闭自动同步，只在点「存档」按钮时更新。可在下方列表里切换。

**保存内容可逐项开关：**

- **元数据** —— 物件的自定义数据（**包含描述文本**）
- **附件** —— 挂在物件上的子物件，相对位置一并保存

**其他操作：**

- 点缩略图 → 在画布中选中并聚焦该物件
- 「重命名」「删除」
- 顶部「导出 / 导入」→ JSON 备份与迁移
- 「设置」→ 开关右键菜单入口

---

## 四、与两个原版的差异

### 相比 Status Peek

| 变化 | 说明 |
|---|---|
| 新增 tab 栏 | 「附件描述」/「保存模板」两个页签 |
| 卡片新增按钮 | GM 视角下，每张卡片右侧有「存档 / 取消存档」和「编辑」 |
| 玩家端不变 | 仍只读，看不到模板 tab |

### 相比 Persistent Tokens

| 变化 | 说明 |
|---|---|
| **作用域收窄** | 只对 PROP / ATTACHMENT 生效（原本是任意 IMAGE 物件） |
| **界面全部重写** | 从 React + MUI 改为原生 DOM，视觉与 Status Peek 统一 |
| **右键菜单合并** | 原本三条独立菜单（Persist / Update Template / Reset to Template），现合并为一条「附件描述」，持久化操作移入面板按钮 |
| **去掉模糊搜索** | 改为普通子串过滤（模板数量通常不多，够用） |
| **去掉弹窗自适应** | 改为固定高度 + 内部滚动 |
| **砍掉 TEXT / DESCRIPTION 开关** | PROP / ATTACHMENT 物件通常没有这两项属性 |
| **保留 v1 数据兼容** | 旧版导出的 JSON 仍可导入 |

---

## 五、验证情况

核心逻辑在 Node 环境下真实加载运行测试，**64 项断言全部通过**：

| 测试组 | 项数 | 覆盖内容 |
|---|---|---|
| 存储读写 | 6 | 保存 / 查询 / 落盘 / 重载 |
| 模板更新与去重 | 7 | 重复保存不新增、已存在项刷新快照并保留模式 |
| 重命名与属性开关 | 5 | 补集计算、undefined 默认值 |
| 删除 | 2 | 内存与落盘同步 |
| **附件坐标往返** | 7 | 相对坐标转换、ROOT 映射、ID 重生 |
| 数据格式校验 | 7 | v1/v2 兼容、非法数据拒绝 |
| 描述文本读写 | 4 | trim、空值安全、类型保护 |
| 图层过滤 | 4 | 只认 PROP / ATTACHMENT |
| 损坏数据自愈 | 2 | JSON 损坏、字段类型错误时不崩溃 |
| 导入合并 | 3 | 同 URL 覆盖而非重复 |
| **默认唯一模式** | 3 | 不传 type 时为 UNIQUE、返回结果可供 UI 提示 |
| **跨 iframe 不互相覆盖** | 4 | 另一 iframe 的写入不会被本 iframe 的内存旧副本冲掉 |
| **多实例自动同步** | 1 | 同图多份时按最近修改的实例回写 |

其中「附件坐标往返不变」是最关键的一项 —— 它保证存进去的附件位置与还原出来完全一致。

---

## 六、已知限制

1. **存储上限 5MB** —— 浏览器 localStorage 的硬限制。面板顶部实时显示占用。清除浏览器数据会一并删除，**建议定期用「导出」备份**。
2. **同一图片的多个物件** —— 持久化以图片 URL 为标识（同一张图的所有副本共享一份存档，
   **无法给每张副本存不同的描述**）。场景中存在多个副本时，自动同步以「最近修改的那个」
   为准。若需要各自不同的描述，只能换用不同的图片。
3. **仅 GM 可用** —— 玩家端只读，看不到任何管理入口。
4. **旧版 Status Peek 数据不会自动迁移** —— 描述文本存在物件 metadata 里，物件本身不受影响；但 PT 的模板数据需从旧扩展导出后再导入本扩展。

---

## 七、开发

```bash
npm install
npm run build      # tsc 类型检查 + 产出 dist/（含生成 manifest.json）
npm run pack       # 把 dist/ 打成 dist.zip（零第三方依赖，自实现 zip）
npm run test       # 运行 64 项运行时断言
npm run dev        # 本地开发（需自签证书才能被 OBR 加载）
```

首次 clone 后先配置部署地址：

```bash
cp .env.example .env.local
# 编辑 .env.local，填入 VITE_DEPLOY_BASE=https://你的域名/status-peek/
```

源码结构：

```
manifest.template.json      构建期生成 manifest.json 的模板（{{BASE}} / {{VERSION}}）
vite.config.ts              读取 VITE_DEPLOY_BASE，注入 base 与 manifest
src/
├── shared.ts               元数据键、描述读写、自身资源 URL 解析
├── background.ts           右键菜单注册 + 唯一模式自动同步
├── action.ts               两个 tab 的容器
├── edit.ts                 编辑面板（只写描述文本，不含存档）
├── persist/
│   ├── model.ts            数据模型与校验        ← 改编自上游
│   ├── store.ts            localStorage 存储层    ← 改编自上游
│   ├── attachments.ts      附件相对坐标转换        ← 移植自上游
│   └── apply.ts            把持久化数据应用到场景  ← 改编自上游
└── ui/
    ├── style.ts            统一设计语言（含深色模式）
    ├── panel-peek.ts       附件描述面板
    └── panel-templates.ts  保存模板面板           ← 由上游 React 版重写
scripts/
└── gen-third-party-notices.py   重新生成第三方组件声明
```

标注「改编自上游」的文件请勿移除文件头部的来源与改动注释 —— 这是 GPL-3.0
第 5 条对修改后文件的要求。

`test-runtime.mjs` 是核心逻辑的运行时测试，改动 `persist/` 下任何文件后建议重跑：

```bash
node test-runtime.mjs
```

它用 esbuild 把 `src/` 打包成 Node 可加载的 ESM（把 `@owlbear-rodeo/sdk` 设为
external），打桩 `globalThis.localStorage`，然后真实调用 store / model /
attachments 模块 —— 不是 mock，是真实执行。

---

## 八、许可证与致谢

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
