// 简化自正常 movie 生成流程（参考 e2/m1.mjs）。
// 正常流程就是：lib.makeMovie(import.meta.url, modelPath, viewerParams, pageFn)
// 其中 modelPath 相对 lib.rootDir 解析，`const subtitle` 驱动 TTS 预生成。
import * as lib from '../lib_3d_viewer_electron.mjs'
import { existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptName = 'test-record'

// makeMovie 的 TTS 预生成会从本脚本解析 `const subtitle`，必须有。
const subtitle = `这是录制测试。`

// 用查看器自带的真实 fixture（与正常脚本一样走 lib.rootDir）。
const MODEL = join(lib.rootDir, 'src', 'test', 'fixtures', 'test-box.glb')

// 强制重新录制，避免 webm 缓存命中导致 pageFn 不执行 / 不产出新文件。
for (const s of ['_h', '_v']) {
  const p = join(__dirname, 'gen', `${scriptName}${s}.webm`)
  if (existsSync(p)) rmSync(p, { force: true })
}

;(async () => {
  await lib.makeMovie(
    import.meta.url,
    MODEL,
    { entryAnim: 'zoom', entryDuration: '1200', AutoRotate: '0' },
    async (page, suffix, tPageOpen) => {
      await lib.rotateModel(page, 180, 2000)
      await page.waitForTimeout(800)
    },
  )
  const outH = join(__dirname, 'gen', `${scriptName}_h.webm`)
  if (!existsSync(outH)) {
    console.error('FAIL: 录制未产出视频文件', outH)
    process.exit(1)
  }
  console.log('PASS: 录制产出', outH)
  process.exit(0)
})().catch((err) => {
  console.error('FAIL:', err && err.message)
  process.exit(1)
})
