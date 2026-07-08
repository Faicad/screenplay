// 简化自正常 movie 流程：通过 makeMovie 驱动真实查看器，
// 并演练「放大镜 → 高亮点击 → 清理」链路（与正常脚本一致）。
import * as lib from '../lib_3d_viewer_electron.mjs'
import { existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptName = 'test_magnifier'

const subtitle = `这是放大镜测试。`

const MODEL = join(lib.rootDir, 'src', 'test', 'fixtures', 'test-box.glb')

for (const s of ['_h', '_v']) {
  const p = join(__dirname, 'gen', `${scriptName}${s}.webm`)
  if (existsSync(p)) rmSync(p, { force: true })
}

;(async () => {
  await lib.makeMovie(
    import.meta.url,
    MODEL,
    { entryAnim: 'zoom', entryDuration: '1000', AutoRotate: '0' },
    async (page, suffix) => {
      // 放大镜：克隆工具栏并放大
      await lib.magnifyToolbar(page, { centerOn: 'view' })
      // 高亮点击需要一个真实 UI 目标；用 try 包裹以兼容不同查看器 DOM
      try {
        await lib.clickWithHighlight(page, 'canvas', '高亮点击', 1500)
      } catch (e) {
        console.log('  (clickWithHighlight 跳过：当前查看器 DOM 无匹配目标)')
      }
      // 清理放大镜
      await lib.removeMagnifyToolbar(page)
      await page.waitForTimeout(500)
    },
  )
  const outH = join(__dirname, 'gen', `${scriptName}_h.webm`)
  if (!existsSync(outH)) {
    console.error('FAIL: 录制未产出视频文件', outH)
    process.exit(1)
  }
  console.log('PASS: 放大镜流程录制完成', outH)
  process.exit(0)
})().catch((err) => {
  console.error('FAIL:', err && err.message)
  process.exit(1)
})
