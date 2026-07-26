import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_electron.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))

const subtitle = `
于是，我决定写一个软件来实现这个功能。
这就是效果
可以一次性浏览成百上千个SVG文件
方便快速找到自己想要的图标，非常方便
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

async function scrollDown(page, { speed = 30, duration = 15000 } = {}) {
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
