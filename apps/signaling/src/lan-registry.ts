import type { LanPeer } from '@peerlink/protocol';

const COLORS = ['红色', '蓝色', '绿色', '橙色', '紫色', '金色', '青色', '粉色'];
const ANIMALS = ['河马', '老虎', '熊猫', '海豚', '企鹅', '孔雀', '狐狸', '松鼠'];

export function generateDeviceName(rng: () => number = Math.random): string {
  const color = COLORS[Math.floor(rng() * COLORS.length)];
  const animal = ANIMALS[Math.floor(rng() * ANIMALS.length)];
  return `${color}${animal}`;
}

interface Entry {
  peerId: string;
  ipGroup: string;
  name: string;
}

/** 按公网 IP 分组的在线设备注册表（局域网发现用）。 */
export class LanRegistry {
  private byPeer = new Map<string, Entry>();

  add(peerId: string, ipGroup: string, name: string): void {
    this.byPeer.set(peerId, { peerId, ipGroup, name });
  }

  remove(peerId: string): void {
    this.byPeer.delete(peerId);
  }

  /** 与 peerId 同组的其他设备（用于推送 lan-peers）。 */
  peersFor(peerId: string): LanPeer[] {
    const self = this.byPeer.get(peerId);
    if (!self) return [];
    const peers: LanPeer[] = [];
    for (const e of this.byPeer.values()) {
      if (e.peerId !== peerId && e.ipGroup === self.ipGroup) {
        peers.push({ peerId: e.peerId, name: e.name });
      }
    }
    return peers;
  }

  /** 同组所有成员（含自己），用于向整组广播更新。 */
  groupMembers(peerId: string): string[] {
    const self = this.byPeer.get(peerId);
    if (!self) return [];
    return [...this.byPeer.values()]
      .filter(e => e.ipGroup === self.ipGroup)
      .map(e => e.peerId);
  }
}
