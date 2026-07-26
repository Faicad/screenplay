/**
 * e5 封面配置
 *
 * 改文案/布局/配色即可，渲染逻辑由 lib-cover.mjs 统一处理。
 */
import { renderCover } from '../lib-cover.mjs'

const frostedCss = `
.bg-img{position:absolute;top:-10%;left:-10%;width:120%;height:120%;object-fit:cover;filter:blur(8px);z-index:0}
.glass{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,.04);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:1}`

renderCover(import.meta.url, {
  // ===== 文案 =====
  texts: {
    text0: '海量SVG图片',
    text1: '如何',
    text2: '快速浏览',
  },

  // ===== 布局 =====
  // 横屏(h)竖屏(v)分开。每个 text 可选：{ top, align, pad?, fontSize? }
  // fontSize 不设则 auto（按行宽计算），横屏 auto 时自动减半
  layout: {
    h: {
      text0: { top: 26, align: 'left',   pad: 22, fontSize: 120 },
      text1: { top: 26, align: 'right',  pad: 18, fontSize: 120 },
      text2: { top: 70, align: 'center', pad: 15 },
    },
    v: {
      text0: { top: 16, align: 'center', fontSize: 120 },
      text1: { top: 24, align: 'center', fontSize: 120 },
      text2: { top: 66, align: 'center' },
    },
  },

  // ===== 配色 =====
  // 改这一行即可切换：gold-blue | gold-ruby | rose-teal | amber-violet | coral-navy
  //                    emerald-peach | platinum-slate | neon-cyan | copper-sage | ruby-ice | lavender-mint
  preset: 'gold-ruby',
  swap: false,  // true → text1/text2 颜色互换

  // ===== 居中位移 =====
  // center 对齐时 translateY 值，默认 -50%，e5 使用 0（文字顶部对齐定位百分比）
  centerTransform: '0',

  // ===== 毛玻璃底图效果 =====
  bgRender({ imgUrl, useOverlay, coverImgFileUrl }) {
    // Tier 2: cover.png 叠加 — 保持原有灰底 + multiply 叠加，再加一层玻璃
    if (useOverlay) {
      return {
        bgStyle: 'background:radial-gradient(ellipse at 50% 30%,#d8d8d8 0%,#b0b0b0 100%)',
        overlayHtml: coverImgFileUrl
          ? `<img class="overlay" src="${coverImgFileUrl}"><div class="glass"></div>`
          : `<div class="glass"></div>`,
        overlayCss: `
.overlay{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;z-index:1;mix-blend-mode:multiply}
.glass{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,.06);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);z-index:2}
`,
      }
    }

    // Tier 1/3: 底图模糊 + 玻璃叠加层
    return {
      bgStyle: 'background:radial-gradient(ellipse at 50% 30%,#d8d8d8 0%,#b0b0b0 100%)',
      overlayHtml: [
        `<img class="bg-img" src="${imgUrl}">`,
        '<div class="glass"></div>',
      ].join('\n'),
      overlayCss: frostedCss,
    }
  },
})
