const subtitle = `
最后，我提示它
还是不对。你再仔细分析一下
正确的代码应该如何写
正确的动画文件应该是什么内容
它完全重新思考以后
抛弃了错误的路线，把问题解决了
`;


const image_config = [
  {
    image: 'screenshot/gear4',
    description: '',
  },
  {
    image: '',
    description: '高亮显示"还是不对。你再仔细分析一下"',
    anim: [
      {
        type: 'highlight-area',
        selector: '还是不对。你再仔细分析一下',
        triggerAt: 0,
        duration: 3.80,
        color: '#ff0000',
        padding: 0,
        highlightMs: 3800,
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"正确的代码应该如何写"',
    anim: [
      {
        type: 'highlight-area',
        selector: '正确的代码应该如何写',
        triggerAt: 0,
        duration: 2.96,
        color: '#ff0000',
        padding: 0,
        highlightMs: 2960,
      },
    ],
  },
  {
    image: '',
    description: '高亮显示"正确的应该是"',
    anim: [
      {
        type: 'highlight-area',
        selector: '正确的应该是',
        triggerAt: 0,
        duration: 3.44,
        color: '#ff0000',
        padding: 0,
        highlightMs: 3440,
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
]