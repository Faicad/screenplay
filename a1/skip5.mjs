const subtitle = `
我就让它尝试解决
中间经过了三轮尝试
前面两轮它受到了之前遗留的错误方案的影响，走了弯路
`;

const image_config = [
  {
    image: 'screenshot/gear3',
    description: '',
  },
  {
    image: '',
    description: '高亮显示"每个行星轮放置时"',
    anim: [
      {
        type: 'highlight-area',
        selector: '每个行星轮放置时',
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
    description: '高亮显示"加上旋转变换即可"',
    anim: [
      {
        type: 'highlight-area',
        selector: '加上旋转变换即可',
        triggerAt: 0,
        duration: 3.5,
        highlightMs: 3500,
        color: '#ff0000',
        padding: 8,
      },
    ],
  },
];
