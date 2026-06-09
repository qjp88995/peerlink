type ProgressFn = (received: number, total: number) => void;

/**
 * 节流进度回调：传输循环每个分片都会上报进度，但若每次都触发 store/React 重渲染，
 * 渲染速率会反过来钉死传输速率（loopback 下尤其明显）。这里把回调限制为至多每
 * `intervalMs` 一次，并保证最终值（received >= total）必定上报，使进度条仍能到 100%。
 */
export function throttleProgress(
  fn: ProgressFn | undefined,
  intervalMs = 100
): ProgressFn | undefined {
  if (!fn) return fn;
  let last = 0;
  return (received, total) => {
    const now = Date.now();
    if (received >= total || now - last >= intervalMs) {
      last = now;
      fn(received, total);
    }
  };
}
