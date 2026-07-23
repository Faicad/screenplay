import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_electron.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const captureDir = join(__dir, 'capture')

const subtitle = `
PCD文件截图
`

lib.makeMovie(
  import.meta.url,
  join(lib.rootDir, 'src/test/fixtures/simple.pcd'),
  {
    AutoRotate: '0',
    closeLeftPanel: '1',
    closeRightPanel: '1',
    enablePreview: '0',
    entryZoomDist: '5;10',
    entryZoomEndDist: '1.1;1.3',
    entryAnim: 'zoom',
    entryDuration: '1500',
  },
  async (page, suffix, tPageOpen) => {
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url.includes('fixtures') || url.endsWith('.pcd')) {
        route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } })
      } else {
        route.continue()
      }
    })
    await page.waitForTimeout(2000)
    await lib.screenshot(page, join(captureDir, 'thumb_PCD'))
    console.log(`[PCD] Captured → ${captureDir}/thumb_PCD_${suffix}.png`)
    await page.waitForTimeout(500)
  },
)