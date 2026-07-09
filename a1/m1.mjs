import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_web.mjs'


const subtitle = `
腾讯最新的混元((Hy3))[[3]]模型真不错
解决了这里的齿轮错位的问题
我在用ai写一个CAD系统
--1--
目标是实现自然语言的建模、仿真和动画
行星齿轮组是一个典型案例
我用deepseek完成了建模，但是有错位问题
我不断告诉它齿轮啮合哪里不对，要怎么调整
都没能解决问题
我猜核心原因是deepseek没有视觉能力，
不能自己发现问题，一直在瞎猜
`;


lib.makeMovie(
  import.meta.url,
  "res/gear0.glb",
  {
    AutoRotate: '0',
    closeRightPanel: '0;1',
    entryAnim: 'zoom', 
    entryZoomDist: '5;10',
    entryZoomEndDist: '1.5;1.2',
    entryDuration: '3000',
    entryTargetShiftY: '0.1',
  },
  async (page, suffix, tPageOpen) => {
    // 模型绕 X 轴旋转 45°，使齿轮圆盘在屏幕上平放
    await lib.rotateModel(page, 45, 2000, { axis: [1, 0, 0] })
    await lib.syncpoint(page)


    // 播放 faicad_motion 扩展动画（行星齿轮组运动），速度减半，只播放一遍
    await page.evaluate(() => {
      const ctrl = window.__faicadMotionController
      if (ctrl) {
        ctrl.setSpeed(0.2)
        ctrl._tween.repeat(0)
        ctrl.play()
      }
    })
    await page.waitForTimeout(2000)

    // lib.animateCamera(page, { rotate: 'y', angle: 180, duration: 4000, ease: 'none' })
    // await page.waitForTimeout(4000)

  },
)
