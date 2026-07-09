import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as lib from '../lib_3d_viewer_web.mjs'


const subtitle = `
大部分网上的行星齿轮组动画
行星轮是被支架固定住的，只有自转没有公转的
完成这样一个行星齿轮组的建模、装配和动画
使用传统的CAD软件
至少要半个小时以上
能力差的很可能还完不成任务
而我写这套系统
只需要一句话就能完成整个建模和动画了
关注我,了解更多进展
`;


lib.makeMovie(
  import.meta.url,
  "res/gear3.glb",
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
    await page.waitForTimeout(1000)
    // 模型绕 X 轴旋转 45°，使齿轮圆盘在屏幕上平放
    await lib.rotateModel(page, 180, 6000, { axis: [-1, 0, 0] })
    await page.waitForTimeout(1000)
    await lib.rotateModel(page, 180-45, 6000, { axis: [-1, 0, 0] })
    await page.waitForTimeout(500)

    // 播放 faicad_motion 扩展动画（行星齿轮组运动），速度减半，只播放一遍
    await page.evaluate(() => {
      const ctrl = window.__faicadMotionController
      if (ctrl) {
        ctrl.setSpeed(0.2)
        ctrl._tween.repeat(0)
        ctrl.play()
      }
    })
    await page.waitForTimeout(10000)

    // await page.evaluate(() => {
    //   const ctrl = window.__faicadMotionController
    //   if (ctrl) {
    //     ctrl.setSpeed(0.1)
    //     ctrl._tween.repeat(0)
    //     ctrl.play()
    //   }
    // })


  },
)



