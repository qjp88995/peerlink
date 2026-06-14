import { join } from 'node:path';

import { app, BrowserWindow, Menu, Tray } from 'electron';

let tray: Tray | undefined;

interface TrayDeps {
  getWindow: () => BrowserWindow | undefined;
  isQuitting: () => boolean;
  requestQuit: () => void;
}

export function setupTray(deps: TrayDeps): void {
  tray = new Tray(join(__dirname, 'tray-icon.png'));
  tray.setToolTip('PeerLink');
  const show = () => {
    const win = deps.getWindow();
    if (win) {
      win.show();
      win.focus();
    }
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 PeerLink', click: show },
      { type: 'separator' },
      { label: '退出', click: () => deps.requestQuit() },
    ])
  );
  tray.on('click', show);
}

/** 拦截关窗：隐藏到托盘而非退出；真正退出由托盘菜单触发。 */
export function wireCloseToTray(
  win: BrowserWindow,
  isQuitting: () => boolean
): void {
  win.on('close', e => {
    if (!isQuitting()) {
      e.preventDefault();
      win.hide();
      if (process.platform === 'darwin') app.dock?.hide();
    }
  });
}
