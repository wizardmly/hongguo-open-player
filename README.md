<p><img src="assets/app-icon.png" alt="红果开源播放器：开放圆环与播放键图标" width="96" height="96"></p>

# 红果开源播放器 (Hongguo Open Player)

[![CI](https://github.com/wizardmly/hongguo-open-player/actions/workflows/ci.yml/badge.svg)](https://github.com/wizardmly/hongguo-open-player/actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)

一款完全基于 **[Longbridge Native Shell (NSH)](https://github.com/longbridge/nsh)** 原生跨平台架构构建的红果短剧桌面播放器（`v2.0.0` 起已全面移除 Electron / Vue / Node.js 运行时）。无需安装安卓模拟器，协议签名、Spade-A 密钥派生、MP4 CENC AES-CTR 解密、ByteVC2/HEVC 转码调度、600MB 磁盘缓存与 UI 渲染全部运行于纯 NSH 原生环境。

---

## 📸 界面预览

以下截图展示播放器核心功能，剧目、弹幕和榜单内容会随来源实时更新。

### 播放、弹幕与剧集/系列季切换

在播放页观看短剧、调整弹幕和播放设置；右侧侧栏支持按分组快速切换剧集，并支持一键查看和换季播放同一系列短剧。

![短剧播放界面：视频上方显示弹幕，右侧展示剧目介绍、系列全季与分组选集](docs/screenshots/theater-playback.jpg)

### 系列全季排序选看

针对多季短剧，系统自动识别基础剧名、补查缺失季目并按第 1 季至末季严格升序排列，支持在侧栏或全季弹窗中直接切换。

![系列全季对话框：多季短剧严格按顺序排好序，清晰展示当前播放季与各季信息，支持点击即播](docs/screenshots/series-seasons.jpg)

### 浏览短剧与剧星榜

从热门榜单与分类浏览短剧，检索剧名、演员或题材，进入演员主页查看作品并直达播放。

![热门短剧目录：顶部提供分类导航和搜索，下面以海报卡片展示短剧](docs/screenshots/catalog-overview.jpg)

---

## ✨ 核心特性

* **🚀 纯 NSH 原生无 Node 运行时**：自 `v2.0.0` 起彻底告别 Electron 与 Node.js/Express 后端，协议解析、CENC 解密与原生 GPU 视图均由 NSH（QuickJS + LLRT + GPUI / Direct2D / Media Foundation）直接驱动。
* **🎬 内置 CENC-MP4 AES-CTR 解密与重写**：在 NSH WebCrypto (`AES-CTR`) 中完成分片样本解密，剔除 `sinf`/`senc`/`saio`/`saiz` 并将 `moov` 前置至 `mdat` 之前；配合 `bvc2-ffmpeg` 与 `ffmpeg`（优先 NVENC，自动回退 libx264）将 ByteVC2 / HEVC 转码为兼容 MP4 落盘缓存。
* **⚡ 后 3 集顺序预加载 + 600MB 磁盘 LRU**：前台切集优先抢占队列并复用进行中的预加载任务，`Fast Path 2` 结合磁盘缓存实现切换零黑屏。
* **💬 原生防碰撞弹幕**：支持 `AnimatedValue` 驱动的多行防碰撞弹幕（1/3/5 行、快/中/慢速度、不透明度与高赞优先过滤），全屏下自动为顶部状态栏与底部控制栏预留安全边距。
* **⌨️ 快捷键对齐移动端**：
  * `空格` / `K`：播放 / 暂停
  * `↑` / `PageUp`：上一集
  * `↓` / `PageDown`：下一集
  * `←` / `→`：快退 / 快进 5 秒
  * `D`：开启 / 关闭弹幕
  * `F` 或 `双击画面`：全屏切换

---

## 🗂️ 目录结构

```text
hongguo-open-player/
├── App.tsx                       应用入口、路由编排与原生生命周期钩子
├── App.test.tsx                  领域逻辑、预加载队列与无头 UI 回归测试
├── Hongguo.test.ts               SM3 / AES-CBC / 协议签名 / Spade / MP4 CENC 单元测试
├── Live.test.tsx                 Windows 实网播放与零黑屏/画面运动像素校验（HONGGUO_LIVE_TEST=1）
├── nsh.json                      NSH 应用清单与能力权限声明
├── theme.json                    明暗双外观语义令牌
├── DESIGN.md                     设计规范与动效清单
├── assets/                       应用图标与内置测试样片/海报
├── scripts/
│   ├── dev.ps1                   Windows 一键开发启动（注入 FFmpeg 与 JRE 路径）
│   ├── verify-windows.ps1        Windows 实网端到端与零黑屏校验
│   ├── package-windows.ps1       Windows 纯 NSH 便携包打包脚本
│   ├── Launcher.cs               Windows 无 Node 启动器源码
│   ├── prepare-playback-signer.ps1 准备本地国内 SDK 签名运行时
│   └── build-bytevc2.sh          构建 ByteVC2 解码器 FFmpeg
└── src/
    ├── hongguo/                  纯 NSH 协议、加密解密、签名、搜索、目录与媒体引擎
    │   ├── api.ts                目录、Web/App 双路检索、剧集详情、演员榜、弹幕
    │   ├── app-source.ts         App 播放接口解析、Spade 密钥派生与 URL 解密
    │   ├── argus.ts              Argus / Ladon / Simon 算法与签名头构造
    │   ├── crypto.ts             SM3、AES-128-CBC、MP4 CENC AES-CTR 解密与 moov 重构
    │   ├── danmaku-sign.ts       评论区/弹幕协议签名
    │   ├── device.ts             播放设备注册与持久化凭证管理
    │   ├── http.ts               重定向校验与安全 HTTP 请求封装
    │   ├── media-engine.ts       并发下载、大文件合并、ByteVC2/HEVC 转码与磁盘缓存
    │   └── signer.ts             Windows x64 DomesticSigner 进程生命周期管理与签名队列
    ├── domain/                   剧集、季目解析纯函数与类型定义
    ├── services/                 片源适配、顺序预加载器、本地持久化 Store
    ├── components/               顶栏、海报卡片、弹幕层、设置与详情弹窗
    ├── pages/                    目录、剧星榜、影院播放页
    └── ui/                       基础语义 UI 组件库
```

---

## 🛠️ 开发与验证

安装 [NSH CLI](https://nsh.dev/docs/installation) 后，在仓库根目录执行：

```powershell
# 1. 类型与构建静态检查
nsh check

# 2. 运行离线单元测试与 UI 回归测试
nsh test Hongguo.test.ts
nsh test App.test.tsx

# 3. 准备 Windows 本地运行依赖并启动原生窗口（需先备好 build/media-ffmpeg、build/bytevc2）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 -NshCommand nsh

# 4. 运行 Windows 实网播放与切集零黑屏像素级校验
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows.ps1 -NshCommand nsh

# 5. 构建 Windows 免安装便携包（输出至 dist/windows-v2.0.0，零 Node.js 依赖）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -NshCommand nsh
```

> 本地运行时需在 `build/playback-signer/win32-x64` 准备签名运行时（`scripts/prepare-playback-signer.ps1` 自动校验 SHA256 下载）、`build/media-ffmpeg/x64/ffmpeg.exe` 完整编码版 FFmpeg 以及 `build/bytevc2/x64/ffmpeg.exe`（构建脚本会自动复制为 `bvc2-ffmpeg.exe`）。

---

## 💡 参考项目与致敬 (Acknowledgements & References)

在本项目的设计与开发过程中，参考了社区中相关优秀开源项目的实践与研究：

### 🔐 视频流解密与核心算法参考
* [`zhangbaio/hongguo`](https://github.com/zhangbaio/hongguo)：红果短剧协议解析与媒体解密开源研究项目，提供了 CENC 解密与移动端协议处理参考；
* [`N3urda/hongguoTV`](https://github.com/N3urda/hongguoTV) / [`woshishiq1/drpys`](https://github.com/hjdhnx/drpy-node)：开源短剧爬虫与算法派生实践，提供了基于 Spade-A 派生 AES 密钥的计算逻辑参考；
* [`jackotom/hongguo-drama`](https://github.com/jackotom/hongguo-drama)：提供了 MP4 CENC 容器格式重写（消除 `sinf` 还原为 `avc1`/`hvc1`）及媒体处理参考。
* [`wxyzh/ffmpeg-bvc2`](https://github.com/wxyzh/ffmpeg-bvc2)：提供了基于 FFmpeg 的 ByteVC2 解码补丁及构建方案参考。
* [`librempeg/librempeg`](https://github.com/librempeg/librempeg)：提供了 ByteVC2 解码支持，是上述解码补丁的上游来源。

### 🖥️ 客户端产品与交互设计参考
* [`yangbin1322/hongguo-player`](https://github.com/yangbin1322/hongguo-player)：原第三方 macOS 客户端，提供了 9:16 沉浸式竖屏观影体验与原型交互参考。

### ☁️ 云端长任务与交付链路参考
* [`parallelpan/hongguo-downloader`](https://github.com/parallelpan/hongguo-downloader)：公开的架构与工程实践文档（CC BY-NC 4.0，不含可执行源码），提供了表级任务队列、下载与整包打包解耦、OSS 流式 ZIP、伸缩组单机自愈等设计取舍的参考；解析见 [参考项目架构解析：hongguo-downloader](docs/hongguo-downloader-architecture.md)。该项目线上另有按取件集数计费的服务，此处仅作技术交流。

---

## ⚖️ 免责声明与版权声明

1. **学习与技术交流**：本项目仅供个人学习、多媒体流处理与跨平台桌面应用开发技术交流研究，不用于任何商业用途。
2. **参考开源项目**：因可能存在版权风险，本项目的所有内容与实现逻辑**均参考社区已开源的项目与公开网络技术资料**。
3. **内容来源与版权**：所有短剧音视频数据与元信息均实时请求自公开网络服务，本项目不提供、不存储亦不分发任何音视频资源文件。请支持正版内容。
4. **侵权与异议联系**：本项目高度尊重原创内容与相关知识产权。对于可能存在的侵权行为，如果有人觉得不合适，请联系作者进行处理（可通过 GitHub 提交 Issue 或联系作者），作者将在核实后第一时间进行删除或修改。
