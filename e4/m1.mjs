import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_electron.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))


const subtitle = `
经过半个月的研发
我又给它增加了7种新的3D文件格式
包括：1、IFC文件
建筑信息模型的数据交换标准格式
--1--
---3000---
2、FreeCAD的原生项目文件格式((Fcstd))
--2--
---2000---
3、BREP文件 —— 边界表示法的实体建模格式
--3--
---2000---
4、IGES文件 —— 工业级CAD数据交换的经典格式
--4--
---2000---
5、STPZ文件 —— STEP文件的压缩变体
--5--
---2000---
6、SCAD文件 —— OpenSCAD的脚本化建模格式
--6--
---2000---
7、MODEL文件 —— 3MF内嵌的独立模型格式
`

const MODELS = [
  { path: 'src/test/fixtures/haus.ifc', label: 'IFC' },
  { path: 'src/test/fixtures/ArchDetail.FCStd', label: 'FCStd' },
  { path: 'src/test/fixtures/Motor-c.brep', label: 'BREP' },
  { path: 'src/test/fixtures/hammer.iges', label: 'IGES' },
  { path: 'res/Car.glb', label: 'STPZ' },
  { path: 'src/test/fixtures/test.scad', label: 'SCAD' },
  { path: 'src/test/fixtures/vise/3D/Objects/object_6.model', label: 'MODEL' },
]

/** Resolve model path: try screenplayDir first, fall back to rootDir. */
function modelPath(path) {
  const full = join(lib.screenplayDir, path)
  if (existsSync(full)) return full
  return join(lib.rootDir, path)
}

const ENTRY_MS = 1500

lib.makeMovie(
  import.meta.url,
  modelPath(MODELS[0].path),
  {
    AutoRotate: '0',
    closeLeftPanel: '1',
    closeRightPanel: '1',
    enablePreview: '0',
    entryZoomDist: '5;10',
    entryZoomEndDist: '1.1;1.3',
    entryAnim: 'zoom',
    entryDuration: String(ENTRY_MS),
  },
  async (page, suffix, tPageOpen) => {
    // Disable HTTP cache for model files
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url.includes('fixtures') || url.endsWith('.glb') || url.endsWith('.stl') || url.endsWith('.stp')) {
        route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })
      } else {
        route.continue()
      }
    })
    lib.showOverlay(page, 'fmt', '1. IFC', 'top-left', 'color:#fff;font-size:42px;font-weight:700;background:rgba(0,0,0,0.5);padding:12px 24px;border-radius:10px;font-family:sans-serif')
    // 隐藏 viewer 顶部工具栏
    await page.evaluate(() => {
      const store = window.__uiStore
      if (store && store.getState) store.getState().setHeaderVisible(false)
    })
    // 爆炸图动画（沿Y轴）
    await lib.callDemo(page, 'GSAPExplode', { spread: '5', range: '12' })
    await page.waitForSelector('#gsap-demo-explode')
    await lib.setSelectValue(page, 'e-axis-select', 'y')
    await lib.clickById(page, 'e-btn-play')
    await lib.animateCamera(page, { rotate: 'y', angle: 180, duration: 5000, ease: 'none' })
    await lib.clickById(page, 'e-btn-reset')
    await lib.animateCamera(page, { rotate: 'y', angle: 180, duration: 5000, ease: 'none' })
    await page.waitForTimeout(500)
    await lib.syncpoint(page)  // --1--

    for (let i = 1; i < MODELS.length; i++) {
      try {
        await lib.loadModel(page, modelPath(MODELS[i].path), {
          entryAnim: 'zoom',
          entryDuration: ENTRY_MS,
          entryZoomDist: '5;10',
          entryZoomEndDist: '1.1;1.3',
        })
        lib.showOverlay(page, 'fmt', `${i + 1}. ${MODELS[i].label}`, 'top-left', 'color:#fff;font-size:42px;font-weight:700;background:rgba(0,0,0,0.5);padding:12px 24px;border-radius:10px;font-family:sans-serif')
        await page.waitForTimeout(500)
        await lib.rotateModel(page, 180, 3000)
        await page.waitForTimeout(1000)
      } catch {
        console.log(`  [${suffix}] Failed to load ${MODELS[i].label}, skipping`)
        await page.waitForTimeout(1000)
      }
      if (i < MODELS.length - 1) await lib.syncpoint(page)  // --2-- through --11--
    }

    await lib.screenshot(page, join(__dir, 'capture/m1_end'))
    await page.waitForTimeout(500)
  },
)