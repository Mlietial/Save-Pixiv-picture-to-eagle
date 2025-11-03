# PTE · Pixiv → Eagle

一键导入 Pixiv 到 Eagle（含 ugoira→GIF）；支持详情/列表/勾选；进度/ETA/可取消；面板可拖动并记忆位置；本地或 Eagle 模式。

- **安装（推荐）**：从 [GreasyFork](https://greasyfork.org/zh-CN/scripts/552563-pte-pixiv-eagle) 安装  

## 快速开始
1. 安装 Tampermonkey（或 Violentmonkey）
2. 打开 GreasyFork 安装脚本
3. 访问 Pixiv，即可看到右上角 **PTE** 工具条

### 界面预览
<img src="https://i.imgs.ovh/2025/10/14/72EAdq.png" alt="72EAdq.png" border="0">

### 本地功能与隐私
- 与 **Eagle** 的交互通过 **本机端口** 完成（默认 `http://localhost:41595`），数据不经第三方服务器。  
- GIF 由浏览器端使用 `gif.js` 生成，worker 脚本从 jsDelivr 拉取后以 **Blob Worker** 方式本地执行。  
- 脚本的外部网络访问域名仅为：
  - `i.pximg.net`（获取 Pixiv 资源）
  - `cdn.jsdelivr.net`（仅拉取 `gif.worker.js`）
  - `localhost` / `127.0.0.1`（与 Eagle 通信）
- 不收集任何个人信息；所用第三方库与来源均在下方列出。

### 前置条件
请确保本机已运行 **Eagle** 并开启本地 API（默认 [`http://localhost:41595`](http://localhost:41595)）。  
首次使用建议在 **Pixiv 详情页** 测试。

### 权限与外部请求说明
- `@grant`：`GM_xmlhttpRequest`，`GM_download`  
- `@connect`：`localhost` / `127.0.0.1` / `i.pximg.net` / `cdn.jsdelivr.net`

### 外部库（通过 `@require` 引入）
- `fflate@0.8.2`（压缩/解压）
- `gif.js@0.2.0`（GIF 生成；*worker* 代码从 jsDelivr 获取并以 **Blob** 形式加载）

### 常见问题
- **按钮没出现**：确认站点为 `pixiv.net`，并等待页面加载到 `document-idle`。  
- **Eagle 连接失败**：确认已启动 Eagle 且本地 API 可用。  
- **GIF 失败**：尝试刷新重试；若为超大 ugoira，处理时间会更长。  
- **无法下载**：检查浏览器 / 脚本管理器的跨域与下载权限设置。

### 参考与致谢
本脚本在交互与实现上参考/借鉴了以下项目，在此致谢（如有不便引用请联系我移除）：
- [Save Pixiv pictures to Eagle](https://greasyfork.org/zh-CN/scripts/419792-save-pixiv-pictures-to-eagle)
- [Pixiv2Eagle](https://greasyfork.org/zh-CN/scripts/533713-pixiv2eagle)
- [Pixiv Previewer](https://greasyfork.org/zh-CN/scripts/30766-pixiv-previewer)
## 许可
MIT
