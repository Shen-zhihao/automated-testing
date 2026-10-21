export const APP_DISPLAY_NAME = '序舟';

export function applicationMenuTemplate(platform = process.platform) {
  const isMac = platform === 'darwin';
  // 保留原生 role 的行为与平台快捷键，显式提供每一级菜单的中文名称。
  return [
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            role: 'appMenu',
            submenu: [
              { label: `关于${APP_DISPLAY_NAME}`, role: 'about' },
              { type: 'separator' },
              { label: '服务', role: 'services' },
              { type: 'separator' },
              { label: `隐藏${APP_DISPLAY_NAME}`, role: 'hide' },
              { label: '隐藏其他应用', role: 'hideOthers' },
              { label: '显示全部', role: 'unhide' },
              { type: 'separator' },
              { label: `退出${APP_DISPLAY_NAME}`, role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        ...(isMac ? [{ label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' }] : []),
        { label: '删除', role: 'delete' },
        ...(!isMac ? [{ type: 'separator' }] : []),
        { label: '全选', role: 'selectAll' },
        ...(isMac
          ? [
              { type: 'separator' },
              {
                label: '文字替换',
                submenu: [
                  { label: '显示替换选项', role: 'showSubstitutions' },
                  { type: 'separator' },
                  { label: '智能引号', role: 'toggleSmartQuotes' },
                  { label: '智能破折号', role: 'toggleSmartDashes' },
                  { label: '文本替换', role: 'toggleTextReplacement' },
                ],
              },
              {
                label: '朗读',
                submenu: [
                  { label: '开始朗读', role: 'startSpeaking' },
                  { label: '停止朗读', role: 'stopSpeaking' },
                ],
              },
            ]
          : []),
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '切换开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      role: 'windowMenu',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '缩放窗口', role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' }, { label: '全部置于前台', role: 'front' }]
          : [{ label: '关闭窗口', role: 'close' }]),
      ],
    },
  ];
}
