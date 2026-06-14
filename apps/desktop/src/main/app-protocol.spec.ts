import { describe, expect, it } from 'vitest';

import { resolveRendererPath } from './app-protocol';

const ROOT = '/app/renderer';

describe('resolveRendererPath', () => {
  it('根路径返回 index.html', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/')).toBe(
      '/app/renderer/index.html'
    );
  });
  it('带扩展名的资源原样解析', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/assets/main-abc.js')).toBe(
      '/app/renderer/assets/main-abc.js'
    );
  });
  it('无扩展名的客户端路由回退 index.html（支持刷新/深链）', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/room/xyz')).toBe(
      '/app/renderer/index.html'
    );
  });
  it('阻止目录穿越（无扩展名 → 回退 index.html）', () => {
    expect(resolveRendererPath(ROOT, 'app://peerlink/../../etc/passwd')).toBe(
      '/app/renderer/index.html'
    );
  });
  it('编码穿越（%2e%2e + 扩展名）被 startsWith 守卫拦回 index.html', () => {
    // URL 会折叠明文 ..，故用编码点构造解码后越界，专门验证 startsWith 守卫
    expect(resolveRendererPath(ROOT, 'app://peerlink/%2e%2e/secret.js')).toBe(
      '/app/renderer/index.html'
    );
  });
});
