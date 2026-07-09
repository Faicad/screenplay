const subtitle = `
结果，它真的自己发现了问题
{zh-CN-YunxiaNeural}从截图可以看到
{zh-CN-YunxiaNeural}只有右侧的行星齿轮0(planet_0)的齿大致对上了
{zh-CN-YunxiaNeural}行星齿轮1(planet_1) 和齿轮2(planet_2)明显错位
好吧，既然能发现问题，看来有戏
`;


const image_config = [
  {
    image: 'screenshot/gear2',
    description: '',
    anim: [
      {
        type: 'overlay-image',
        image: 'screenshot/gear.png',
        triggerAt: 0,
        width: 500,
        height: 500,
        position: 'center',
        top: { h: 120, v: -150 },
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"从截图可以看到"',
    anim: [
      {
        type: 'highlight-area',
        selector: '从截图可以看到',
        triggerAt: 0,
        duration: 2.0,
        highlightMs: 2000,
        color: '#ff0000',
        padding: 8,
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"planet_0"',
    anim: [
      {
        type: 'highlight-area',
        selector: 'planet_0',
        triggerAt: 0,
        duration: 3.8,
        highlightMs: 3800,
        color: '#ff0000',
        padding: 8,
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"planet_1 和 planet_2 明显错位"',
    anim: [
      {
        type: 'highlight-area',
        selector: 'planet_1',
        triggerAt: 0,
        duration: 3.0,
        highlightMs: 3000,
        color: '#ff0000',
        padding: 8,
      },
    ],
  },
  {
    image: '',
    description: '',
  },
];
