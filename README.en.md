---
date modified: 2026.10.13 14:48:36
---
# Article Image Collector

[简体中文](README.md) | **English**

Author: **Tsuki**. An Obsidian desktop plugin for Windows and macOS that collects remote and vault images into a folder next to an article, using figure numbers and captions as filenames.

## Language

Choose **Follow Obsidian**, **简体中文**, or **English** from **语言 / Language** at the top right of the collection preview, or in **Settings → 文章图片归集**. The choice is saved. Switching in the preview keeps your selection, filter and committed caption edits.

Automatic mode uses Chinese for Chinese Obsidian locales and English for other locales. Command names are bilingual so you can find them in either language. Context menus, previews, replacement dialogs, results and plugin notices use the selected language. Changing the language does not translate article content, captions, existing filenames, image folders or recovery records.

## Windows long image paths

While enabled, the plugin loads vault images with full paths of 260 characters or more through in-memory URLs, preserving filenames, folders and article references. This supports image tabs, rendered article images and plugin thumbnails. Disabling the plugin restores Obsidian’s original path-loading behavior. System settings and other applications are not changed. Large images consume memory; closing the image releases its loading resources.

## Image previews and integrity checks

Pending or review items show thumbnails. Click a thumbnail to open a larger view. Healthy, collected images load only after their cards are expanded. A missing image with an available source displays a recovery-source preview; this does not mean the image has been restored. Remote thumbnails require an explicit click on **Load remote thumbnail**. Failed previews display a source or format message. Previews do not write image files.

Expand **Original reference and full paths** to see the current reference and recorded remote or local original. Local-original existence is also checked. Collection retains local originals in other vault folders; computer-selected files are not managed by the plugin. Source records live independently in plugin settings, in data.json, so deleting the image folder does not delete those records. Keep your plugin settings; source records are not image backups. Known sources in the latest legacy log are imported. Older sources without records are marked unknown rather than guessed.

Choose **Check image integrity** in the preview or command palette to see counts of available local images, missing images, recoverable images and remote references. Checking does not modify the article or request remote URLs. You may manually load a remote thumbnail after expanding its card. Recover one image, recover all available images, or choose a replacement. Recovery requires a local original, vault-trash image or accessible recorded URL. A local source whose contents differ from its recorded hash is rejected for manual review. Batch recovery keeps full-article numbering and existing figure labels.

## Features

- Collect HTTP/HTTPS images and images already in your vault into an article-specific folder.
- The folder is named `（图件）` plus the complete article basename, without `.md`, and is placed next to the article.
- Files use `图1_caption.png` or chapter numbering such as `图2-1_caption.png`. Filenames have no timestamps. These naming rules stay the same in both interface languages.
- Unchanged managed images are skipped without reading or rewriting their binary content. Replace a single image independently.
- New images receive a unique `{#fig:YYYYMMDDHHmmss}` label. Existing labels, cross-references, captions and widths are preserved.
- Preview original filenames, captions and line numbers. Expand references and paths only when needed.
- Pending or review items are shown by default; healthy images collapse to one line when you show all images.
- Select individual images. Numbering is based on the full article even when processing a subset.
- Entering a nonempty manual caption synchronizes the saved filename and Markdown image caption. Caption input is optional when none is detected.
- Rename managed images when only their numbers or captions change, without rewriting image content.
- Missing images can be restored from vault trash, downloaded from their recorded URL, or replaced with a chosen file or URL.
- Save old image versions and the latest article recovery snapshot. Check for later edits before restoring.
- Built-in Markdown math validation; no PowerShell, Pandoc or external vault script is required.

## Install

The plugin is not yet listed in the Obsidian community plugin directory. Use BRAT or install manually.

### BRAT

In BRAT, choose **Add Beta plugin**, enter `2891892831z-ship-it/obsidian-article-image-collector`, and install the latest release. No GitHub token is needed for this public repository. Releases include standalone `main.js` and `manifest.json` for BRAT.

### Manual installation

1. Download `article-image-collector.zip` from [Releases](https://github.com/2891892831z-ship-it/obsidian-article-image-collector/releases).
2. Create `.obsidian/plugins/article-image-collector/` in your vault.
3. Extract `main.js` and `manifest.json` into that directory.
4. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

Requires Obsidian 1.5.0 or later on Windows or macOS desktop. Intel and Apple Silicon Macs use the same package. Mobile is not supported. In Finder, press **Command + Shift + .** to show hidden folders. When updating manually, replace the two plugin files and keep your existing `data.json`.

## Use

Open an article and run **Collect article images** from the command palette, or use the file context menu. Review the preview and choose **Process selected images**. Only checked images are processed. Use **Select all pending** and **Clear selection** to adjust the selection.

A nonempty manual caption updates the saved filename and the caption inside Markdown image brackets, preserving figure labels and cross-references. Manual captions are remembered by article and figure label. Missing or ambiguous captions have an orange prompt; you can leave the field blank and continue.

To replace one image, place the cursor in its reference and run **Replace image at cursor (keep caption and number)**, or use the editor context menu. Choose a local image or enter a direct image URL. The previous image content is kept in history.

After editing captions or inserting figures, open a new preview to review renames. A destination collision stops the rename; number swaps use temporary filenames. One image referenced with different figure numbers must be separated into independent files before renaming. Obsidian link-update settings are respected; if automatic link updates are disabled, the current article's selected references are still updated, but links in other notes may need attention.

Missing-image recovery is performed only when you click its action. Vault-trash copies are retained. The plugin does not scan the operating system trash. If a download fails, return to the preview to choose a new source.

Run **Restore article before last collection** to undo the latest successful modification. The plugin stops if the article or relevant images have changed since collection. Only the latest recovery records are kept: `最近归集.txt` and `归集前.txt`. Legacy plugin JSON logs and snapshots are moved to vault trash; source images and image history are retained. Recovery filenames, markers and stored data remain compatible across interface languages.

## Captions and numbering

Meaningful Markdown image captions take priority. For empty captions or number-only captions, the plugin looks for explicit adjacent figure captions such as “图1-1 区域位置图”. Wiki embeds can also use adjacent captions, otherwise the original filename is used. Ambiguous captions require review. Invalid filename characters are sanitized and overly long names are shortened.

Choose automatic, chapter, or sequential numbering in the preview. Automatic mode uses chapter numbering when frontmatter contains `chapters: true` and numbered chapters are recognized; otherwise it uses sequential numbering. Supported headings include “第十二章”, “一、研究背景”, and top-level “1 Introduction”. Figure numbers come from article order, not the figure label ID. A chapter without images does not shift later chapter numbers.

Labels such as `{#fig:...}` and references such as `@fig:...` are for Pandoc-crossref. This plugin does not render or export cross-references.

## Limits and troubleshooting

- Remote images need accessible HTTP/HTTPS direct URLs. Authentication and custom headers are not supported.
- Import files outside the vault first, or select a local file in the replacement dialog.
- Recognizes PNG, JPEG, GIF, WebP, SVG, BMP, AVIF and TIFF. Display support depends on Obsidian.
- Images in code blocks and comments are ignored. HTML images, reference-style Markdown images and multiline image syntax are not recognized.
- Keep the article image folder. Recovery requires a matching vault-trash image or a usable source in the latest record; otherwise choose a replacement.
- Display-math delimiters must be on separate lines. Equation labels must immediately follow the closing delimiter and be followed by a blank line. Validation failures leave the article unchanged, though newly created image files may remain.

## Build and release

Requires Node.js 18 or later; no npm dependencies are needed.

```sh
npm run check
npm run build
npm test
```

Install the built `dist/main.js` and `dist/manifest.json`. The source `main.js` requires `core.js` and `i18n.js` and must be bundled before installation.

Push a Git tag matching the manifest version, such as `0.8.0`, to trigger the release workflow. GitHub Actions runs the build and automated tests on Windows and macOS and publishes the ZIP plus the two standalone BRAT assets. Automated tests do not replace an Obsidian UI check on a physical Mac.

The repository does not include personal notes, images, operation logs, plugin settings or local installation scripts.

## License

MIT. See LICENSE.
