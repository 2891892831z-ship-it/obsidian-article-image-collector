---
date modified: 2026.10.12 10:22:15
---
# 文章图片归集 · Article Image Collector

作者：**Tsuki**。适用于 Obsidian 的 Windows / macOS 桌面插件，将一篇文章引用的网络图片和库内图片集中保存到文章旁边，按图号和图题命名。

## 功能

- 图片文件夹为 `（图件）文章完整文件名`，与文章同级，不含 `.md` 后缀。
- 文件名为 `图1_图题.png`，或按章节编号为 `图2-1_图题.png`，文件名不添加时间戳。
- 已归集且图号、图题不变的图片直接跳过；通过替换命令只更新选中的一张图片。
- 没有图标签的图片生成 `{#fig:YYYYMMDDHHmmss}`；已有标签和正文交叉引用保留，换图不改变标签。
- 保留原有 Markdown / Wiki 图片嵌入语法、图题和宽度。
- 替换图片时保存旧图片历史版本；修改引用前保存文章快照，支持恢复最近一次操作。
- 写入正文前检查数学格式和 Unicode 上下标，检测文章或图片的并发修改。

## 安装

支持 BRAT 和手动安装，尚未提交 Obsidian 社区插件商店。

### 使用 BRAT 安装（Windows / Mac）

在 BRAT 设置中选择“添加 Beta 插件”，输入 `2891892831z-ship-it/obsidian-article-image-collector`，选择最新版本并添加。公开仓库不需要 GitHub 令牌。Release 提供独立的 `manifest.json` 和构建后的 `main.js`，BRAT 会自动下载安装。

### 手动安装

1. 从本仓库 Releases 下载 `article-image-collector.zip`。
2. 在目标库中创建 `.obsidian/plugins/article-image-collector/`。
3. 将压缩包中的 `main.js`、`manifest.json` 放入该目录。
4. 重新加载 Obsidian，在“设置 → 第三方插件”中启用“文章图片归集”。

支持 Windows 和 macOS 上的 Obsidian 1.5.0 或以上桌面版本，Intel / Apple Silicon Mac 共用同一个安装包。插件内置 JavaScript 数学格式校验，不需要 PowerShell、Pandoc 或额外库脚本。不支持移动端。

Mac 安装时，在 Finder 中打开你的库文件夹，按 `Command + Shift + .` 显示隐藏目录，再进入 `.obsidian/plugins/`。升级时替换 `main.js` 和 `manifest.json` 并重新加载插件，保留已有的 `data.json`。

## 使用

打开文章，在命令面板运行“文章图片归集：归集当前文章图片”，检查预览后执行。也可以在文件菜单中选择归集。

更换图片时，把光标放在图片引用内，运行“替换光标所在图片（保留图题和编号）”，或使用编辑器右键菜单。选择本地新图片或填写新图片网址即可。

需要撤销插件最近一次操作时，运行“恢复最近一次归集前的文章”。若文章或图片之后又被修改，插件会停止恢复，以保护后续内容。文章快照和历史图片不自动清除；原来源图片也不会自动删除。

Markdown 图片的方括号文字用作图题；Wiki 图片嵌入使用原文件名作为图题。没有图题时使用默认名称。文件名中的非法字符会替换，过长图题会截短。图号根据文章中图片的顺序计算，不从图标签 ID 提取。

编号模式在预览窗口选择。自动模式在 frontmatter 包含 `chapters: true` 且存在 `# 第 N 章` 标题时按章节编号，其余情况全文连续编号。

`{#fig:...}` 和 `@fig:...` 用于 Pandoc-crossref 交叉引用；本插件不负责渲染或导出这些引用。

## 限制与排错

- 网络图片需要可访问的 HTTP/HTTPS 直链；暂不提供登录认证或自定义请求头。
- 库外图片请先导入库内，或使用替换窗口选择本地文件。
- 支持 PNG、JPEG、GIF、WebP、SVG、BMP、AVIF、TIFF 的识别与保存；能否显示取决于 Obsidian 对该格式的支持。
- 代码块和注释内的示例图片不会归集，暂不识别 HTML 图片、引用式 Markdown 图片和跨行图片语法。
- 已归集图片文件夹需要保留。删除或移入回收站后，仅凭本地引用无法重新下载；应恢复图片，或重新提供来源。
- 数学格式检查要求行间 `$$` 独占一行，公式标签紧跟结束行且后接空行。检查失败时不改正文，已新建的图片可能仍保留。

## 从源码构建

需要 Node.js 18 或以上，无须安装 npm 依赖：

```sh
npm run check
npm run build
npm test
```

`dist/` 包含可安装的 `main.js` 和 `manifest.json`。根目录的 `main.js` 是源码入口，需要与 `core.js` 一起构建；安装时使用 `dist/main.js`。

## GitHub 发布

将本项目目录作为独立仓库上传，保留 `.github/workflows/release.yml`。首次上传可通过 GitHub 网页创建仓库并上传项目文件，或添加自己的远程仓库后用 Git 推送。

创建与 `manifest.json` 版本号一致的 Git 标签（例如 `0.6.2`）并推送。GitHub Actions 会校验版本、构建并生成 Release，附带完整安装包。发布流程需要仓库允许 GitHub Actions。构建与自动测试在 Windows 和 macOS runner 上执行；这些测试不替代 Obsidian 的界面实机检查。

本项目不包含个人笔记、图片、操作日志、插件设置或本机安装脚本。

## 许可证

MIT，详见 LICENSE。
