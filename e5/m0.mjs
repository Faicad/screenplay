import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_electron.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))

const subtitle = `
一个文件夹，几十个甚至几百个svg文件
如何做到快速查看？
这个视频来告诉你
`

async function ensureRightPanel(page) {
  await page.evaluate(() => {
    const ui = window.__uiStore?.getState()
    if (!ui) return
    if (!ui.rightPanelOpen) ui.toggleRightPanel()
    if (!ui.enablePreview) ui.setEnablePreview(true)
  })
}

async function clickFullscreenBtn(page) {
  await page.evaluate(() => {
    document.querySelector('button[title="全屏查看缩略图"]')?.click()
  })
}

async function scrollDown(page, { speed = 30, duration = 6000 } = {}) {
  await page.evaluate(async ({ speed, duration }) => {
    const fs = document.querySelector('.fixed.inset-0.z-50')
    if (!fs) return
    const sa = fs.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"], [data-radix-scroll-area-viewport]')
    if (!sa) return
    const pxPerMs = speed / 1000
    const start = performance.now()
    const startTop = sa.scrollTop
    let prevTop = startTop
    const maxTop = sa.scrollHeight - sa.clientHeight

    function tick() {
      const elapsed = performance.now() - start
      if (elapsed >= duration) return
      const delta = Math.round(elapsed * pxPerMs)
      const top = Math.min(startTop + delta, maxTop)
      if (top !== prevTop) {
        sa.scrollTop = top
        prevTop = top
      }
      requestAnimationFrame(tick)
    }
    tick()
    await new Promise(r => setTimeout(r, duration))
  }, { speed, duration })
}


lib.makeMovie(
  import.meta.url,
  "C:\\git\\3D\\PrusaSlicer\\resources\\icons\\add.svg",
  {
    AutoRotate: '0',
    closeLeftPanel: '1',
    entryDuration: '0',
  },
  async (page, suffix, tPageOpen) => {
    await ensureRightPanel(page)
    await clickFullscreenBtn(page)
    await page.waitForTimeout(1000)
    await lib.contentStart(page)
    await scrollDown(page)
    await lib.screenshot(page, join(__dir, 'capture/m1_end'))
  },
)
