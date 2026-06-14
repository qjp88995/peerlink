import { join } from 'node:path';

import { app, BrowserWindow, ipcMain } from 'electron';

import {
  APP_ORIGIN,
  registerAppProtocol,
  registerSchemePrivileges,
} from './app-protocol';
import { ConfigStore, type IceConfig } from './config-store';
import { installScreenPicker } from './screen-picker';
import { domainFromSignalUrl } from './signal-url';

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

registerSchemePrivileges();

let mainWindow: BrowserWindow | undefined;
let config: ConfigStore;

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

  if (!isDev) registerAppProtocol(join(__dirname, 'renderer'));
  createWindow();
});

app.on('window-all-closed', () => {
  // Task 6 会改成"关窗到托盘不退出"；当前先保留默认。
  if (process.platform !== 'darwin') app.quit();
});

export { config, mainWindow };
