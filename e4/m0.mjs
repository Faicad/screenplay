
const subtitle = `
windows已经放弃了内置的3D查看器软件
上个视频，我推荐了一款免费的替代款
支持25种3D模型
`;

const image_config = [
  {
    image: 'screenshot/3dd',
    description: '"已不再受支持"高亮，然后加载3d_viewer图片叠加放大',
    anim: [
      {
        type: 'highlight-area',
        selector: '已不再受支持',
        triggerAt: 2.0,
        highlightMs: 99999,
        padding: 5,
        color: '#007aff',
        borderWidth: 9,
        flashCount: 2,
        holdDuration: 9,
      },
    ],
  },
  {
    image: '',
    description: '',
    anim: [
      {
        type: 'overlay-image',
        image: '../screenshot/3d_viewer.png',
        zoomIn: true,
        triggerAt: 0,
        duration: 4,
        ease: 'power4.out',
      },
    ],
  },
  {
    image: '',
    description: '',
    anim: [
    ],
  },
];
