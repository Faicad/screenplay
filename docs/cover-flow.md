# Cover 生成与嵌入流程分析

## 一、整体流程图

```
录制阶段 (makeMovie / captureCover)
  │
  ├─ captureCover(page)         → 生成 {project}_cover_{h|v}.png（原始截图）
  │
合并阶段 (mergeProject)
  │
  ├─ 1. processProjectCovers()  → 运行项目 cover.mjs（如有）
  │     │                          cover.mjs 读取原始/本地封面图，
  │     │                          叠加文字后输出 _final_ 版
  │     │
  │     ├─ Tier 1: cover_{h|v}.png（项目目录下的定向封面）
  │     ├─ Tier 2: cover.png（项目目录下的通用封面）
  │     └─ Tier 3: gen/{project}_cover_{h|v}.png（captureCover 输出）
  │
  ├─ 2. detectProjectCover()    → 检测 gen/{project}_cover_final_{h|v}.png
  │
  └─ 3. 嵌入 cover 到合并视频
        │
        ├─ 老路径 (concatBurnedClips) ✅
        │     makeCoverClip() → prepend 到 clip 列表 → 一起 concat
        │
        ├─ 新路径 (mergeVideoWithTransitions) ❌（修复前）
        │     传了 coverPng 但函数内部忽略（注释说"For now, coverPng is handled in the merge flow"）
        │
        └─ 新路径 (mergeVideoWithTransitions) ⚠️（修复后）
             视频渲染完后，在 mergeVideo.mjs 中后处理 concat cover
```

---

## 二、各环节详解

### 2.1 录制阶段截图 — `captureCover(page)`

**文件：** `lib-common.mjs:1170-1183`

```js
export async function captureCover(page) {
  const projectDir = dirname(_genDir)        // e.g. e5
  const projectName = basename(projectDir)   // e5
  const orient = _currentIsLandscape ? 'h' : 'v'
  const outputPath = join(_genDir, `${projectName}_cover_${orient}.png`)
  await page.screenshot({ path: outputPath, type: 'png' })
  console.log(`[cover] captured → ${outputPath}`)
}
```

- 在 pageFn 中调用，截取当前画面
- 保存到 `gen/e5_cover_{h|v}.png`
- **不影响视频内容**，只是存文件

---

### 2.2 封面美化 — `cover.mjs`

**文件：** `e5/cover.mjs`

每个项目目录下可选的 `cover.mjs`，对封面截图叠加文字渲染出最终封面图。

**工作机制：**
1. 用 Playwright 打开一个 Chrome 浏览器
2. 构造一张 HTML 页面，尺寸为 1920×1080（横屏）或 1080×1920（竖屏）
3. 页面包含文字元素："海量SVG图片"、"如何"、"快速浏览"，带 CSS 渐变色和阴影
4. 截图保存为 `gen/e5_cover_final_{h|v}.png`

**输入图片的读取优先级（从上到下，命中即用）：**

| Tier | 路径 | 说明 |
|------|------|------|
| 1 | `e5/cover_{h\|v}.png` | 项目目录下的定向封面图，居中缩放在灰色径向渐变底图上 |
| 2 | `e5/cover.png` | 项目目录下的通用封面图，作为 `<img>` 叠加在灰色底图上（`mix-blend-mode: multiply`） |
| 3 | `gen/e5_cover_{h\|v}.png` | captureCover 在录制阶段截的原始截图，居中缩放在灰色底图上 |

**三种情况的渲染效果：**

```
Tier 1 (cover_h.png)：         Tier 2 (cover.png)：          Tier 3 (captureCover 截图)：
┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
│  ┌──────────────┐    │      │  gray bg             │      │  gray bg             │
│  │ cover_h.png  │    │      │    ┌──────────┐      │      │    ┌──────────┐      │
│  │ (居中缩放)   │    │      │    │cover.png │      │      │    │ 截图居中  │      │
│  └──────────────┘    │      │    │(multiply) │      │      │    │ (contain) │      │
│                      │      │    └──────────┘      │      │    └──────────┘      │
│  "海量SVG图片"(左)   │      │  "海量SVG图片"(左)   │      │  "海量SVG图片"(左)   │
│  "如何"(右)          │      │  "如何"(右)          │      │  "如何"(右)          │
│  "快速浏览"(中下)    │      │  "快速浏览"(中下)    │      │  "快速浏览"(中下)    │
└──────────────────────┘      └──────────────────────┘      └──────────────────────┘
```

**输出：** `gen/e5_cover_final_{h|v}.png`（1920×1080 或 1080×1920）

**触发时机：** `mergeProject()` 第 314 行 `processProjectCovers(absDir)`

---

### 2.3 封面检测 — `detectProjectCover()`

**文件：** `mergeVideo.mjs:186-198`

```js
function detectProjectCover(projectDir) {
  const genDir = join(projectDir, 'gen')
  const projectName = basename(projectDir)   // e5
  for (const orient of ['h', 'v']) {
    const path = join(genDir, `${projectName}_cover_final_${orient}.png`)
    if (existsSync(path) && statSync(path).size > 0) {
      result[orient] = path
    }
  }
  return result
}
```

- **只检测 `_final_` 版**，即 cover.mjs 处理后的成品
- 返回 `{ h: path|null, v: path|null }`

---

### 2.4 封面嵌入 — 两条路径

#### 路径 A：`concatBurnedClips`（老路径）✅

**文件：** `mergeVideo.mjs:88-102`

```js
function concatBurnedClips(clipPaths, outputPath, bgmPath, targetW, targetH, fps, coverPng) {
  if (coverPng && existsSync(coverPng)) {
    const coverClip = join(dirname(outputPath), `.cover_tmp_${basename(outputPath)}`)
    const ok = makeCoverClip(coverPng, coverClip, targetW, targetH, fps)
    if (ok) {
      clipPaths = [coverClip, ...clipPaths]    // prepend 到 clip 列表
    }
  }
  // ...然后所有 clip 一起过 scale+pad → concat 滤镜
}
```

- 用 `makeCoverClip()` 生成 1 帧 MP4
- prepend 到 clipPaths 数组
- 所有 clip 通过同一套 filter chain（scale+pad → concat）

#### 路径 B：`mergeVideoWithTransitions`（新路径）❌（修复前）

**文件：** `lib-common.mjs:1793-1994`

```js
export function mergeVideoWithTransitions(opts) {
  const { coverPng, ... } = opts
  // ...
  // line 1926-1927:
  // If we have a cover PNG, we'd need to handle it here
  // For now, coverPng is handled in the merge flow (prepended as 1-frame clip before mergeVideoWithTransitions)
}
```

- 收到了 `coverPng` 但**完全忽略**
- 注释说应该在调用前 prepend，但实际调用方并没有这样做
- 结果：cover 从未被嵌入 merged 视频

#### 路径 B 修复方案（当前代码）

**文件：** `mergeVideo.mjs:419-454`

在 merge 循环结束后，对已生成的 `merged_{h|v}.mp4` 做后处理：

```js
// 7b. Post-processing: prepend cover to merged videos
for (const suffix of ['h', 'v']) {
  const coverPath = covers[suffix]
  if (!coverPath) continue

  const info = probeVideo(mergedPath)
  const coverClip = makeCoverClip(coverPath, coverClip, info.width, info.height, fps)
  // ffmpeg concat: cover clip + merged video → 替换原文件
}
```

---

## 三、关键问题

### 3.1 cover 只在 merge 时生效

运行 `node burn.mjs e5/m4.mjs -v` 时：
- `captureCover()` 截图存文件 ✅
- 但 `burnVideo()` → `renderVideo()` 没有传 `coverPng` ❌
- cover **不会**出现在单个 burned 视频中

运行 `node mergeVideo.mjs e5` 时：
- `cover.mjs` 处理封面 ✅
- `concatBurnedClips`（老路径）嵌入 cover ✅
- `mergeVideoWithTransitions`（新路径）之前忽略 cover ❌

### 3.2 两条路径的覆盖策略不一致

**老路径 `concatBurnedClips`：**
- cover 作为 clip prepend 到列表开头
- 和所有 clip 一起过 filter chain
- cover 没有音频轨道，concat 时从后续 clip 取音频

**修复后路径（后处理）：**
- cover 作为独立 1 帧 MP4，等视频全部渲染完才 concat 到开头
- 不碰 filter chain、clip 计数、transition 等任何内部逻辑
- 失败时降级用原视频，不会导致整个 merge 失败

---

## 四、相关文件

| 文件 | 职责 |
|------|------|
| `lib-common.mjs` `captureCover()` | 录制时截图存 `gen/{project}_cover_{h\|v}.png` |
| `lib-common.mjs` `renderVideo()` | burn 时生成 cover clip 并 prepend（含 cover 处理） |
| `lib-common.mjs` `mergeVideoWithTransitions()` | 新 merge 路径，不接受 coverPng |
| `mergeVideo.mjs` `processProjectCovers()` | 运行项目 `cover.mjs` |
| `mergeVideo.mjs` `detectProjectCover()` | 检测 `_final_` 封面 |
| `mergeVideo.mjs` `concatBurnedClips()` | 老 merge 路径，正常嵌入 cover |
| `mergeVideo.mjs` 后处理 | 新 merge 路径 repair，视频渲染完再补 cover |
| `coverClip.mjs` `makeCoverClip()` | 生成 1 帧 cover MP4 |
| `e5/cover.mjs` | e5 项目的封面美化脚本 |
