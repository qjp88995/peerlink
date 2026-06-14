import { join } from 'node:path';

import {
  BrowserWindow,
  desktopCapturer,
  type DesktopCapturerSource,
  ipcMain,
  type Session,
} from 'electron';

export interface PickerItem {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  dataUrl: string;
}

interface ThumbLike {
  toDataURL(): string;
}

/** 纯函数：源列表 → 选择器 UI 数据。 */
export function toPickerItems(
  sources: { id: string; name: string; thumbnail: ThumbLike }[]
): PickerItem[] {
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    dataUrl: s.thumbnail.toDataURL(),
  }));
}

/** 弹自带选择器窗口，resolve 用户选中的源（取消则 undefined）。 */
function openPicker(
  parent: BrowserWindow,
  sources: DesktopCapturerSource[]
): Promise<DesktopCapturerSource | undefined> {
  return new Promise(resolve => {
    const picker = new BrowserWindow({
      parent,
      modal: true,
      width: 720,
      height: 520,
      title: '选择共享内容',
      webPreferences: {
        preload: join(__dirname, 'picker-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    picker.loadFile(join(__dirname, 'picker.html'));

    const items = toPickerItems(sources);
    picker.webContents.once('did-finish-load', () => {
      picker.webContents.send('picker:items', items);
    });

    const onChoose = (_e: unknown, id: string | null) => {
      cleanup();
      resolve(id ? sources.find(s => s.id === id) : undefined);
      picker.close();
    };
    ipcMain.once('picker:choose', onChoose);
    function cleanup() {
      ipcMain.removeListener('picker:choose', onChoose);
    }
    picker.on('closed', () => {
      cleanup();
      resolve(undefined);
    });
  });
}

/** 注册屏幕共享 handler。macOS 支持时走系统选择器。 */
export function installScreenPicker(
  session: Session,
  getParent: () => BrowserWindow
): void {
  // 一次只开一个选择器：重入直接拒绝，避免两个 modal 叠加 + ipc 监听竞态
  let pickerOpen = false;
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      if (pickerOpen) {
        callback({});
        return;
      }
      desktopCapturer
        .getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 200 },
        })
        .then(async sources => {
          pickerOpen = true;
          try {
            const chosen = await openPicker(getParent(), sources);
            // chosen 为空 → 传空对象，前端 getDisplayMedia 将 reject
            callback(chosen ? { video: chosen } : {});
          } finally {
            pickerOpen = false;
          }
        })
        // 取源失败也要回调，否则前端 getDisplayMedia 永挂
        .catch(() => callback({}));
    },
    { useSystemPicker: true }
  );
}
