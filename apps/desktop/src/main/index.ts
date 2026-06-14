import { app, BrowserWindow } from 'electron';

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1100, height: 760 });
  win.loadURL('data:text/html,<h1>PeerLink desktop scaffold</h1>');
});
