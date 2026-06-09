import { describe, expect, it } from 'vitest';

import { generateDeviceName, LanRegistry } from './lan-registry';

describe('generateDeviceName', () => {
  it('combines a color and an animal', () => {
    const name = generateDeviceName(() => 0);
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(1);
  });
});

describe('LanRegistry', () => {
  it('lists peers in the same ip group, excluding the asker', () => {
    const r = new LanRegistry();
    r.add('p1', '1.2.3.4', '红色河马');
    r.add('p2', '1.2.3.4', '蓝色老虎');
    r.add('p3', '9.9.9.9', '绿色熊猫');
    expect(r.peersFor('p1')).toEqual([{ peerId: 'p2', name: '蓝色老虎' }]);
    expect(r.peersFor('p3')).toEqual([]);
  });

  it('groupMembers returns all peerIds sharing the asker group', () => {
    const r = new LanRegistry();
    r.add('p1', '1.2.3.4', 'a');
    r.add('p2', '1.2.3.4', 'b');
    expect(r.groupMembers('p1').sort()).toEqual(['p1', 'p2']);
  });

  it('remove drops the peer from its group', () => {
    const r = new LanRegistry();
    r.add('p1', '1.2.3.4', 'a');
    r.add('p2', '1.2.3.4', 'b');
    r.remove('p2');
    expect(r.peersFor('p1')).toEqual([]);
  });
});
