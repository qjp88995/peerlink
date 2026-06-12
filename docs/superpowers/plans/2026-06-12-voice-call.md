# 实时语音通话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PeerLink 上增加电话式实时语音通话：一方拨打、对端振铃接听后，双向音频经 RTCPeerConnection 音频轨实时传输，含排他、能力检测、断连恢复。

**Architecture:** 呼叫控制（invite/accept/reject/end）走已连接的 DataChannel 作为新控制消息；媒体走 MediaStream 音频轨，接听后双方 addTrack 触发 renegotiation（offer/answer 走信令服务，由固定的「原始 PC initiator」端发起）。纯逻辑状态机 `CallSession` 编排呼叫生命周期，依赖注入收发/取麦克风/协商三个函数，可独立 TDD。「接通」以收到对端音频轨为准（通话前 ICE 已 connected，不会再触发 connected 事件）。

**Tech Stack:** TypeScript / zod（协议）、WebRTC（RTCPeerConnection audio track + renegotiation）、Vitest（TDD）、React 19 + zustand + Tailwind v4（UI）。

**设计来源：** `docs/superpowers/specs/2026-06-12-voice-call-design.md`

---

## 文件结构

| 文件                                                | 职责                                                                         | 动作   |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| `packages/protocol/src/constants.ts`                | 振铃超时 / 断连宽限常量                                                      | Modify |
| `packages/protocol/src/control.ts`                  | 4 条 call 控制消息 schema + reason 类型                                      | Modify |
| `packages/protocol/src/control.spec.ts`             | round-trip 测试                                                              | Modify |
| `apps/web/src/core/peer-connection.ts`              | addLocalAudio / removeLocalAudio / renegotiate / onRemoteTrack / isInitiator | Modify |
| `apps/web/src/core/peer-connection.spec.ts`         | 媒体方法调用契约                                                             | Modify |
| `apps/web/src/core/mic.ts`                          | `acquireMic()` 带能力/权限探测，抛 `MicError{reason}`                        | Create |
| `apps/web/src/core/mic.spec.ts`                     | 能力/权限分支                                                                | Create |
| `apps/web/src/core/call-session.ts`                 | 纯逻辑通话状态机                                                             | Create |
| `apps/web/src/core/call-session.spec.ts`            | 状态机全路径                                                                 | Create |
| `apps/web/src/core/conversation.ts`                 | 路由 call 控制消息进 CallSession；接出 onRemoteTrack；暴露 call API          | Modify |
| `apps/web/src/state/conversation-store.ts`          | `call` 切片 + `kind:'call'` 时间线记录 + actions                             | Modify |
| `apps/web/src/core/session-manager.ts`              | 串接 CallSession ↔ store；隐藏 `<audio>` 播放元素                            | Modify |
| `apps/web/src/features/chat/CallPanel.tsx`          | 通话条（状态/计时/静音/挂断）                                                | Create |
| `apps/web/src/features/chat/IncomingCallPrompt.tsx` | 来电接听/拒绝                                                                | Create |
| `apps/web/src/features/chat/CallRecordBubble.tsx`   | 时间线通话记录                                                               | Create |
| `apps/web/src/features/chat/Composer.tsx`           | 加「拨打」键                                                                 | Modify |

**注意：** 实现前先运行一次 `pnpm --filter @peerlink/web exec ls src/features/chat` 与 `pnpm --filter @peerlink/web exec ls src/routes` 确认 Composer 实际路径与挂载通话 UI 的容器组件名（Task 8 会用到，spec 未固定该组件名）。

---

## Task 1: 协议——call 控制消息 + 常量

**Files:**

- Modify: `packages/protocol/src/constants.ts`
- Modify: `packages/protocol/src/control.ts`
- Test: `packages/protocol/src/control.spec.ts`

- [ ] **Step 1: 加常量**

在 `packages/protocol/src/constants.ts` 末尾追加：

```ts
/** 呼叫振铃无应答超时（毫秒）。 */
export const CALL_RING_TIMEOUT_MS = 30 * 1000;

/** 通话中 ICE 断连自愈宽限期（毫秒）。 */
export const CALL_GRACE_MS = 8 * 1000;
```

- [ ] **Step 2: 写失败测试**

在 `packages/protocol/src/control.spec.ts` 中加入（沿用文件已有的导入与 `describe` 风格；若文件用 `controlMessageSchema.parse` round-trip，则照此写）：

```ts
import { controlMessageSchema } from './control';

describe('call control messages', () => {
  it('parses call-invite', () => {
    const msg = { type: 'call-invite', callId: 7, ts: 1000 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });
  it('parses call-accept', () => {
    const msg = { type: 'call-accept', callId: 7 };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });
  it('parses call-reject with reason', () => {
    const msg = { type: 'call-reject', callId: 7, reason: 'busy' };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });
  it('parses call-end with reason', () => {
    const msg = { type: 'call-end', callId: 7, reason: 'hangup' };
    expect(controlMessageSchema.parse(msg)).toEqual(msg);
  });
  it('rejects unknown call-reject reason', () => {
    expect(() =>
      controlMessageSchema.parse({
        type: 'call-reject',
        callId: 7,
        reason: 'nope',
      })
    ).toThrow();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @peerlink/protocol test -- control`
Expected: FAIL（`call-invite` 等未在 union 中，parse 抛错）。

- [ ] **Step 4: 实现 schema**

在 `packages/protocol/src/control.ts` 的 `voiceComplete` 定义之后、`controlMessageSchema` 之前插入：

```ts
export const callRejectReasonSchema = z.enum([
  'declined',
  'busy',
  'unsupported',
  'no-mic',
  'permission-denied',
]);
export type CallRejectReason = z.infer<typeof callRejectReasonSchema>;

export const callEndReasonSchema = z.enum([
  'hangup',
  'cancelled',
  'timeout',
  'failed',
]);
export type CallEndReason = z.infer<typeof callEndReasonSchema>;

const callInvite = z.object({
  type: z.literal('call-invite'),
  callId: z.number().int().nonnegative(),
  ts: z.number().int(),
});
const callAccept = z.object({
  type: z.literal('call-accept'),
  callId: z.number().int().nonnegative(),
});
const callReject = z.object({
  type: z.literal('call-reject'),
  callId: z.number().int().nonnegative(),
  reason: callRejectReasonSchema,
});
const callEnd = z.object({
  type: z.literal('call-end'),
  callId: z.number().int().nonnegative(),
  reason: callEndReasonSchema,
});
```

并把 `callInvite, callAccept, callReject, callEnd` 追加到 `controlMessageSchema` 的 `discriminatedUnion` 数组末尾。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @peerlink/protocol test -- control`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/protocol/src/constants.ts packages/protocol/src/control.ts packages/protocol/src/control.spec.ts
git commit -m "feat(protocol): add call control messages and timeout constants"
```

---

## Task 2: PeerConnection——音频轨 + renegotiation

**Files:**

- Modify: `apps/web/src/core/peer-connection.ts`
- Test: `apps/web/src/core/peer-connection.spec.ts`

**说明：** 现有信令路由已支持 renegotiation（initiator 收 sdp→`acceptAnswer`，responder 收 sdp→`acceptOffer`），故只需新增本地轨管理 + `renegotiate()` + 远端轨回调。不监听 `onnegotiationneeded`（避免与显式 `renegotiate()` 双发 offer）。

- [ ] **Step 1: 写失败测试**

打开 `apps/web/src/core/peer-connection.spec.ts`，参照其现有 fake `RTCPeerConnection` mock 的写法新增（mock 须支持 `addTrack` 返回一个带 `track` 的 sender、`removeTrack`、`getSenders`、派发 `track` 事件、`createOffer`/`setLocalDescription`）：

```ts
it('addLocalAudio adds track and renegotiate emits offer via onSignal', async () => {
  const signals: { sdp?: string }[] = [];
  const pc = new PeerConnection({
    iceServers: [],
    createPc: () => fakePc, // 你的 fake，createOffer 返回 { type:'offer', sdp:'OFFER' }
    onSignal: p => signals.push(p),
  });
  const stream = {
    getAudioTracks: () => [{ kind: 'audio' }],
  } as unknown as MediaStream;
  pc.addLocalAudio(stream);
  expect(fakePc.addTrack).toHaveBeenCalled();
  await pc.renegotiate();
  expect(signals.some(s => s.sdp === 'OFFER')).toBe(true);
});

it('onRemoteTrack fires on track event', () => {
  const tracks: MediaStreamTrack[] = [];
  const pc = new PeerConnection({
    iceServers: [],
    createPc: () => fakePc,
    onRemoteTrack: t => tracks.push(t),
  });
  const track = { kind: 'audio' } as MediaStreamTrack;
  fakePc.dispatch('track', { track });
  expect(tracks).toContain(track);
});

it('removeLocalAudio removes previously added senders', () => {
  const pc = new PeerConnection({ iceServers: [], createPc: () => fakePc });
  const stream = {
    getAudioTracks: () => [{ kind: 'audio' }],
  } as unknown as MediaStream;
  pc.addLocalAudio(stream);
  pc.removeLocalAudio();
  expect(fakePc.removeTrack).toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @peerlink/web test -- peer-connection`
Expected: FAIL（`addLocalAudio` / `renegotiate` / `removeLocalAudio` / `onRemoteTrack` 不存在）。

- [ ] **Step 3: 实现**

在 `apps/web/src/core/peer-connection.ts`：

`PeerConnectionOptions` 接口加一行：

```ts
  onRemoteTrack?: (track: MediaStreamTrack) => void;
```

类内加字段：

```ts
  private localSenders: RTCRtpSender[] = [];
```

构造函数内、`datachannel` 监听之后，加 track 监听：

```ts
this.pc.addEventListener('track', evt => {
  const e = evt as RTCTrackEvent;
  this.opts.onRemoteTrack?.(e.track);
});
```

类内新增三个方法（放在 `addCandidate` 之后）：

```ts
  addLocalAudio(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      this.localSenders.push(this.pc.addTrack(track, stream));
    }
  }

  removeLocalAudio(): void {
    for (const sender of this.localSenders) {
      try {
        this.pc.removeTrack(sender);
      } catch {
        /* 已移除/已关闭则忽略 */
      }
    }
    this.localSenders = [];
  }

  /** 仅由原始 initiator 调用：发起一轮新的 offer/answer 协商。 */
  async renegotiate(): Promise<void> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.opts.onSignal?.({ sdp: offer.sdp });
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @peerlink/web test -- peer-connection`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/peer-connection.ts apps/web/src/core/peer-connection.spec.ts
git commit -m "feat(web): add audio track + renegotiation to PeerConnection"
```

---

## Task 3: 麦克风获取与能力检测 `mic.ts`

**Files:**

- Create: `apps/web/src/core/mic.ts`
- Test: `apps/web/src/core/mic.spec.ts`

- [ ] **Step 1: 写失败测试**

`apps/web/src/core/mic.spec.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireMic, MicError } from './mic';

const g = globalThis as unknown as { navigator: unknown };
const orig = g.navigator;
afterEach(() => {
  g.navigator = orig;
  vi.restoreAllMocks();
});

describe('acquireMic', () => {
  it('throws unsupported when getUserMedia missing', async () => {
    g.navigator = {} as Navigator;
    await expect(acquireMic()).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('returns stream on success', async () => {
    const stream = {} as MediaStream;
    g.navigator = {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    } as unknown as Navigator;
    await expect(acquireMic()).resolves.toBe(stream);
  });

  it('maps NotAllowedError to permission-denied', async () => {
    g.navigator = {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('x'), { name: 'NotAllowedError' })
          ),
      },
    } as unknown as Navigator;
    await expect(acquireMic()).rejects.toMatchObject({
      reason: 'permission-denied',
    });
  });

  it('maps NotFoundError to no-mic', async () => {
    g.navigator = {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('x'), { name: 'NotFoundError' })
          ),
      },
    } as unknown as Navigator;
    await expect(acquireMic()).rejects.toMatchObject({ reason: 'no-mic' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @peerlink/web test -- mic`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`apps/web/src/core/mic.ts`：

```ts
import type { CallRejectReason } from '@peerlink/protocol';

/** 取麦克风失败时抛出，reason 与 call-reject 的 reason 对齐。 */
export class MicError extends Error {
  constructor(readonly reason: CallRejectReason) {
    super(reason);
    this.name = 'MicError';
  }
}

/** 申请麦克风音频流；失败抛 MicError，reason ∈ unsupported|permission-denied|no-mic。 */
export async function acquireMic(): Promise<MediaStream> {
  const md =
    typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) throw new MicError('unsupported');
  try {
    return await md.getUserMedia({ audio: true });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MicError('permission-denied');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new MicError('no-mic');
    }
    throw new MicError('no-mic');
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @peerlink/web test -- mic`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/mic.ts apps/web/src/core/mic.spec.ts
git commit -m "feat(web): add acquireMic with capability/permission detection"
```

---

## Task 4: `CallSession` 纯逻辑状态机

**Files:**

- Create: `apps/web/src/core/call-session.ts`
- Test: `apps/web/src/core/call-session.spec.ts`

**接口约定（实现前先建类型骨架，使测试可编译）：**

```ts
export type CallState =
  | 'idle'
  | 'dialing'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'reconnecting';

export type CallDir = 'out' | 'in';

/** 通话结束后落时间线的记录。 */
export interface CallRecord {
  dir: CallDir;
  /** 已接通过：通话时长（毫秒）。 */
  durationMs?: number;
  /** 未接通的结束原因。 */
  outcome?:
    | 'cancelled'
    | 'declined'
    | 'missed'
    | 'busy'
    | 'failed'
    | 'rejected';
}

export type CallControl =
  | { type: 'call-invite'; callId: number; ts: number }
  | { type: 'call-accept'; callId: number }
  | { type: 'call-reject'; callId: number; reason: CallRejectReason }
  | { type: 'call-end'; callId: number; reason: CallEndReason };
```

`CallSessionDeps`：

```ts
export interface CallSessionDeps {
  isInitiator: boolean;
  sendControl: (msg: CallControl) => void;
  acquireMic: () => Promise<MediaStream>;
  addLocalAudio: (stream: MediaStream) => void;
  removeLocalAudio: () => void;
  renegotiate: () => Promise<void>;
  genCallId: () => number;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  callbacks: {
    onStateChange?: (state: CallState, dir: CallDir | null) => void;
    onIncoming?: (callId: number) => void;
    /** 主叫本端能力/对端拒绝等失败原因（用于 toast）。 */
    onError?: (reason: CallRejectReason) => void;
    onEnded?: (record: CallRecord) => void;
  };
}
```

依赖注入 `now` / `setTimeout` / `clearTimeout` / `genCallId` / `acquireMic` 使其可纯逻辑测试。

- [ ] **Step 1: 写失败测试（建 harness + 核心路径）**

`apps/web/src/core/call-session.spec.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALL_GRACE_MS, CALL_RING_TIMEOUT_MS } from '@peerlink/protocol';
import { CallSession, type CallControl } from './call-session';

function harness(isInitiator: boolean) {
  const sent: CallControl[] = [];
  const timers: { fn: () => void; ms: number; h: number }[] = [];
  let nextH = 1;
  let clock = 0;
  const states: { state: string; dir: string | null }[] = [];
  const ended: unknown[] = [];
  const errors: string[] = [];
  const incoming: number[] = [];
  const renegotiate = vi.fn().mockResolvedValue(undefined);
  const addLocalAudio = vi.fn();
  const removeLocalAudio = vi.fn();
  const mic = {} as MediaStream;
  const acquireMic = vi.fn().mockResolvedValue(mic);

  const session = new CallSession({
    isInitiator,
    sendControl: m => sent.push(m),
    acquireMic,
    addLocalAudio,
    removeLocalAudio,
    renegotiate,
    genCallId: () => 42,
    now: () => clock,
    setTimeout: (fn, ms) => {
      const h = nextH++;
      timers.push({ fn, ms, h });
      return h;
    },
    clearTimeout: h => {
      const i = timers.findIndex(t => t.h === h);
      if (i >= 0) timers.splice(i, 1);
    },
    callbacks: {
      onStateChange: (state, dir) => states.push({ state, dir }),
      onIncoming: id => incoming.push(id),
      onError: r => errors.push(r),
      onEnded: r => ended.push(r),
    },
  });

  return {
    session,
    sent,
    ended,
    errors,
    incoming,
    renegotiate,
    addLocalAudio,
    removeLocalAudio,
    acquireMic,
    mic,
    advance(ms: number) {
      clock += ms;
      const due = timers.filter(t => t.ms <= ms);
      for (const t of due) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
    fireTimers() {
      const all = [...timers];
      timers.length = 0;
      for (const t of all) t.fn();
    },
    get state() {
      return session.state;
    },
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('CallSession outgoing (caller = initiator)', () => {
  it('dial acquires mic, adds track, sends invite, goes dialing', async () => {
    const h = harness(true);
    await h.session.dial();
    expect(h.acquireMic).toHaveBeenCalled();
    expect(h.addLocalAudio).toHaveBeenCalledWith(h.mic);
    expect(h.sent).toContainEqual({ type: 'call-invite', callId: 42, ts: 0 });
    expect(h.state).toBe('dialing');
  });

  it('remote accept -> connecting -> renegotiate (initiator)', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    expect(h.state).toBe('connecting');
    expect(h.renegotiate).toHaveBeenCalled();
  });

  it('remote track -> active', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    expect(h.state).toBe('active');
  });

  it('ring timeout sends call-end timeout and records missed-out', async () => {
    const h = harness(true);
    await h.session.dial();
    h.advance(CALL_RING_TIMEOUT_MS);
    expect(h.sent).toContainEqual({
      type: 'call-end',
      callId: 42,
      reason: 'timeout',
    });
    expect(h.state).toBe('idle');
    expect(h.removeLocalAudio).toHaveBeenCalled();
  });

  it('remote reject busy -> idle + onError(busy)', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-reject', callId: 42, reason: 'busy' });
    expect(h.errors).toContain('busy');
    expect(h.state).toBe('idle');
  });

  it('local mic failure does not send invite', async () => {
    const h = harness(true);
    h.acquireMic.mockRejectedValueOnce(
      Object.assign(new Error('x'), { reason: 'no-mic' })
    );
    await h.session.dial();
    expect(h.sent).toHaveLength(0);
    expect(h.errors).toContain('no-mic');
    expect(h.state).toBe('idle');
  });
});

describe('CallSession incoming', () => {
  it('invite while idle -> ringing + onIncoming', () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    expect(h.state).toBe('ringing');
    expect(h.incoming).toContain(9);
  });

  it('busy: invite while active -> auto reject busy, state unchanged', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio(); // active
    h.session.onControl({ type: 'call-invite', callId: 99, ts: 1 });
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 99,
      reason: 'busy',
    });
    expect(h.state).toBe('active');
  });

  it('accept (responder) sends call-accept and waits (no renegotiate)', async () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    await h.session.accept();
    expect(h.sent).toContainEqual({ type: 'call-accept', callId: 9 });
    expect(h.state).toBe('connecting');
    expect(h.renegotiate).not.toHaveBeenCalled();
  });

  it('accept (initiator) sends call-accept then renegotiates', async () => {
    const h = harness(true);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    await h.session.accept();
    expect(h.sent).toContainEqual({ type: 'call-accept', callId: 9 });
    expect(h.renegotiate).toHaveBeenCalled();
  });

  it('reject sends call-reject declined and records', () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    h.session.reject();
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 9,
      reason: 'declined',
    });
    expect(h.state).toBe('idle');
  });

  it('accept with mic failure rejects with reason', async () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 5 });
    h.acquireMic.mockRejectedValueOnce(
      Object.assign(new Error('x'), { reason: 'permission-denied' })
    );
    await h.session.accept();
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 9,
      reason: 'permission-denied',
    });
    expect(h.state).toBe('idle');
  });
});

describe('CallSession glare (simultaneous dial)', () => {
  it('non-initiator dialing receives invite -> switches to ringing', async () => {
    const h = harness(false);
    await h.session.dial(); // 我方 dialing，callId 42
    h.session.onControl({ type: 'call-invite', callId: 7, ts: 1 });
    expect(h.state).toBe('ringing'); // 让对方（initiator）的呼叫胜出
    expect(h.incoming).toContain(7);
  });

  it('initiator dialing receives invite -> rejects busy, keeps dialing', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-invite', callId: 7, ts: 1 });
    expect(h.sent).toContainEqual({
      type: 'call-reject',
      callId: 7,
      reason: 'busy',
    });
    expect(h.state).toBe('dialing');
  });
});

describe('CallSession hangup / remote end / disconnect', () => {
  it('hangup active sends call-end hangup and records duration', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio(); // active at clock 0
    h.advance(0); // 仅推进 timers，不动时长
    h.session.hangup();
    expect(h.sent).toContainEqual({
      type: 'call-end',
      callId: 42,
      reason: 'hangup',
    });
    expect(h.state).toBe('idle');
    expect(h.removeLocalAudio).toHaveBeenCalled();
  });

  it('remote end while active records duration', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.onControl({ type: 'call-end', callId: 42, reason: 'hangup' });
    expect(h.state).toBe('idle');
    expect(h.ended.at(-1)).toMatchObject({ dir: 'out' });
  });

  it('remote end while ringing records missed (in)', () => {
    const h = harness(false);
    h.session.onControl({ type: 'call-invite', callId: 9, ts: 1 });
    h.session.onControl({ type: 'call-end', callId: 9, reason: 'cancelled' });
    expect(h.state).toBe('idle');
    expect(h.ended.at(-1)).toMatchObject({ dir: 'in', outcome: 'missed' });
  });

  it('disconnect during active -> reconnecting, grace expiry ends call failed', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.onConnectionState('disconnected');
    expect(h.state).toBe('reconnecting');
    h.advance(CALL_GRACE_MS);
    expect(h.state).toBe('idle');
    expect(h.sent).toContainEqual({
      type: 'call-end',
      callId: 42,
      reason: 'failed',
    });
  });

  it('reconnect within grace -> back to active', async () => {
    const h = harness(true);
    await h.session.dial();
    h.session.onControl({ type: 'call-accept', callId: 42 });
    await flush();
    h.session.onRemoteAudio();
    h.session.onConnectionState('disconnected');
    h.session.onConnectionState('connected');
    expect(h.state).toBe('active');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @peerlink/web test -- call-session`
Expected: FAIL（`CallSession` 不存在）。

- [ ] **Step 3: 实现 `call-session.ts`**

```ts
import {
  CALL_GRACE_MS,
  CALL_RING_TIMEOUT_MS,
  type CallEndReason,
  type CallRejectReason,
} from '@peerlink/protocol';

export type CallState =
  | 'idle'
  | 'dialing'
  | 'ringing'
  | 'connecting'
  | 'active'
  | 'reconnecting';

export type CallDir = 'out' | 'in';

export interface CallRecord {
  dir: CallDir;
  durationMs?: number;
  outcome?:
    | 'cancelled'
    | 'declined'
    | 'missed'
    | 'busy'
    | 'failed'
    | 'rejected';
}

export type CallControl =
  | { type: 'call-invite'; callId: number; ts: number }
  | { type: 'call-accept'; callId: number }
  | { type: 'call-reject'; callId: number; reason: CallRejectReason }
  | { type: 'call-end'; callId: number; reason: CallEndReason };

export interface CallSessionDeps {
  isInitiator: boolean;
  sendControl: (msg: CallControl) => void;
  acquireMic: () => Promise<MediaStream>;
  addLocalAudio: (stream: MediaStream) => void;
  removeLocalAudio: () => void;
  renegotiate: () => Promise<void>;
  genCallId: () => number;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  callbacks: {
    onStateChange?: (state: CallState, dir: CallDir | null) => void;
    onIncoming?: (callId: number) => void;
    onError?: (reason: CallRejectReason) => void;
    onEnded?: (record: CallRecord) => void;
  };
}

/** 纯逻辑通话状态机：编排单路语音通话的生命周期。 */
export class CallSession {
  state: CallState = 'idle';
  private dir: CallDir | null = null;
  private callId: number | null = null;
  private startedAt = 0;
  private ringTimer: unknown;
  private graceTimer: unknown;

  constructor(private d: CallSessionDeps) {}

  // ---- 本端动作 ----

  async dial(): Promise<void> {
    if (this.state !== 'idle') return;
    let stream: MediaStream;
    try {
      stream = await this.d.acquireMic();
    } catch (err) {
      this.d.callbacks.onError?.(reasonOf(err));
      return;
    }
    this.d.addLocalAudio(stream);
    this.callId = this.d.genCallId();
    this.dir = 'out';
    this.setState('dialing');
    this.d.sendControl({
      type: 'call-invite',
      callId: this.callId,
      ts: this.d.now(),
    });
    this.ringTimer = this.d.setTimeout(() => {
      if (this.callId !== null) {
        this.d.sendControl({
          type: 'call-end',
          callId: this.callId,
          reason: 'timeout',
        });
      }
      this.finish({ dir: 'out', outcome: 'missed' });
    }, CALL_RING_TIMEOUT_MS);
  }

  async accept(): Promise<void> {
    if (this.state !== 'ringing' || this.callId === null) return;
    const callId = this.callId;
    let stream: MediaStream;
    try {
      stream = await this.d.acquireMic();
    } catch (err) {
      this.d.sendControl({
        type: 'call-reject',
        callId,
        reason: reasonOf(err),
      });
      this.finish({ dir: 'in', outcome: 'declined' });
      return;
    }
    this.d.addLocalAudio(stream);
    this.setState('connecting');
    this.d.sendControl({ type: 'call-accept', callId });
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  reject(): void {
    if (this.state !== 'ringing' || this.callId === null) return;
    this.d.sendControl({
      type: 'call-reject',
      callId: this.callId,
      reason: 'declined',
    });
    this.finish({ dir: 'in', outcome: 'declined' });
  }

  hangup(): void {
    if (this.state === 'idle') return;
    if (this.state === 'ringing') return this.reject();
    if (this.callId === null) return;
    if (this.state === 'dialing') {
      this.d.sendControl({
        type: 'call-end',
        callId: this.callId,
        reason: 'cancelled',
      });
      this.finish({ dir: 'out', outcome: 'cancelled' });
      return;
    }
    // connecting / active / reconnecting
    this.d.sendControl({
      type: 'call-end',
      callId: this.callId,
      reason: 'hangup',
    });
    this.finish(this.endRecord());
  }

  // ---- 远端控制消息 ----

  onControl(msg: CallControl): void {
    switch (msg.type) {
      case 'call-invite':
        return this.onInvite(msg.callId);
      case 'call-accept':
        if (this.state === 'dialing' && msg.callId === this.callId) {
          this.clearRing();
          this.setState('connecting');
          if (this.d.isInitiator) void this.d.renegotiate();
        }
        return;
      case 'call-reject':
        if (this.state === 'dialing' && msg.callId === this.callId) {
          this.d.callbacks.onError?.(msg.reason);
          this.finish({
            dir: 'out',
            outcome: msg.reason === 'busy' ? 'busy' : 'rejected',
          });
        }
        return;
      case 'call-end':
        if (
          this.callId !== null &&
          msg.callId === this.callId &&
          this.state !== 'idle'
        ) {
          this.finish(this.endRecord(msg.reason));
        }
        return;
    }
  }

  private onInvite(callId: number): void {
    if (this.state === 'idle') {
      this.callId = callId;
      this.dir = 'in';
      this.setState('ringing');
      this.d.callbacks.onIncoming?.(callId);
      return;
    }
    if (this.state === 'dialing' && !this.d.isInitiator) {
      // glare：让 initiator 一方的呼叫胜出，本端放弃自己的拨打转为振铃
      this.clearRing();
      this.callId = callId;
      this.dir = 'in';
      this.setState('ringing');
      this.d.callbacks.onIncoming?.(callId);
      return;
    }
    // 其余（含 initiator 的 dialing、connecting、active...）：忙线
    this.d.sendControl({ type: 'call-reject', callId, reason: 'busy' });
  }

  // ---- 媒体 / 连接事件 ----

  /** 收到对端音频轨：视为接通。 */
  onRemoteAudio(): void {
    if (this.state === 'connecting') {
      this.startedAt = this.d.now();
      this.setState('active');
    }
  }

  onConnectionState(state: RTCIceConnectionState): void {
    if (state === 'disconnected') {
      if (this.state === 'active') {
        this.setState('reconnecting');
        this.graceTimer = this.d.setTimeout(() => {
          if (this.callId !== null) {
            this.d.sendControl({
              type: 'call-end',
              callId: this.callId,
              reason: 'failed',
            });
          }
          this.finish(this.endRecord('failed'));
        }, CALL_GRACE_MS);
      }
      return;
    }
    if (state === 'connected' || state === 'completed') {
      if (this.state === 'reconnecting') {
        this.clearGrace();
        this.setState('active');
      }
      return;
    }
    if (state === 'failed' || state === 'closed') {
      if (this.state !== 'idle') this.finish(this.endRecord('failed'));
    }
  }

  /** 会话销毁/对端离开：强制收尾。 */
  dispose(): void {
    if (this.state !== 'idle') this.finish(this.endRecord('failed'));
  }

  // ---- 内部 ----

  private endRecord(reason?: CallEndReason): CallRecord {
    const dir = this.dir ?? 'out';
    if (this.state === 'active' || this.state === 'reconnecting') {
      return { dir, durationMs: this.d.now() - this.startedAt };
    }
    // 未接通
    if (this.state === 'ringing') return { dir, outcome: 'missed' };
    if (reason === 'failed') return { dir, outcome: 'failed' };
    return { dir, outcome: reason === 'cancelled' ? 'cancelled' : 'missed' };
  }

  private finish(record: CallRecord): void {
    this.clearRing();
    this.clearGrace();
    this.d.removeLocalAudio();
    this.callId = null;
    this.dir = null;
    this.startedAt = 0;
    this.setState('idle');
    this.d.callbacks.onEnded?.(record);
  }

  private setState(s: CallState): void {
    this.state = s;
    this.d.callbacks.onStateChange?.(s, s === 'idle' ? null : this.dir);
  }

  private clearRing(): void {
    if (this.ringTimer !== undefined) {
      this.d.clearTimeout(this.ringTimer);
      this.ringTimer = undefined;
    }
  }

  private clearGrace(): void {
    if (this.graceTimer !== undefined) {
      this.d.clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }
  }
}

function reasonOf(err: unknown): CallRejectReason {
  const r = (err as { reason?: CallRejectReason })?.reason;
  return r ?? 'no-mic';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @peerlink/web test -- call-session`
Expected: PASS（全部用例）。若 `onEnded` 在 `idle` 后触发顺序导致 `endRecord` 读到 idle 状态：注意 `finish` 先算 record 再 `setState('idle')`——实现已按此顺序，勿调换。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/call-session.ts apps/web/src/core/call-session.spec.ts
git commit -m "feat(web): add CallSession state machine for voice calls"
```

---

## Task 5: 接入 Conversation

**Files:**

- Modify: `apps/web/src/core/conversation.ts`

**说明：** Conversation 持有 CallSession；把 4 条 call 控制消息路由进去；`buildPeer` 注入 `onRemoteTrack`（同时喂给 CallSession 与对外回调以挂 `<audio>`）；`startConversation` 暴露 call API 与角色 `isInitiator`（create=true / join=false）。

- [ ] **Step 1: 扩展回调与依赖类型**

在 `ConversationCallbacks` 接口追加：

```ts
  onCallStateChange?: (state: CallState, dir: CallDir | null) => void;
  onCallIncoming?: () => void;
  onCallError?: (reason: CallRejectReason) => void;
  onCallEnded?: (record: CallRecord) => void;
  onRemoteAudioTrack?: (track: MediaStreamTrack) => void;
```

文件顶部从协议导入 reason 类型，从 `./call-session` 导入：

```ts
import type { CallRejectReason } from '@peerlink/protocol';
import {
  CallSession,
  type CallControl,
  type CallDir,
  type CallRecord,
  type CallState,
} from './call-session';
```

`ConversationDeps` 增加：

```ts
  isInitiator: boolean;
  renegotiate: () => Promise<void>;
  addLocalAudio: (stream: MediaStream) => void;
  removeLocalAudio: () => void;
```

- [ ] **Step 2: 在 Conversation 内构造 CallSession**

`Conversation` 类加字段与构造逻辑（构造函数内，赋值 `this.cb` 之后）：

```ts
  private call: CallSession;
```

```ts
this.call = new CallSession({
  isInitiator: deps.isInitiator,
  sendControl: (m: CallControl) => this.channel.send(encodeControlFrame(m)),
  acquireMic,
  addLocalAudio: deps.addLocalAudio,
  removeLocalAudio: deps.removeLocalAudio,
  renegotiate: deps.renegotiate,
  genCallId: () => this.nextFileId++,
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  callbacks: {
    onStateChange: (s, d) => this.cb.onCallStateChange?.(s, d),
    onIncoming: () => this.cb.onCallIncoming?.(),
    onError: r => this.cb.onCallError?.(r),
    onEnded: r => this.cb.onCallEnded?.(r),
  },
});
```

顶部加 `import { acquireMic } from './mic';`。

- [ ] **Step 3: 公开 call 动作 + 远端轨入口**

`Conversation` 类加方法：

```ts
  dialCall(): Promise<void> {
    return this.call.dial();
  }
  acceptCall(): Promise<void> {
    return this.call.accept();
  }
  rejectCall(): void {
    this.call.reject();
  }
  hangupCall(): void {
    this.call.hangup();
  }
  /** 由 peer 的 'track' 事件驱动。 */
  handleRemoteTrack(track: MediaStreamTrack): void {
    this.call.onRemoteAudio();
    this.cb.onRemoteAudioTrack?.(track);
  }
  notifyConnectionState(state: RTCIceConnectionState): void {
    this.call.onConnectionState(state);
  }
```

- [ ] **Step 4: 路由 4 条 call 控制消息**

在 `handleIncoming` 的 `switch (msg.type)` 中，`reject` case 之后加：

```ts
      case 'call-invite':
      case 'call-accept':
      case 'call-reject':
      case 'call-end':
        this.call.onControl(msg as CallControl);
        return;
```

- [ ] **Step 5: closeRemote 收尾通话**

在 `closeRemote()` 方法体内（清理 voice 之后）追加：

```ts
this.call.dispose();
```

- [ ] **Step 6: `startConversation` 注入角色与媒体函数**

`startConversation` 内需要在 `peer` 建好后才有 `addLocalAudio` 等。采用「延迟委托」：先声明可变 peer，Conversation 的媒体依赖通过闭包转发到当前 peer。

把 `new Conversation({...})` 调用改为：

```ts
const isInitiator = init.mode === 'create';
const conv = new Conversation({
  channel: {
    send: () => {
      throw new Error('channel not open');
    },
    bufferedAmount: 0,
    waitForDrain: () => Promise.resolve(),
  },
  makeWriter: defaultMakeWriter,
  isInitiator,
  addLocalAudio: stream => peer?.addLocalAudio(stream),
  removeLocalAudio: () => peer?.removeLocalAudio(),
  renegotiate: () => peer?.renegotiate() ?? Promise.resolve(),
  callbacks,
});
```

在 `buildPeer` 的 `PeerConnection` 配置里加：

```ts
      onRemoteTrack: track => conv.handleRemoteTrack(track),
```

并在 `onStateChange` 回调**最前面**加一行，把状态同步给 CallSession（与既有 DataChannel 自愈逻辑并存）：

```ts
      onStateChange: state => {
        conv.notifyConnectionState(state);
        // ...（保留原有 connected/disconnected/failed 处理）
```

- [ ] **Step 7: `ConversationHandle` 暴露 call API**

`ConversationHandle` 接口与 return 对象各加：

```ts
  dialCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangupCall: () => void;
```

return 对象：

```ts
    dialCall: () => conv.dialCall(),
    acceptCall: () => conv.acceptCall(),
    rejectCall: () => conv.rejectCall(),
    hangupCall: () => conv.hangupCall(),
```

- [ ] **Step 8: typecheck + 既有测试回归**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web test -- conversation`
Expected: PASS（既有 conversation.spec 不回归；如该 spec 直接 `new Conversation(...)`，给它补上新增的 4 个 deps：`isInitiator:false` + 三个 `() => {}` / `() => Promise.resolve()` 空实现）。

- [ ] **Step 9: 提交**

```bash
git add apps/web/src/core/conversation.ts apps/web/src/core/conversation.spec.ts
git commit -m "feat(web): wire CallSession into Conversation"
```

---

## Task 6: Store——call 切片 + 通话时间线记录

**Files:**

- Modify: `apps/web/src/state/conversation-store.ts`

- [ ] **Step 1: 扩展类型**

文件顶部从 core 导入 call 类型：

```ts
import type { CallDir, CallRecord, CallState } from '../core/call-session';
```

`TimelineItem` union 追加一支：

```ts
  | {
      kind: 'call';
      id: string;
      dir: 'out' | 'in';
      durationMs?: number;
      outcome?: CallRecord['outcome'];
      ts: number;
    };
```

新增通话实时状态类型与 `Session` 字段：

```ts
export interface CallUiState {
  state: CallState;
  dir: CallDir | null;
  /** 最近一次主叫失败/对端拒绝原因，用于 toast 后清空。 */
  error?: string;
  muted: boolean;
}
```

`Session` 接口加：

```ts
call: CallUiState;
```

`addSession` 初始化的 session 对象加：

```ts
        call: { state: 'idle', dir: null, muted: false },
```

- [ ] **Step 2: 新增 actions 到 `RoomsState` 接口**

```ts
  setCallState(id: string, state: CallState, dir: CallDir | null): void;
  setCallError(id: string, error: string | undefined): void;
  setCallMuted(id: string, muted: boolean): void;
  appendCallRecord(id: string, record: CallRecord): void;
```

- [ ] **Step 3: 实现 actions**

在 store 实现中（`setVoiceFailed` 之后）加：

```ts
  setCallState: (id, state, dir) =>
    set(s =>
      patchSession(s, id, sess => ({
        ...sess,
        call: { ...sess.call, state, dir, muted: state === 'idle' ? false : sess.call.muted },
      }))
    ),

  setCallError: (id, error) =>
    set(s => patchSession(s, id, sess => ({ ...sess, call: { ...sess.call, error } }))),

  setCallMuted: (id, muted) =>
    set(s => patchSession(s, id, sess => ({ ...sess, call: { ...sess.call, muted } }))),

  appendCallRecord: (id, record) =>
    set(s =>
      patchSession(s, id, sess => ({
        ...sess,
        items: [
          ...sess.items,
          {
            kind: 'call',
            id: crypto.randomUUID(),
            dir: record.dir,
            durationMs: record.durationMs,
            outcome: record.outcome,
            ts: Date.now(),
          },
        ],
        unread:
          record.dir === 'out' || id === s.activeId ? sess.unread : sess.unread + 1,
      }))
    ),
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/state/conversation-store.ts
git commit -m "feat(web): add call slice and call timeline record to store"
```

---

## Task 7: SessionManager——串接 CallSession 与 store + 音频播放

**Files:**

- Modify: `apps/web/src/core/session-manager.ts`

**说明：** 把 call 回调路由到 store；用一个隐藏 `<audio autoplay>` 播放对端音频流；管理静音（控制本地 sender 的 track.enabled，经 handle 暴露的方法）。

- [ ] **Step 1: 扩展 `SessionStore` 接口**

```ts
  setCallState(id: string, state: CallState, dir: CallDir | null): void;
  setCallError(id: string, error: string | undefined): void;
  setCallMuted(id: string, muted: boolean): void;
  appendCallRecord(id: string, record: CallRecord): void;
```

顶部导入：

```ts
import type { CallDir, CallRecord, CallState } from './call-session';
```

- [ ] **Step 2: 音频播放元素管理**

`SessionManager` 类加字段与私有方法：

```ts
  private audioEls = new Map<string, HTMLAudioElement>();

  private playRemote(id: string, track: MediaStreamTrack): void {
    let el = this.audioEls.get(id);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      this.audioEls.set(id, el);
    }
    el.srcObject = new MediaStream([track]);
    void el.play?.().catch(() => {});
  }

  private stopRemote(id: string): void {
    const el = this.audioEls.get(id);
    if (el) {
      el.srcObject = null;
      this.audioEls.delete(id);
    }
  }
```

- [ ] **Step 3: 公开 call 操作方法**

```ts
  dialCall(id: string): void {
    void this.handles.get(id)?.dialCall();
  }
  acceptCall(id: string): void {
    void this.handles.get(id)?.acceptCall();
  }
  rejectCall(id: string): void {
    this.handles.get(id)?.rejectCall();
  }
  hangupCall(id: string): void {
    this.handles.get(id)?.hangupCall();
  }
```

- [ ] **Step 4: 在 `callbacks(id)` 里接 call 回调**

`return { ... }` 内追加：

```ts
      onCallStateChange: (state, dir) => {
        this.store.setCallState(id, state, dir);
        if (state === 'idle') this.stopRemote(id);
      },
      onCallIncoming: () => {
        /* 振铃 UI 由 store.call.state==='ringing' 驱动；如需提示音可在此触发 */
      },
      onCallError: reason => this.store.setCallError(id, reason),
      onCallEnded: record => this.store.appendCallRecord(id, record),
      onRemoteAudioTrack: track => this.playRemote(id, track),
```

- [ ] **Step 5: remove/closeAll 清理音频元素**

`remove(id)` 内 `this.handles.delete(id);` 之前加 `this.stopRemote(id);`。
`closeAll()` 内循环后加：

```ts
for (const id of [...this.audioEls.keys()]) this.stopRemote(id);
```

- [ ] **Step 6: typecheck + 既有 session-manager 测试回归**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web test -- session-manager`
Expected: PASS。若既有 `session-manager.spec.ts` 用了实现 `SessionStore` 的 fake，给 fake 补 4 个空方法实现，并在测试环境（jsdom）确认 `document.createElement('audio')` 可用；如该 spec 不触发 call 路径则无需改动。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/core/session-manager.ts apps/web/src/core/session-manager.spec.ts
git commit -m "feat(web): route CallSession to store and play remote audio"
```

---

## Task 8: UI——拨打键 + 通话条 + 来电弹层 + 时间线记录

**Files:**

- Create: `apps/web/src/features/chat/CallPanel.tsx`
- Create: `apps/web/src/features/chat/IncomingCallPrompt.tsx`
- Create: `apps/web/src/features/chat/CallRecordBubble.tsx`
- Modify: `apps/web/src/features/chat/Composer.tsx`
- Modify: 渲染时间线的容器组件（路径由文件结构表下方的「注意」预备步骤确认）

**说明：** 无渲染测试（项目无 testing-library，UI 由真实浏览器双开手测）。组件读 `useRoomsStore` 的 `call` 切片与 `SessionManager` 操作方法。下面给出可直接落地的组件骨架；实现者按现有 chat 组件的 className 习惯（参考 `VoiceBubble.tsx`）微调样式。

- [ ] **Step 1: 时长格式化工具**

若 `apps/web/src/lib` 无 `formatDuration`，在 `CallRecordBubble.tsx` 内置局部函数（mm:ss）。

- [ ] **Step 2: `CallRecordBubble.tsx`**

```tsx
import { Phone, PhoneMissed } from 'lucide-react';
import type { TimelineItem } from '../../state/conversation-store';

type CallItem = Extract<TimelineItem, { kind: 'call' }>;

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function label(item: CallItem): string {
  if (item.durationMs !== undefined) return `通话时长 ${fmt(item.durationMs)}`;
  switch (item.outcome) {
    case 'missed':
      return item.dir === 'in' ? '未接来电' : '对方未接听';
    case 'cancelled':
      return '已取消';
    case 'declined':
      return item.dir === 'in' ? '已拒绝' : '对方已拒绝';
    case 'busy':
      return '对方忙线中';
    case 'rejected':
      return '无法接通';
    case 'failed':
    default:
      return '通话中断';
  }
}

export function CallRecordBubble({ item }: { item: CallItem }) {
  const missed = item.durationMs === undefined && item.outcome !== 'cancelled';
  const Icon = missed ? PhoneMissed : Phone;
  return (
    <div className="flex justify-center my-1">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label(item)}
      </span>
    </div>
  );
}
```

在时间线渲染处（遍历 `items` 的 switch/三元）增加 `item.kind === 'call'` 分支渲染 `<CallRecordBubble item={item} />`。

- [ ] **Step 3: `IncomingCallPrompt.tsx`**

```tsx
import { Phone, PhoneOff } from 'lucide-react';

export function IncomingCallPrompt({
  onAccept,
  onReject,
}: {
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <span className="text-sm font-medium">语音通话来电…</span>
      <div className="flex gap-2">
        <button
          onClick={onReject}
          className="inline-flex size-10 items-center justify-center rounded-full bg-destructive text-white"
          aria-label="拒绝"
        >
          <PhoneOff className="size-5" />
        </button>
        <button
          onClick={onAccept}
          className="inline-flex size-10 items-center justify-center rounded-full bg-green-600 text-white"
          aria-label="接听"
        >
          <Phone className="size-5" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `CallPanel.tsx`（通话条：dialing/connecting/active/reconnecting）**

```tsx
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CallUiState } from '../../state/conversation-store';

const TEXT: Record<string, string> = {
  dialing: '正在呼叫…',
  connecting: '接通中…',
  active: '',
  reconnecting: '重连中…',
};

function useElapsed(active: boolean): string {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) {
      setS(0);
      return;
    }
    const t = setInterval(() => setS(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function CallPanel({
  call,
  onHangup,
  onToggleMute,
}: {
  call: CallUiState;
  onHangup: () => void;
  onToggleMute: () => void;
}) {
  const active = call.state === 'active';
  const elapsed = useElapsed(active);
  if (call.state === 'idle' || call.state === 'ringing') return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2 shadow-sm">
      <span className="text-sm">{active ? elapsed : TEXT[call.state]}</span>
      <div className="flex gap-2">
        <button
          onClick={onToggleMute}
          disabled={!active}
          className="inline-flex size-9 items-center justify-center rounded-full bg-muted disabled:opacity-50"
          aria-label={call.muted ? '取消静音' : '静音'}
        >
          {call.muted ? (
            <MicOff className="size-4.5" />
          ) : (
            <Mic className="size-4.5" />
          )}
        </button>
        <button
          onClick={onHangup}
          className="inline-flex size-9 items-center justify-center rounded-full bg-destructive text-white"
          aria-label="挂断"
        >
          <PhoneOff className="size-4.5" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 静音实现（本地 track.enabled）**

静音切换需要操作本地音频 sender 的 `track.enabled`。在 `PeerConnection` 加方法：

```ts
  setMicEnabled(enabled: boolean): void {
    for (const sender of this.localSenders) {
      if (sender.track) sender.track.enabled = enabled;
    }
  }
```

`ConversationHandle` 暴露 `setMicEnabled`，`startConversation` return 加 `setMicEnabled: e => peer?.setMicEnabled(e)`，`SessionManager` 加：

```ts
  toggleMute(id: string, muted: boolean): void {
    this.handles.get(id)?.setMicEnabled(!muted);
    this.store.setCallMuted(id, muted);
  }
```

- [ ] **Step 6: Composer 加「拨打」键**

在 `Composer.tsx` 工具区（与语音消息麦克风并列）加一个电话图标按钮：

```tsx
import { PhoneCall } from 'lucide-react';
// ...
<button
  type="button"
  onClick={onDial}
  disabled={callBusy || connection !== 'connected'}
  className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground disabled:opacity-40"
  aria-label="语音通话"
>
  <PhoneCall className="size-5" />
</button>;
```

`onDial` 与 `callBusy`（= `call.state !== 'idle'`）由父容器传入。

- [ ] **Step 7: 容器组件接线**

在渲染会话的容器组件中（路径见文件结构表下方「注意」预备步骤）：从 `useRoomsStore` 取当前 session 的 `call`，从 SessionManager 单例取操作方法，渲染：

- `call.state === 'ringing'` → `<IncomingCallPrompt onAccept={() => sm.acceptCall(id)} onReject={() => sm.rejectCall(id)} />`
- `call.state ∈ {dialing,connecting,active,reconnecting}` → `<CallPanel call={call} onHangup={() => sm.hangupCall(id)} onToggleMute={() => sm.toggleMute(id, !call.muted)} />`
- Composer 传 `onDial={() => sm.dialCall(id)}`、`callBusy={call.state !== 'idle'}`
- `call.error` 用现有 sonner `toast.error(...)` 提示后调 `setCallError(id, undefined)` 清空（用 `useEffect` 监听 `call.error`）。错误文案映射：`unsupported→对方设备不支持语音通话`、`no-mic→对方无可用麦克风`、`permission-denied→对方拒绝了麦克风权限`、`declined→对方拒绝接听`、`busy→对方正在通话中`。

- [ ] **Step 8: typecheck + lint + build**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web lint && pnpm --filter @peerlink/web build`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add apps/web/src/features/chat apps/web/src/core/peer-connection.ts apps/web/src/core/conversation.ts apps/web/src/core/session-manager.ts
git commit -m "feat(web): voice call UI — dial button, call panel, incoming prompt, timeline record"
```

---

## Task 9: 全量校验 + 手测清单

- [ ] **Step 1: 全量校验**

Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm build`
Expected: 全 PASS。

- [ ] **Step 2: 浏览器双开手测（用户执行）**

两个标签页进同一房间，DataChannel 连上后逐项验证：

1. A 拨打 → B 振铃弹层 → B 接听 → 双向能听到声音，A/B 均显示计时。
2. 通话中 A 静音 → B 听不到 A；A 取消静音恢复。
3. A 挂断 → 两端回到 idle，时间线各留「通话时长 mm:ss」。
4. A 拨打 → B 拒绝 → A toast「对方拒绝接听」，两端时间线留记录。
5. A 拨打 → B 不接，30s 后 → A「对方未接听」、B「未接来电」。
6. 通话中拔网/切网 → 显示「重连中」，8s 内恢复继续；超时则「通话中断」。
7. 通话进行中，再次点拨打键应禁用（排他）。
8. B 禁用麦克风权限后接听 → 回 A「对方拒绝了麦克风权限」。

- [ ] **Step 3: 更新文档（可选）**

如 README/CLAUDE.md 需登记新功能，按需更新（不新建 .md）。

---

## 自检对照（spec → task）

- 呼叫模型/振铃 → Task 4（dial/accept/reject + ring timeout）✅
- 信令路径方案 A（控制走 DataChannel）→ Task 1 + Task 5 ✅
- renegotiation 固定 initiator 发 offer → Task 2（renegotiate）+ Task 4（isInitiator 分支）✅
- 排他 busy → Task 4（onInvite 非 idle 回 busy）✅
- glare 裁决 → Task 4（dialing + 非 initiator 转 ringing）✅
- 能力检测 → Task 3（acquireMic）+ Task 4（dial/accept 失败分支）✅
- 标准 UI（计时/静音/状态）→ Task 8 ✅
- 断连恢复（8s 宽限）→ Task 4（onConnectionState）+ Task 5（notifyConnectionState）✅
- 接通以远端轨为准 → Task 4（onRemoteAudio）+ Task 5（handleRemoteTrack）✅
- 时间线记录 → Task 6 + Task 8（CallRecordBubble）✅
- 会话销毁收尾 → Task 4（dispose）+ Task 5（closeRemote→dispose）✅
- 测试策略（纯逻辑 TDD + mock 契约）→ Task 1–4 ✅
