# screenplay 与宿主项目位置解耦方案

## 需求

`screenplay` 项目已从 `3d_viewer_electron/` 移动为独立项目，位于 `3d_viewer_electron/../screenplay/`。目前代码仍假定 screenplay 是 electron 项目的子目录，需要解除这种位置依赖。

## 目的

- screenplay 不再硬编码任何宿主项目的文件路径
- 同时支持 `3d_viewer_electron`（Electron 桌面端）和 `3d_viewer_web`（Web 端）两个宿主项目
- 未来可扩展支持 `ficad_web` 等更多宿主
- `3d_viewer_web/p*/` 下的录制脚本拷贝到 screenplay 后只需改一行 import 即可运行
- 现有 electron 录制脚本（`e1/`、`e2/` 等）尽量不改动
- 每个宿主项目的位置信息只在 screenplay 的 `.env` 文件中配置一次

## 现状分析

### 当前耦合点

`lib-electron.mjs` 文件顶部用 `__dirname` 推导了 3 个变量，全部假定 screenplay 是 electron 项目的子目录：

| 导出 | 当前定义 | 实际语义 |
|------|---------|---------|
| `rootDir` | `join(__dirname, '..')` | electron 项目根目录 |
| `distDir` | `join(rootDir, 'dist')` | electron 打包输出目录 |
| `fixtureDir` | `join(rootDir, 'src/test/fixtures')` | electron 测试模型目录 |

另有 `getElectronExePath()` 函数依赖 `rootDir` 拼接 exe 路径。

### 外部使用情况

- `e2/m1.mjs`：2 处使用 `lib.rootDir` 拼接模型绝对路径（MODELS 数组混用了 screenplay 内部路径和 electron fixtures 路径）
- `tests/test-unloadModel.mjs`：自行定义了 `rootDir = join(__dirname, '..', '..')` 和 `distDir`
- 其余所有 `.mjs` 文件不引用 `rootDir` / `fixtureDir` / `distDir`

### 两个宿主项目的 lib.mjs 差异

| | electron 版 (`lib-electron.mjs`) | web 版 (`lib.mjs`) |
|---|---|---|
| Playwright 导入 | `_electron as electron` | `chromium` |
| 启动方式 | `electron.launch()` 启动打包 exe | `chromium.launch()` 启动浏览器，goto URL |
| 模型加载 | `page.evaluate(executeCommand('loadFile'))` | `page.goto(url + params)` 或 postMessage |
| 等待模型就绪 | 轮询 `__modelStore.__loadingPhase` | 等待 DOM 事件或 `__modelLoaded` 标志 |
| 视口调整 | `BrowserWindow.setContentSize()` | `page.setViewportSize()` |
| 静态服务 | 不需要（Electron 自带 file:// 协议） | 需要起静态服务器提供 viewer + 模型 |
| **其余所有函数** | （rotateModel, overlay, syncpoint, renderVideo, buildAss, burnVideo 等） | **完全相同** |

两个版本约 80% 的代码是相同的。

## 技术方案

### 总体架构

```
screenplay/
├── .env                              ← ★ 唯一配置点
├── lib.mjs                           ← 不变：export * from './lib-electron.mjs'
├── lib-common.mjs                    ← 新增：两版共用的通用函数
├── lib-electron.mjs                  ← 改：读取 3D_VIEWER_ELECTRON_ROOT
├── lib-web.mjs                       ← 新增：读取 3D_VIEWER_WEB_ROOT
├── env.mjs                           ← 不变
├── e1/ e2/ e3/                       ← 录制脚本，基本不改
└── ...（其余文件全部不改）
```

### 配置设计（`.env`）

`screenplay/.env` 中新增以下条目：

```
# ── 宿主项目根目录配置 ──

# Electron 桌面端项目位置（相对路径相对于 screenplay 目录）
3D_VIEWER_ELECTRON_ROOT=../3d_viewer_electron

# Web 端项目位置
3D_VIEWER_WEB_ROOT=../3d_viewer_web

# Electron 可执行文件路径（覆盖默认推导）
# ELECTRON_EXE=C:/path/to/3D_Viewer.exe
```

配置原则：
- 每个宿主项目一个 `*_ROOT` 变量，名称自描述，一目了然
- 相对路径相对于 screenplay 项目根目录解析
- 也支持绝对路径
- `ELECTRON_EXE` 保持现有 env var 命名，不受影响
- `env.mjs` 已有的 `.env` 加载机制直接复用，无需修改

### 各文件的职责和改动

#### `lib-common.mjs`（新增）

从 `lib-electron.mjs` 中提取出与宿主无关的通用函数。包含：

- `SIZE_PRESETS`、`resolveSizePreset()`、`resolveOrientationFilter()`、`resolve30fps()`、`resolveTtsProvider()`
- `resolveOrientParam()`、`resolveOrientParams()`
- `rotateModel()`、`translateModel()`、`moveModelToScreenNdc()`、`fitCameraToHeatbed()`
- `animateCamera()`
- `syncpoint()`
- `zoomUI()`
- `showOverlay()`、`hideOverlay()`、`clearOverlays()`
- `clickById()`、`clickWithHighlight()`、`animateCursorClick()`
- `magnifyToolbar()`、`removeMagnifyToolbar()`
- `interceptProtocolWithDialog()`
- `postMessage()`、`postMessageAndWait()`
- `dispatchEvent()`、`callDemo()`
- `captureCover()`、`screenshot()`
- `setSelectValue()`、`setEnv()`、`hdrUrl()`
- `renderVideo()`、`buildAss()`、`toAssTime()`、`buildKaraokeAssText()`、`burnVideo()`
- `MODEL_PORT`、`DEFAULT_BGM`
- `createStaticServer()`、`MIME_MAP`

这些函数不依赖任何宿主项目的路径或启动方式，纯 Playwright + FFmpeg + Node.js 内置模块。

#### `lib-electron.mjs`（改动）

只改顶部变量定义区域和 `getElectronExePath()`，其余不动：

- 删除 `rootDir`、`distDir`、`fixtureDir` 的硬编码推导
- 新增 `resolveElectronRoot()` 函数：读取 `3D_VIEWER_ELECTRON_ROOT`，如果是相对路径则相对于 screenplay 目录（`__dirname`）解析为绝对路径；如果未设置则 fallback 到 `join(__dirname, '..')`（向后兼容）
- `rootDir`、`distDir`、`fixtureDir` 改用 `resolveElectronRoot()` 推导，表达式不变
- `getElectronExePath()`：优先 `ELECTRON_EXE` env var，否则用 `resolveElectronRoot()` + 约定路径
- 从 `lib-common.mjs` re-export 所有通用函数
- `moviesDir` 保持不变（指向 screenplay 自身，这是正确的）

#### `lib-web.mjs`（新增）

Web 宿主项目的适配器，与 `lib-electron.mjs` 结构平行：

- 从 `lib-common.mjs` re-export 所有通用函数
- 自己实现 `makeMovie()`、`recordOne()`、`loadModel()`、`waitForModel()`、`startRecording()`（用 `chromium` 而非 `_electron`）
- 新增 `resolveWebRoot()` 函数：读取 `3D_VIEWER_WEB_ROOT`，解析逻辑同 electron 版
- 导出 `rootDir`、`distDir`、`fixtureDir`（面向 web 项目的目录结构）
- Web 版 `makeMovie` 通过 `chromium.launch()` 启动浏览器，用 URL 参数加载模型和配置

#### `lib.mjs`（不改）

保持 `export * from './lib-electron.mjs'`，向后兼容现有 electron 录制脚本。

#### `env.mjs`（不改）

已有 `.env` 加载逻辑完全适用。`3D_VIEWER_ELECTRON_ROOT` 等新变量会被自动加载进 `process.env`。

#### `tests/test-unloadModel.mjs`（改动）

删除自行定义的 `rootDir` 和 `distDir`，改为使用 `lib.rootDir` 和 `lib.distDir`。改动约 3 行。

### 录制脚本兼容性

**electron 录制脚本**（`e1/`、`e2/` 现有脚本）：完全不动。继续 `import * as lib from '../lib.mjs'`，继续使用 `lib.rootDir` 等。

**web 录制脚本**（从 `3d_viewer_web/p*/` 拷贝过来）：只改 import 行：

```
- import * as lib from '../lib.mjs'
+ import * as lib from '../lib-web.mjs'
```

其余代码不变。`makeMovie()` 的签名和 pageFn 的编写方式在 electron 和 web 版之间保持一致，因此录制脚本的业务逻辑无需任何改动。

### 路径解析逻辑

`lib-electron.mjs` 中的 `resolveElectronRoot()` 和 `lib-web.mjs` 中的 `resolveWebRoot()` 采用相同的解析规则：

1. 读取对应的 env var（如 `3D_VIEWER_ELECTRON_ROOT`）
2. 若值为相对路径 → 相对于 screenplay 项目目录（各自文件中的 `__dirname`）解析为绝对路径
3. 若值为绝对路径 → 直接使用
4. 若未设置 → 回退到 `join(__dirname, '..')`（保持向后兼容）
5. `rootDir` 导出为解析后的绝对路径
6. `distDir` = `join(rootDir, 'dist')`
7. `fixtureDir` = `join(rootDir, 'src/test/fixtures')`

### 为什么这是"一个配置点"

所有对宿主项目的路径依赖，归纳起来只需要知道"宿主项目的根目录在哪"这一个信息。`distDir`、`fixtureDir`、exe 路径都由此派生。

- electron 项目：配 `3D_VIEWER_ELECTRON_ROOT`
- web 项目：配 `3D_VIEWER_WEB_ROOT`
- 未来 `ficad_web`：配 `FICAD_WEB_ROOT`

每个宿主只需一行配置。哪个录制脚本用哪个宿主，由其 import 的 lib 决定（`lib-electron.mjs` vs `lib-web.mjs`），而不由全局配置决定——只有这样才能同时支持多个宿主。

### 文件改动汇总

| 文件 | 操作 | 改动量 |
|------|------|--------|
| `.env` | 新增 2 行配置 | +2 行 |
| `lib-common.mjs` | **新建**，从 `lib-electron.mjs` 搬通用函数 | ~1600 行（搬家，不写新逻辑） |
| `lib-electron.mjs` | 删掉通用函数（搬走），改顶部变量定义 | 删 ~1600 行，改 ~10 行 |
| `lib-web.mjs` | **新建**，实现 web 版 `makeMovie` 等 | ~400 行新代码 |
| `lib.mjs` | 不改 | 0 行 |
| `tests/test-unloadModel.mjs` | `rootDir`/`distDir` 改用 lib 导出 | ~3 行 |
| 所有其他文件 | 不改 | 0 行 |

### Web 项目录制脚本迁移步骤（未来参考）

1. 确保 `screenplay/.env` 中配置了 `3D_VIEWER_WEB_ROOT=../3d_viewer_web`
2. 将 `3d_viewer_web/p1/` 拷贝到 `screenplay/eN/`
3. 将脚本中的 `import * as lib from '../lib.mjs'` 改为 `import * as lib from '../lib-web.mjs'`
4. 运行脚本（CLI 参数不变）
