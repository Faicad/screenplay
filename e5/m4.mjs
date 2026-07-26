import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_electron.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))

const subtitle = `
使用也很简单
用Faicad 3D查看器打开一个SVG文件
界面右侧会自动生成同目录的svg文件的缩略图
如果缩略图很多, 可以拖动缩略图区域
把它从一排变成多排
如果要查看成百上千的图片
--1--
可以点击右上角的最大化图标
就可以全屏查看全部的SVG文件了。
是不是很方便
本软件开源、免费
--2--
求关注、求转发、求收藏
`

async function zoomSvg(page, factor) {
  const fileId = await page.evaluate(() => {
    const ws = window.__svgWorkspaceStore?.getState()
    return ws?.files[0]?.fileId ?? null
  })
  if (!fileId) return
  const steps = 20
  const stepFactor = Math.pow(factor, 1 / steps)
  await page.evaluate(async ({ fid, stepFactor, steps }) => {
    const store = window.__svgWorkspaceStore.getState()
    store.selectFile(fid)
    for (let i = 0; i < steps; i++) {
      store.zoomFile(fid, stepFactor)
      await new Promise(r => setTimeout(r, 80))
    }
  }, { fid: fileId, stepFactor, steps })
}

async function ensureRightPanel(page) {
  await page.evaluate(() => {
    const ui = window.__uiStore?.getState()
    if (!ui) return
    if (!ui.rightPanelOpen) ui.toggleRightPanel()
    if (!ui.enablePreview) ui.setEnablePreview(true)
  })
}

async function widenRightPanel(page, duration = 1200) {
  // 找到右侧面板的 resize handle（总是最后一个 .cursor-col-resize）
  const box = await page.evaluate(() => {
    const handles = document.querySelectorAll('.cursor-col-resize')
    if (handles.length === 0) return null
    const h = handles[handles.length - 1]
    if (!h) return null
    const r = h.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: window.innerWidth }
  })
  if (!box) return

  const startX = box.x
  const startY = box.y

  // 计算 target X：让右侧面板从当前宽度翻倍（不超过 MAX_PANEL_PCT=40%）
  // 公式：rightPanelPct = 100 - (clientX / windowWidth * 100)
  // 当前宽度 = 100 - (startX / windowW * 100)
  const curPct = 100 - (startX / box.w * 100)
  const targetPct = Math.min(curPct * 2, 40)
  const targetX = (100 - targetPct) / 100 * box.w

  // 注入浮层鼠标光标（在 DOM 中创建一个鼠标 SVG，随真实鼠标同步移动）
  await page.evaluate(({ startX, startY }) => {
    const old = document.getElementById('__movie_cursor')
    if (old) old.remove()
    const cursor = document.createElement('div')
    cursor.id = '__movie_cursor'
    cursor.innerHTML =
      `<svg width="48" height="48" viewBox="0 0 26 30">` +
      `<polygon points="3,2 3,26 10,20 17,29 21,25 13,18 22,11" ` +
      `fill="#fff" stroke="#222" stroke-width="1.8" stroke-linejoin="round"/></svg>`
    Object.assign(cursor.style, {
      position: 'fixed',
      zIndex: '10002',
      pointerEvents: 'none',
      left: '0px',
      top: '0px',
      filter: 'drop-shadow(2px 3px 4px rgba(0,0,0,0.45))',
      transform: `translate(${startX - 6}px, ${startY - 4}px)`,
    })
    document.body.appendChild(cursor)
  }, { startX, startY })

  // 平滑拖动（基于 deadline 计时，消除 CDP overhead 累积误差）
  const deadline = Date.now() + duration
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  while (Date.now() < deadline) {
    const elapsed = deadline - Date.now()
    const t = Math.max(0, Math.min(1 - elapsed / duration, 1))
    const x = startX + (targetX - startX) * t
    await page.mouse.move(x, startY)
    // 同步更新浮层光标位置
    await page.evaluate(({ x, y }) => {
      const c = document.getElementById('__movie_cursor')
      if (c) c.style.transform = `translate(${x - 6}px, ${y - 4}px)`
    }, { x, y: startY })
    await new Promise(r => setTimeout(r, 10))
  }
  // 确保最终位置
  await page.mouse.move(targetX, startY)
  await page.evaluate(({ x, y }) => {
    const c = document.getElementById('__movie_cursor')
    if (c) c.style.transform = `translate(${x - 6}px, ${y - 4}px)`
  }, { x: targetX, y: startY })

  await page.mouse.up()

  // 拖拽完成后移除浮层光标
  await page.evaluate(() => {
    const c = document.getElementById('__movie_cursor')
    if (c) c.remove()
  })
}

async function showEndingOverlay(page) {
  await page.evaluate(() => {
    const old = document.getElementById('__ending_overlay')
    if (old) old.remove()

    const gsap = window.__gsap

    // 全屏遮罩层（半透明黑底 + 模糊）
    const overlay = document.createElement('div')
    overlay.id = '__ending_overlay'
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 10001;
      background: rgba(0,0,0,0.45);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
      opacity: 0;
    `

    // 文字容器
    const text = document.createElement('div')
    text.textContent = '求关注 · 求转发 · 求收藏'
    text.style.cssText = `
      color: #fff;
      font-size: 72px;
      font-weight: 800;
      font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
      text-shadow: 0 4px 20px rgba(0,0,0,0.6);
      letter-spacing: 6px;
      transform: scale(0.7);
      opacity: 0;
    `
    overlay.appendChild(text)
    document.body.appendChild(overlay)

    // GSAP 动画：遮罩淡入 + 文字弹出
    gsap.to(overlay, { opacity: 1, duration: 0.6, ease: 'power2.out' })
    gsap.to(text, {
      opacity: 1, scale: 1, duration: 0.8, ease: 'back.out(1.7)',
      delay: 0.15,
    })
  })

  // 等待 TTS 朗读完最后一句
  await page.waitForTimeout(2000)
}

async function injectPulseStyle(page) {
  await page.evaluate(() => {
    if (document.getElementById('__my_style')) return
    const style = document.createElement('style')
    style.id = '__my_style'
    style.textContent = `@keyframes __myPulse { 0%,100% { transform:scale(1); opacity:.9; } 50% { transform:scale(1.35); opacity:.4; } }`
    document.head.appendChild(style)
  })
}

async function findFullscreenBtn(page) {
  return page.evaluate(() => {
    const byTitle = document.querySelector('button[title="全屏查看缩略图"]')
    if (byTitle) { byTitle.id = '__fs_btn'; return true }
    const allBtns = document.querySelectorAll('button')
    for (const btn of allBtns) {
      const svg = btn.querySelector('svg')
      if (!svg) continue
      if (svg.innerHTML.includes('M8') && svg.innerHTML.includes('H3') && svg.innerHTML.includes('V3')) {
        btn.id = '__fs_btn'
        return true
      }
    }
    return false
  })
}

async function highlightBtn(page) {
  // Phase 1: 红框脉冲圆 + 标签
  await page.evaluate(() => {
    const btn = document.getElementById('__fs_btn')
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const r = 56                      // 半径 2x (原 28)
    const borderPx = 12               // 线宽 4x (原 3px)

    let container = document.getElementById('movie-overlay-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'movie-overlay-container'
      container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999'
      document.body.appendChild(container)
    }

    const circle = document.createElement('div')
    circle.id = '__my_highlight'
    Object.assign(circle.style, {
      position: 'absolute', left: `${cx - r}px`, top: `${cy - r}px`,
      width: `${r * 2}px`, height: `${r * 2}px`, borderRadius: '50%',
      border: `${borderPx}px solid #ff3333`,
      background: 'rgba(255,50,50,0.15)',
      boxShadow: '0 0 40px rgba(255,0,0,0.7), inset 0 0 20px rgba(255,0,0,0.25)',
      animation: '__myPulse 0.8s ease-in-out infinite',
      pointerEvents: 'none',
    })
    container.appendChild(circle)

    const lbl = document.createElement('div')
    lbl.id = '__my_label'
    Object.assign(lbl.style, {
      position: 'absolute', left: `${cx}px`, top: `${cy + r + 20}px`,
      color: '#ff3333', fontSize: '32px', fontWeight: '700',
      fontFamily: 'sans-serif', textShadow: '0 0 12px rgba(0,0,0,0.7)',
      pointerEvents: 'none', whiteSpace: 'nowrap', transform: 'translateX(-50%)',
    })
    lbl.textContent = '全屏查看缩略图'
    container.appendChild(lbl)
  })

  // 脉冲展示 1.5s
  await page.waitForTimeout(1500)

  // Phase 2: 鼠标光标从下方上升点击 + 清理
  await page.evaluate(() => {
    const btn = document.getElementById('__fs_btn')
    if (!btn) return

    // 移除脉冲圆 + 标签
    document.getElementById('__my_highlight')?.remove()
    document.getElementById('__my_label')?.remove()

    const rect = btn.getBoundingClientRect()
    const tx = rect.left + rect.width / 2
    const ty = rect.top + rect.height / 2
    const cursorSize = 96             // 鼠标 2x (原 48px)
    const moveDistance = 240          // 移动距离 2x (原 120px)

    let container = document.getElementById('movie-overlay-container')
    if (!container) {
      container = document.createElement('div')
      container.id = 'movie-overlay-container'
      container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999'
      document.body.appendChild(container)
    }

    // 起点：按钮正下方
    const sx = tx
    const sy = ty + moveDistance

    // 创建鼠标光标 SVG（144px）
    const cursor = document.createElement('div')
    cursor.id = '__movie_cursor'
    cursor.innerHTML =
      `<svg width="${cursorSize}" height="${cursorSize}" viewBox="0 0 26 30">` +
      `<polygon points="3,2 3,26 10,20 17,29 21,25 13,18 22,11" ` +
      `fill="#fff" stroke="#222" stroke-width="1.8" stroke-linejoin="round"/></svg>`
    Object.assign(cursor.style, {
      position: 'fixed', zIndex: '10002', pointerEvents: 'none',
      left: '0px', top: '0px',
      filter: 'drop-shadow(4px 6px 8px rgba(0,0,0,0.5))',
      transform: `translate(${sx - cursorSize * 0.12}px, ${sy - cursorSize * 0.08}px)`,
    })
    container.appendChild(cursor)

    // 用 requestAnimationFrame 平滑移动，返回 Promise 让 evaluate 等待
    return new Promise(resolve => {
      const startTime = performance.now()
      const moveDuration = 1200

      function animateMove(now) {
        const elapsed = now - startTime
        const progress = Math.min(elapsed / moveDuration, 1)
        // ease-out 曲线
        const ease = 1 - Math.pow(1 - progress, 3)
        const curX = sx + (tx - sx) * ease
        const curY = sy + (ty - sy) * ease
        cursor.style.transform =
          `translate(${curX - cursorSize * 0.12}px, ${curY - cursorSize * 0.08}px)`

        if (progress < 1) {
          requestAnimationFrame(animateMove)
        } else {
          // 到达 → 点击 + 压扁反馈
          btn.click()
          cursor.style.transition = 'transform 0.08s ease-out'
          cursor.style.transform =
            `translate(${tx - cursorSize * 0.12}px, ${ty - cursorSize * 0.08}px) scale(0.6)`
          setTimeout(() => {
            cursor.style.transition = 'opacity 0.25s ease-out'
            cursor.style.opacity = '0'
            setTimeout(() => {
              cursor.remove()
              resolve()
            }, 250)
          }, 100)
        }
      }
      requestAnimationFrame(animateMove)
    })
  })
}

async function scrollDown(page, { speed = 30, duration = 16000 } = {}) {
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

async function scrollRightPanel(page, { speed = 30, duration = 2000 } = {}) {
  await page.evaluate(async ({ speed, duration }) => {
    // 右侧面板内部的缩略图滚动区域（最后一个 data-radix-scroll-area-viewport）
    const rp = document.querySelector('aside.flex.flex-col.shrink-0:not([data-testid])')
    if (!rp) return
    const vps = rp.querySelectorAll('[data-radix-scroll-area-viewport]')
    const sa = vps[vps.length - 1]
    if (!sa) return
    const maxTop = sa.scrollHeight - sa.clientHeight
    if (maxTop <= 0) return
    const startTop = sa.scrollTop
    const start = performance.now()
    let prevTop = startTop
    const pxPerMs = speed / 1000
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
  "C:\\git\\3D\\OrcaSlicer\\resources\\images\\logo111.svg",
  {
    AutoRotate: '0',
    closeLeftPanel: '1',
    entryDuration: '0',
  },
  async (page, suffix, tPageOpen) => {
    await zoomSvg(page, 0.5)
    await lib.contentStart(page)

    await page.waitForTimeout(2000)    
    await ensureRightPanel(page)
    await scrollRightPanel(page, { speed: 30, duration: 7000 })
    await page.waitForTimeout(2000)    

    await widenRightPanel(page, 2000)
    await page.waitForTimeout(1000)
    await lib.syncpoint(page)

    await injectPulseStyle(page)
    const found = await findFullscreenBtn(page)
    if (found) {
      await highlightBtn(page)
    }
    await scrollDown(page, { speed: 30, duration: 10000 } )
    // await lib.screenshot(page, join(__dir, 'capture/m1_end'))
    await lib.captureCover(page)

    await lib.syncpoint(page)

    await showEndingOverlay(page)
  },
)
