import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_web.mjs'


const subtitle = `
这是第二个动画
演示外层齿圈固定
太阳轮驱动行星轮转动
两个动画中，行星轮不仅有自转，还有公转（移动）
这两个动画比看起来要难
`;


lib.makeMovie(
  import.meta.url,
  "res/gear2.glb",
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
    await page.waitForTimeout(1000)


    // 播放 faicad_motion 扩展动画（行星齿轮组运动），速度减半，只播放一遍
    await page.evaluate(() => {
      const ctrl = window.__faicadMotionController
      if (ctrl) {
        ctrl.setSpeed(0.2)
        ctrl._tween.repeat(0)
        ctrl.play()
      }
    })

    // lib.animateCamera(page, { rotate: 'y', angle: 180, duration: 4000, ease: 'none' })
    // await page.waitForTimeout(4000)

  },
)



