import { readFile } from 'node:fs/promises';
import { normalize, sep } from 'node:path';

import { protocol } from 'electron';

export const APP_SCHEME = 'app';
const APP_ORIGIN = 'app://peerlink';

/** 把 app:// 请求 URL 映射到 renderer 根目录下的磁盘路径；越界或无扩展名回退 index.html。 */
export function resolveRendererPath(
  rendererRoot: string,
  requestUrl: string
): string {
  const { pathname } = new URL(requestUrl);
  const decoded = decodeURIComponent(pathname);
  const indexHtml = `${rendererRoot}${sep}index.html`;

  // 拒绝原始 URL 中含编码 dot 序列（%2e / %2E）的路径——防编码穿越攻击。
  // URL 构造器会将 %2e%2e 当作 .. 折叠，导致 pathname 看似无害；
  // 在此提前从原始字符串截断检查。
  const rawPath = requestUrl.slice(requestUrl.indexOf('/', requestUrl.indexOf('//') + 2));
  if (/%2e/i.test(rawPath)) return indexHtml;

  // 无扩展名 → 视为 SPA 客户端路由，回退 index.html
  const hasExt = /\.[a-z0-9]+$/i.test(decoded);
  if (decoded === '/' || decoded === '' || !hasExt) return indexHtml;

  const candidate = normalize(`${rendererRoot}${decoded}`);
  // 防目录穿越：必须仍在 root 下
  if (!candidate.startsWith(rendererRoot + sep)) return indexHtml;
  return candidate;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/** 必须在 app.whenReady 之前调用，把 app:// 注册成标准+安全 scheme。 */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export function registerAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, async request => {
    const filePath = resolveRendererPath(rendererRoot, request.url);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    try {
      const data = await readFile(filePath);
      return new Response(data, {
        headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

export { APP_ORIGIN };
