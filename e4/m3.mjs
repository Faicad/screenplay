
const subtitle = `
求关注、求转发、求收藏
`;

const image_config = [
  {
    image: 'e4/capture/all24',
    description: '第0秒淡入半透明蒙版，第1秒上方显示字幕动画',
    anim: [
      {
        type: 'overlay-image',
        image: 'capture/overlay.png',
        triggerAt: 0,
        duration: 0.8,
        width: 2000,
        height: 2000,
        position: 'center',
      },
      {
        type: 'caption',
        text: 'Faicad.cn',
        split: ['Fai', 'cad', ' .cn'],
        triggerAt: 0, 
        duration: 2.4,
        top: { h: 30, v: 38 },
        fontSize: { h: 120, v: 120 },
        color: '#ff6b35',
        align: { h: 'center', v: 'center' },
        pad: { h: 5, v: 8 },
      },
    ],
  },

];
