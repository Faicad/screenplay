
const subtitle = `
使用方法也很简单
下载和安装Faicad 3D查看器这个软件
然后用它打开一个svg文件即可
`;

const image_config = [
  {
    image: 'e5/s1',
    description: '',
    anim: [
      {
        // type: 'scroll-down',
        // speed: 0.02,
      },
    ],
  },
  {
    image: '',
    description: '',
    anim: [],
  },
  {
    image: 'e5/3',
    description: '鼠标移动到"add_modifier.svg"这个高亮的区块并点击的动画',
    anim: [
      {
        type: 'move-click',
        selector: 'add_modifier.svg',
        triggerAt: 0.3,
        moveMs: 1000,
        distanceY: { h: 324, v: 576 },
      },
    ],
  },
];
