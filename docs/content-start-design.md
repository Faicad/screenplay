# contentStart — 视频正片起点标记

## 背景

在 `pageFn` 中，某些操作（如缩放、高亮按钮、等待过渡动画）只是为录制作准备的 **setup**，并非视频想展示的内容。传统的做法是把所有操作都录进去，然后在后期剪辑中裁掉，效率低且需要手动处理。

`contentStart` API 允许开发者在 `pageFn` 中精确标记"视频正片从这里开始"，之前的 setup 操作虽然仍然执行（以便准备好界面状态），**但它们的画面帧会自动从最终视频中裁掉**。

## API

```js
import * as lib from '../lib_3d_viewer_electron.mjs'

// 在 pageFn 中调用
await lib.contentStart(page)
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | `Page` | Playwright page 实例 |

### 返回值

无。

## 用法示例

```js
lib.makeMovie(
  import.meta.url,
  'model.glb',
  { AutoRotate: '0', entryDuration: '0' },
  async (page, suffix, tPageOpen) => {
    // ── setup（会被裁掉）──
    await zoomSvg(page, 5)
    await ensureRightPanel(page)
    await highlightBtn(page)
    await page.waitForTimeout(5000)  // 等待过渡动画

    // ── 正片起点 ──
    await lib.contentStart(page)

    // ── 视频内容 ──
    await scrollDown(page)
    await lib.screenshot(page, 'capture/end')
  },
)
```

## 工作原理

1. `contentStart(page)` 在浏览器端记录 `performance.now()` 到 `window.__movieContentStart`
2. `pageFn` 结束后，`recordOne` 读取该值
3. 计算 setup 耗时 = `contentStart - tModelBrowser`（浏览器时间戳，单位 ms）
4. 将 setup 耗时加到 `trimStart`（FFmpeg 裁切起点），从 `pageFnDuration` 中减掉
5. FFmpeg 帧精确裁剪：`ffmpeg -i raw.webm -ss <start> -t <duration>`（`-ss` 在 `-i` 之后，确保帧精确）

### 与 syncpoint 的区别

| | `syncpoint` | `contentStart` |
|--|-------------|----------------|
| 用途 | 字幕/音频同步标记 | 视频裁切起点标记 |
| 是否裁切视频 | ❌ 不裁切，仅记录时间戳 | ✅ 裁掉之前的帧 |
| 是否影响时长 | ❌ 不改变视频时长 | ✅ 减少视频时长 |
| 与 TTS 关系 | 可等待 TTS 播完 | 不考虑 TTS |

## 注意事项

- `contentStart` 只裁切视频帧，不影响操作执行——setup 代码仍然完整运行，确保界面状态就绪
- 裁切是基于 FFmpeg 的帧精确 seek（`-ss` 在 `-i` 之后），不会有多余帧残留
- 如果 TTS 总时长 > 裁切后的视频时长，`recordOne` 会自动延长视频以对齐 TTS
- 需要强制重新录制时，使用 `-f / --force` 标志
