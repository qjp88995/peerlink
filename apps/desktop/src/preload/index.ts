import { contextBridge, ipcRenderer } from 'electron';

// 同步从主进程取启动配置（preload 早于页面脚本执行）
const bootstrap = ipcRenderer.sendSync('peerlink:bootstrap') as {
  signalUrl: string;
  signalDomain: string;
  ice: Record<string, string>;
};

const activateHandlers = new Set<(sessionId: string) => void>();
ipcRenderer.on('peerlink:activate-session', (_e, sessionId: string) => {
  activateHandlers.forEach(cb => cb(sessionId));
});

const configHandlers = new Set<(cfg: unknown) => void>();
ipcRenderer.on('peerlink:config-changed', (_e, cfg: unknown) => {
  configHandlers.forEach(cb => cb(cfg));
});

contextBridge.exposeInMainWorld('peerlink', {
  signalUrl: bootstrap.signalUrl,
  signalDomain: bootstrap.signalDomain,
  ice: bootstrap.ice,
  setSignalDomain: (domain: string) =>
    ipcRenderer.invoke('peerlink:set-signal-domain', domain),
  setIce: (ice: Record<string, string>) =>
    ipcRenderer.invoke('peerlink:set-ice', ice),
  onConfigChange: (cb: (cfg: unknown) => void) => {
    configHandlers.add(cb);
  },
  notify: (payload: {
    title: string;
    body: string;
    kind: 'message' | 'call';
    sessionId: string;
  }) => ipcRenderer.send('peerlink:notify', payload),
  onActivateSession: (cb: (sessionId: string) => void) => {
    activateHandlers.add(cb);
  },
});
