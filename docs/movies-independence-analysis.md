# movies 项目独立化 — 技术分析文档

> 目标：将 `movies/` 子目录从当前 Electron 项目中提取为独立项目，同时支持 `3d_viewer_electron`、`3d_viewer_web`、`ficad_web` 及未来更多宿主项目。

---

## 1. 现状分析

### 1.1 目录结构概览

```
movies/
├── lib-electron.mjs          ← Electron 录制核心（2051行，与宿主项目深度耦合）
├── lib.mjs                   ← 薄转发层：export * from './lib-electron.mjs'
├── lib_gen_url_image.mjs     ← 路径 D1/D2 共享录制流程（依赖 lib.mjs）
│
├── generate-subtitle.mjs     ← TTS → .subtitle + .mp3（项目无关）
├── pregen-tts.mjs            ← TTS 预生成 + timing（项目无关）
├── generate-image-video.mjs  ← 路径 B 入口：截图合成（项目无关）
├── generate-html-video.mjs   ← 路径 C 入口：手写 scene（依赖 lib.mjs）
├── generate-url-video.mjs    ← 路径 D1 入口：URL 源（依赖 lib.mjs）
├── generate-image2-video.mjs ← 路径 D2 入口：截图源（依赖 lib.mjs）
│
├── html-composer.mjs         ← HTML/GSAP 动画合成（项目无关）
├── burn.mjs                  ← 字幕烧录 + 混音（依赖 lib.mjs 的 renderVideo）
├── mergeVideo.mjs            ← 多段拼接（依赖 lib.mjs 的 renderVideo + burnVideo）
├── coverClip.mjs             ← 封面预处理（项目无关）
│
├── env.mjs                   ← .env 加载（项目无关）
├── easyocr-mark.mjs / .py    ← OCR 文字定位（项目无关）
├── edit-marks.mjs / .html    ← marks 编辑器（项目无关）
│
├── templates/                ← GSAP / HTML 模板（项目无关）
├── screenshot-window.ps1     ← Windows 截图脚本（项目无关）
├── mark-text-easyocr.py      ← OCR 标注脚本（项目无关）
│
├── e1/ e2/ e3/               ← 项目目录（录制脚本 + AI 生成数据）
├── docs/                     ← 设计文档
│
└── *.glb / *.hdr / *.wav     ← 模型/环境贴图/音频资源文件
```

### 1.2 依赖分析：哪些模块依赖宿主项目？

| 模块 | 依赖宿主项目？ | 具体耦合点 |
|------|:---:|------|
| `lib-electron.mjs` | ✅ 深度耦合 | Electron 可执行路径、BrowserWindow API、`executeCommand('loadFile')` |
| `lib.mjs` | ✅ | 当前直接转发到 `lib-electron.mjs` |
| `lib_gen_url_image.mjs` | ⚠️ 间接 | `import * as lib from './lib.mjs'` |
| `generate-html-video.mjs` | ⚠️ 间接 | 依赖 lib.mjs 的 Playwright 启动 |
| `generate-url-video.mjs` | ⚠️ 间接 | 依赖 lib_gen_url_image.mjs |
| `generate-image2-video.mjs` | ⚠️ 间接 | 依赖 lib_gen_url_image.mjs |
| `generate-image-video.mjs` | ⚠️ 间接 | 使用 lib.mjs 的 renderVideo |
| `burn.mjs` | ⚠️ 间接 | 依赖 lib.mjs 的 burnVideo + renderVideo |
| `mergeVideo.mjs` | ⚠️ 间接 | 依赖 lib.mjs 的 DEFAULT_BGM + burnVideo |
| **其余所有模块** | ❌ 完全无关 | 纯 Node.js / Python / FFmpeg，不碰宿主项目 |

### 1.3 electron 版 vs web 版 `lib.mjs` 差异

当前两个项目的 movies 有大量重复代码：

| 比较维度 | electron 版 (`lib-electron.mjs`) | web 版 (`lib.mjs`) |
|----------|----------------------------------|---------------------|
| Playwright 导入 | `import { _electron as electron } from 'playwright'` | `import { chromium } from 'playwright'` |
| 启动方式 | 启动打包的 Electron exe | 启动 Chrome/Chromium 浏览器 |
| 模型加载 | `page.evaluate(() => window.__executeCommand('loadFile', ...))` | URL 参数 + `waitForFunction` 等待 DOM 事件 |
| 等待模型 | 轮询 `__modelStore.getState().__loadingPhase === 'done'` | 等待 `window.__modelLoaded` 标志 / DOM 事件 |
| 相机能力 | GSAP 操作 `__r3f_dev` + Three.js store | 同（共用浏览器端 API） |
| UI 操作 | `executeCommand` IPC | `postMessage` 跨窗口通信 |
| 静态服务 | 无需（Electron 自带协议） | 需要 `createStaticServer()` 提供静态资源 |
| 窗口控制 | `browserWindow(page).evaluate(bw => bw.setContentSize(...))` | `page.setViewportSize(...)` |
| 录制入口 | `makeMovie()` 启动 electron.launch() | `makeMovie()` 启动 chromium.launch() |

**核心发现**：差异集中在 **"如何启动宿主 App 并加载模型"** 这一环节，其余相机动画、UI 操作、录制控制逻辑几乎完全相同。

### 1.4 五条视频路径的项目依赖矩阵

| 路径 | 是否需要宿主项目 | 宿主提供什么 |
|------|:---:|------|
| **A** — 3D 录制 | ✅ 需要 | 3D 渲染引擎 (Three.js R3F)，模型加载能力 |
| **B** — 截图合成 | ❌ 不需要 | — |
| **C** — 手写 scene | ❌ 不需要 | — |
| **D1** — URL 录制 | ❌ 不需要 | — |
| **D2** — 本地截图录制 | ❌ 不需要 | — |

**路径 B/C/D 已完全独立**，只需要 Playwright + Chrome + FFmpeg + Python TTS，不依赖任何宿主项目。

---

## 2. 架构设计：movies 独立项目

### 2.1 总体架构

```
┌──────────────────────────────────────────────────────┐
│                   movies-core                         │
│  (npm package: @faicad/movies)                       │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │ TTS 引擎     │  │ 视频渲染引擎  │  │ HTML 合成   │ │
│  │ subtitle    │  │ renderVideo  │  │ html-composer│ │
│  │ pregen-tts  │  │ burnVideo    │  │              │ │
│  │ edgetts_tts │  │ clipMerge    │  │              │ │
│  └─────────────┘  └──────────────┘  └─────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │  录制适配器接口 (Recording Adapter Interface)  │    │
│  │  start / stop / loadModel / waitForModel /   │    │
│  │  record / screenshot / animateCamera / ...   │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
         ▲              ▲              ▲
         │              │              │
    ┌────┴────┐   ┌─────┴────┐   ┌────┴─────┐
    │ Electron │   │   Web    │   │ 未来项目  │
    │ Adapter  │   │ Adapter  │   │ Adapter  │
    └────┬─────┘   └─────┬────┘   └────┬─────┘
         │               │              │
    ┌────┴────┐   ┌─────┴────┐   ┌────┴─────┐
    │3d_viewer │   │3d_viewer │   │ ficad_web│
    │_electron │   │  _web    │   │   ...    │
    └─────────┘   └──────────┘   └──────────┘
```

### 2.2 模块分层

```
movies-core (独立 npm 包)
├── tts/                          # TTS 引擎层
│   ├── generate-subtitle.mjs     # 字幕生成（从 tts-cache 读数 → .subtitle + .mp3）
│   ├── pregen-tts.mjs            # TTS 预生成（文本 → 音频缓存 + timing）
│   ├── providers/
│   │   ├── edge-tts.mjs          # edge-tts provider
│   │   ├── spark-tts.mjs         # Spark-TTS provider
│   │   └── tencent-tts.mjs       # 腾讯云 TTS provider
│   └── edgetts_tts.py / indextts_tts.py / sparktts_tts.py
│
├── video/                        # 视频渲染层
│   ├── render-video.mjs          # FFmpeg scale+pad + ASS字幕 + 混音（从 lib-electron 提取）
│   ├── burn.mjs                  # 烧录 CLI
│   └── merge.mjs                 # 合并 CLI
│
├── html/                         # HTML 合成层
│   ├── html-composer.mjs         # 预制动画 HTML 生成
│   ├── generate-html-video.mjs   # 路径 C：手写 scene → HTML → 录制
│   ├── generate-image-video.mjs  # 路径 B：截图 → FFmpeg 合成
│   ├── generate-url-video.mjs    # 路径 D1：URL → 录制
│   └── generate-image2-video.mjs # 路径 D2：本地截图 → 录制
│
├── ocr/                          # OCR 工具层
│   ├── easyocr-mark.mjs
│   ├── easyocr-mark.py
│   └── mark-text-easyocr.py
│
├── adapter/                      # 录制适配器接口定义
│   └── interface.mjs             # 标准接口（JSDoc 类型定义 + 抽象函数签名）
│
├── templates/                    # HTML/GSAP 模板
├── env.mjs                       # .env 加载
├── edit-marks.mjs                # marks 编辑器
├── cover.mjs                     # 封面工具
│
└── index.mjs                     # 统一导出
```

### 2.3 录制适配器接口设计

这是整个架构的核心。定义一套标准接口，每个宿主项目实现自己的适配器：

```javascript
// movies-core/adapter/interface.mjs — 接口定义（JSDoc + 函数签名）

/**
 * 录制适配器接口。
 * 每个宿主项目（Electron / Web / ...）实现自己的适配器。
 */

// ── 生命周期 ──
/** 启动宿主 App，返回 { app, page, cleanup } */
async function launchApp(opts) {}

/** 关闭宿主 App */
async function closeApp(app) {}

// ── 页面/视口 ──
/** 设置录制视口尺寸 */
async function setViewport(page, { width, height }) {}

/** 等待 App 就绪（canvas + API + store） */
async function waitForAppReady(page) {}

// ── 模型加载 ──
/** 加载 3D 模型文件 */
async function loadModel(page, modelPath, opts) {}

/** 等待模型加载完成 */
async function waitForModel(page) {}

/** 卸载模型 */
async function unloadModel(page, target, opts) {}

// ── 导出的可选能力（capabilities） ──
/** 适配器声明自己支持的能力 */
function getCapabilities() {
  return {
    loadModel: true,          // 支持 loadModel（路径 A 必须）
    unloadModel: true,        // 支持 unloadModel
    exportModel: true,        // 支持导出模型
    uiPanelControl: true,     // 支持面板开关
    hdrEnvControl: true,      // 支持 HDR 环境切换
    customProtocol: true,     // 支持自定义协议拦截
    toolbarMagnifier: true,   // 支持工具栏放大
  }
}
```

### 2.4 适配器实现示例

#### Electron 适配器（3d_viewer_electron）

```javascript
// 3d_viewer_electron/movies-adapter/electron-adapter.mjs
import { _electron as electron } from 'playwright'
import { join } from 'path'

export const capabilities = {
  loadModel: true,
  unloadModel: true,
  exportModel: true,
  uiPanelControl: true,
  hdrEnvControl: true,
  toolbarMagnifier: true,
}

export async function launchApp(opts) {
  const electronApp = await electron.launch({
    executablePath: opts.executablePath || getDefaultExePath(),
    args: ['--no-sandbox'],
    env: { ...process.env, E2E: '1', MOVIE_MODE: '1' },
    recordVideo: { dir: opts.recordDir, size: opts.viewport },
  })
  const page = await electronApp.firstWindow()
  return { app: electronApp, page, cleanup: () => electronApp.close() }
}

export async function loadModel(page, modelPath, opts) {
  const absPath = resolve(modelPath)
  await page.evaluate(async (fp) => {
    return window.__executeCommand('loadFile', { filePath: fp, ...opts })
  }, absPath)
}

export async function waitForModel(page) {
  await page.waitForFunction(
    () => window.__modelStore?.getState().__loadingPhase === 'done',
    { timeout: 60000 }
  )
}

// ... 其他函数
```

#### Web 适配器（3d_viewer_web / ficad_web）

```javascript
// 3d_viewer_web/movies-adapter/web-adapter.mjs
import { chromium } from 'playwright'

export const capabilities = {
  loadModel: true,
  unloadModel: true,
  exportModel: true,
  uiPanelControl: true,
  hdrEnvControl: true,
  toolbarMagnifier: true,
}

export async function launchApp(opts) {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: opts.viewport,
    recordVideo: { dir: opts.recordDir, size: opts.viewport },
  })
  const page = await context.newPage()

  // 构造 URL 参数
  const params = new URLSearchParams({ movie_mode: '1', ...opts.viewerParams })
  await page.goto(`http://localhost:${opts.devPort || 5173}/?${params}`)

  return { app: { browser, context }, page, cleanup: () => browser.close() }
}

export async function loadModel(page, modelPath, opts) {
  // Web 版：通过 postMessage 或 URL 参数加载模型
  const url = `http://localhost:${opts.modelPort}/${modelPath}`
  await page.evaluate((modelUrl) => {
    window.postMessage({
      type: '3d-viewer',
      command: 'loadModel',
      params: { url: modelUrl }
    }, '*')
  }, url)
}

export async function waitForModel(page) {
  await page.waitForFunction(() => window.__modelLoaded === true, { timeout: 60000 })
}

// ... 其他函数
```

### 2.5 路径 A 适配器 vs 路径 B/C/D

路径 B/C/D **不需要适配器**。它们只需要 Playwright + Chrome + FFmpeg + TTS。

但路径 A 的 `makeMovie()` 需要适配器来启动宿主 App。解决方案：

- `movies-core` 的路径 A 入口函数接受 `adapter` 作为参数
- 录制脚本只 `import` 它的适配器

```javascript
// movies/e2/m1.mjs（路径 A 录制脚本）
import { makeMovie } from '@faicad/movies'
import * as adapter from '../../movies-adapter/electron-adapter.mjs'

makeMovie({
  adapter,
  scriptUrl: import.meta.url,
  modelPath: '/path/to/model.glb',
  viewerParams: { entryAnim: 'zoom' },
  async pageFn(page, suffix, tPageOpen) {
    await rotateModel(page, 360, 3000)
    await syncpoint(page)
  },
})
```

---

## 3. 代码复用策略：消除 electron/web 重复

### 3.1 当前状态

`lib-electron.mjs`（2051行）和 web 版 `lib.mjs`（2041行）有约 **85% 的代码完全相同**：

| 模块 | 代码行数 | 是否相同 |
|------|---------|:---:|
| `SIZE_PRESETS` / CLI 解析 | ~80 | ✅ |
| `resolveOrientParam` / `resolveOrientParams` | ~50 | ✅ |
| `rotateModel` / `translateModel` / `animateCamera` | ~200 | ✅ |
| `syncpoint` | ~70 | ✅ |
| `captureCover` / `screenshot` | ~60 | ✅ |
| `showOverlay` / `hideOverlay` / `clearOverlays` | ~80 | ✅ |
| `clickById` / `clickWithHighlight` / `animateCursorClick` | ~350 | ✅ |
| `magnifyToolbar` / `removeMagnifyToolbar` | ~130 | ✅ |
| `interceptProtocolWithDialog` | ~100 | ✅ |
| `postMessage` / `postMessageAndWait` | ~50 | ✅ |
| `loadModel` / `unloadModel` / `exportModel` | ~250 | ⚠️ 差异 |
| `waitForModel` / `startRecording` | ~50 | ⚠️ 差异 |
| `makeMovie` / `recordOne` | ~350 | ⚠️ 差异 |
| `renderVideo` / `buildAss` / `burnVideo` | ~300 | ✅ |
| `createStaticServer` | ~50 | ✅（Web 用，Electron 不用） |

### 3.2 提取策略

**Step 1：提取纯函数到 movies-core**

以下函数直接进入 `movies-core`（从 `lib-electron.mjs` 复制一份即可）：

- `SIZE_PRESETS`, `resolveSizePreset()`, `resolveOrientationFilter()`, `resolve30fps()`, `resolveTtsProvider()`, `resolveNoWarm()`
- `resolveOrientParam()`, `resolveOrientParams()`
- `rotateModel()`, `translateModel()`, `animateCamera()`, `moveModelToScreenNdc()`
- `fitCameraToHeatbed()`
- `syncpoint()`, `captureCover()`, `screenshot()`
- `zoomUI()`
- `showOverlay()`, `hideOverlay()`, `clearOverlays()`
- `clickById()`, `clickWithHighlight()`, `animateCursorClick()`
- `magnifyToolbar()`, `removeMagnifyToolbar()`
- `interceptProtocolWithDialog()`
- `postMessage()`, `postMessageAndWait()`
- `dispatchEvent()`, `callDemo()`
- `setSelectValue()`
- `renderVideo()`, `buildAss()`, `toAssTime()`, `buildKaraokeAssText()`
- `burnVideo()`
- `hdrUrl()`, `setEnv()`
- `MODEL_PORT`, `DEFAULT_BGM`

**Step 2：抽取适配器相关函数**

以下函数需要适配器实现（或提供默认实现 + 允许覆盖）：

- `launchApp(opts)` → 适配器
- `closeApp(app)` → 适配器
- `waitForModel(page)` → 适配器（Electron 轮询 store，Web 等待事件）
- `loadModel(page, path, opts)` → 适配器
- `unloadModel(page, target, opts)` → 适配器
- `exportModel(page, format)` → 适配器
- `setViewport(page/app, size)` → 适配器
- `waitForAppReady(page)` → 适配器

**Step 3：重构 `makeMovie`**

```javascript
// movies-core/record/path-a.mjs
export async function makeMovie({ adapter, scriptUrl, modelPath, viewerParams, pageFn, outputDir }) {
  // ... CLI 参数解析、TTS 预生成、up-to-date 检查 ...
  // ... 遍历 orientations ...

  const { app, page } = await adapter.launchApp({ /* ... */ })
  await adapter.waitForAppReady(page)
  await adapter.loadModel(page, modelPath, viewerParams)
  await adapter.waitForModel(page)

  const { trimStart, tModelBrowser } = await startRecording(page, tPageOpen, entryDuration)

  // 注入 TTS timing
  if (ttsTiming) { /* ... */ }

  await pageFn(page, suffix, tPageOpen)

  // ... trim 录制、syncpoint 收集、FFmpeg 裁剪 ...
  await adapter.closeApp(app)
}
```

### 3.3 浏览器端 API 统一

无论 Electron 还是 Web，最终都是 Playwright 控制的浏览器页面。所有 `page.evaluate(...)` 调用的 Three.js 动画 API 在两种环境下完全相同：

```
window.__r3f_dev          → Three.js 开发句柄
window.__gsap              → GSAP 动画库
window.__modelStore        → Zustand 模型状态
window.__viewerAPI         → 模型操作 API
window.__animateCamera()   → 相机动画助手
window.__executeCommand()  → Electron IPC（Web 版也可实现同样的桥接）
```

**对 movies-core 而言，浏览器端 API 是统一的。** 适配器只需要保证启动后这些 API 可用。

---

## 4. 项目组织方案

### 4.1 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. npm 包** (`@faicad/movies`) | 标准依赖管理，版本控制明确 | 发布/更新流程稍重 |
| **B. Git submodule** | 直接修改源码，调试方便 | 版本锁定不灵活，submodule 管理复杂 |
| **C. 独立仓库 + npm link** | 开发灵活 | 部署时需额外步骤 |
| **推荐：A（npm 包）** | 最干净 | 工作量可控 |

### 4.2 推荐目录结构

```
faicad-movies/                          ← 新独立仓库
├── package.json                         # @faicad/movies
├── README.md
├── AGENTS.md
│
├── src/
│   ├── index.mjs                        # 统一导出
│   ├── env.mjs                          # .env 加载
│   │
│   ├── tts/
│   │   ├── generate-subtitle.mjs
│   │   ├── pregen-tts.mjs
│   │   └── providers/
│   │       ├── edge-tts.mjs
│   │       ├── spark-tts.mjs
│   │       └── tencent-tts.mjs
│   │
│   ├── video/
│   │   ├── render.mjs                   # renderVideo + buildAss + karaoke
│   │   ├── burn.mjs                     # burnVideo CLI
│   │   └── merge.mjs                    # merge CLI
│   │
│   ├── record/
│   │   ├── adapter-interface.mjs        # 适配器接口定义
│   │   ├── common.mjs                   # 通用录制函数（rotateModel, overlay, 等）
│   │   ├── path-a.mjs                   # makeMovie（依赖适配器）
│   │   └── playwrigt-utils.mjs          # 纯 Playwright 工具（chrome launch, recordVideo）
│   │
│   ├── html/
│   │   ├── html-composer.mjs
│   │   ├── generate-html-video.mjs
│   │   ├── generate-image-video.mjs
│   │   ├── generate-url-video.mjs
│   │   ├── generate-image2-video.mjs
│   │   └── lib_gen_url_image.mjs
│   │
│   ├── ocr/
│   │   ├── easyocr-mark.mjs
│   │   ├── easyocr-mark.py
│   │   └── mark-text-easyocr.py
│   │
│   ├── cover.mjs                        # 封面预处理
│   ├── cover-clip.mjs                   # 封面视频片段
│   │
│   ├── edit-marks.mjs
│   ├── edit-marks.html
│   │
│   └── templates/
│       ├── gsap.min.js
│       └── ...
│
├── python/                              # Python 脚本
│   ├── edgetts_tts.py
│   ├── indextts_tts.py
│   ├── sparktts_tts.py
│   └── mark-text-easyocr.py
│
├── scripts/
│   └── screenshot-window.ps1
│
├── docs/                                # 设计文档（从原 movies/docs/ 迁移）
│
└── test/                                # 测试
    └── ...
```

### 4.3 各宿主项目的 movies 目录结构（精简后）

宿主项目不再包含 `movies/` 的全部代码，只保留：

```
3d_viewer_electron/
├── movies/                              ← 精简后
│   ├── .env                             # 项目级 TTS 配置
│   ├── .gitignore
│   ├── models/                          # 3D 模型文件（从原 movies/ 迁移过来）
│   │   ├── Car.glb
│   │   ├── Trident_Assembly.glb
│   │   └── ...
│   ├── audio/                           # 音频资源（BGM、参考语音）
│   │   └── alex-productions-acoustic-folk-friends.wav
│   │
│   ├── adapter.mjs                      # ← Electron 适配器（唯一项目特定文件）
│   │
│   ├── e1/ e2/ e3/                      # 项目录制脚本（保持不变）
│   │   ├── m0.mjs
│   │   ├── m1.mjs
│   │   ├── cover.mjs
│   │   ├── gen/                         # 生成文件（gitignored）
│   │   └── ai_gen/                      # AI 生成数据
│   │
│   └── screenshot/                      # 截图目录
│
├── package.json                         # 依赖中加入 @faicad/movies
└── ...
```

```javascript
// movies/adapter.mjs — Electron 适配器
import { _electron as electron } from 'playwright'
import { createAdapter } from '@faicad/movies/record/adapter-interface'
import { join } from 'path'

export default createAdapter({
  name: 'electron',

  launchApp: async (opts) => { /* ... */ },
  closeApp: async (app) => { /* ... */ },

  loadModel: async (page, modelPath, opts) => { /* ... */ },
  waitForModel: async (page) => { /* ... */ },
  unloadModel: async (page, target, opts) => { /* ... */ },

  // ... 其他实现
})
```

### 4.4 录制脚本写法（跨项目统一）

```javascript
// movies/e2/m1.mjs — 跨项目可移植的录制脚本
import { makeMovie, startRecording, rotateModel, syncpoint } from '@faicad/movies'
import adapter from '../adapter.mjs'   // ← 项目提供的适配器

const subtitle = `
第一段台词
--1--
第二段台词
`;

makeMovie({
  adapter,                              // ← 传入适配器
  scriptUrl: import.meta.url,
  modelPath: 'models/Car.glb',          // 相对于 movies/ 的路径
  viewerParams: { entryAnim: 'zoom', entryDuration: '2000' },
  async pageFn(page, suffix, tPageOpen) {
    // startRecording 由 makeMovie 自动调用
    await rotateModel(page, 360, 3000)
    await syncpoint(page)
    await page.waitForTimeout(2000)
  },
})
```

**关键点**：同一份录制脚本，只需改 `import adapter from '../adapter.mjs'` 就能在 Electron / Web 项目之间无缝切换。

---

## 5. 实施路线图

### Phase 1：搭建独立仓库（1-2 天）

1. 创建 `faicad-movies` 新仓库
2. 初始化 `package.json`（`"name": "@faicad/movies"`, `"type": "module"`）
3. 建立基本目录结构（`src/tts/`, `src/video/`, `src/record/`, `src/html/` 等）
4. 迁移 **项目无关** 的模块（直接复制，不改代码）：
   - `generate-subtitle.mjs` → `src/tts/`
   - `pregen-tts.mjs` → `src/tts/`
   - TTS provider 脚本（`edgetts_tts.py` 等） → `python/`
   - `env.mjs` → `src/`
   - `html-composer.mjs` → `src/html/`
   - `easyocr-mark.mjs/.py` → `src/ocr/`
   - `templates/` → `src/templates/`
5. 写入 `src/index.mjs` 统一导出

### Phase 2：提取通用视频渲染（1 天）

1. 从 `lib-electron.mjs` 提取以下纯函数到 `src/video/render.mjs`：
   - `renderVideo()` + `probe()` + `hasAudio()` + `clipExists()`
   - `buildAss()` + `toAssTime()` + `buildKaraokeAssText()`
   - `BASE_STYLE` 常量
2. 提取 `burnVideo()` → `src/video/burn.mjs`
3. 提取 `mergeVideo` 相关 → `src/video/merge.mjs`
4. 确保这些模块 **零外部依赖**（只依赖 Node.js 内置 + ffmpeg/ffprobe）

### Phase 3：提取通用录制函数（1 天）

1. 从 `lib-electron.mjs` 提取到 `src/record/common.mjs`：
   - 所有 CLI 解析函数
   - `resolveOrientParam` / `resolveOrientParams`
   - 所有 `page.evaluate()` 动画函数（rotateModel, translateModel, animateCamera, fitCameraToHeatbed, clickWithHighlight, magnifyToolbar, overlay, captureCover, screenshot, syncpoint 等）
   - `postMessage`, `postMessageAndWait`
   - `callDemo`, `interceptProtocolWithDialog`
2. 提取 `startRecording`（zoomUI + waitForModel + entryDuration + trimStart 计算）

### Phase 4：定义适配器接口（0.5 天）

1. 在 `src/record/adapter-interface.mjs` 定义接口
2. 实现一个 **Mock 适配器** 用于测试（不需要真实 3D 引擎，只验证流程）
3. 重构 `makeMovie` / `recordOne` 使用适配器接口

### Phase 5：各宿主项目实现适配器（1 天）

1. **3d_viewer_electron**：建 `movies/adapter.mjs`（核心：electron.launch + executeCommand 模型加载）
2. **3d_viewer_web**：建 `movies/adapter.mjs`（核心：chromium.launch + URL 参数模型加载）
3. 验证：同一份录制脚本在两个项目中都能跑

### Phase 6：清理与文档（1 天）

1. 更新录制脚本的 import 路径（`../lib.mjs` → `@faicad/movies` + `../adapter.mjs`）
2. 删除原 `movies/` 下的冗余文件（保留 adapter.mjs + 项目脚本 + 模型资源）
3. 更新 README、AGENTS.md、CLAUDE.md
4. 写 migration guide

### Phase 7：ficad_web 接入验证

1. 在 `ficad_web` 中建 `movies/` 目录
2. 写 Web 适配器
3. 复制一个现有录制脚本，验证能跑通

---

## 6. 风险与注意事项

### 6.1 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Web 版 lib.mjs 与 electron 版有未发现的细微差异 | 提取后 Web 版可能出 bug | 逐函数 diff + 单元测试 |
| 适配器接口粒度不够 | 未来项目接入时需要改 movies-core | 接口设计保持最小化，只暴露真正不同的部分 |
| npm 包发布流程变慢开发迭代 | 每次改动都要发布 | 开发期用 npm link，稳定后再发包 |
| Python 脚本路径变化 | TTS/OCR 调用失败 | 在 movies-core 中提供路径解析工具函数 |

### 6.2 向后兼容

- 第一阶段（Phase 1-4），保持原 movies 目录不动，新代码在独立仓库开发
- `lib.mjs` 改为从 `@faicad/movies` re-export，旧脚本无需修改
- 过渡期：`import * as lib from '../lib.mjs'` 仍然有效

### 6.3 测试策略

- movies-core 每个模块有独立单元测试（vitest）
- 适配器有集成测试（Playwright + 对应的宿主 App）
- 路径 B/C/D 可以完全脱离宿主项目测试

---

## 7. 关键决策点

| 决策 | 推荐 | 理由 |
|------|------|------|
| 包发布方式 | npm 包 (`@faicad/movies`) | 标准、版本可控 |
| 适配器粒度 | 只抽象"启动/模型加载/关闭"，其余共享 | 最大复用，最小接口面积 |
| `lib.mjs` 当前的双重角色 | 拆分为 `common.mjs`（共享函数）+ `adapter.mjs`（项目特定） | 职责清晰 |
| Python 脚本位置 | 保留在 movies-core 内，通过 `import.meta.url` 推导路径 | 单仓库，避免跨包路径问题 |
| 模型文件 | 留在各宿主项目，不作为 movies-core 的一部分 | 模型是项目资源，不是工具链 |
| 字幕生成/烧录 | 完全提取到 movies-core | 无项目依赖 |
| 是否需要 CLI 工具 | 建议建，如 `npx movies burn ...` | 减少记忆路径的认知成本 |

---

## 8. 附录：现有文件归属映射

| 原路径 (movies/) | 归属 | 新路径 (faicad-movies/) |
|------|------|------|
| `lib-electron.mjs` | → 拆分为 `common.mjs` + 适配器接口 | `src/record/common.mjs` + `adapter-interface.mjs` |
| `lib.mjs` | → 删除（宿主项目各自提供 `adapter.mjs`） | — |
| `generate-subtitle.mjs` | → movies-core | `src/tts/generate-subtitle.mjs` |
| `pregen-tts.mjs` | → movies-core | `src/tts/pregen-tts.mjs` |
| `tencent-tts.mjs` / `tencent_demo.cjs` | → movies-core | `src/tts/providers/` |
| `burn.mjs` | → movies-core | `src/video/burn.mjs` |
| `mergeVideo.mjs` | → movies-core | `src/video/merge.mjs` |
| `coverClip.mjs` | → movies-core | `src/cover-clip.mjs` |
| `html-composer.mjs` | → movies-core | `src/html/html-composer.mjs` |
| `lib_gen_url_image.mjs` | → movies-core | `src/html/lib_gen_url_image.mjs` |
| `generate-html-video.mjs` | → movies-core | `src/html/generate-html-video.mjs` |
| `generate-image-video.mjs` | → movies-core | `src/html/generate-image-video.mjs` |
| `generate-url-video.mjs` | → movies-core | `src/html/generate-url-video.mjs` |
| `generate-image2-video.mjs` | → movies-core | `src/html/generate-image2-video.mjs` |
| `env.mjs` | → movies-core | `src/env.mjs` |
| `easyocr-mark.mjs` / `.py` | → movies-core | `src/ocr/` |
| `mark-text-easyocr.py` | → movies-core | `python/mark-text-easyocr.py` |
| `edit-marks.mjs` / `.html` | → movies-core | `src/edit-marks.mjs` + `src/edit-marks.html` |
| `edgetts_tts.py` / `indextts_tts.py` / `sparktts_tts.py` | → movies-core | `python/` |
| `screenshot-window.ps1` | → movies-core | `scripts/screenshot-window.ps1` |
| `templates/` | → movies-core | `src/templates/` |
| `.env` | → 各宿主项目 | 各宿主项目的 `movies/.env` |
| `e1/` `e2/` `e3/` | → 留在宿主项目 | 各宿主项目的 `movies/e*/` |
| `*.glb` `*.hdr` `*.wav` | → 留在宿主项目 | 各宿主项目 `movies/models/` 或 `movies/audio/` |
| `test/` / `tests/` | → movies-core | `test/` |
| `docs/` | → movies-core | `docs/` |
