/**
 * cover.mjs 共享库
 *
 * 用法 — 项目自己的 cover.mjs 只需配置数据，然后调用 renderCover：
 *
 *   import { renderCover } from '../lib-cover.mjs'
 *
 *   renderCover(import.meta.url, {
 *     texts: { text1: '标题', text2: '副标题' },
 *     layout: {
 *       h: { text1: { top:20, align:'center' }, text2: { top:33, align:'right', pad:15 } },
 *       v: { text1: { top:23, align:'center' }, text2: { top:75, align:'center' } },
 *     },
 *     preset: 'gold-ruby',
 *     swap: false,
 *   })
 *
 * 参数说明见 renderCover JSDoc。
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { spawnSync } from 'child_process'
import { chromium } from 'playwright'

// ===== 共享配色预设 =====
// 每条文字定义渐变三色 [亮, 中, 暗]
// 中色同时作为不支持 background-clip 时的 fallback
export const PRESETS = {
  'gold-blue': {
    text1: ['#F8ECD0', '#F0D898', '#E4C878'],
    text2: ['#E0ECF8', '#C4D8EC', '#A8C4E0'],
  },
  'gold-gold': {
    text1: ['#F8ECD0', '#F0D898', '#E4C878'],
    text2: ['#F8ECD0', '#F0D898', '#E4C878'],
  },
  'gold-ruby': {
    text1: ['#F8ECD0', '#F0D898', '#E4C878'],
    text2: ['#F0C8D0', '#E06078', '#C83050'],
  },
  'rose-teal': {
    text1: ['#F5D5E0', '#E8A0B8', '#D07890'],
    text2: ['#C8F0E5', '#90D8C0', '#68C0A8'],
  },
  'amber-violet': {
    text1: ['#FDE8C8', '#F5B860', '#E89828'],
    text2: ['#E0D8F8', '#B098E8', '#8878D0'],
  },
  'coral-navy': {
    text1: ['#F8D8D0', '#F09080', '#E06850'],
    text2: ['#D0D8F0', '#8898D0', '#6070B8'],
  },
  'emerald-peach': {
    text1: ['#D0F0E0', '#80D0A8', '#50B880'],
    text2: ['#F8E8D8', '#F0C098', '#E8A068'],
  },
  'platinum-slate': {
    text1: ['#F0F0F0', '#D0D0D0', '#A8A8A8'],
    text2: ['#E0E4E8', '#B0B8C0', '#889098'],
  },
  'neon-cyan': {
    text1: ['#F8F8B8', '#F0E840', '#E0D810'],
    text2: ['#B8F8F8', '#40E0E0', '#00B8C8'],
  },
  'copper-sage': {
    text1: ['#F0D8C0', '#D8A080', '#C08050'],
    text2: ['#E0E8D8', '#B8C8A8', '#90A878'],
  },
  'ruby-ice': {
    text1: ['#F0C8D0', '#E06078', '#C83050'],
    text2: ['#D0E8F8', '#88C0E8', '#58A0D0'],
  },
  'lavender-mint': {
    text1: ['#F0E0F8', '#C8A8E8', '#A880D0'],
    text2: ['#D8F8E8', '#98E8C0', '#68D098'],
  },
}

const COVER_SIZE = { h: { w: 1920, h: 1080 }, v: { w: 1080, h: 1920 } }

// ===== 工具函数 =====

export function probePng(path) {
  const r = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', path,
  ], { stdio: 'pipe', timeout: 5000 })
  const [w, h] = r.stdout.toString().trim().split(',').map(Number)
  return w && h ? { w, h } : null
}

export function fontSizeForWidth(width, text) {
  let wide = 0, narrow = 0
  for (const ch of text) {
    if (/[一-鿿　-〿＀-￯]/.test(ch)) wide++
    else narrow++
  }
  return Math.floor(width * 0.8 / (wide + narrow * 0.6))
}

export function gradientStyle(stops) {
  return `color:${stops[1]};background-image:linear-gradient(180deg,${stops.join(',')});-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent`
}

export function positionCss({ top, align, pad = 20 }, centerY = '-50%') {
  switch (align) {
    case 'left':   return `top:${top}%;left:${pad}%;text-align:left;`
    case 'right':  return `top:${top}%;right:${pad}%;text-align:right;`
    case 'center':
    default:       return `top:${top}%;left:50%;text-align:center;transform:translate(-50%,${centerY});`
  }
}

function defaultBgRender({ useOverlay, coverImgFileUrl, imgUrl }) {
  if (useOverlay) {
    return {
      bgStyle: 'background:radial-gradient(ellipse at 50% 30%,#d8d8d8 0%,#b0b0b0 100%)',
      overlayHtml: coverImgFileUrl
        ? `<img class="overlay" src="${coverImgFileUrl}">`
        : '',
      overlayCss: '.overlay{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;z-index:1;mix-blend-mode:multiply}',
    }
  }
  return {
    bgStyle: `background:url('${imgUrl}') no-repeat center/contain, radial-gradient(ellipse at 50% 30%,#d8d8d8 0%,#b0b0b0 100%)`,
    overlayHtml: '',
    overlayCss: '',
  }
}

/**
 * 渲染封面
 *
 * @param {string}  metaUrl — 传入 import.meta.url
 * @param {object}  config
 * @param {object}  config.texts      — 文案映射，如 { text1:'标题', text2:'副标题' } 或 { text0, text1, text2 }
 * @param {object}  config.layout     — { h: { text1:{top,align,pad?,fontSize?}, ... }, v: {...} }
 * @param {string}  [config.preset]   — PRESETS 中的键名（与 inlineColors 二选一）
 * @param {boolean} [config.swap]     — 互换 text1/text2 颜色（仅对 text1/text2 生效）
 * @param {object}  [config.presetOverrides] — 合并到 PRESETS 的自定义预设 { presetName: { text1:[...], text2:[...] } }
 * @param {object}  [config.inlineColors]   — 跳过预设，直接使用颜色 CSS（不含 position），如 { text1:'color:...;background-image:...' }
 * @param {object}  [config.inlineFullCss]  — 完全自定义 CSS（含 position，不含 font-size），如 { text1:'top:25%;left:20%;color:...' }
 * @param {function} [config.bgRender]      — 底图渲染回调：(ctx) => { bgStyle, overlayHtml?, overlayCss? }
 *     ctx: { orient, isH, w, h, imgUrl, useOverlay, coverImgFileUrl, projectDir, projectName, rawPath }
 *     默认：灰色径向渐变 + 有 cover.png 时 multiply 叠加
 * @param {string}  [config.centerTransform] — 居中时 translateY，默认 '-50%'，3行布局常用 '0'
 */
export async function renderCover(metaUrl, config) {
  const projectDir = dirname(fileURLToPath(metaUrl))
  const projectName = basename(projectDir)
  const genDir = join(projectDir, 'gen')

  const {
    texts,
    layout,
    preset,
    swap = false,
    presetOverrides = {},
    inlineColors = null,
    bgRender,
    centerTransform = '-50%',
  } = config

  const mergedPresets = { ...PRESETS, ...presetOverrides }

  const coverPngPath = join(projectDir, 'cover.png')
  const hasCoverPng = existsSync(coverPngPath)
  const coverImgFileUrl = hasCoverPng ? pathToFileURL(coverPngPath).href : null

  const orientations = ['h', 'v']
  let anyWork = false
  const browser = await chromium.launch()

  try {
    for (const orient of orientations) {
      const isH = orient === 'h'
      let w, h, imgUrl, rawPath, useOverlay

      // ── 解析背景来源（三阶查找） ──
      // Tier 1: cover_h.png / cover_v.png（项目目录下的定向封面）
      // Tier 2: cover.png 叠加在灰色底图上（mix-blend-mode: multiply）
      // Tier 3: gen/{project}_cover_{orient}.png（captureCover 截图）
      const size = COVER_SIZE[orient]
      w = size.w; h = size.h
      const localCoverPath = join(projectDir, `cover_${orient}.png`)
      if (existsSync(localCoverPath)) {
        const dims = probePng(localCoverPath)
        if (dims) {
          imgUrl = pathToFileURL(localCoverPath).href
          rawPath = localCoverPath
        }
      }
      if (!imgUrl && hasCoverPng) {
        useOverlay = true
      }
      if (!imgUrl && !useOverlay) {
        rawPath = join(genDir, `${projectName}_cover_${orient}.png`)
        if (!existsSync(rawPath)) {
          console.log(`[cover] ${basename(rawPath)} not found, skipping`)
          continue
        }
        const dims = probePng(rawPath)
        if (!dims) { console.error(`[cover] Cannot probe ${basename(rawPath)}`); continue }
        imgUrl = pathToFileURL(rawPath).href
      }

      // ── 计算字号 & 颜色 ──
      const textKeys = Object.keys(texts)
      const autoFs = t => isH
        ? Math.round(fontSizeForWidth(w, t) * 0.5)
        : fontSizeForWidth(w, t)

      const fontSize = {}
      const textCss = {}
      for (const key of textKeys) {
        const lay = layout[orient][key]
        fontSize[key] = lay.fontSize ?? autoFs(texts[key])

        if (inlineColors && inlineColors[key]) {
          textCss[key] = positionCss(lay, centerTransform) + `font-size:${fontSize[key]}px;` + inlineColors[key]
        } else {
          const raw = mergedPresets[preset] ?? mergedPresets['gold-blue']
          // 查找该行对应的色组：text0 且 preset 中无 text0 则用 text1 的色组
          const pKey = raw[key] ? key : (textKeys.includes('text0') && key === 'text0' ? 'text1' : key)
          const pColors = (swap && key === 'text2')
            ? raw.text1
            : (swap && key === 'text1')
              ? raw.text2
              : raw[pKey]
          textCss[key] = positionCss(lay, centerTransform) + `font-size:${fontSize[key]}px;` + gradientStyle(pColors)
        }
      }

      const finalPath = join(genDir, `${projectName}_cover_final_${orient}.png`)
      const targetRatio = isH ? 4 / 3 : 3 / 4

      // ── 底图渲染 ──
      const bgCtx = { orient, isH, w, h, imgUrl, useOverlay, coverImgFileUrl, projectDir, projectName, rawPath }
      const bgResult = bgRender
        ? bgRender(bgCtx)
        : defaultBgRender(bgCtx)
      const bgStyle = bgResult.bgStyle
      const overlayImg = bgResult.overlayHtml ?? ''
      const overlayCss = bgResult.overlayCss ?? ''

      // ── 构建 HTML ──
      const textDivs = textKeys.map(k =>
        `<div class="t ${k}" id="${k}El">${texts[k]}</div>`
      ).join('\n')

      const textClassCss = textKeys.map(k =>
        `.${k}{${textCss[k]}}`
      ).join('\n')

      const txEntries = textKeys.map(k => `${k}El:'${texts[k]}'`).join(',')
      const checkIds = textKeys.map(k => `'${k}El'`).join(',')

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${w}px;height:${h}px;${bgStyle};position:relative}
.t{font-weight:bold;font-family:'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Noto Sans CJK',sans-serif;filter:drop-shadow(0 2px 4px rgba(0,0,0,.85)) drop-shadow(0 6px 28px rgba(0,0,0,.45));line-height:1.2;position:absolute;word-break:keep-all;z-index:2}
${overlayCss}
${textClassCss}
</style></head><body>
${overlayImg}
${textDivs}
<script>
console.log('__CV__ viewport w='+document.documentElement.clientWidth+' h='+document.documentElement.clientHeight);var r=document.getElementById.bind(document),R=Math.round,W=${w},H=${h},tr=${targetRatio},tx={${txEntries}};var sl=0,st=0,sw=W,sh=H;if(W/H>tr){sw=R(H*tr);sl=R((W-sw)/2)}else{sh=R(W/tr);st=R((H-sh)/2)};[${checkIds}].forEach(function(id){var e=r(id);if(!e)return;var b=e.getBoundingClientRect(),ok=b.left>=sl&&b.top>=st&&b.right<=sl+sw&&b.bottom<=st+sh;console.log('__CV__ '+id+' text="'+tx[id]+'" b=['+R(b.left)+','+R(b.top)+','+R(b.right)+','+R(b.bottom)+'] safe=['+sl+','+st+','+R(sl+sw)+','+R(st+sh)+'] ok='+ok)})
</script>
</body></html>`

      const htmlTmp = join(genDir, `_cover_tmp_${orient}.html`)
      mkdirSync(genDir, { recursive: true })
      writeFileSync(htmlTmp, html)

      const page = await browser.newPage({ viewport: { width: w, height: h } })
      let checkOk = true
      page.on('console', msg => {
        const t = msg.text()
        if (!t.startsWith('__CV__')) return
        if (t.includes(' ok=')) {
          const ok = t.includes(' ok=true')
          if (!ok) {
            checkOk = false
            const m = t.replace('__CV__ ', '')
            console.error(`[cover] 安全区越界: ${basename(finalPath)} (${orient}) ${m}`)
          }
        }
      })
      page.on('pageerror', err => {
        console.error(`[cover] Page error:`, err.message)
        checkOk = false
      })
      await page.goto(`file://${htmlTmp}`, { waitUntil: 'networkidle' })
      if (!checkOk) { await page.close(); unlinkSync(htmlTmp); process.exit(1) }
      await page.screenshot({ path: finalPath, fullPage: false })
      await page.close()
      unlinkSync(htmlTmp)

      const srcLabel = useOverlay ? 'cover.png + gray bg'
        : rawPath ? basename(rawPath)
        : 'unknown'
      const sizeLabel = textKeys.map(k => `"${texts[k]}"=${fontSize[k]}px`).join(', ')
      console.log(`[cover] ${srcLabel} → ${basename(finalPath)} (${w}×${h}, ${sizeLabel})`)
      anyWork = true
    }
  } finally {
    await browser.close()
  }

  if (!anyWork) process.exit(1)
}
