# PTE · Pixiv → Eagle

一键导入 Pixiv 图片到 Eagle。有 UI 操作界面，本地或 Eagle 模式切换，实时进度条显示。

- **安装（推荐）**：从 [GreasyFork](https://greasyfork.org/zh-CN/scripts/552563-pte-pixiv-eagle) 安装

## 功能特性

### ⭐ ***0.9.8.8 版本标签版新增***
- 三栏式界面：将标签分为"待翻译"、"已翻译"、"排除"三个列表
- 拖放排序：轻松拖拽重新排列每列中的标签
- 标签翻译：自动或手动翻译标签
- 搜索过滤：支持关键词搜索标签
- 编辑管理：编辑、删除和组织标签，提供友好的用户界面
- 自动保存：所有标签翻译和设置自动保存到本地

> **注意事项**：
> - 标签管理功能是可选的，不强制使用。不使用标签管理器也不会对标签产生任何影响
> - **标签翻译功能**需要本地部署 Ollama（默认 `qwen2.5:14b` 模型，也可选择其他模型）。未部署则无法使用自动翻译
> - **标签数据导入**：项目提供预设的标签翻译和排除规则 JSON 文件，可直接下载导入使用

## 快速开始

### 安装步骤
1. 安装 Tampermonkey（或 Violentmonkey）
2. 打开 GreasyFork 安装脚本
3. 访问 Pixiv，即可看到右上角 **PTE** 工具条（如看不到，请拉宽浏览器窗口）

### 界面预览
<img
src="https://i.imgs.ovh/2025/11/03/7xVt6F.png" alt="界面预览1" border="0">
<img
src="https://i.imgs.ovh/2025/10/14/72EAdq.png" alt="界面预览2" border="0">

### 单作品下载功能预览
<img src="https://i.imgs.ovh/2025/11/03/7xzUOY.gif" alt="下载预览" border="0">

### 本地功能与隐私
- 与 Eagle 通过本机端口通信（默认 `http://localhost:41595`），数据不经过第三方服务器
- GIF 由浏览器端生成，所有脚本资源均来自本地或 jsDelivr
- 外部网络访问仅限于：`i.pximg.net`、`cdn.jsdelivr.net`、`localhost`
- 不收集任何个人信息

### 前置条件
确保已运行 Eagle 并开启本地 API（默认 [`http://localhost:41595`](http://localhost:41595)）

**标签翻译功能**（可选）：需要本地部署 Ollama。默认使用 `qwen2.5:14b` 模型，也可选择其他模型。若未部署则无法使用自动翻译功能。

**标签数据导入**：项目中提供预设的标签翻译 JSON 文件（待定）。

### 权限说明
- `@grant`：`GM_xmlhttpRequest`、`GM_download`
- `@connect`：`localhost` / `127.0.0.1` / `i.pximg.net` / `cdn.jsdelivr.net`

### 外部库
- `fflate@0.8.2`（压缩/解压）
- `gif.js@0.2.0`（GIF 生成）

### 常见问题
- **按钮没出现**：确认站点为 `pixiv.net`，稍等片刻页面加载完成
- **Eagle 连接失败**：确认已启动 Eagle 且 API 可用
- **GIF 失败**：刷新重试；超大 ugoira 处理时间较长
- **无法下载**：检查浏览器跨域和下载权限设置

### 参考与致谢
- [Save Pixiv pictures to Eagle](https://greasyfork.org/zh-CN/scripts/419792-save-pixiv-pictures-to-eagle)
- [Pixiv2Eagle](https://greasyfork.org/zh-CN/scripts/533713-pixiv2eagle)
- [Pixiv Previewer](https://greasyfork.org/zh-CN/scripts/30766-pixiv-previewer)

## 许可

MIT
