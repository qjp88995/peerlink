import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('picker', {
  onItems: (cb: (items: unknown) => void) =>
    ipcRenderer.on('picker:items', (_e, items) => cb(items)),
  choose: (id: string | null) => ipcRenderer.send('picker:choose', id),
});
