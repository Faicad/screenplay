const subtitle = `
我先丢给它一张屏幕截图，然后问它
你能否识别这张图
图中齿轮有错位
如果你能看到是哪里的问题，告诉我
我没让它一上来就解决问题
因为它要是发现不了问题
我就打算直接放弃
因为混元3的优势在于多模态，可识别图像
但是模型本身参数太少
我不相信它的纯编程能力
`;


const image_config = [
  {
    image: 'screenshot/gear1',
    description: '',
    anim: [
      {
        type: 'overlay-image',
        image: 'screenshot/gear.png',
        triggerAt: 1.5,
        width: 500,
        height: 500,
        position: 'center',
        top: { h: 120, v: -150 },
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"你能否识别这张图"',
    anim: [
      {
        type: 'highlight-area',
        selector: '你能否识别这张图',
        triggerAt: 0,
        duration: 2.3,
        color: '#ff0000',
        padding: 0,
        highlightMs: 2300,
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"但是齿轮有错位"',
    anim: [
      {
        type: 'highlight-area',
        selector: '但是齿轮有错位',
        triggerAt: 0,
        duration: 2.2,
        color: '#ff0000',
        padding: 0,
        highlightMs: 2200,
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"如果你能看到是哪里的问题，告诉我"',
    anim: [
      {
        type: 'highlight-area',
        selector: '如果你能看到是哪里的问题，告诉我',
        triggerAt: 0,
        duration: 3.6,
        color: '#ff0000',
        padding: 0,
        highlightMs: 3600,
      },
    ],
  },
  {
    image: '',
    description: '',
  },
  {
    image: '',
    description: '',
  },
  {
    image: '',
    description: '',
  },
  {
    image: '',
    description: '',
  },
  {
    image: '',
    description: '',
  },
  {
    image: '',
    description: '',
  },
];
