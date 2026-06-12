/** 微信式语音时长：<60s 显示 `N"`，≥60s 显示 `M'SS"`。 */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}"`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}'${s.toString().padStart(2, '0')}"`;
}
