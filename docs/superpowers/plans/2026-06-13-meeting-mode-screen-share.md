# 会议模式（双人）+ 屏幕共享 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 1v1 通话之上加屏幕共享，使「通话」升级为「会议」（语音 + 文字 + 一方共享屏幕，一次一个演示者，只传画面）。

**Architecture:** 复用 `call-session` 语音核心不改其状态机；新增纯逻辑模块 `screen-share.ts` 管理「谁在演示」并通过一条可复用的 video transceiver + 固定 initiator 端 renegotiation 完成媒体协商；协议加 `screen-start`/`screen-stop` 两个控制帧走已有 DataChannel；UI 在 `CallPanel` 加共享按钮与「视频 + 可叠加层」容器（为后续涂鸦预留）。

**Tech Stack:** TypeScript（全 ESM）、zod（协议校验）、WebRTC（`RTCRtpTransceiver` / `getDisplayMedia`）、React 19 + Tailwind v4、Vitest（`*.spec.ts` 同目录共置）。

参考 spec：`docs/superpowers/specs/2026-06-13-meeting-mode-screen-share-design.md`

---

## File Structure

- `packages/protocol/src/control.ts`（改）— 新增 `screen-start`/`screen-stop` schema，加入 `controlMessageSchema`。
- `packages/protocol/src/control.spec.ts`（改）— 新帧解析用例。
- `apps/web/src/core/peer-connection.ts`（改）— 新增 `setScreenTrack`/`prepareRecvVideo`/`clearScreenTrack` + 复用 video transceiver。
- `apps/web/src/core/peer-connection.spec.ts`（改）— transceiver 方向翻转/replaceTrack 契约。
- `apps/web/src/core/screen-share.ts`（新）— 纯逻辑屏幕共享状态机。
- `apps/web/src/core/screen-share.spec.ts`（新）— 四种 renegotiation 时序 + 守卫 + onended + getDisplayMedia 失败。
- `apps/web/src/core/call-session.ts`（改）— 加只读 `currentCallId()` 访问器（供屏幕共享绑定 callId）。
- `apps/web/src/core/conversation.ts`（改）— 实例化 `ScreenShare`、路由 `screen-*`、`handleRemoteTrack` 按 kind 分流、暴露 `startScreenShare`/`stopScreenShare`、`closeRemote` 复位。
- `apps/web/src/state/conversation-store.ts`（改）— `CallUiState` 加 `screen` 字段 + `setScreenState` action。
- `apps/web/src/core/session-manager.ts`（改）— 屏幕流 maps、`startScreenShare`/`stopScreenShare`/`getScreenStream`、屏幕回调接线、会议结束清理。
- `apps/web/src/features/chat/CallPanel.tsx`（改）— 共享按钮 + 视频容器；文案「会议」。
- `apps/web/src/features/chat/ConversationView.tsx`（改）— 向 `CallPanel` 传屏幕状态/流/回调。

---

## Task 1: 协议层新增 screen-start / screen-stop 控制帧

**Files:**

- Modify: `packages/protocol/src/control.ts`
- Test: `packages/protocol/src/control.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/protocol/src/control.spec.ts` 末尾、最后一个 `});`（`describe` 收尾）之前追加：

```ts
it('accepts screen-start / screen-stop with callId', () => {
  expect(
    controlMessageSchema.parse({ type: 'screen-start', callId: 7 })
  ).toEqual({ type: 'screen-start', callId: 7 });
  expect(
    controlMessageSchema.parse({ type: 'screen-stop', callId: 7 })
  ).toEqual({ type: 'screen-stop', callId: 7 });
});

it('requires callId on screen-start', () => {
  expect(() => controlMessageSchema.parse({ type: 'screen-start' })).toThrow();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/protocol test -- control.spec`
Expected: FAIL（`screen-start` 不在 union，parse 抛错 / 用例不通过）

- [ ] **Step 3: 实现**

在 `packages/protocol/src/control.ts` 的 `callEnd` 定义之后、`controlMessageSchema` 之前加：

```ts
const screenStart = z.object({
  type: z.literal('screen-start'),
  callId: z.number().int().nonnegative(),
});
const screenStop = z.object({
  type: z.literal('screen-stop'),
  callId: z.number().int().nonnegative(),
});
```

并把 `screenStart, screenStop` 加进 `controlMessageSchema` 的 `discriminatedUnion` 数组（紧跟 `callEnd` 之后）：

```ts
export const controlMessageSchema = z.discriminatedUnion('type', [
  chat,
  manifest,
  accept,
  reject,
  fileComplete,
  transferComplete,
  cancel,
  voiceStart,
  voiceComplete,
  callInvite,
  callAccept,
  callReject,
  callEnd,
  screenStart,
  screenStop,
]);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/protocol test -- control.spec`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/control.ts packages/protocol/src/control.spec.ts
git commit -m "feat(protocol): add screen-start/screen-stop control frames"
```

---

## Task 2: peer-connection 复用 video transceiver

**Files:**

- Modify: `apps/web/src/core/peer-connection.ts`
- Test: `apps/web/src/core/peer-connection.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/core/peer-connection.spec.ts` 末尾追加（`richPc` 已含 `addEventListener`/`dispatch`；这里补一个带 `addTransceiver` 的 fake）：

```ts
function pcWithTransceiver() {
  const sender = { replaceTrack: vi.fn(async () => {}) };
  const transceiver = {
    sender,
    direction: 'inactive' as RTCRtpTransceiverDirection,
  };
  return {
    base: {
      createDataChannel: vi.fn(() => ({
        binaryType: '',
        addEventListener: vi.fn(),
      })),
      createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'O' })),
      setLocalDescription: vi.fn(async () => {}),
      setRemoteDescription: vi.fn(async () => {}),
      addIceCandidate: vi.fn(async () => {}),
      addTransceiver: vi.fn(() => transceiver),
      close: vi.fn(),
      addEventListener: vi.fn(),
    },
    transceiver,
    sender,
  };
}

describe('PeerConnection screen video', () => {
  it('setScreenTrack reuses one transceiver, attaches track, sendonly', () => {
    const { base, transceiver, sender } = pcWithTransceiver();
    const conn = new PeerConnection({
      iceServers: [],
      createPc: () => base as unknown as RTCPeerConnection,
    });
    const track = { kind: 'video' } as MediaStreamTrack;
    conn.setScreenTrack(track);
    conn.setScreenTrack(track); // 第二次复用同一 transceiver
    expect(base.addTransceiver).toHaveBeenCalledTimes(1);
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(track);
    expect(transceiver.direction).toBe('sendonly');
  });

  it('prepareRecvVideo sets recvonly; clearScreenTrack clears + inactive', () => {
    const { base, transceiver, sender } = pcWithTransceiver();
    const conn = new PeerConnection({
      iceServers: [],
      createPc: () => base as unknown as RTCPeerConnection,
    });
    conn.prepareRecvVideo();
    expect(transceiver.direction).toBe('recvonly');
    conn.clearScreenTrack();
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(null);
    expect(transceiver.direction).toBe('inactive');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- peer-connection.spec`
Expected: FAIL（`setScreenTrack` 等方法不存在）

- [ ] **Step 3: 实现**

在 `apps/web/src/core/peer-connection.ts` 的 `class PeerConnection` 内，`localSenders` 字段下方加字段：

```ts
  private videoTransceiver?: RTCRtpTransceiver;
```

在 `setMicEnabled` 方法之后加：

```ts
  private ensureVideoTransceiver(): RTCRtpTransceiver {
    if (!this.videoTransceiver) {
      this.videoTransceiver = this.pc.addTransceiver('video', {
        direction: 'inactive',
      });
    }
    return this.videoTransceiver;
  }

  /** 我开始演示：挂上屏幕视频轨，方向 sendonly。 */
  setScreenTrack(track: MediaStreamTrack): void {
    const tr = this.ensureVideoTransceiver();
    void tr.sender.replaceTrack(track);
    tr.direction = 'sendonly';
  }

  /** 对方要演示前（仅原始 initiator 调）：预置 recvonly 收口。 */
  prepareRecvVideo(): void {
    this.ensureVideoTransceiver().direction = 'recvonly';
  }

  /** 停止演示（任意一方）：卸轨，方向 inactive（保留同一条 m-line 复用）。 */
  clearScreenTrack(): void {
    if (!this.videoTransceiver) return;
    void this.videoTransceiver.sender.replaceTrack(null);
    this.videoTransceiver.direction = 'inactive';
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- peer-connection.spec`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/peer-connection.ts apps/web/src/core/peer-connection.spec.ts
git commit -m "feat(web): reusable video transceiver on peer-connection for screen share"
```

---

## Task 3: call-session 暴露 currentCallId 访问器

**Files:**

- Modify: `apps/web/src/core/call-session.ts`
- Test: `apps/web/src/core/call-session.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/core/call-session.spec.ts` 末尾、最后一个 `});` 之前追加（沿用该文件已有的 deps 构造方式；如文件已有 `makeSession()`/`makeDeps()` 辅助则复用之，下面用最小内联依赖）：

```ts
it('currentCallId is null when idle and a number while dialing', async () => {
  let id: number | null = null;
  const session = new CallSession({
    isInitiator: true,
    sendControl: () => {},
    acquireMic: async () => ({}) as MediaStream,
    addLocalAudio: () => {},
    removeLocalAudio: () => {},
    renegotiate: async () => {},
    genCallId: () => 42,
    now: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    callbacks: {},
  });
  expect(session.currentCallId()).toBeNull();
  await session.dial();
  id = session.currentCallId();
  expect(id).toBe(42);
});
```

> 注：若 `call-session.spec.ts` 顶部缺少 `import { CallSession } from './call-session';` 则补上。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- call-session.spec`
Expected: FAIL（`currentCallId` 不存在）

- [ ] **Step 3: 实现**

在 `apps/web/src/core/call-session.ts` 的 `class CallSession` 内、`constructor` 之后、`// ---- 本端动作 ----` 注释之前加：

```ts
  /** 当前会议的 callId；idle 时为 null。供屏幕共享绑定。 */
  currentCallId(): number | null {
    return this.callId;
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- call-session.spec`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/call-session.ts apps/web/src/core/call-session.spec.ts
git commit -m "feat(web): expose currentCallId() on CallSession"
```

---

## Task 4: screen-share 纯逻辑状态机

**Files:**

- Create: `apps/web/src/core/screen-share.ts`
- Test: `apps/web/src/core/screen-share.spec.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/web/src/core/screen-share.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';

import { ScreenShare, type ScreenShareDeps } from './screen-share';

function fakeTrack(): MediaStreamTrack {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    kind: 'video',
    stop: vi.fn(),
    addEventListener: vi.fn((t: string, cb: () => void) => {
      (listeners[t] ??= []).push(cb);
    }),
    removeEventListener: vi.fn(),
    dispatch: (t: string) => (listeners[t] ?? []).forEach(cb => cb()),
  } as unknown as MediaStreamTrack & { dispatch: (t: string) => void };
}

function fakeStream(track: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function setup(overrides: Partial<ScreenShareDeps> = {}) {
  const track = fakeTrack();
  const calls = {
    sendControl: vi.fn(),
    setScreenTrack: vi.fn(),
    prepareRecvVideo: vi.fn(),
    clearScreenTrack: vi.fn(),
    renegotiate: vi.fn(async () => {}),
    onStateChange: vi.fn(),
    onLocalStream: vi.fn(),
    onError: vi.fn(),
  };
  const deps: ScreenShareDeps = {
    isInitiator: true,
    sendControl: calls.sendControl,
    acquireDisplay: async () => fakeStream(track),
    setScreenTrack: calls.setScreenTrack,
    prepareRecvVideo: calls.prepareRecvVideo,
    clearScreenTrack: calls.clearScreenTrack,
    renegotiate: calls.renegotiate,
    getCallId: () => 9,
    callbacks: {
      onStateChange: calls.onStateChange,
      onLocalStream: calls.onLocalStream,
      onError: calls.onError,
    },
    ...overrides,
  };
  return { ss: new ScreenShare(deps), calls, track };
}

describe('ScreenShare', () => {
  it('initiator start: attach track, renegotiate, send screen-start, state local', async () => {
    const { ss, calls, track } = setup({ isInitiator: true });
    await ss.start();
    expect(calls.setScreenTrack).toHaveBeenCalledWith(track);
    expect(calls.renegotiate).toHaveBeenCalledTimes(1);
    expect(calls.sendControl).toHaveBeenCalledWith({
      type: 'screen-start',
      callId: 9,
    });
    expect(ss.state).toBe('local');
    expect(calls.onLocalStream).toHaveBeenCalled();
  });

  it('non-initiator start: attach + send screen-start but does NOT renegotiate', async () => {
    const { ss, calls } = setup({ isInitiator: false });
    await ss.start();
    expect(calls.setScreenTrack).toHaveBeenCalled();
    expect(calls.sendControl).toHaveBeenCalledWith({
      type: 'screen-start',
      callId: 9,
    });
    expect(calls.renegotiate).not.toHaveBeenCalled();
    expect(ss.state).toBe('local');
  });

  it('initiator receiving screen-start: prepareRecvVideo + renegotiate, state remote', async () => {
    const { ss, calls } = setup({ isInitiator: true });
    await ss.onControl({ type: 'screen-start', callId: 9 });
    expect(calls.prepareRecvVideo).toHaveBeenCalledTimes(1);
    expect(calls.renegotiate).toHaveBeenCalledTimes(1);
    expect(ss.state).toBe('remote');
  });

  it('non-initiator receiving screen-start: just go remote, no renegotiate', async () => {
    const { ss, calls } = setup({ isInitiator: false });
    await ss.onControl({ type: 'screen-start', callId: 9 });
    expect(calls.prepareRecvVideo).not.toHaveBeenCalled();
    expect(calls.renegotiate).not.toHaveBeenCalled();
    expect(ss.state).toBe('remote');
  });

  it('start is a no-op while remote is presenting (guard)', async () => {
    const { ss, calls } = setup();
    await ss.onControl({ type: 'screen-start', callId: 9 }); // state remote
    calls.setScreenTrack.mockClear();
    await ss.start();
    expect(calls.setScreenTrack).not.toHaveBeenCalled();
    expect(ss.state).toBe('remote');
  });

  it('presenter stop: clear track, stop stream, send screen-stop, state none', async () => {
    const { ss, calls, track } = setup({ isInitiator: true });
    await ss.start();
    await ss.stop();
    expect(calls.clearScreenTrack).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(calls.sendControl).toHaveBeenLastCalledWith({
      type: 'screen-stop',
      callId: 9,
    });
    expect(calls.onLocalStream).toHaveBeenLastCalledWith(null);
    expect(ss.state).toBe('none');
  });

  it('initiator receiving screen-stop: clear + renegotiate, state none', async () => {
    const { ss, calls } = setup({ isInitiator: true });
    await ss.onControl({ type: 'screen-start', callId: 9 }); // remote
    calls.renegotiate.mockClear();
    await ss.onControl({ type: 'screen-stop', callId: 9 });
    expect(calls.clearScreenTrack).toHaveBeenCalled();
    expect(calls.renegotiate).toHaveBeenCalledTimes(1);
    expect(ss.state).toBe('none');
  });

  it('native Stop sharing (track ended) auto-stops', async () => {
    const { ss, calls, track } = setup({ isInitiator: true });
    await ss.start();
    (track as unknown as { dispatch: (t: string) => void }).dispatch('ended');
    await Promise.resolve();
    expect(calls.clearScreenTrack).toHaveBeenCalled();
    expect(ss.state).toBe('none');
  });

  it('getDisplayMedia denial → onError, stays none', async () => {
    const err = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    const { ss, calls } = setup({
      acquireDisplay: async () => {
        throw err;
      },
    });
    await ss.start();
    expect(calls.onError).toHaveBeenCalledWith('permission-denied');
    expect(ss.state).toBe('none');
  });

  it('start no-ops when not in a call (callId null)', async () => {
    const { ss, calls } = setup({ getCallId: () => null });
    await ss.start();
    expect(calls.setScreenTrack).not.toHaveBeenCalled();
    expect(ss.state).toBe('none');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- screen-share.spec`
Expected: FAIL（`./screen-share` 不存在）

- [ ] **Step 3: 实现**

创建 `apps/web/src/core/screen-share.ts`：

```ts
export type ScreenState = 'none' | 'local' | 'remote';

export type ScreenControl =
  | { type: 'screen-start'; callId: number }
  | { type: 'screen-stop'; callId: number };

export type ScreenError = 'permission-denied' | 'unsupported';

export interface ScreenShareDeps {
  isInitiator: boolean;
  sendControl: (m: ScreenControl) => void;
  acquireDisplay: () => Promise<MediaStream>;
  setScreenTrack: (track: MediaStreamTrack) => void;
  prepareRecvVideo: () => void;
  clearScreenTrack: () => void;
  renegotiate: () => Promise<void>;
  /** 取 call-session 当前 callId；不在会议中为 null。 */
  getCallId: () => number | null;
  callbacks: {
    onStateChange?: (state: ScreenState) => void;
    onLocalStream?: (stream: MediaStream | null) => void;
    onError?: (reason: ScreenError) => void;
  };
}

/** 纯逻辑屏幕共享状态机：一次一个演示者，固定 initiator 端 renegotiation。 */
export class ScreenShare {
  state: ScreenState = 'none';
  private localStream: MediaStream | null = null;

  constructor(private d: ScreenShareDeps) {}

  /** 本端发起共享。 */
  async start(): Promise<void> {
    if (this.state !== 'none') return;
    const callId = this.d.getCallId();
    if (callId === null) return;
    let stream: MediaStream;
    try {
      stream = await this.d.acquireDisplay();
    } catch (err) {
      this.d.callbacks.onError?.(reasonOf(err));
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stopStream(stream);
      this.d.callbacks.onError?.('unsupported');
      return;
    }
    this.localStream = stream;
    track.addEventListener('ended', this.onTrackEnded);
    this.d.setScreenTrack(track);
    this.setState('local');
    this.d.callbacks.onLocalStream?.(stream);
    this.d.sendControl({ type: 'screen-start', callId });
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  /** 本端停止共享。 */
  async stop(): Promise<void> {
    if (this.state !== 'local') return;
    const callId = this.d.getCallId();
    this.teardownLocal();
    this.d.clearScreenTrack();
    this.setState('none');
    if (callId !== null) this.d.sendControl({ type: 'screen-stop', callId });
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  /** 处理对端屏幕控制帧。 */
  async onControl(msg: ScreenControl): Promise<void> {
    if (msg.type === 'screen-start') {
      if (this.state !== 'none') return; // 已有人演示，忽略（按钮侧已置灰）
      this.setState('remote');
      if (this.d.isInitiator) {
        this.d.prepareRecvVideo();
        await this.d.renegotiate();
      }
      return;
    }
    // screen-stop
    if (this.state !== 'remote') return;
    this.d.clearScreenTrack();
    this.setState('none');
    if (this.d.isInitiator) await this.d.renegotiate();
  }

  /** 会议结束/对端离开：强制复位（不发控制帧、不 renegotiate）。 */
  dispose(): void {
    if (this.state === 'local') this.teardownLocal();
    if (this.state !== 'none') {
      this.d.clearScreenTrack();
      this.setState('none');
    }
  }

  private onTrackEnded = (): void => {
    void this.stop();
  };

  private teardownLocal(): void {
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) {
        t.removeEventListener('ended', this.onTrackEnded);
        t.stop();
      }
      this.localStream = null;
    }
    this.d.callbacks.onLocalStream?.(null);
  }

  private setState(s: ScreenState): void {
    this.state = s;
    this.d.callbacks.onStateChange?.(s);
  }
}

function reasonOf(err: unknown): ScreenError {
  return (err as { name?: string })?.name === 'NotAllowedError'
    ? 'permission-denied'
    : 'unsupported';
}

function stopStream(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- screen-share.spec`
Expected: PASS（11 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/screen-share.ts apps/web/src/core/screen-share.spec.ts
git commit -m "feat(web): screen-share state machine (one presenter, initiator-driven renegotiation)"
```

---

## Task 5: conversation 接线屏幕共享

**Files:**

- Modify: `apps/web/src/core/conversation.ts`
- Test: `apps/web/src/core/conversation.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/core/conversation.spec.ts` 末尾、最后一个 `});` 之前追加（沿用该文件已有的 `Conversation` 构造辅助；下面假设可直接 `new Conversation(deps)`，若该文件已有 `makeConversation()`/`makeDeps()` 工厂则改用之并仅补 4 个屏幕依赖）：

```ts
it('routes screen-start to screen share and splits video tracks', async () => {
  const sent: unknown[] = [];
  const setScreenTrack = vi.fn();
  const onRemoteScreenTrack = vi.fn();
  const conv = new Conversation({
    channel: {
      send: b => sent.push(b),
      bufferedAmount: 0,
      waitForDrain: async () => {},
    },
    makeWriter: async () => ({}) as never,
    isInitiator: true,
    renegotiate: async () => {},
    addLocalAudio: () => {},
    removeLocalAudio: () => {},
    setScreenTrack,
    prepareRecvVideo: vi.fn(),
    clearScreenTrack: vi.fn(),
    callbacks: { onRemoteScreenTrack },
  });
  // 视频轨走屏幕回调，不当成接通信号
  conv.handleRemoteTrack({ kind: 'video' } as MediaStreamTrack);
  expect(onRemoteScreenTrack).toHaveBeenCalledTimes(1);
});
```

> 注：测试顶部如未引入 `vi` 需补 `import { ... vi } from 'vitest';`。`ConversationDeps` 新增的 4 个屏幕字段在 Step 3 定义。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation.spec`
Expected: FAIL（`setScreenTrack` 不是合法 dep / `onRemoteScreenTrack` 未触发）

- [ ] **Step 3: 实现**

3a. 顶部 import 加入：

```ts
import { ScreenShare, type ScreenControl } from './screen-share';
```

3b. `ConversationCallbacks` 接口内（紧跟 `onRemoteAudioTrack?` 之后）加：

```ts
  onScreenStateChange?: (state: import('./screen-share').ScreenState) => void;
  onLocalScreenStream?: (stream: MediaStream | null) => void;
  onRemoteScreenTrack?: (track: MediaStreamTrack) => void;
  onScreenError?: (reason: import('./screen-share').ScreenError) => void;
```

3c. `ConversationDeps` 接口内（紧跟 `removeLocalAudio` 之后）加：

```ts
  setScreenTrack: (track: MediaStreamTrack) => void;
  prepareRecvVideo: () => void;
  clearScreenTrack: () => void;
```

3d. `class Conversation` 内，`private call: CallSession;` 下加字段：

```ts
  private screen: ScreenShare;
```

3e. 在 `constructor` 里 `this.call = new CallSession({...});` 之后加：

```ts
this.screen = new ScreenShare({
  isInitiator: deps.isInitiator,
  sendControl: (m: ScreenControl) => this.channel.send(encodeControlFrame(m)),
  acquireDisplay: () => navigator.mediaDevices.getDisplayMedia({ video: true }),
  setScreenTrack: deps.setScreenTrack,
  prepareRecvVideo: deps.prepareRecvVideo,
  clearScreenTrack: deps.clearScreenTrack,
  renegotiate: deps.renegotiate,
  getCallId: () => this.call.currentCallId(),
  callbacks: {
    onStateChange: s => this.cb.onScreenStateChange?.(s),
    onLocalStream: s => this.cb.onLocalScreenStream?.(s),
    onError: r => this.cb.onScreenError?.(r),
  },
});
```

3f. 公开方法：在 `hangupCall()` 方法之后加：

```ts
  startScreenShare(): Promise<void> {
    return this.screen.start();
  }
  stopScreenShare(): Promise<void> {
    return this.screen.stop();
  }
```

3g. `handleRemoteTrack` 改为按 kind 分流：

```ts
  /** 由 peer 的 'track' 事件驱动。 */
  handleRemoteTrack(track: MediaStreamTrack): void {
    if (track.kind === 'video') {
      this.cb.onRemoteScreenTrack?.(track);
      return;
    }
    this.call.onRemoteAudio();
    this.cb.onRemoteAudioTrack?.(track);
  }
```

3h. 控制帧路由：在 `case 'call-end': this.call.onControl(msg); return;` 之后加：

```ts
      case 'screen-start':
      case 'screen-stop':
        await this.screen.onControl(msg);
        return;
```

3i. `closeRemote()` 内 `this.call.dispose();` 之后加：

```ts
this.screen.dispose();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @peerlink/web test -- conversation.spec`
Expected: PASS

- [ ] **Step 5: 接线 handle 与 startConversation**

5a. `ConversationHandle` 接口内（`hangupCall` 之后）加：

```ts
startScreenShare: () => Promise<void>;
stopScreenShare: () => Promise<void>;
```

5b. `startConversation` 里 `new Conversation({...})` 的 deps 中（`renegotiate` 行之后）加：

```ts
    setScreenTrack: t => peer?.setScreenTrack(t),
    prepareRecvVideo: () => peer?.prepareRecvVideo(),
    clearScreenTrack: () => peer?.clearScreenTrack(),
```

5c. `startConversation` 末尾 `return { ... }` 对象里（`hangupCall` 之后）加：

```ts
    startScreenShare: () => conv.startScreenShare(),
    stopScreenShare: () => conv.stopScreenShare(),
```

- [ ] **Step 6: 类型检查 + 提交**

Run: `pnpm --filter @peerlink/web typecheck`
Expected: 无错误

```bash
git add apps/web/src/core/conversation.ts apps/web/src/core/conversation.spec.ts
git commit -m "feat(web): wire screen-share into conversation orchestrator"
```

---

## Task 6: store 增加 screen 子状态

**Files:**

- Modify: `apps/web/src/state/conversation-store.ts`
- Test: `apps/web/src/state/conversation-store.spec.ts`（若存在；否则在本任务末尾随实现做 typecheck 并跳过测试步骤）

- [ ] **Step 1: 写失败测试**

若 `apps/web/src/state/conversation-store.spec.ts` 存在，在其末尾、最后一个 `});` 之前追加（沿用该文件已有的 store 创建/`addSession` 辅助）：

```ts
it('setScreenState updates a session call.screen', () => {
  const store = useConversationStore.getState();
  store.addSession('s1', null);
  store.setScreenState('s1', 'local');
  expect(useConversationStore.getState().sessions['s1'].call.screen).toBe(
    'local'
  );
});
```

> 注：导入名以该文件现有写法为准（如 `useConversationStore` / `useRoomsStore`）。若无 spec 文件，跳过 Step 1–2、4，仅做实现 + typecheck。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- conversation-store.spec`
Expected: FAIL（`screen` 字段 / `setScreenState` 不存在）

- [ ] **Step 3: 实现**

3a. 顶部从 core 引入类型（与现有 `CallState`/`CallDir`/`CallRecord` 的 import 同处）：

```ts
import type { ScreenState } from '@/core/screen-share';
```

3b. `CallUiState` 接口加字段：

```ts
export interface CallUiState {
  state: CallState;
  dir: CallDir | null;
  error?: string;
  muted: boolean;
  screen: ScreenState;
}
```

3c. 找到创建初始 `CallUiState` 的地方（`addSession` 内构造 `call: { state: 'idle', dir: null, muted: false }`），补 `screen: 'none'`：

```ts
      call: { state: 'idle', dir: null, muted: false, screen: 'none' },
```

3d. `RoomsState` 接口里（`setCallMuted` 之后）加 action 声明：

```ts
  setScreenState(id: string, screen: ScreenState): void;
```

3e. 在 store 实现里（`setCallMuted` 的实现之后）加：

```ts
  setScreenState: (id, screen) =>
    set(state =>
      patchSession(state, id, s => ({ ...s, call: { ...s.call, screen } }))
    ),
```

> 注：若会议结束时 `setCallState(id, 'idle', null)` 也应顺带把 `screen` 复位，可在 `setCallState` 的 `'idle'` 分支里同时重置 `screen: 'none'`；否则由 session-manager 在 idle 回调显式调用 `setScreenState(id, 'none')`（本计划采用后者，见 Task 7）。

- [ ] **Step 4: 运行测试确认通过 / typecheck**

Run: `pnpm --filter @peerlink/web test -- conversation-store.spec`（无 spec 则跳过）
Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS / 无错误

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/state/conversation-store.ts apps/web/src/state/conversation-store.spec.ts
git commit -m "feat(web): add screen sub-state to CallUiState"
```

---

## Task 7: session-manager 接线屏幕流与动作

**Files:**

- Modify: `apps/web/src/core/session-manager.ts`
- Test: `apps/web/src/core/session-manager.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/core/session-manager.spec.ts` 末尾、最后一个 `});` 之前追加（沿用该文件已有的 manager/store/handle mock 辅助；下面只断言「调用转发」契约）：

```ts
it('startScreenShare / stopScreenShare delegate to the handle', () => {
  const startScreenShare = vi.fn(async () => {});
  const stopScreenShare = vi.fn(async () => {});
  // 用该文件已有的方式建一个 manager 并注入带上述两个方法的 handle，
  // 关联 id 'a'（与现有 dialCall/hangupCall 测试同款 mock 路径）。
  const { manager } = makeManagerWithHandle('a', {
    startScreenShare,
    stopScreenShare,
  });
  manager.startScreenShare('a');
  manager.stopScreenShare('a');
  expect(startScreenShare).toHaveBeenCalledTimes(1);
  expect(stopScreenShare).toHaveBeenCalledTimes(1);
});
```

> 注：`makeManagerWithHandle` 为占位——请套用该 spec 文件中**已有**的 manager 构造/handle 注入辅助（参考既有的 `dialCall`/`hangupCall`/`toggleMute` 测试），仅把 handle 的 `startScreenShare`/`stopScreenShare` 加进 mock。若现有 mock handle 是完整对象，给它补这两个方法即可。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @peerlink/web test -- session-manager.spec`
Expected: FAIL（`manager.startScreenShare` 不存在）

- [ ] **Step 3: 实现**

3a. `class SessionManager` 内，已有 `audioEls` 字段附近加两个屏幕流 map：

```ts
  private localScreens = new Map<string, MediaStream>();
  private remoteScreens = new Map<string, MediaStream>();
```

3b. 在 `toggleMute` 方法之后加动作与读取：

```ts
  startScreenShare(id: string): void {
    void this.handles.get(id)?.startScreenShare();
  }

  stopScreenShare(id: string): void {
    void this.handles.get(id)?.stopScreenShare();
  }

  /** 当前应展示的屏幕流：本端演示给本地预览，对端演示给远端画面。 */
  getScreenStream(id: string): MediaStream | null {
    return this.localScreens.get(id) ?? this.remoteScreens.get(id) ?? null;
  }
```

3c. 私有清理方法（放在 `stopRemote` 之后）：

```ts
  private clearScreens(id: string): void {
    this.localScreens.delete(id);
    const rs = this.remoteScreens.get(id);
    if (rs) {
      for (const t of rs.getTracks()) t.stop();
      this.remoteScreens.delete(id);
    }
  }
```

3d. `callbacks(id)` 返回对象里，`onRemoteAudioTrack` 之后加屏幕回调：

```ts
      onScreenStateChange: state => {
        this.store.setScreenState(id, state);
        if (state === 'none') this.clearScreens(id);
      },
      onLocalScreenStream: stream => {
        if (stream) this.localScreens.set(id, stream);
        else this.localScreens.delete(id);
      },
      onRemoteScreenTrack: track => {
        this.remoteScreens.set(id, new MediaStream([track]));
      },
      onScreenError: () => {
        // 共享失败（取消/无权限）：状态由模块回到 none，这里可选 toast
      },
```

3e. 会议结束清理：在 `onCallStateChange` 回调里，已有 `if (state === 'idle') this.stopRemote(id);` 之后补：

```ts
if (state === 'idle') {
  this.store.setScreenState(id, 'none');
  this.clearScreens(id);
}
```

3f. `closeAll()` 内（`stopRemote` 循环附近）加：

```ts
for (const id of [...this.remoteScreens.keys()]) this.clearScreens(id);
```

- [ ] **Step 4: 运行测试确认通过 + typecheck**

Run: `pnpm --filter @peerlink/web test -- session-manager.spec`
Run: `pnpm --filter @peerlink/web typecheck`
Expected: PASS / 无错误

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/session-manager.ts apps/web/src/core/session-manager.spec.ts
git commit -m "feat(web): session-manager screen-share actions and stream routing"
```

---

## Task 8: CallPanel 共享按钮 + 视频容器；文案「会议」

**Files:**

- Modify: `apps/web/src/features/chat/CallPanel.tsx`
- Modify: `apps/web/src/features/chat/ConversationView.tsx`

> apps/web 无 testing-library，UI 不写渲染测试，靠 `typecheck` + `lint` + 用户浏览器手测。

- [ ] **Step 1: 改 CallPanel — 加共享按钮与视频容器**

把 `apps/web/src/features/chat/CallPanel.tsx` 整体替换为：

```tsx
import { useEffect, useRef, useState } from 'react';

import { Mic, MicOff, MonitorUp, MonitorX, PhoneOff } from 'lucide-react';

import type { CallUiState } from '@/state/conversation-store';

const TEXT: Partial<Record<CallUiState['state'], string>> = {
  dialing: '正在呼叫…',
  connecting: '接通中…',
  reconnecting: '重连中…',
};

function useElapsed(active: boolean): string {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const t = setInterval(
      () => setS(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    return () => clearInterval(t);
  }, [active]);
  const shown = active ? s : 0;
  return `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, '0')}`;
}

export function CallPanel({
  call,
  screenStream,
  onHangup,
  onToggleMute,
  onToggleScreen,
}: {
  call: CallUiState;
  screenStream: MediaStream | null;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleScreen: () => void;
}) {
  const active = call.state === 'active';
  const elapsed = useElapsed(active);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el) el.srcObject = screenStream;
  }, [screenStream]);

  if (call.state === 'idle' || call.state === 'ringing') return null;

  const sharing = call.screen === 'local';
  const peerSharing = call.screen === 'remote';

  return (
    <div className="flex flex-col border-b border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="text-sm text-fg-muted">
          {active ? elapsed : TEXT[call.state]}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            disabled={!active}
            aria-label={call.muted ? '取消静音' : '静音'}
            className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-fg-muted disabled:opacity-50"
          >
            {call.muted ? (
              <MicOff className="size-4.5" />
            ) : (
              <Mic className="size-4.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onToggleScreen}
            disabled={!active || peerSharing}
            aria-label={
              peerSharing ? '对方正在共享' : sharing ? '停止共享' : '共享屏幕'
            }
            title={peerSharing ? '对方正在共享' : undefined}
            className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-fg-muted disabled:opacity-50"
          >
            {sharing ? (
              <MonitorX className="size-4.5" />
            ) : (
              <MonitorUp className="size-4.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onHangup}
            aria-label="挂断"
            className="flex size-9 items-center justify-center rounded-full bg-danger text-white"
          >
            <PhoneOff className="size-4.5" />
          </button>
        </div>
      </div>

      {call.screen !== 'none' && (
        // 视频 + 可叠加层容器：后续涂鸦的 <canvas> 直接叠在 <video> 之上，像素对齐。
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={sharing}
            className="absolute inset-0 size-full object-contain"
          />
          {/* 预留：标记/涂鸦 canvas 层将来挂这里 */}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 改 ConversationView — 传屏幕状态/流/回调**

在 `apps/web/src/features/chat/ConversationView.tsx` 找到渲染 `<CallPanel ... />` 的位置（约 111 行），补两个 props。当前为：

```tsx
      <CallPanel
        call={...}
        onHangup={() => sessionManager.hangupCall(activeId)}
        ...
      />
```

改为同时传 `screenStream` 与 `onToggleScreen`：

```tsx
<CallPanel
  call={session.call}
  screenStream={sessionManager.getScreenStream(activeId)}
  onHangup={() => sessionManager.hangupCall(activeId)}
  onToggleMute={() => sessionManager.toggleMute(activeId, !session.call.muted)}
  onToggleScreen={() =>
    session.call.screen === 'local'
      ? sessionManager.stopScreenShare(activeId)
      : sessionManager.startScreenShare(activeId)
  }
/>
```

> 注：`call`/`onToggleMute` 沿用该文件现有写法（变量名以现有代码为准，例如 `session.call` 或既有的局部变量），仅**新增** `screenStream` 与 `onToggleScreen` 两个 prop。`getScreenStream` 在 store 状态变化（`call.screen` 翻转）触发的重渲染中读取，故无需额外响应式封装。

- [ ] **Step 3: 文案对齐「会议」**

把发起入口的「通话/呼叫」类文案改为「会议」。检索并替换用户可见文案（不改 `call-session.ts`/变量名，只改 UI 文本）：

Run: `grep -rn "通话\|呼叫\|拨打" apps/web/src/features --include=*.tsx`

逐处判断：发起按钮 `aria-label`/可见文字改为「开会议」；来电提示（`IncomingCallPrompt.tsx`）「邀请你通话」→「邀请你开会议」之类。保留 `CallRecordBubble.tsx` 里历史记录的「通话时长/未接来电」等表述（语义仍准确，可不动）。

- [ ] **Step 4: 校验**

Run: `pnpm --filter @peerlink/web typecheck`
Run: `pnpm --filter @peerlink/web lint`
Expected: 均无错误

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/chat/CallPanel.tsx apps/web/src/features/chat/ConversationView.tsx apps/web/src/features/chat/IncomingCallPrompt.tsx
git commit -m "feat(web): meeting UI — screen-share toggle, video container, 会议 labels"
```

---

## Task 9: 全量校验 + lucide 图标确认

**Files:** 无（验证任务）

- [ ] **Step 1: lucide 图标存在性**

`MonitorUp` / `MonitorX` 均为 lucide-react 标准图标。确认：

Run: `node -e "import('lucide-react').then(m => console.log(!!m.MonitorUp, !!m.MonitorX))"`
Expected: `true true`（若任一为 false，改用 `ScreenShare`/`ScreenShareOff` 图标并同步 CallPanel import）

- [ ] **Step 2: 全量测试 + 类型 + lint + 构建**

Run: `pnpm test`
Run: `pnpm typecheck`
Run: `pnpm lint`
Run: `pnpm build`
Expected: 全绿

- [ ] **Step 3: 手测引导（用户在真实浏览器）**

两个浏览器标签建立会议后逐项验证：

1. A 发起会议、B 接听 → 双向语音通（既有功能不回归）。
2. A 点「共享屏幕」→ B 看到 A 的屏幕；A 本地看到自己预览；B 的共享按钮置灰。
3. A 停止共享 → 双方视频区消失，按钮恢复。
4. 反向：B 共享（B 为非 initiator）→ A 看到 B 屏幕（验证非 initiator 演示走 initiator renegotiation 的链路）。
5. 共享中点浏览器原生「停止共享」条 → 自动回到无共享态。
6. 共享中挂断会议 → 视频区清理、屏幕流停止、时间线落一条通话记录。

- [ ] **Step 4: 收尾提交（如手测中有微调）**

```bash
git add -A && git commit -m "chore(web): polish meeting screen-share after manual testing"
```

---

## Self-Review 记录

- **Spec 覆盖**：协议帧(T1)、video transceiver(T2)、callId 访问(T3)、状态机四时序+守卫+onended+权限失败(T4)、conversation 路由/分流/dispose(T5)、store screen 子态(T6)、session-manager 流路由与清理(T7)、UI 按钮+视频容器+涂鸦预留+「会议」文案(T8)、回归与手测(T9) —— spec 各节均有对应任务。
- **非 initiator 演示链路**：T4 单测 + T9 手测第 4 项覆盖。
- **阅后即焚/不落盘**：屏幕流为实时轨，不入时间线（设计即如此，无需额外代码）；T7 在会议结束 `stop()` 所有远端轨。
- **类型一致性**：`ScreenState`/`ScreenControl`/`ScreenError` 在 T4 定义，T5/T6 引用一致；`setScreenState`/`getScreenStream`/`startScreenShare`/`stopScreenShare` 命名前后统一。
- **已知取舍**：双方几乎同时点「共享」的极罕见竞态下，`onControl(screen-start)` 守卫会忽略后到者，可能出现短暂不一致——符合需求决策「最简状态机、靠按钮置灰而非接管」，v1 接受。
