/** 把用户填的域名/URL 规范化为前端可直接用的 ws(s) 信令地址。 */
export function normalizeSignalDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('signal domain is empty');

  // 补协议，便于用 URL 解析；裸域名默认按安全协议处理。
  const withProto = /^[a-zA-Z]+:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProto);

  const wsProto =
    url.protocol === 'http:' || url.protocol === 'ws:' ? 'ws' : 'wss';
  const path =
    url.pathname === '/' || url.pathname === '' ? '/signal' : url.pathname;
  return `${wsProto}://${url.host}${path}`;
}

/** 反解：从规范化后的 ws URL 取出供设置面板展示的域名（默认路径则隐藏）。 */
export function domainFromSignalUrl(signalUrl: string): string {
  const url = new URL(signalUrl);
  const path = url.pathname === '/signal' ? '' : url.pathname;
  return `${url.host}${path}`;
}
