# 通用视频片段切换过渡动画设计方案

> 目标：不论视频来源（3D 录制 / 截图合成 / HTML 动画 / URL 录制），在 merge 拼接时均支持可声明的过渡动画。

---

## 1. 现状分析

### 1.1 当前 merge 流程

```
burn.mjs（单个脚本：生成视频 → 字幕 → 烧录 → _burn_h.mp4）
         ↓
mergeVideo.mjs（收集所有 _burn_h.mp4 → 简单拼接 → merged_h.mp4）
```

当前 `concatBurnedClips()` 使用 ffmpeg 的 `concat` filter：

```text
[0:v]scale+pad[v0]; [1:v]scale+pad[v1]; [v0][v1]concat=n=2:v=1:a=1[outv]
```

**问题**：clip 之间硬切（cut），无任何过渡效果。即使单个 clip 内部的 Path D1/D2 有 caption/highlight 动画，clip **之间的切换**始终是生硬拼接。

### 1.2 FFmpeg 已有能力

ffmpeg 的 [`xfade`](https://ffmpeg.org/ffmpeg-filters.html#xfade) filter 提供 30+ 种过渡效果：

| 类型 | 效果 |
|------|------|
| `fade` | 叠化淡入淡出 |
| `fadeblack` | 黑场过渡 |
| `fadewhite` | 白场过渡 |
| `slideleft` / `slideright` | 滑动（左/右） |
| `slideup` / `slidedown` | 滑动（上/下） |
| `wipeleft` / `wipright` | 擦除 |
| `zoomin` | 放大进入 |
| `circleclose` / `circleopen` | 圆形展开/收缩 |
| `pixelize` | 像素化 |
| `smoothleft` / `smoothright` | 平滑滑动 |
| `dissolve` | 溶解 |
| … | 共 30+ 种 |

音频对应有 [`acrossfade`](https://ffmpeg.org/ffmpeg-filters.html#acrossfade) filter。

---

## 2. 设计原则

1. **统一语法** — 所有视频类型（Path A/B/C/D1/D2）共享同一套过渡声明
2. **渐进增强** — 不声明则保持现有 cut 行为，零迁移成本
3. **声明式** — 在 `merge.json` 中声明过渡，不改动现有脚本文本
4. **ffmpeg 原生** — 利用 `xfade` filter，不引入新依赖

---

## 3. 声明语法

### 3.1 merge.json 全局/单条过渡

在 `merge.json` 中新增 `transitions` 字段：

```jsonc
// p3/merge.json
{
  // 可选：背景音乐（已有）
  "audioBg": "Jamvana - Pure Ocean.mp3",

  // 可选：全局默认过渡（所有 clip 间生效）
  "transition": {
    "type": "fade",
    "duration": 0.4       // 秒
  },

  // 可选：逐条覆盖（按 clip 序号）
  "transitions": [
    // m0 → m1（第 0 个和第 1 个 clip 之间）
    { "from": 0, "to": 1, "type": "slideleft", "duration": 0.5 },
    // m1 → m2
    { "from": 1, "to": 2, "type": "zoomin",    "duration": 0.6 },
    // m2 → m3
    { "from": 2, "to": 3, "type": "fadeblack", "duration": 0.3 }
  ]
}
```

### 3.2 字段说明

| 字段 | 层级 | 类型 | 说明 |
|------|------|------|------|
| `transition.type` | 全局 | string | 默认过渡类型，见下方列表 |
| `transition.duration` | 全局 | number | 默认过渡时长（秒），默认 0.4 |
| `transitions[].from` | 单条 | number | 前一个 clip 的序号（从 0 开始） |
| `transitions[].to` | 单条 | number | 后一个 clip 的序号（= from + 1） |
| `transitions[].type` | 单条 | string | 过渡类型 |
| `transitions[].duration` | 单条 | number | 过渡时长（秒），覆盖全局默认 |

**序号规则**：`from` = 第 N 个 clip，`to` = 第 N+1 个 clip。在 merge 时 clip 按文件名排序后的索引。

### 3.3 支持的所有过渡类型

```text
fade         叠化淡入淡出（默认）
fadeblack    黑场过渡
fadewhite    白场过渡
fadegrays    灰场过渡
slideleft    下一张从左滑入
slideright   下一张从右滑入
slideup      下一张从上滑入
slidedown    下一张从下滑入
smoothleft   平滑左滑
smoothright  平滑右滑
smoothup     平滑上滑
smoothdown   平滑下滑
wipeleft     从左擦除
wiperight    从右擦除
wipeup       从上擦除
wipedown     从下擦除
circleclose  圆形收缩（缩放进入中心）
circleopen   圆形展开（从中心扩出）
rectclose    矩形收缩
rectopen     矩形展开
dissolve     溶解
pixelize     像素方块化
zoomin       放大进入
hlslice      水平切割进入
hrslice      水平切割退出
vuslice      垂直向上切割
vdslice      垂直向下切割
distance     3D 景深过渡
```

### 3.4 简写形式（仅全局需要时）

```jsonc
// 最简单的写法：所有 clip 间使用同一个过渡
{ "transition": { "type": "fade", "duration": 0.5 } }
```

### 3.5 百分比时长

`duration` 也可以写百分比，表示占 clip 总时长的比例：

```jsonc
{ "transition": { "type": "fade", "duration": "10%" } }
// → 自动计算为 clip 时长的 10%，但不低于 0.1s，不高于 1.5s
```

---

## 4. 关键问题分析

### 4.1 总时长会变化吗？

**会减少，不会增加。**

`xfade` 的原理是两段视频的**尾部与头部重叠**：

```
clip A 时长  tA = 10.0s
clip B 时长  tB = 10.0s
过渡时长     d  =  0.5s

无过渡:       |--- A (10s) ---|--- B (10s) ---|        = 20.0s
有过渡:       |--- A 9.5s --[← 0.5s 重叠 →]-- B 9.5s ---| = 19.5s
                                                    ↓ 减少了 0.5s
```

总时长 = Σt - Σd。没有内容被裁剪，只是尾部与头部在过渡期内同时显示。

### 4.2 已烧录的字幕会重叠吗？

**这是本方案的核心矛盾。**

当前流水线中，`burn.mjs` 已经将字幕（ASS）烧录进每个 `_burn_h.mp4` 的视频帧。如果直接对这些已烧录的视频做 xfade，过渡期间两段字幕会同时可见。

```
过渡 0.5s 期间：
  clip A 的最后一帧（含字幕 A 的最后几个字）
  →
  clip B 的第一帧（含字幕 B 的前几个字）
  二者半透明叠加 → 文字叠文字，不清晰
```

### 4.3 音频 acrossfade 会让人声重叠吗？

**会，而且效果很差。**

`acrossfade` 会让 clip A 末尾的 TTS 人声和 clip B 开头的 TTS 人声同时播放 — 两个人在同时说话，听众无法理解。

---

## 5. 解决方案：三轨分离

### 5.1 核心思路

为了解决上述两个问题，过渡操作不直接作用在 `_burn.mp4` 上，而是**分轨处理**：

| 轨道 | 内容 | 过渡策略 |
|------|------|----------|
| **视频画面** | 不含字幕的原始画面（`.webm`） | ✅ 完整的 `xfade` 过渡（fade / slide / zoom 等） |
| **音频人声** | TTS 配音（`.mp3`） | ❌ 不做 acrossfade，仅在边界处做 0.1s 极短淡变防止咔哒声 |
| **字幕** | `.subtitle` 合并后统一烧录 | ✅ 在已做过渡的合并视频上，只烧一次字幕 |

也就是说，**过渡流程从 merge 阶段提前到 burn 阶段的输出素材层级**，把视频、音频、字幕拆开处理后再合并。

### 5.2 新流水线

```
当前流水线：
  .webm ─→ burn.mjs（混入字幕+音频 → _burn.mp4）→ merge（concat _burn.mp4）

新流水线：
  .webm ───────────────────┐
  .subtitle（字幕）─────────┤→ renderVideo（过渡+混音+烧字幕 → merged.mp4）
  .mp3（TTS 配音）─────────┘
```

即：merge 阶段不再拼接已烧好的 `_burn.mp4`，而是直接拿原始素材烧录一次成片。但过渡本身就包含在 `renderVideo` 的 filter graph 中。

### 5.3 对现有架构的影响

需要在 merge 阶段拿到每个 clip 的**原始素材路径**而非已烧录路径：

```
当前 merge 收集： gen/m1_burn_h.mp4
新版 merge 收集： gen/m1_h.webm（视频）
                 gen/m1.mp3   （音频）
                 gen/m1.subtitle（字幕）
```

改动在 `mergeVideo.mjs` 中，原有 `burn.mjs` 流程不变（单个脚本仍可独立 burn）。

---

## 6. 技术实现

### 6.1 FFmpeg xfade 原理

```text
xfade=transition=fade:duration=0.5:offset=9.5
       ↑过渡类型           ↑时长     ↑clip A 中的起始位置
```

- `offset`：在第一段中的开始位置。`offset = tA - d`，即 clip A 结束前 d 秒开始过渡。
- `duration`：过渡持续的时间。
- 过渡期间两段视频叠加，总时长 = tA + tB - d。

### 6.2 多 clip 的 xfade filter graph

对于 **3 个 clip + 2 个过渡**：

```text
Step 1: 对每个 clip 做 scale+pad 到目标分辨率
  [0:v]scale+pad... -> [v0]
  [1:v]scale+pad... -> [v1]
  [2:v]scale+pad... -> [v2]

Step 2: 逐对应用 xfade
  offset_0 = t0 - d0
  [v0][v1]xfade=transition=slideleft:duration=d0:offset=offset_0 -> [x1]

  // x1 的累积时长 = t0 + t1 - d0
  offset_1 = (t0 + t1 - d0) - d1
  [x1][v2]xfade=transition=fade:duration=d1:offset=offset_1 -> [outv]
```

**核心公式**：
```
第 N 个过渡的 offset（在累积视频中的位置）：
  offset_N = (Σ_{i=0}^{N} t_i) - (Σ_{j=0}^{N-1} d_j) - d_N
```

### 6.3 音频处理

音频（TTS 配音）**不做完整 acrossfade**，因为人声重叠不可接受：

```text
// 各 clip 的音频
[0:a]aresample=48000[a0];
[1:a]aresample=48000[a1];

// 只用极短交叉淡变消除咔哒声（0.1s）
[a0][a1]acrossfade=d=0.1:c=tri[outa];
//          ↑ 固定 0.1s，与视频过渡时长无关
```

如果担心 0.1s 仍然会切断尾音，可以改为在短过渡期间**人声先淡出再淡入**：

```text
// clip A 最后 0.1s 淡出，clip B 开头 0.1s 淡入，无重叠
[a0]afade=t=out:st=10.0:d=0.1[a0_fade];
[a1]afade=t=in:st=0:d=0.1[a1_fade];
[a0_fade][a1_fade]concat=n=2:v=0:a=1[outa];
```

此方式彻底避免人声同时间出现。BGM 在最终混音阶段叠加，不受影响。

### 6.4 字幕处理

字幕不在每个 clip 单独烧录，而是在**过渡后的合并视频上统一烧录**：

```
合并字幕 = mergeSubtitles()（已有实现，将所有 .subtitle 按时间偏移合并）
→ buildAss() 生成一个完整的 ASS
→ 在最终的 ffmpeg 命令中用 ass filter 烧录
```

### 6.5 完整 filter graph 示例（2 clip + 1 fade）

```
输入：
  [0] clip0_h.webm（t0=10.0s，带音轨）
  [1] clip1_h.webm（t1=8.0s，带音轨）

过渡：fade, d=0.5s
BGM：bgm.wav

filter_complex:
  [0:v]scale=1920:1080:force_original_aspect_ratio=decrease,
        pad=1920:1080:(ow-iw)/2:(oh-ih)/2,
        setsar=1,fps=25[v0];
  [1:v]同上的 scale+pad[v1];
  [v0][v1]xfade=transition=fade:duration=0.5:offset=9.5[rawv];

  [0:a]aresample=48000[a0];
  [1:a]aresample=48000[a1];

  // 视频过渡 0.5s，但音频仅 0.1s 淡变防止人声重叠
  [a0]afade=t=out:st=9.9:d=0.1[a0f];
  [a1]afade=t=in:st=0:d=0.1[a1f];
  [a0f][a1f]concat=n=2:v=0:a=1[raww];

  // 烧录合并字幕
  [rawv]ass='merged_subtitle.ass'[finalv];

  // BGM 混音
  [raww][2:a]amix=inputs=2:duration=first[outa];
```

### 6.6 边界情况

| 场景 | 处理方式 |
|------|----------|
| `duration` > clip 总时长 | 自动截断为 min(tA, tB, d) |
| `duration` = 0 | 视为 cut 跳过过渡 |
| `type` 无效 | 打印警告，降级为 `fade` |
| 某 clip 无音频 | 填充 `anullsrc` 空音轨，音频过渡直接跳过 |
| 仅 1 个 clip | transitions 忽略 |
| 百分比 duration | 按 clip A 和 clip B 中较短者的百分比计算，clamp [0.1, 2.0] |

---

## 7. 代码变更

### 7.1 `lib-common.mjs` — 新增函数

```js
/**
 * 解析 merge.json 中的过渡配置，与 clip 一一对应。
 * @param {object}  mergeCfg       — merge.json 内容
 * @param {number}  clipCount      — clip 数量
 * @param {number[]} clipDurations — 各 clip 时长（秒）
 * @returns {Array<{type:string, duration:number, from:number, to:number, offset:number}>}
 */
export function resolveTransitions(mergeCfg, clipCount, clipDurations) { ... }

/**
 * 构建 xfade filter graph 字符串，含 scale+pad + 音频 concat。
 * @param {Array}   transitions   — resolveTransitions 的返回值
 * @param {number}  targetW, targetH, fps
 * @param {boolean[]} hasAudio    — 各 clip 是否有音轨
 * @returns {{ filterComplex: string, outputVideoLabel: string, outputAudioLabel: string|null }}
 */
export function buildTransitionFilter(transitions, targetW, targetH, fps, hasAudio) { ... }
```

### 7.2 `lib-common.mjs` — 新增 `mergeVideoWithTransitions` 入口

新增一个高阶函数，直接接受原始素材路径（视频 `.webm` + 音频 `.mp3` + 字幕 `.subtitle`），统一处理过渡→烧字幕→混音：

```js
/**
 * 合并多个视频片段，支持过渡 + 字幕烧录 + 音频混音。
 *
 * @param {object} opts
 * @param {string[]}  opts.videoClips   — 各 clip 的视频路径（.webm，不含字幕）
 * @param {string[]}  opts.audioVoices  — 各 clip 的配音路径（.mp3，可为 null）
 * @param {string}    opts.subtitlePath — 合并后的字幕路径（由 mergeSubtitles 预生成）
 * @param {string}    opts.output       — 输出路径（merged_h.mp4）
 * @param {number}    opts.targetW, targetH, fps
 * @param {string}    opts.bgmPath      — 背景音乐路径
 * @param {Array}     opts.transitions  — 过渡配置数组
 * @param {string}    [opts.coverPng]   — 封面 PNG（可选）
 */
export function mergeVideoWithTransitions(opts) { ... }
```

### 7.3 `mergeVideo.mjs` — 修改 `mergeProject`

核心变化：不再跳过 burn 阶段去取 `_burn.mp4`，改为收集**原始素材**，然后统一调 `mergeVideoWithTransitions` 处理：

```js
function mergeProject(dirPath) {
  // 1. 扫描 .mjs → 对每个脚本执行 burn.mjs（不变）
  // 2. 收集原始素材而非已烧录的 _burn.mp4
  const baseNames = files.map(f => basename(f, '.mjs'))
  const videoClips_h = baseNames.map(n => join(genDir, `${n}_h.webm`))
  const audioVoices_h = baseNames.map(n => join(genDir, `${n}.mp3`))
  const subtitles = baseNames.map(n => join(genDir, `${n}.subtitle`))

  // 3. 检查所有原始素材存在
  // 4. 合并字幕 = mergeSubtitles(subtitles, totalDuration)
  // 5. 读取 merge.json 解析 transitions
  // 6. 统一调用 mergeVideoWithTransitions
  mergeVideoWithTransitions({
    videoClips: videoClips_h,
    audioVoices: audioVoices_h,
    subtitlePath: mergedSubtitle,
    output: mergedPath,
    targetW, targetH, fps,
    bgmPath,
    transitions,
    coverPng: covers['h'] || null,
  })
}
```

### 7.4 关于向后兼容

- 单个脚本的 `burn.mjs` 流程 **完全不动** — 用户仍可 `node burn.mjs p1/m1.mjs` 独立烧录单个视频
- 只有 `mergeVideo.mjs` 内部改变：merge 时不再用 `_burn.mp4`，改回原始素材
- 无 transitions 时，`mergeVideoWithTransitions` 内部退化到 `concat` filter，渲染结果与之前一致

---

## 8. 边界情况

| 场景 | 处理方式 |
|------|----------|
| `duration` > clip 总时长 | 自动截断为 min(tA, tB, d) |
| `duration` = 0 | 视为 cut，跳过过渡 |
| `type` 无效 | 打印警告，降级为 `fade` |
| 某 clip 无配音（.mp3 不存在） | 音频 concat 时跳过该段，不产生音轨空隙 |
| 某 clip 无视频（.webm 不存在） | 报错退出 |
| 仅 1 个 clip | transitions 忽略，纯 concat |
| 百分比 duration | 按 min(tA, tB) 的百分比计算，clamp [0.1, 2.0] |
| 已有 `_burn.mp4` 但无原始 `.webm` | 提示用户 re-run with `-f` |

---

## 9. 实施步骤

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `lib-common.mjs` | 新增 `resolveTransitions()` — mergeCfg → 过渡配置数组 |
| 2 | `lib-common.mjs` | 新增 `buildTransitionFilter()` — 过渡配置 → ffmpeg filter 字符串 |
| 3 | `lib-common.mjs` | 新增 `mergeVideoWithTransitions()` — 完整合并入口 |
| 4 | `mergeVideo.mjs` | 修改 `mergeProject()` — 收集原始素材路径而非 `_burn.mp4` |
| 5 | 测试 | 用 2 段小 .webm 验证 fade / slideleft / zoomin 效果 |
| 6 | 文档 | 更新 README.md 和 AGENTS.md 记录 transitions 声明方式 |

---

## 10. 远期展望（可后续迭代）

1. **自定义 CSS 过渡** — Path C/D 使用 GSAP 动画时，在 HTML 层实现更复杂的过渡（如 3D 翻转、弹跳）
2. **过渡参数** — `xfade` 支持额外参数如 `reverse=1`（反向过渡）、`custom` 自定义 GLSL shader
3. **clip 首尾裁剪** — 允许在过渡前/后裁剪 clip 头部/尾部若干秒，精确控制过渡范围
4. **片头/片尾渐变** — 封面从黑场 fade in / 结尾 fade to black，可通过 `from: -2` / `to: -2` 语法
5. **过渡预览** — 在开发阶段快速预览过渡效果，无需完整渲染
