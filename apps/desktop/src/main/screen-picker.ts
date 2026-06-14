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
      webPreferences: { preload: join(__dirname, 'picker-preload.cjs') },
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
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 200 },
        })
        .then(async sources => {
          const chosen = await openPicker(getParent(), sources);
          callback(chosen ? { video: chosen } : {});
        });
    },
    { useSystemPicker: true }
  );
}
