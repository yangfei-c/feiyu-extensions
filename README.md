# 飞羽系列浏览器扩展

作者：YangFei

本仓库用于存放飞羽系列原创浏览器扩展。每个扩展在独立子目录中维护源码、安装说明、功能演示与商店素材。

## 扩展列表

| 扩展 | 当前版本 | 简介 |
| --- | --- | --- |
| [飞羽 · 学术论文助手](./feiyu-arxiv-copilot/README.md) | v2.3.0 | 支持 arXiv / ar5iv / ScienceDirect / PDF 的论文阅读助手：结构化导读、双语对照翻译、划词与图表问答、阅读记录导出。 |
| [飞羽 · B站学习助手](./feiyu-bilibili-copilot/README.md) | v1.0.0 | 把 B 站视频整理成学习笔记：带时间戳的 AI 总结、高赞热评与 AI 课代表提炼、视频问答。 |

## 开发工作流

按时段选择模型，用 DeepSeek Harness 和 Playwright MCP 开发、验证扩展，再通过 GitHub Actions 打包并同步到 Chrome 商店提审。

上线后，用户可在扩展里提交反馈，由 Cloudflare Workers 接收并转发，再通过 Server酱推送到微信。

![飞羽 Chrome 扩展开发流程](./开发工作流/飞羽开发工作流.png)

[查看 SVG 矢量图](./开发工作流/飞羽开发工作流.svg)

## 飞羽 · 学术论文助手

[![飞羽 · 学术论文助手封面](./feiyu-arxiv-copilot/store-assets/宣传图/宣传图.jpg)](./feiyu-arxiv-copilot/README.md)

目前已支持 arXiv、ar5iv、ScienceDirect 及 PDF 论文页面，后续将逐步延伸适配更多常见学术论文网站。

- **三 Tab 分页**：导读 / 译文 / 问答三个页签各自独立，切换时状态互不串台。
- **结构化导读（摘要快读 / 全文精读）**：摘要快读仅分析摘要、适合快速筛论文；全文精读读取整篇正文与公式、适合深入拆解方法与实验。
- **双语对照翻译**：逐段译在原文下方，保留公式；支持 PDF 按页码分段翻译。
- **划词与图表问答**：选中段落或公式即可翻译、举例解释或提问；支持 PDF 右键划词，以及在输入框内 `Ctrl + V` 粘贴截图识别公式与图表。
- **阅读记录与 Zotero 导出**：本地留痕，可导出 Markdown 笔记或 BibTeX。

[查看完整说明 →](./feiyu-arxiv-copilot/README.md)

## 飞羽 · B站学习助手（v1.0.0）

[![飞羽 · B站学习助手封面](./feiyu-bilibili-copilot/store-assets/宣传图/宣传图.jpg)](./feiyu-bilibili-copilot/README.md)

把 B 站视频变成可检索的学习资料：

- **带时间戳的 AI 总结**：按「核心结论 / 分段大纲 / 关键知识点」输出，时间戳可点击跳转到对应播放位置。
- **高赞热评与 AI 课代表提炼**：拉取高赞评论并生成课代表笔记。
- **视频问答**：以字幕为上下文提问。
- **笔记导出**：总结自动按「视频 + 分 P」存入本地，可批量导出 Markdown。

[查看完整说明 →](./feiyu-bilibili-copilot/README.md)

## 安装方式

- **Chrome 应用商店**：[打开「飞羽 · 学术论文助手」详情页](https://chromewebstore.google.com/detail/gmpagaiebchoilchbhdbpgjjbbefipcl)，点击「添加至 Chrome」。
- **GitHub 手动安装**：[下载 v2.3.0 安装包](https://github.com/yangfei-c/feiyu-extensions/releases/download/v2.3.0/feiyu-arxiv-copilot-v2.3.0.zip)并解压，然后按[手动安装步骤](./feiyu-arxiv-copilot/README.md#本地手动安装)加载扩展。
- **飞羽 · B站学习助手（手动安装）**：克隆本仓库后，按[手动安装步骤](./feiyu-bilibili-copilot/README.md#本地手动安装)加载 `feiyu-bilibili-copilot` 文件夹。

仓库将持续更新已有扩展，并陆续加入其他浏览器扩展。
