import { join } from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import {
  APP_ORIGIN,
  registerAppProtocol,
  registerSchemePrivileges,
} from './app-protocol';
import { ConfigStore, type IceConfig } from './config-store';
import { showNotification } from './notifications';
import { installScreenPicker } from './screen-picker';
import { domainFromSignalUrl } from './signal-url';
import { setupTray, wireCloseToTray } from './tray';

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

registerSchemePrivileges();

let mainWindow: BrowserWindow | undefined;
let config: ConfigStore;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.on('before-quit', () => {
  quitting = true;
});

function currentBootstrap() {
  const c = config.get();
  return {
    signalUrl: c.signalUrl,
    signalDomain: domainFromSignalUrl(c.signalUrl),
    ice: c.ice,
  };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 提示音 / 振铃用 WebAudio + <audio>，且常在非用户手势时触发（来消息），
      // 关掉自动播放手势限制，否则首次播放会被静默拦截。
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/`);
  }
  installScreenPicker(mainWindow.webContents.session, () => mainWindow!);
  wireCloseToTray(mainWindow, () => quitting);
}

app.whenReady().then(() => {
  config = new ConfigStore(join(app.getPath('userData'), 'config.json'));

  ipcMain.on('peerlink:bootstrap', e => {
    e.returnValue = currentBootstrap();
  });
  ipcMain.handle('peerlink:set-signal-domain', (_e, domain: string) => {
    config.setSignalDomain(domain);
    mainWindow?.webContents.send('peerlink:config-changed', currentBootstrap());
  });
  ipcMain.handle('peerlink:set-ice', (_e, ice: IceConfig) => {
    config.setIce(ice);
    mainWindow?.webContents.send('peerlink:config-changed', currentBootstrap());
  });
  ipcMain.on(
    'peerlink:notify',
    (_e, payload: { title: string; body: string; sessionId: string }) =>
      showNotification(payload, () => mainWindow)
  );

  if (!isDev) registerAppProtocol(join(__dirname, 'renderer'));
  createWindow();

  setupTray({
    getWindow: () => mainWindow,
    isQuitting: () => quitting,
    requestQuit: () => {
      quitting = true;
      app.quit();
    },
  });
});

app.on('window-all-closed', () => {
  // 后台常驻：不退出。退出只经托盘菜单 → before-quit → quit。
});

app.on('activate', () => {
  mainWindow?.show();
  app.dock?.show();
});

export { config, mainWindow };
