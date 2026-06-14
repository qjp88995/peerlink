import { useState } from 'react';

import { getBridge } from '@/lib/desktop-bridge';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const bridge = getBridge();
  const [domain, setDomain] = useState(bridge?.signalDomain ?? '');
  const [stun, setStun] = useState(bridge?.ice.stunUrls ?? '');
  const [turnUrl, setTurnUrl] = useState(bridge?.ice.turnUrl ?? '');
  const [turnUser, setTurnUser] = useState(bridge?.ice.turnUsername ?? '');
  const [turnCred, setTurnCred] = useState(bridge?.ice.turnCredential ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bridge) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await bridge!.setIce({
        stunUrls: stun,
        turnUrl,
        turnUsername: turnUser,
        turnCredential: turnCred,
      });
      await bridge!.setSignalDomain(domain); // 经 onConfigChange 即时生效，不重载
      onClose(); // 成功才关闭
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请检查域名格式');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-120 rounded-lg bg-surface p-6 text-sm">
        <h2 className="mb-4 text-base font-semibold">设置</h2>

        <label className="mb-1 block text-fg-muted">信令服务器域名</label>
        <input
          className="mb-1 w-full rounded-md border border-line bg-transparent px-3 py-2"
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="peerlink.qinjiapeng.com"
        />
        <p className="mb-4 text-xs text-fg-muted">
          只填域名即可，应用会自动补全 wss:// 与
          /signal。保存后会立即用新地址重连。
        </p>

        <label className="mb-1 block text-fg-muted">
          STUN（逗号分隔，可空）
        </label>
        <input
          className="mb-3 w-full rounded-md border border-line bg-transparent px-3 py-2"
          value={stun}
          onChange={e => setStun(e.target.value)}
        />

        <label className="mb-1 block text-fg-muted">TURN URL（可空）</label>
        <input
          className="mb-3 w-full rounded-md border border-line bg-transparent px-3 py-2"
          value={turnUrl}
          onChange={e => setTurnUrl(e.target.value)}
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <input
            className="rounded-md border border-line bg-transparent px-3 py-2"
            placeholder="TURN 用户名"
            value={turnUser}
            onChange={e => setTurnUser(e.target.value)}
          />
          <input
            className="rounded-md border border-line bg-transparent px-3 py-2"
            placeholder="TURN 凭据"
            value={turnCred}
            onChange={e => setTurnCred(e.target.value)}
          />
        </div>

        {error && <p className="mb-3 text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            className="rounded-md px-4 py-2 text-fg-muted"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="rounded-md bg-signal px-4 py-2 font-medium text-ink disabled:opacity-50"
            disabled={saving}
            onClick={save}
          >
            {saving ? '保存并重连…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
