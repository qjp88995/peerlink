import { describe, expect, it } from 'vitest';

import { toPickerItems } from './screen-picker';

describe('toPickerItems', () => {
  it('把 desktopCapturer 源映射为选择器条目', () => {
    const sources = [
      { id: 'screen:0', name: 'Entire Screen', thumbnail: fakeThumb('a') },
      { id: 'window:12', name: 'VS Code', thumbnail: fakeThumb('b') },
    ];
    expect(toPickerItems(sources)).toEqual([
      {
        id: 'screen:0',
        name: 'Entire Screen',
        kind: 'screen',
        dataUrl: 'data:a',
      },
      { id: 'window:12', name: 'VS Code', kind: 'window', dataUrl: 'data:b' },
    ]);
  });
});

function fakeThumb(s: string) {
  return { toDataURL: () => `data:${s}` };
}
