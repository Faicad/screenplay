# screenplay 与 electron 项目位置解耦方案

## 需求

`screenplay` 项目已从 `3d_viewer_electron/movies/` 移动到 `3d_viewer_electron/../screenplay/`（平级位置）。当前代码仍然假定 screenplay 是 electron 项目的子目录，需要解除这种位置依赖。

## 目的

- screenplay 不再硬编码 electron 项目的文件路径
- 未来可以对接 `3d_viewer_web`、`ficad_web` 等其他宿主项目
- 实际录制脚本（`e1/`、`e2/` 等）尽量不改动
- electron 项目位置信息只在一处配置

## 现状：耦合点分析

### 耦合点 1：`lib-electron.mjs` 的 4 个导出

文件顶层用 `__dirname` 推导出 3 个变量，它们全部假定 screenplay 位于 electron 项目内部：

| 导出 | 当前值 | 实际含义 |
|------|--------|---------|
| `rootDir` | `join(screenplayDir, '..')` | electron 项目根目录 |
| `distDir` | `join(rootDir, 'dist')` | electron 打包输出目录 |
| `fixtureDir` | `join(rootDir, 'src/test/fixtures')` | electron 测试模型目录 |

以及 `getElectronExePath()` 函数用 `rootDir` 拼接 electron 可执行文件路径。

### 耦合点 2：录制脚本引用 `lib.rootDir`

仅有 `e2/m1.mjs` 使用了 `lib.rootDir`，用于拼接 3D 模型文件的绝对路径：

- `join(lib.rootDir, 'movies/13+pro+max.stl')` — 实际在 screenplay 内，但通过 rootDir 间接引用
- `join(lib.rootDir, 'src/test/fixtures/vise.3mf')` — 在 electron 项目的 fixtures 里

MODELS 数组里的路径混用了两种来源：
- `movies/xx.glb` → 文件在 screenplay 自身目录下
- `src/test/fixtures/xx.3mf` → 文件在 electron 项目的 test fixtures 下

### 耦合点 3：`tests/test-unloadModel.mjs`

自己定义了 `rootDir = join(__dirname, '..', '..')`，同样假设 electron 项目是其祖父目录。

### 耦合点 4：`lib.mjs`

是 `lib-electron.mjs` 的纯转发：`export * from './lib-electron.mjs'`。录制脚本 import 的是 `lib.mjs`。

## 技术方案

### 核心原则

**对 electron 项目的位置依赖只配置在一个地方** —— screenplay 项目根目录的 `.env` 文件。

`lib-electron.mjs` 启动时从 `.env` 读取 `HOST_ROOT`（宿主项目根目录），推导出 `rootDir`、`fixtureDir`、`distDir`。录制脚本不感知这个变化——它们继续 `import * as lib from '../lib.mjs'`，继续使用 `lib.rootDir` 等导出。

### 架构图

```
screenplay/
├── .env                        ← ★ 唯一配置点：HOST_ROOT=../3d_viewer_electron
├── lib.mjs                     ← 不变，仍是转发
├── lib-electron.mjs             ← 改：从 .env 读取 HOST_ROOT 来推导 rootDir 等
├── env.mjs                     ← 已有，负责加载 .env
├── e2/m1.mjs                   ← 不变
├── tests/test-unloadModel.mjs  ← 改：删除自己推导的 rootDir，改用 lib.rootDir
└── ...（其余文件全部不改）
```

### 配置格式

`screenplay/.env` 新增一行：

```
HOST_ROOT=../3d_viewer_electron
```

- 支持相对路径（相对于 screenplay 目录）和绝对路径
- `env.mjs` 已有的 `.env` 加载机制无需修改，直接复用
- `HOST_ROOT` 的含义：宿主项目（即 electron 项目）的根目录

### `lib-electron.mjs` 改动范围

只改文件开头的 4 行变量定义和 `getElectronExePath` 函数，其余 ~2040 行完全不动。

**改动前**（硬编码推导）：

```
export const moviesDir = __dirname
export const rootDir = join(__dirname, '..')            // ← 假定父目录是 electron
export const distDir = join(rootDir, 'dist')            // ← 派生自 rootDir
export const fixtureDir = join(rootDir, 'src', 'test', 'fixtures') // ← 派生自 rootDir
```

**改动后**（从配置读取，提供默认值做 fallback）：

```
export const moviesDir = __dirname                        // 不变，screenplay 自身目录
export const rootDir = resolveHostRoot()                   // 从 HOST_ROOT 推导
export const distDir = join(rootDir, 'dist')              // 表达式不变
export const fixtureDir = join(rootDir, 'src', 'test', 'fixtures') // 表达式不变
```

`resolveHostRoot()` 逻辑：

1. 读 `process.env.HOST_ROOT`
2. 如果是相对路径 → 相对于 screenplay 目录（`__dirname`）解析为绝对路径
3. 如果是绝对路径 → 直接使用
4. 如果未设置 → **保持向后兼容**，fallback 到 `join(__dirname, '..')`（当前行为）

`getElectronExePath()` 改动：

1. 优先用 `process.env.ELECTRON_EXE`
2. fallback 用 `HOST_ROOT` + 项目约定的相对路径 `dist/win-unpacked/3D_Viewer.exe`
3. 不再硬编码 `rootDir`

### 为什么这样设计

**1. 录制脚本不用改**

`e2/m1.mjs` 里的 `lib.rootDir` 继续可用。只要 `.env` 中配置了 `HOST_ROOT` 指向 electron 项目，所有路径拼接结果和以前完全一致。

**2. 只有一个配置点**

所有对 electron 项目的路径依赖，归根结底只需要知道"electron 项目的根目录在哪里"。这个信息放进 `HOST_ROOT` 一个变量里。`distDir`、`fixtureDir`、exe 路径全部由此推导。

**3. `env.mjs` 的加载机制是现成的**

`env.mjs` 已经在 `lib-electron.mjs` 被 import 之前被各处加载（`generate-subtitle.mjs`、`pregen-tts.mjs` 等都用它）。只需让 `lib-electron.mjs` 顶部也调用一次 `loadDotEnv`，或直接读 `process.env.HOST_ROOT`。

**4. screenplay 自身目录（`moviesDir`/`screenplayDir`）不变**

`__dirname` 在任何位置都是正确的——它指向 screenplay 项目根目录。`DEFAULT_BGM`、`saveExportedModel` 等使用的资源路径不受影响。

### `tests/test-unloadModel.mjs` 改动

删除文件内自己定义的 `rootDir` 和 `distDir`，改为从 `lib` 导入：

- `rootDir` → `lib.rootDir`
- `distDir` → `lib.distDir`

这样 test 文件也跟随 `.env` 配置，不再自行假设 electron 项目位置。

### `.env` 在不同宿主项目中的配置示例

**electron 项目**（当前）：
```
HOST_ROOT=../3d_viewer_electron
```

**web 项目**（未来）：
```
HOST_ROOT=../3d_viewer_web
DIST_DIR=../3d_viewer_web/dist        # web 项目的 dist 结构不同
FIXTURE_DIR=../3d_viewer_web/public/models
```

如果未来 `distDir` 和 `fixtureDir` 的推导规则在不同宿主项目中不一致，可以在 `.env` 中额外配置 `DIST_DIR` 和 `FIXTURE_DIR` 覆盖默认推导值。

### 不修改的文件清单

以下文件完全不动：

- `e1/` 下所有 `.mjs`
- `e2/` 下所有 `.mjs`（包括 `m1.mjs`）
- `e3/` 下所有 `.mjs`
- `generate-subtitle.mjs`
- `pregen-tts.mjs`
- `generate-html-video.mjs`
- `generate-image-video.mjs`
- `generate-url-video.mjs`
- `generate-image2-video.mjs`
- `html-composer.mjs`
- `lib_gen_url_image.mjs`
- `burn.mjs`
- `mergeVideo.mjs`
- `coverClip.mjs`
- `env.mjs`
- `easyocr-mark.mjs`
- `edit-marks.mjs`
- `lib.mjs`

### 修改的文件清单

| 文件 | 改动范围 | 改动行数 |
|------|---------|---------|
| `screenplay/.env` | 新增 `HOST_ROOT=...` 一行 | +1 行 |
| `lib-electron.mjs` | 顶部变量定义 + `getElectronExePath` | ~10 行 |
| `tests/test-unloadModel.mjs` | `rootDir`/`distDir` 改为引用 lib 导出 | ~3 行 |

### 向后兼容

- 如果 `.env` 中没有 `HOST_ROOT`，行为回退到当前方式（假定 screenplay 在 electron 项目内）
- 已有录制脚本的 CLI 调用方式不变
- `lib.rootDir`、`lib.fixtureDir` 等导出保持不变
