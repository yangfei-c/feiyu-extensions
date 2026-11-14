# AGENTS.md — 飞羽系列浏览器扩展开发规范

本文件约束本仓库（`feiyu-extensions`）中所有「飞羽」系列 Chrome 扩展的开发与维护。

**标准样板**：[`feiyu-arxiv-copilot/`](./feiyu-arxiv-copilot/)（v2.2.3，已按本规范重构并验证通过）。
新建或改动任何扩展前，先通读该样板的源码、`manifest.json` 与子目录 `README.md`。

---

## 1. 仓库规范（Monorepo）

- 采用**单仓库多扩展（Monorepo）**结构。仓库根目录只保留：`README.md`、`AGENTS.md` 与各扩展子目录，不放置任何扩展运行源码。
- 每个扩展一个独立子目录 `feiyu-<name>/`（例如 `feiyu-arxiv-copilot/`），命名统一小写 kebab-case，前缀固定为 `feiyu-`。
- **新增 / 变更 / 升级扩展时**，必须同步更新根目录 [`README.md`](./README.md) 的「扩展列表」表：登记扩展名称、一句话简介、当前版本，并链接到该扩展子目录的 `README.md`。
- 每个扩展子目录内应维护自己的 `README.md`，至少包含：功能说明、安装方式、适用范围与隐私声明。

## 2. 标准目录结构（Chrome MV3 · 零打包原生 JS）

- 必须使用 **Chrome Manifest V3**；**不引入** Webpack / Vite 等打包工具，只用原生 JS（`<script>` 与 `content_scripts` 直接加载）。
- 所有源码统一放 `src/` 下，按职责分层：`config/`、`background/`、`popup/`、`content/`。
- **HTML / CSS / JS 严格分离**：样式进独立 `.css` 文件；Shadow DOM 面板样式也独立成 `.css`，通过 `chrome.runtime.getURL` 加载，不内联大段样式。
- **公共常量统一收拢到 `src/config/constants.js`**（如服务商/模型列表 `PROVIDERS`、反馈接口地址 `FEEDBACK_ENDPOINT`），禁止在 popup 与 content 两处重复定义。
- **模块间用全局命名空间连接**：每个扩展使用自己的命名空间 `window.Feiyu<Name>`（样板为 `window.FeiyuArxiv`），各文件只挂载自己的子命名空间（如 `render` / `extractor` / `panel` / `app` / `state`）。在 `popup.html` 与 `manifest.json` 的 `content_scripts[].js` 中**按依赖顺序加载**，`constants.js` 必须最先加载。
- **单个 JS 文件尽量不超过 350 行**；超出时优先按职责继续拆分（例如把「渲染」「抓取」「面板 UI」「调度」拆成独立文件）。
- **商店截图、宣传图、商店图标等非运行素材统一放 `store-assets/`**，不混入 `src/`；扩展运行时真正引用的图标放根级 `icons/`（由 `manifest.json` 的 `icons` / `action.default_icon` 引用）。

标准样板目录树：

```text
feiyu-<name>/
├── manifest.json
├── README.md
├── icons/                     # 扩展运行时图标（manifest 引用）
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── store-assets/              # 商店/宣传素材（不进代码目录）
│   ├── 图标/
│   ├── 效果展示/
│   └── 宣传图/
└── src/
    ├── config/
    │   └── constants.js
    ├── background/
    │   └── service-worker.js
    ├── popup/
    │   ├── popup.html
    │   ├── popup.css
    │   ├── export.js
    │   └── popup.js
    └── content/
        ├── render.js
        ├── extractor.js
        ├── panel.css
        ├── panel.js
        └── index.js
```

- `manifest.json` 需按新路径更新 `background.service_worker`、`action.default_popup`、`content_scripts[].js` 与 `web_accessible_resources`。content 侧按需加载的 `.css` 必须登记到 `web_accessible_resources` 的 `resources` + `matches`。
- 结构调整完成后：删除根目录旧的散落 `.js/.html` 文件，并核对各 `README.md` 内图片相对路径仍能正常显示。

## 3. 安全与隐私

- **严禁在任何前端代码（popup / content / background / constants 等）或仓库文件中硬编码密钥、Token、密码等凭据。**
- 用户 API Key 与本地记录（如阅读历史）**只存 `chrome.storage.local`**，不写入 cookie / `localStorage`，不上传第三方。
- 服务端密钥只放 **Cloudflare Worker 环境变量（Secret）**，不进入 Worker 代码或仓库。
- 权限按最小化原则：能用 `host_permissions` / `optional_host_permissions` 精确到域名的，不要常驻 `https://*/*`；每项新增权限都要在 README 中说明用途。
- 在 README 与弹窗中给出明确隐私声明：数据仅存本地、仅在用户主动操作时向所配置的接口发送本次所需内容。

## 4. UI 与交互

- 保持飞羽系列**极简、克制**的视觉风格：不使用花哨 emoji，不堆砌模板化营销话术。
- 弹窗与网页悬浮面板通过 **`chrome.storage.onChanged` 实时同步「显隐」与「配置」**（样板字段：`showPanel`、`provider` / `apiUrl` / `model` / `apiKey`）。
- 明确标注**适用网站范围**与 **BYOK（自带密钥 / Bring Your Own Key）**声明，避免误导用户。
- 文案使用简体中文，通用英文术语（如 Transformer、Attention、API Key）保留英文。

## 5. 调试习惯

- **写网页提取 / 内容脚本选择器之前，先用 Playwright MCP 检查目标页面真实 DOM 与日志**：用 `browser_snapshot` 看可达性树、`browser_evaluate` 读真实 `querySelector` 结构、`browser_console_messages` 看控制台报错；**不要凭经验盲猜选择器**。
- 依赖页面结构的选择器要覆盖目标站点的多种页面形态（如 arXiv 的 `abs` / `html` / `pdf` 与 ar5iv），并做空值兜底（`?.`、`|| fallback`）。
- 改完先逐个 `node --check` 校验 JS 语法、解析校验 `manifest.json`、核对所有引用路径真实存在，再提交。
