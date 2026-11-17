# NSH 开源播放器 (`nsh-open-player`)

基于 [Longbridge Native Shell (NSH)](https://github.com/longbridge/nsh) 原生跨平台 UI 框架构建的竖屏（`9:16`）与横屏（`16:9`）剧集播放器，支持 Windows（Direct2D + Media Foundation）、macOS（AppKit + AVPlayer）、Linux（GTK 4 + GStreamer）、iOS、Android、Web 与终端（TUI）。

Windows 版默认接入本仓库的红果片源和播放后端，复用国内 SDK 签名、MP4 解密、ByteVC2 转换及真实弹幕。NSH 原生 Video 播放本地服务输出的 H.264 视频。其他平台目前保留原有片单实现。

## 核心特性

- **原生跨端渲染**：基于 `longbridge/nsh` 引擎原生视图渲染（无 Electron / Chromium 体积开销），支持深色影院（Dark）与浅色纸感（Light）双主题令牌自适应。
- **后 3 集顺序预加载与 128MB LRU 缓存队列**（`src/services/preloader.ts`）：
  - 当前集播放期间，后台按分集顺序依次预加载后续 3 集；
  - 主动切集请求优先调度，命中正在进行的预加载任务时直接复用同一 Promise，避免重复拉流；
  - 默认 128MB / 15 集缓存上限，淘汰时优先保护当前播放集与即将播放的后 3 集。
- **多季自动聚合与缺季补查**（`src/domain/seasons.ts`、`src/services/catalog.ts`）：
  - 自动解析中文/阿拉伯数字季号并按第 1 季至末季严格升序排列；
  - 当通用检索存在缺口（如存在第 2 季与第 4 季但漏掉第 3 季）时，自动发起定向季号补查并在刷新时保留既有季目。
- **沉浸式剧场与 UI 线程弹幕**：
  - `9:16` 竖屏与 `16:9` 横屏画幅自适应（`适应` / `铺满` 一键切换）、倍速切换（`0.75x`–`2.0x`）、保留当前秒数的重试与历史续播；
  - 基于 NSH 原生 `AnimatedValue` 驱动的多行防碰撞弹幕层（支持 1/3/5 行、快/中/慢速度、不透明度与高赞优先过滤）。
- **完整浏览与本地持久化**：
  - 热门榜单、真人短剧、精品漫剧、AI 短剧、剧星榜（支持性别筛选、演员主页与合作演员跳转）、搜索与最近搜索记录、观影历史与收藏持久化。

## 目录结构

```text
nsh-open-player/
├── App.tsx                     应用入口与全局路由/弹窗编排
├── App.test.tsx                领域逻辑、预加载缓存队列与端到端 UI 测试套件
├── DESIGN.md                   设计规范、语义令牌体系与全屏动效清单 (Motion Inventory)
├── nsh.json                    NSH 应用配置
├── theme.json                  明暗双外观语义颜色令牌 (shadcn cssVars)
├── assets/                     内置开源测试样片 (9:16 & 16:9 H.264 MP4) 与海报/图标资源
└── src/
    ├── ui/                     应用自有语义组件库 (Button, Input, Tabs, Slider, Switch, Dialog, Menu, Toast, Gallery)
    ├── domain/                 数据类型与多季解析/缺季检测纯函数
    ├── services/               顺序预加载、持久化 Store、红果片源适配和本地服务连接
    ├── components/             顶栏导航、海报卡片、原生弹幕层与详情/全季/演员/设置弹窗
    └── pages/                  目录网格页、剧星榜页、沉浸式剧场播放页
```

## 快速运行与验证

Windows 完整目录版通过以下命令生成，需要先准备仓库根目录的签名组件、ByteVC2 FFmpeg 和支持 HEVC 解码的完整 FFmpeg。完整 FFmpeg 放在 `../build/media-ffmpeg/x64/ffmpeg.exe`，也可用 `HONGGUO_NSH_FFMPEG` 指定路径。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1 -NshCommand nsh
```

运行 `dist/windows-integrated/红果开源播放器/红果开源播放器.exe`。整个文件夹可一起移动，启动器负责启动本地片源服务与原生窗口，并在退出时关闭服务。签名运行时和两个 FFmpeg 随包附带。

开发时先运行 `node scripts/prepare-backend.cjs`，再执行 `node scripts/verify-windows.cjs <nsh.exe路径>`，可自动启动本地服务并运行真实 Windows 播放测试。默认 `nsh test` 继续运行原有演示片单测试。

安装 [NSH CLI](https://nsh.dev/docs/installation) 后，在 `nsh-open-player` 目录下执行：

```sh
# 1. 静态类型检查与构建检查
nsh check
nsh build

# 2. 运行单元与无头端到端测试
nsh test

# 3. 启动桌面原生窗口（支持热更新）
nsh run --target windows    # macOS: --target macos, Linux: --target linux, Web: --target web, 终端: --target tui

# 4. 打包免安装便携目录与压缩包（输出至 .nsh/out/）
nsh package --target windows
nsh package --target web
```

## 自定义 JSON 片单格式

可通过右上角菜单 **「配置片源接口…」** 填入 HTTP(S) JSON 地址，或通过 **「导入本地片源…」** 选择本地 `.mp4` / `.json` 文件：

```json
{
  "series": [
    {
      "series_id": "my-series-01",
      "series_title": "示例短剧",
      "category": "real-drama",
      "tags": ["剧情", "原创"],
      "description": "自有授权标准 MP4 剧集示例",
      "episodes": [
        {
          "vid": "ep-1",
          "vid_index": 1,
          "title": "第 1 集",
          "src": "https://cdn.example.com/videos/ep-01.mp4",
          "aspect": "vertical"
        }
      ]
    }
  ]
}
```
