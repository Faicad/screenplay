# Merge 指南

> 将项目内多个视频片段合并为一个完整视频，支持封面、背景音乐、片段切换过渡。

---

## 快速开始

```bash
# 合并 p1 项目（自动 burn + 合并）
node mergeVideo.mjs p1

# 合并 e5 项目，仅竖屏，强制重新生成
node mergeVideo.mjs e5 -v -f
```

## 目录

- [流程概述](#1-流程概述)
- [merge.json 配置](#2-mergejson-配置)
- [片段切换过渡](#3-片段切换过渡)
- [CLI 参数](#4-cli-参数)
- [技术细节](#5-技术细节)
- [常见问题](#6-常见问题)

---

## 1. 流程概述

```
项目目录 (e.g. p1/)
   │
   ├─ [1] 扫描所有 .mjs 文件，按文件名排序，排除 cover.mjs 和 skip-* 文件
   │     → [m0.mjs, m1.mjs, m2.mjs]
   │
   ├─ [2] 对每个 .mjs 执行 burn.mjs（透传 CLI 参数）
   │     → 产生 gen/m0_burn_h.mp4, m0_burn_v.mp4（自包含：视频+音频+字幕）
   │
   ├─ [3] 收集 burned 视频（_burn_.mp4，按方向分组）
   │     横屏: [m0_burn_h.mp4, m2_burn_h.mp4]
   │     竖屏: [m1_burn_v.mp4]
   │
   ├─ [4] cover 预处理 → 自动检测封面
   │
   ├─ [5] 读 merge.json（可选），取 audioBg / transitions
   │
   ├─ [6] 合并（按方向分别处理）
   │     ├─ 无 transitions → concatBurnedClips（简单拼接）
   │     └─ 有 transitions → mergeBurnedWithTransitions（tpad + xfade，视频总长不变）
   │
   ├─ [7] 生成合并字幕 merged.subtitle（备查）
   │
   └─ [8] 自动播放合并结果
```

### 素材收集规则

Merge 统一使用 **burned 视频**（`_burn_.mp4`），每个文件自包含视频+音频+已烘焙字幕。不使用 raw `.webm` 或独立 `.mp3`。

burned 视频由 step 2 的 `burn.mjs` 自动生成，不存在时会报错。

### Cover 处理

Cover 不是 clip，不参与合并过程，不占用 transition 索引。

| 路径 | Cover 处理方式 |
|------|---------------|
| 无 transitions（`concatBurnedClips`） | Cover 在函数内部拼接到 clip 列表开头，和所有 clip 一起 concat |
| 有 transitions（`mergeBurnedWithTransitions`） | Cover **不作为 transition 的输入**。merge 完成后，通过 ffmpeg concat 将 cover 前置到 merged.mp4：`cover(1帧) + merged.mp4 → 替换 merged.mp4` |

**有 transitions 时 cover 不参与合并的原因：** Transition 的 `from`/`to` 索引对应 burned 视频（m0, m1, m2...），cover 不在这个序列中。如果 cover 拼进 clip 列表，所有 transition 索引都会偏移 1。所以 cover 以**后处理方式**追加，不影响 transition 索引。索引保持和 merge.json 配置一致。

---

## 2. merge.json 配置

在项目目录下放置 `merge.json`，可选配置。完整示例：

```jsonc
{
  // ── 背景音乐（可选）──
  "audioBg": "Jamvana - Pure Ocean.mp3",

  // ── 全局默认过渡（可选，所有 clip 之间生效）──
  "transition": {
    "type": "slideleft",
    "duration": 0.5
  },

  // ── 逐条覆盖过渡（可选，仅列出的边界有过渡，其他保持 direct cut）──
  "transitions": [
    { "from": 0, "to": 1, "type": "fade",      "duration": 0.4 },
    { "from": 2, "to": 3, "type": "fadeblack", "duration": 0.3 }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `audioBg` | string | 背景音乐路径（相对项目目录或绝对路径）。优先级低于 `.env` 的 `AUDIO_BG` |
| `transition.type` | string | 全局默认过渡类型，存在时所有 clip 边界都应用此过渡 |
| `transition.duration` | number / string | 全局过渡时长（秒，或百分比如 `"10%"`） |
| `transitions[].from` | number | 前一个 clip 序号（从 0 开始） |
| `transitions[].to` | number | 后一个 clip 序号（= from + 1） |
| `transitions[].type` | string | 过渡类型。`"cut"` 表示跳过/直接切换，其余值覆盖全局 |
| `transitions[].duration` | number / string | 过渡时长，覆盖全局 |

### 语义规则

| 配置方式 | 效果 |
|----------|------|
| 不写任何过渡字段 | 全部直接切（cut） |
| 仅 `transitions[]`（无 `transition`） | **仅列出**的边界有过渡，其他全部直接切 |
| 仅 `transition`（全局，无 `transitions[]`） | 全部边界都用全局过渡 |
| `transition` + `transitions[]` | 全部默认全局，列表中的覆盖全局 |
| `transitions[].type = "cut"` | 显式跳过该边界（即使有全局默认也强制切） |

### 简化写法

只有全局默认过渡时：

```json
{ "transition": { "type": "fade", "duration": 0.5 } }
```

不需要过渡时（merge.json 可以只配背景音乐）：

```json
{ "audioBg": "my_music.mp3" }
```

---

## 3. 片段切换过渡

### 3.1 支持 25+ 种过渡类型

| 类型 | 效果 | 适用场景 |
|------|------|----------|
| `fade` | 叠化淡入淡出 | 通用，最自然 |
| `fadeblack` | 黑场过渡 | 章节切换 |
| `fadewhite` | 白场过渡 | 闪回/回忆 |
| `slideleft` | 下一张从左滑入 | 产品展示 |
| `slideright` | 下一张从右滑入 | 产品展示 |
| `slideup` | 下一张从上滑入 | 信息流 |
| `slidedown` | 下一张从下滑入 | 信息流 |
| `smoothleft/right/up/down` | 平滑滑动 | 更流畅的滑动 |
| `wipeleft/right/up/down` | 擦除效果 | 转场 |
| `circleclose` | 圆形收缩（焦点缩小到中心） | 结束画面 |
| `circleopen` | 圆形展开（从中心扩出） | 开头画面 |
| `rectclose/rectopen` | 矩形收缩/展开 | 类 PPT 转场 |
| `dissolve` | 溶解 | 梦幻过渡 |
| `pixelize` | 像素方块化 | 创意过渡 |
| `zoomin` | 放大进入 | 特写过渡 |
| `hlslice/hrslice` | 水平切割 | 分割画面 |
| `vuslice/vdslice` | 垂直切割 | 分割画面 |
| `distance` | 景深过渡 | 3D 效果 |

### 3.2 过渡时长

`duration` 支持两种写法：

```jsonc
// 绝对值（秒）
{ "type": "fade", "duration": 0.5 }

// 百分比（取两段 clip 中较短者的百分比）
{ "type": "slideleft", "duration": "10%" }
```

自动 clamp 到 `[0.1s, min(tA, tB)/2]`，防止过渡超过 clip 时长。

### 3.3 过渡对时长的影响

过渡采用 **tpad 补偿机制**，视频总时长不变：

```
clip A 10s + clip B 10s + 0.5s fade
  → A 末尾延长 0.5s（freeze 最后一帧）
  → xfade 叠 0.5s
  → 总时长 = (10 + 0.5) + 10 - 0.5 = 20s  ← 不变
```

tpad 延长的是前一段的最后一帧（静音冻结），不改变字幕。字幕已烘焙在 burned 视频的画面中，tpad freeze 时最后一帧的字幕保持显示，xfade 过渡时两段字幕自然叠化。

#### 音频的 per-segment 自动补长

音频来自 burned 视频自带的音轨，原样 concat。但每个 burned 片段的音频流和视频流时长可能不一致：

| 情况 | 示例 | 处理方式 |
|------|------|----------|
| 视频 > 音频 | m1: 视频 15.12s, 音频 11.57s | 音频补静音到视频长度 |
| 音频 > 视频 | m4: 视频 42.52s, 音频 45.61s | 音频不动，视频末尾冻结帧补齐 |

在 `mergeBurnedWithTransitions` 中，concat 前对每段音频做 `apad=whole_dur=clipDurations[i]`，其中 `clipDurations[i]` 取 `format.duration = max(视频流时长, 音频流时长)`。**只补不裁**，保证长的那方完整保留：

```
m0: 音频 11.614s → apad=whole_dur=11.640 → 补 0.026s  ➜  11.640s
m1: 音频 11.566s → apad=whole_dur=15.120 → 补 3.554s  ➜  15.120s
m4: 音频 45.612s → apad=whole_dur=45.612 → 已等长     ➜  45.612s
```

这样音频 concat 的 segment 边界 = `clipDurations` 的累计和，和视频 xfade 的 offset 位置一致，保证每段起始时音画同步。这和 `concatBurnedClips` 中 `concat v=1:a=1` 的 per-segment `max(v, a)` 行为完全一致。

### 3.4 字幕处理

字幕已烘焙在 burned 视频的画面中，merge 不单独处理字幕。tpad freeze 时最后一帧的字幕保持显示，xfade 过渡时两段字幕自然叠化。

---

## 4. CLI 参数

### 基本用法

```bash
node mergeVideo.mjs <project-dir> [options]
```

### 参数列表

| 参数 | 说明 |
|------|------|
| `-s` | 480p（960×540 / 540×720） |
| `-m` | 720p（1280×720 / 720×960） |
| `-g` | 1080p 默认（1920×1080 / 1080×1440） |
| `-h` | 仅横屏 |
| `-v` | 仅竖屏 |
| `-f` / `--force` | 强制重新生成所有文件（跳过缓存检查） |
| `-30` | 30fps 输出（源 25fps → 1.2× 加速） |
| `--tts <provider>` | 指定 TTS 引擎（如 `spark-tts`） |

### 示例

```bash
# 基本合并
node mergeVideo.mjs p1

# 1080p + 仅横屏 + 强制重新生成
node mergeVideo.mjs p1 -g -h -f

# 480p + 仅竖屏
node mergeVideo.mjs e5 -s -v

# 自定义 TTS 引擎
node mergeVideo.mjs p1 --tts spark-tts
```

### 缓存机制

Merge 自动检查各上游文件（`_burn_.mp4`、`merge.json`、封面、BGM）的修改时间。如果已生成的 `merged.mp4` 比所有上游文件都新，则跳过合并步骤。

使用 `-f` 强制覆盖缓存。

---

## 5. 技术细节

### 5.1 视频过渡：xfade

使用 ffmpeg 内置的 `xfade` filter，在 clip 之间实现过渡动画。工作原理：

```
clip A 末尾 ──→ xfade ──→ clip B 开头
                 ↑
      过渡期内两段视频叠加
```

对于多个 clip，逐对串联：

```
[v0][v1]xfade=transition=fade:duration=0.5:offset=9.5 → [x1]
[x1][v2]xfade=transition=slideleft:duration=0.4:offset=... → [rawv]
```

### 5.2 音频处理

**人声（TTS）不做完整 acrossfade**，只做 0.1s 极短淡变消除边界咔哒声。这样避免了两个人声同时播放的问题。

背景音乐（BGM）在所有 clip 拼接后的最终音轨上叠加混音。

### 5.3 架构示意

```
Merge 阶段（mergeVideo.mjs）：
  输入: _burn_.mp4 × N（每个自包含视频+音频+字幕）+ BGM
        │
        ├─ 视频: [i:v] → tpad(延长) → xfade 链（有 transition 时）
        │        或 [i:v] → scale+pad → concat（无 transition 时）
        ├─ 音频: [i:a] → aresample → concat（原样，不修改）
        ├─ 字幕: 已烘焙在视频画面中，不处理
        └─ 混音: amix（合并音频 + BGM）
        │
        ↓
  输出: merged.mp4（含字幕 + 配音 + 背景音乐）
```

### 5.4 相关函数

| 函数 | 位置 | 作用 |
|------|------|------|
| `resolveTransitions()` | `lib-common.mjs` | 从 `merge.json` 解析过渡配置 |
| `concatBurnedClips()` | `mergeVideo.mjs` | 合并 burned 视频（无 transition） |
| `mergeBurnedWithTransitions()` | `mergeVideo.mjs` | 合并 burned 视频（tpad + xfade，有 transition） |

---

## 6. 常见问题

### 6.1 为什么 merge 重新 burn 了所有脚本？

每次运行 merge 都会对每个 `.mjs` 执行 `burn.mjs`。如果素材已存在且无变更，`burn.mjs` 会跳过缓存步骤，不会真正重新录制/生成。

### 6.2 过渡不生效怎么办？

检查以下几点：
1. 项目目录下有 `merge.json`，且格式正确（JSON 标准，无注释）
2. 至少有 2 个同方向的 burned 视频（如 `m0_burn_v.mp4` + `m1_burn_v.mp4`）
3. 过渡类型名称拼写正确（参考 [支持的类型列表](#31-支持-25-种过渡类型)）

### 6.3 过渡时字幕是否会重叠？

字幕已烘焙在 burned 视频的画面中。tpad 冻结前一帧时，该帧的字幕保持显示；xfade 过渡时两段字幕自然叠化后再消失，视觉效果合理。

### 6.4 过渡时间太长/太短

调整 `duration` 值。建议范围：`0.2` ~ `1.0` 秒。超过 clip 时长的一半会自动截断。
