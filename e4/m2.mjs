// e4/m2.mjs — 单张截图轮播视频（Path C：手写 scene 函数）
// 4句字幕共用 all24 一张图，高亮逐格移动
// 运行: node generate-html-video.mjs e4/m2.mjs

const subtitle = `
除了前面演示的7种新增格式
之前还支持25种3D模型文件格式
一共支持32种模型格式
FaiCAD是已知开源免费软件里，格式支持最完善的
`;

export function scene({ imagePath, width, height, duration, fps, index, startTime, totalDuration }) {
  const orient = width > height ? 'h' : 'v';
  const img = `../../capture/all24_${orient}.png`;
  const isH = orient === 'h';

  // 竖屏：居中光斑引导视线
  if (!isH) {
    // 竖屏网格布局：4列×6行
    const vCols = 4;
    const vRows = 6;
    // 1080×1920 canvas，每格居中位置
    const vColX = [60, 300, 540, 780];
    const vRowY = [60, 360, 660, 960, 1260, 1560];
    const vCellW = 240;
    const vCellH = 300;

    function vCellPos(idx) {
      const col = idx % vCols;
      const row = Math.floor(idx / vCols);
      return { x: vColX[col] + vCellW / 2, y: vRowY[row] + vCellH / 2 };
    }

    // 光斑：径向渐变圆，从亮白到橘黄渐变透明
    const glowHtml = `<div id="glow" style="position:absolute;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,0.35) 0%,rgba(255,220,100,0.2) 30%,rgba(255,150,0,0.08) 60%,transparent 80%);pointer-events:none;opacity:0;z-index:10;transform:translate(-50%,-50%)"></div>`;

    const baseHtml = `<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:#1a1a2e url('${img}') no-repeat center/contain"></div>`;

    const totalMoves = Math.floor(totalDuration);
    const fadeInEnd = 1.7;

    const html = baseHtml + glowHtml;
    let anim = '';

    if (index === 0) {
      anim += `  tl.from('#s0 > div:first-child', {opacity:0,duration:${fadeInEnd},ease:'power2.out'}, ${startTime.toFixed(3)});\n`;
    }

    const startCell = startTime >= fadeInEnd ? Math.floor(startTime - fadeInEnd) % 24 : 0;
    const p = vCellPos(startCell);
    anim += `  tl.set('#glow', {left:${p.x},top:${p.y},opacity:1}, ${startTime.toFixed(3)});\n`;

    for (let n = startCell + 1; n < startCell + 1 + totalMoves; n++) {
      const cellIdx = n % 24;
      const t = fadeInEnd + n;
      if (t < startTime + duration) {
        const p2 = vCellPos(cellIdx);
        anim += `  tl.to('#glow', {left:${p2.x},top:${p2.y},duration:0.3,ease:'power2.out'}, ${t.toFixed(3)});\n`;
      }
    }

    return { html, animation: anim };
  }

  // 网格布局（从实际图像分析得出）
  const cols = 6;
  const rows = 4;
  // 横屏 1920×1080: 6列×4行，每格 296×212，列间距 29px，行间距 274px
  const colX = [0, 325, 650, 975, 1300, 1625];
  const rowY = [0, 274, 548, 822];
  const cellW = 296;
  const cellH = 212;

  // 高亮框
  const highlightHtml = `<div id="hl" style="position:absolute;top:0;left:0;width:${cellW}px;height:${cellH}px;border:3px solid #ff6b35;box-shadow:0 0 20px rgba(255,107,53,0.6);border-radius:6px;pointer-events:none;opacity:0;z-index:10"></div>`;

  const baseHtml = `<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:#1a1a2e url('${img}') no-repeat center/contain"></div>`;

  // 计算每个格子左上角坐标
  function cellPos(idx) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    return { x: colX[col], y: rowY[row] };
  }

  const totalMoves = Math.floor(totalDuration);  // 每秒移动一次
  const fadeInEnd = 1.7;  // 淡入动画时长

  // 统一的高亮移动算法：绝对时间轴，cell 在 t 时刻 = Math.floor(t - fadeInEnd) % 24
  // 每个场景只生成自己时间范围内的移动
  const html = baseHtml + highlightHtml;
  let anim = '';

  if (index === 0) {
    // 第一张：all24 淡入
    anim += `  tl.from('#s0 > div:first-child', {opacity:0,duration:${fadeInEnd},ease:'power2.out'}, ${startTime.toFixed(3)});\n`;
  }

  // 当前场景起始时刻应高亮的格子
  const startCell = startTime >= fadeInEnd ? Math.floor(startTime - fadeInEnd) % 24 : 0;
  const p = cellPos(startCell);
  anim += `  tl.set('#hl', {left:${p.x},top:${p.y},opacity:1}, ${startTime.toFixed(3)});\n`;

  // 继续移动：绝对时间轴 t = fadeInEnd + n （n 为 cell 序号）
  // 从 startCell 的下一个开始，只生成当前场景时间范围内的移动
  for (let n = startCell + 1; n < startCell + 1 + totalMoves; n++) {
    const cellIdx = n % 24;
    const t = fadeInEnd + n;
    if (t < startTime + duration) {
      const p2 = cellPos(cellIdx);
      anim += `  tl.to('#hl', {left:${p2.x},top:${p2.y},duration:0.3,ease:'power2.out'}, ${t.toFixed(3)});\n`;
    }
  }

  return { html, animation: anim };
}