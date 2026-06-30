// Minimal recording test for lib-electron.mjs
import * as lib from '../lib_3d_viewer_electron.mjs'

const subtitle = `这是 Electron 录制测试。`

lib.makeMovie(
  import.meta.url,
  'C:/my/Faicad/3d_viewer_electron/src/test/fixtures/test-box.glb',
  {},
  async (page, suffix, tPageOpen) => {
    await lib.startRecording(page, tPageOpen, 1000)
    // Wait a few seconds to capture video
    await page.waitForTimeout(3000)
  },
)
