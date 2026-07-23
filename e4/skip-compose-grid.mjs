/**
 * compose-grid.mjs — 将模型截图拼成4页网格
 * 每页6种格式，横屏3x2，竖屏2x3
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { chromium } from 'playwright'

const __dir = dirname(fileURLToPath(import.meta.url))
const genDir = join(__dir, 'gen')

// 24种格式（不含PCD），分4页，每页6种
const PAGES = [
  [
    { label: 'STL', file: 'thumb_00_STL' },
    { label: 'STEP/STP', file: 'thumb_01_STEP_STP' },
    { label: '3MF', file: 'thumb_02_3MF' },
    { label: 'OBJ', file: 'thumb_03_OBJ' },
    { label: 'GLB/GLTF', file: 'thumb_04_GLB_GLTF' },
    { label: 'PLY', file: 'thumb_05_PLY' },
  ],
  [
    { label: 'FBX', file: 'thumb_06_FBX' },
    { label: 'DAE', file: 'thumb_07_DAE' },
    { label: '3DS', file: 'thumb_08_3DS' },
    { label: 'USDZ', file: 'thumb_09_USDZ' },
    { label: 'DRC', file: 'thumb_10_DRC' },
    { label: 'BVH', file: 'thumb_11_BVH' },
  ],
  [
    { label: 'VTK', file: 'thumb_12_VTK' },
    { label: 'XYZ', file: 'thumb_13_XYZ' },
    { label: 'PDB', file: 'thumb_14_PDB' },
    { label: 'NRRD', file: 'thumb_15_NRRD' },
    { label: 'GCode', file: 'thumb_16_GCode' },
    { label: 'WRL', file: 'thumb_17_WRL' },
  ],
  [
    { label: 'VOX', file: 'thumb_18_VOX' },
    { label: 'KMZ', file: 'thumb_19_KMZ' },
    { label: 'AMF', file: 'thumb_20_AMF' },
    { label: 'LWO', file: 'thumb_21_LWO' },
    { label: 'MD2', file: 'thumb_22_MD2' },
    { label: '3DM', file: 'thumb_23_3DM' },
  ],
]

const ORIENTS = ['h', 'v']

// 横屏1920x1080: 3列x2行, 竖屏1080x1920: 2列x3行
const GRID = {
  h: { cols: 3, rows: 2, width: 1920, height: 1080 },
  v: { cols: 2, rows: 3, width: 1080, height: 1920 },
}

function buildHtml(pageIdx, orient) {
  const items = PAGES[pageIdx]
  const grid = GRID[orient]
  const isH = orient === 'h'

  // 缩略图尺寸（短边填满不留白）
  const gapX = isH ? Math.round(grid.width * 0.015) : Math.round(grid.width * 0.025)
  const gapY = Math.round(grid.height * 0.015)
  const thumbH = isH ? Math.round((grid.height - gapY) / 2) : Math.round(grid.height * 0.30)
  const thumbW = isH ? Math.round(grid.width * 0.30) : Math.round((grid.width - gapX) / 2)
  // 标签字体（叠加在截图上）
  const labelFontSize = Math.round(thumbH * 0.13)

  // 计算总宽高，居中偏移
  const totalW = grid.cols * thumbW + (grid.cols - 1) * gapX
  const totalH = grid.rows * thumbH + (grid.rows - 1) * gapY
  const startX = Math.round((grid.width - totalW) / 2)
  const startY = Math.round((grid.height - totalH) / 2)

  const cells = items.map((item, idx) => {
    const col = idx % grid.cols
    const row = Math.floor(idx / grid.cols)
    const x = startX + col * (thumbW + gapX)
    const y = startY + row * (thumbH + gapY)
    const thumbPath = join(genDir, `${item.file}_${orient}.png`)
    if (!existsSync(thumbPath)) {
      console.error(`  WARN: ${thumbPath} not found`)
      return ''
    }
    const imgUrl = pathToFileURL(thumbPath).href
    return `
    <div class="cell" style="left:${x}px;top:${y}px;width:${thumbW}px;height:${thumbH}px">
      <img src="${imgUrl}" class="thumb">
      <div class="label">${item.label}</div>
    </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${grid.width}px;height:${grid.height}px;background:#1a1a2e;position:relative;overflow:hidden}
.cell{position:absolute}
.thumb{width:100%;height:100%;object-fit:contain;border-radius:10px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,.5);display:block}
.label{position:absolute;bottom:0;left:0;right:0;padding:8px 12px;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;font-size:${labelFontSize}px;font-family:'Microsoft YaHei','PingFang SC',sans-serif;font-weight:700;text-align:center;border-radius:0 0 10px 10px;pointer-events:none}
</style></head><body>
${cells}
</body></html>`
}

async function main() {
  const browser = await chromium.launch()
  try {
    for (let pageIdx = 0; pageIdx < PAGES.length; pageIdx++) {
      for (const orient of ORIENTS) {
        const html = buildHtml(pageIdx, orient)
        const htmlPath = join(genDir, `_grid_tmp_p${pageIdx + 1}_${orient}.html`)
        writeFileSync(htmlPath, html)

        const grid = GRID[orient]
        const page = await browser.newPage({ viewport: { width: grid.width, height: grid.height } })
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(500)

        const outPath = join(genDir, `grid_p${pageIdx + 1}_${orient}.png`)
        await page.screenshot({ path: outPath, fullPage: false })
        await page.close()
        unlinkSync(htmlPath)

        console.log(`[grid] Page ${pageIdx + 1} ${orient} → ${outPath} (${grid.width}×${grid.height})`)
      }
    }
  } finally {
    await browser.close()
  }
  console.log(`\nDone! Generated ${PAGES.length * ORIENTS.length} grid pages.`)
}

main().catch(err => { console.error(err); process.exit(1) })