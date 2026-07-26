
const subtitle = `
我想快速浏览很多svg图片
比如这个文件夹里的所有图片
但是windows却不支持
`;

const image_config = [
  {
    image: 'e5/1',
    description: '',
    anim: [
      {
        // type: 'scroll-down',
        // speed: 0.02,
      },
    ],
  },
  {
    image: 'e5/3',
    description: '显示Windows预览区域提示"没有预览"，高亮该文字',
    anim: [
      {
        type: 'highlight-area',
        selector: '没有预览',
        triggerAt: 0.3,
        highlightMs: 1500,
        flashCount: 2,
        padding: 10,
        borderWidth: 6,
        persist: true,
      },
    ],
  },
  {
    image: '',
    description: '在"没有预览"文字上方添加红色大字幕"没有预览"',
    anim: [
      {
        type: 'caption',
        text: '没有预览',
        triggerAt: 0.3,
        duration: 2.3,
        relativeTo: 'mark',
        markSelector: '没有预览',
        offsetY: 15,
        fontSize: { h: 64, v: 56 },
        color: '#ff3333',
      },
    ],
  },
];
