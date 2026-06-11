# Disconnected 宽限期重连 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WebRTC `disconnected` 这一可自愈瞬态不再立即终结会话,给 15s 宽限期等待自愈,期间以 `reconnecting` 状态在 UI 提示;仅 `failed`/`closed`/超时才关闭会话。

**Architecture:** 纯 `apps/web` 客户端改动。核心是 `startConversation()` 内 `onStateChange` 回调从"三态合一立即 teardown"改为按 ICE 状态语义分流 + 一个宽限计时器。`Connection` 联合类型新增 `reconnecting`,经现有 `onConnection` 回调 → zustand store → UI。UI 层只需补一处状态文案与一条提示条(Composer 在 `reconnecting` 时已天然禁用)。

**Tech Stack:** TypeScript, React 19, Vitest(jsdom + fake timers), zustand。不触及 `packages/protocol` 与 `apps/signaling`。

设计文档:`docs/superpowers/specs/2026-06-11-disconnected-grace-reconnect-design.md`

---

## File Structure

- `apps/web/src/core/conversation.ts` — 核心逻辑。`Connection` 类型扩展、模块级 `GRACE_MS` 常量、`startConversation()` 内宽限计时器与 `onStateChange` 分流、`teardown()` 清理计时器。
- `apps/web/src/core/start-conversation.spec.ts` — 核心逻辑测试(已有文件,追加用例,引入 fake timers)。
- `apps/web/src/features/chat/conversation-list.helpers.ts` — `statusHint` 增 `reconnecting` 文案。
- `apps/web/src/features/chat/conversation-list.helpers.spec.ts` — 追加 `reconnecting` 断言(已有文件)。
- `apps/web/src/features/chat/ConversationView.tsx` — `reconnecting` 时顶部提示条(Composer 已自动禁用)。

---

## Task 1: 核心宽限期逻辑与 `Connection` 类型扩展

**Files:**

- Modify: `apps/web/src/core/conversation.ts:29-35`(`Connection` 类型)、`:314-344`(`buildPeer` 的 `onStateChange` 与 `teardown`)
- Test: `apps/web/src/core/start-conversation.spec.ts`(追加用例)

- [ ] **Step 1: 扩展 `Connection` 类型**

把 `apps/web/src/core/conversation.ts:29-35` 的 `Connection` 联合类型改为:

```ts
export type Connection =
  | 'idle'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'error';
```

- [ ] **Step 2: 写失败测试(追加到 start-conversation.spec.ts)**

在 `apps/web/src/core/start-conversation.spec.ts` 顶部 import 增加 `beforeEach`/`afterEach`(已有 `describe, expect, it, vi`),即:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

在文件末尾 `describe('startConversation teardown', ...)` 之后,新增一个 describe 块。注意 `makeCallbacks()` 与 `mocks` 已在文件内定义,直接复用:

```ts
describe('startConversation reconnecting grace period', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function bootPeer() {
    const cb = makeCallbacks();
    const handle = startConversation({ mode: 'create' }, cb);
    const sig = mocks.sigs.at(-1)!;
    sig.emit('open');
    sig.emit('peer-joined', 'peer-x'); // synchronously builds the peer
    const peer = mocks.peers.at(-1)!;
    return { cb, handle, sig, peer };
  }

  it('enters reconnecting on disconnected without tearing down', () => {
    const { cb, sig, peer } = bootPeer();
    peer.opts.onStateChange('disconnected');
    expect(cb.onConnection).toHaveBeenLastCalledWith('reconnecting');
    expect(peer.closeCount).toBe(0);
    expect(sig.closeCount).toBe(0);
  });

  it('restores to connected when ICE recovers within the grace window', () => {
    const { cb, sig, peer } = bootPeer();
    peer.opts.onStateChange('disconnected');
    peer.opts.onStateChange('connected');
    expect(cb.onConnection).toHaveBeenLastCalledWith('connected');
    vi.advanceTimersByTime(20_000);
    expect(peer.closeCount).toBe(0);
    expect(sig.closeCount).toBe(0);
  });

  it('tears down when the grace window expires while still disconnected', () => {
    const { sig, peer } = bootPeer();
    peer.opts.onStateChange('disconnected');
    vi.advanceTimersByTime(15_000);
    expect(peer.closeCount).toBe(1);
    expect(sig.closeCount).toBe(1);
  });

  it('tears down immediately on failed without waiting for the grace window', () => {
    const { sig, peer } = bootPeer();
    peer.opts.onStateChange('disconnected');
    peer.opts.onStateChange('failed');
    expect(peer.closeCount).toBe(1);
    expect(sig.closeCount).toBe(1);
  });

  it('clears the grace timer on close() so it does not tear down twice', () => {
    const { handle, peer } = bootPeer();
    peer.opts.onStateChange('disconnected');
    handle.close();
    expect(peer.closeCount).toBe(1);
    vi.advanceTimersByTime(20_000);
    expect(peer.closeCount).toBe(1); // timer cleared, no second teardown
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- start-conversation`
Expected: 新增 5 个用例 FAIL(当前 `disconnected` 会立即 teardown,且无 `reconnecting`/计时器逻辑);原有 2 个 teardown 用例仍 PASS。

- [ ] **Step 4: 实现宽限期逻辑**

在 `apps/web/src/core/conversation.ts` 模块顶部(`Connection` 类型定义附近,约第 28 行之前)新增常量:

```ts
/** disconnected 自愈宽限期：超时仍未恢复才关闭会话。 */
const GRACE_MS = 15_000;
```

在 `startConversation()` 内、`buildPeer` 之前(约第 313 行,`const send = ...` 之后)新增计时器状态与清理函数:

```ts
let graceTimer: ReturnType<typeof setTimeout> | undefined;
function clearGraceTimer() {
  if (graceTimer !== undefined) {
    clearTimeout(graceTimer);
    graceTimer = undefined;
  }
}
```

把 `buildPeer` 内的 `onStateChange`(当前 `apps/web/src/core/conversation.ts:323-332`)整体替换为:

```ts
onStateChange: state => {
  // connected/completed：仅当处于宽限期时视为自愈成功，恢复 UI。
  if (state === 'connected' || state === 'completed') {
    if (graceTimer !== undefined) {
      clearGraceTimer();
      callbacks.onConnection?.('connected');
    }
    return;
  }
  // disconnected：非终态，给宽限期等待自愈，不立即 teardown。
  if (state === 'disconnected') {
    if (torndown || graceTimer !== undefined) return;
    callbacks.onConnection?.('reconnecting');
    graceTimer = setTimeout(() => {
      graceTimer = undefined;
      conv.closeRemote();
      teardown();
    }, GRACE_MS);
    return;
  }
  // failed/closed：终态，立即关闭。
  if (state === 'failed' || state === 'closed') {
    clearGraceTimer();
    conv.closeRemote();
    teardown();
  }
},
```

把 `teardown()`(当前 `apps/web/src/core/conversation.ts:339-344`)加一行计时器清理:

```ts
function teardown() {
  if (torndown) return;
  torndown = true;
  clearGraceTimer();
  peer?.close();
  sig.close();
}
```

注意:`torndown` 声明在 `teardown` 之上(当前第 338 行 `let torndown = false;`),而 `onStateChange` 在 `buildPeer` 内闭包引用 `torndown`/`graceTimer`/`teardown`,三者均在同一 `startConversation` 作用域,引用顺序无问题(`onStateChange` 在运行时才被调用)。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- start-conversation`
Expected: 全部 PASS(原 2 + 新 5 = 7 个用例)。

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/core/conversation.ts apps/web/src/core/start-conversation.spec.ts
git commit -m "feat(web): grace period for ICE disconnected before tearing down session"
```

---

## Task 2: 会话列表状态文案(`reconnecting`)

**Files:**

- Modify: `apps/web/src/features/chat/conversation-list.helpers.ts:8-23`(`statusHint`)
- Test: `apps/web/src/features/chat/conversation-list.helpers.spec.ts`

说明:`statusTone`(helpers.ts:37-41)的 default 分支已对非 `connected`/`closed`/`error` 返回 `'pending'`,故 `reconnecting` 天然映射为 `pending`(品牌橙点,区别于 connected 绿、closed 灰)——**无需改 `statusTone`**,仅补 `statusHint` 文案并加测试锁定行为。

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/features/chat/conversation-list.helpers.spec.ts` 现有的 `it('maps connection to a status tone', ...)` 块(当前 :66-72)末尾,在 `expect(statusTone('error')).toBe('dead');` 之后追加一行:

```ts
expect(statusTone('reconnecting')).toBe('pending');
```

先把 `statusHint` 加进文件顶部 import(当前 :5-9 从 `'./conversation-list.helpers'` 只导入了 `lastPreview, sessionName, statusTone`,未含 `statusHint`):

```ts
import {
  lastPreview,
  sessionName,
  statusHint,
  statusTone,
} from './conversation-list.helpers';
```

`statusHint` 当前无独立测试块,在 `it('maps connection to a status tone', ...)` 块之后(:72 的 `});` 之后)新增一个 `it`:

```ts
it('maps connection to a status hint', () => {
  expect(statusHint('reconnecting')).toBe('重连中…');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation-list.helpers`
Expected: `statusHint('reconnecting')` 断言 FAIL(当前 default 返回 `''`);`statusTone('reconnecting')` 断言 PASS(default 已返回 `'pending'`)。

- [ ] **Step 3: 实现 `statusHint` 文案**

在 `apps/web/src/features/chat/conversation-list.helpers.ts` 的 `statusHint` switch 中,`case 'connected'` 之后新增:

```ts
    case 'reconnecting':
      return '重连中…';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation-list.helpers`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/chat/conversation-list.helpers.ts apps/web/src/features/chat/conversation-list.helpers.spec.ts
git commit -m "feat(web): show reconnecting status hint in conversation list"
```

---

## Task 3: 会话详情提示条

**Files:**

- Modify: `apps/web/src/features/chat/ConversationView.tsx:75-91`(主返回 JSX)

说明:`ConversationView.tsx:73` 的 `const connected = session.connection === 'connected'` 使 `reconnecting` 时 `connected === false`,Composer(`:85-89`)已 `disabled={!connected}` 自动禁用——**无需改 Composer**,只在 Timeline 之上加一条提示条。本任务为 UI 呈现,项目无 React 组件测试(无 `@testing-library`),走 typecheck + 用户手测验证。

- [ ] **Step 1: 加提示条**

把 `apps/web/src/features/chat/ConversationView.tsx` 主返回(当前 `:75-91`)改为在 `<MobileHeader>` 与 `<Timeline>` 之间插入提示条:

```tsx
return (
  <main
    className={cn('flex h-full flex-1 flex-col overflow-hidden', className)}
  >
    <MobileHeader session={session} />
    {session.connection === 'reconnecting' && (
      <div className="border-b border-line bg-signal/10 px-4 py-1.5 text-center text-xs text-fg-muted">
        网络波动，重连中…
      </div>
    )}
    <Timeline
      items={session.items}
      onAccept={id => sessionManager.acceptTransfer(activeId, id)}
      onReject={id => sessionManager.rejectTransfer(activeId, id)}
    />
    <Composer
      disabled={!connected}
      onSendText={text => sessionManager.sendText(activeId, text)}
      onSendFiles={files => sessionManager.sendFiles(activeId, files)}
    />
  </main>
);
```

- [ ] **Step 2: typecheck + lint**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web lint`
Expected: 无错误。

- [ ] **Step 3: 手测(用户在真实浏览器)**

两端进同一房间建立连接后,断开一端网络(如关 Wi-Fi)模拟波动:

- 列表项状态点变橙、文案"重连中…"。
- 详情顶部出现"网络波动,重连中…"提示条,Composer 禁用。
- 15s 内恢复网络 → 提示条消失、Composer 恢复、状态回"已连接"。
- 超过 15s 不恢复 → 状态变"已断开"、置灰。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/chat/ConversationView.tsx
git commit -m "feat(web): reconnecting banner in conversation detail"
```

---

## Self-Review

**Spec coverage:**

- 核心 `onStateChange` 分流(4 行为)→ Task 1 Step 4 ✅
- `GRACE_MS = 15s` 常量 → Task 1 Step 4 ✅
- `disconnected` 不 `closeRemote`、文件传输挂起 → Task 1(分支内不调用 closeRemote)✅,测试 Step 2 用例 1 验证未 teardown ✅
- 计时器清理无泄漏 → Task 1 Step 4 `teardown` + 测试用例 5 ✅
- `Connection` 新增 `reconnecting` → Task 1 Step 1 ✅
- 列表黄/橙点 + "重连中…" → Task 2 ✅
- 详情提示条 + Composer 禁用 → Task 3(禁用为既有行为,提示条新增)✅
- 5 个测试用例(自愈/超时/failed/无泄漏/进入态)→ Task 1 Step 2 ✅

**Placeholder scan:** 无 TBD/TODO;所有代码步骤含完整代码。

**Type consistency:** `Connection` 含 `reconnecting`(Task 1)在 `statusHint`/`statusTone`(Task 2)、`session.connection === 'reconnecting'`(Task 3)一致使用;计时器变量名 `graceTimer`/`clearGraceTimer`/`GRACE_MS` 全程一致;`onConnection`/`closeRemote`/`teardown` 沿用既有签名。
