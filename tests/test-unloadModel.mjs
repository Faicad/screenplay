// 简化自正常 movie 流程：通过 makeMovie 驱动真实查看器，
// 演练「加载第二个模型 → 卸载该模型」链路（与正常脚本一致）。
import * as lib from '../lib_3d_viewer_electron.mjs'
import { existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptName = 'test-unloadModel'

const subtitle = `这是卸载模型测试。`

const MODEL_A = join(lib.rootDir, 'src', 'test', 'fixtures', 'test-box.glb')
const MODEL_B = join(lib.rootDir, 'src', 'test', 'fixtures', 'cube_output.glb')

for (const s of ['_h', '_v']) {
  const p = join(__dirname, 'gen', `${scriptName}${s}.webm`)
  if (existsSync(p)) rmSync(p, { force: true })
}

;(async () => {
  await lib.makeMovie(
    import.meta.url,
    MODEL_A,
    { entryAnim: 'zoom', entryDuration: '1000', AutoRotate: '0' },
    async (page, suffix) => {
      await lib.loadModel(page, MODEL_B, { entryAnim: 'zoom', entryDuration: '1000' })
      await page.waitForTimeout(500)
      await lib.unloadModel(page, MODEL_B)
      await page.waitForTimeout(500)
    },
  )
  const outH = join(__dirname, 'gen', `${scriptName}_h.webm`)
  if (!existsSync(outH)) {
    console.error('FAIL: 录制未产出视频文件', outH)
    process.exit(1)
  }
  console.log('PASS: 加载/卸载模型流程录制完成', outH)
  process.exit(0)
})().catch((err) => {
  console.error('FAIL:', err && err.message)
  process.exit(1)
})
