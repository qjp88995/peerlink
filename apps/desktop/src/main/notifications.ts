import { BrowserWindow, Notification } from 'electron';

export function showNotification(
  payload: { title: string; body: string; sessionId: string },
  getWindow: () => BrowserWindow | undefined
): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: payload.title, body: payload.body });
  n.on('click', () => {
    const win = getWindow();
    if (win) {
      win.show();
      win.focus();
      win.webContents.send('peerlink:activate-session', payload.sessionId);
    }
  });
  n.show();
}
