# FS Access 落盘门控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接收端按 File System Access 能力决定落盘方式——支持则盘到盘流式（FsAccessWriter），单文件不支持退化为 BlobWriter，多文件/文件夹不支持则拒绝传输（自动向发送方发 reject）。

**Architecture:** 落盘决策收敛到 `core/storage/writer.ts` 的纯函数 `decideWriter`，产出 `fs-access | blob | unsupported` 三态。删除 ZipWriter 整条路径及 `@zip.js/zip.js` 依赖。接收会话编排（`transfer-session.ts`）与接收面板（`ReceivePanel.tsx`）共用该决策；面板在 manifest 到达且判定 `unsupported` 时自动 `reject()` 并展示不兼容提示，用户根本走不到「接受」。

**Tech Stack:** TypeScript（ESM）、React 19、Vitest、Vite、pnpm workspace（catalog）。

---

## File Structure

- `apps/web/src/core/storage/writer.ts` — 重构：`chooseWriterKind`/`WriterKind` 删除，新增 `decideWriter`/`WriterDecision`。保留 `detectCapabilities`、`manifestHasDirectory`、`WriterCapabilities`、`Writer`。
- `apps/web/src/core/storage/writer.spec.ts` — 更新：覆盖 `decideWriter` 新矩阵。
- `apps/web/src/core/storage/zip-writer.ts` — 删除（死代码）。
- `apps/web/src/lib/transfer-session.ts` — 重构 `makeWriter`：用 `decideWriter`，删 zip 分支与 `FolderZipWriter` import。
- `apps/web/src/features/receive/ReceivePanel.tsx` — 新增决策 `useMemo`、`unsupported` 自动 `reject` 的 effect、不兼容提示渲染。
- `apps/web/package.json` — 删除 `@zip.js/zip.js` 依赖。
- `pnpm-workspace.yaml` — 删除 `@zip.js/zip.js` catalog 条目。

决策矩阵（仅看接收端能力）：

|                    | 单文件      | 多文件 / 文件夹       |
| ------------------ | ----------- | --------------------- |
| **支持 FS Access** | `fs-access` | `fs-access`           |
| **不支持**         | `blob`      | `unsupported`（拒绝） |

---

## Task 1: 重构落盘决策为三态 `decideWriter`

**Files:**

- Modify: `apps/web/src/core/storage/writer.ts`
- Test: `apps/web/src/core/storage/writer.spec.ts`

- [ ] **Step 1: 改写测试为 `decideWriter` 新矩阵**

替换 `apps/web/src/core/storage/writer.spec.ts` 全文为：

```ts
import { describe, expect, it } from 'vitest';

import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
} from './writer';

describe('detectCapabilities', () => {
  it('reports fileSystemAccess based on showDirectoryPicker', () => {
    expect(
      detectCapabilities({ showDirectoryPicker: () => {} } as never)
    ).toEqual({ fileSystemAccess: true });
    expect(detectCapabilities({} as never)).toEqual({
      fileSystemAccess: false,
    });
  });
});

describe('decideWriter', () => {
  const caps = (fs: boolean) => ({ fileSystemAccess: fs });

  it('uses fs-access for a single file when supported', () => {
    expect(
      decideWriter(caps(true), { fileCount: 1, hasDirectory: false })
    ).toEqual({ kind: 'fs-access' });
  });

  it('uses fs-access for folders/multi when supported', () => {
    expect(
      decideWriter(caps(true), { fileCount: 3, hasDirectory: true })
    ).toEqual({ kind: 'fs-access' });
  });

  it('uses blob for a single flat file without fs-access', () => {
    expect(
      decideWriter(caps(false), { fileCount: 1, hasDirectory: false })
    ).toEqual({ kind: 'blob' });
  });

  it('is unsupported for multi files without fs-access', () => {
    const d = decideWriter(caps(false), { fileCount: 2, hasDirectory: false });
    expect(d.kind).toBe('unsupported');
  });

  it('is unsupported for folders without fs-access', () => {
    const d = decideWriter(caps(false), { fileCount: 1, hasDirectory: true });
    expect(d.kind).toBe('unsupported');
  });
});

describe('manifestHasDirectory', () => {
  it('detects nested relative paths', () => {
    expect(
      manifestHasDirectory([
        { fileId: 0, name: 'a', size: 0, relativePath: 'x/a' },
      ])
    ).toBe(true);
    expect(
      manifestHasDirectory([
        { fileId: 0, name: 'a', size: 0, relativePath: 'a' },
      ])
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @peerlink/web test -- writer.spec`
Expected: FAIL —— `decideWriter` 未从 `./writer` 导出（import 报错 / 类型错误）。

- [ ] **Step 3: 在 `writer.ts` 用 `decideWriter` 替换 `chooseWriterKind`**

在 `apps/web/src/core/storage/writer.ts` 中，删除 `WriterKind` 类型与整个 `chooseWriterKind` 函数（当前 20-43 行），替换为：

```ts
export type WriterDecision =
  | { kind: 'fs-access' }
  | { kind: 'blob' }
  | { kind: 'unsupported'; reason: string };

const UNSUPPORTED_REASON =
  '当前浏览器不支持接收文件夹或多文件，请改用基于 Chromium 的浏览器（Chrome / Edge）。';

/** 仅依据接收端能力与文件构成决定落盘方式。 */
export function decideWriter(
  caps: WriterCapabilities,
  opts: { fileCount: number; hasDirectory: boolean }
): WriterDecision {
  if (caps.fileSystemAccess) return { kind: 'fs-access' };
  const multi = opts.hasDirectory || opts.fileCount > 1;
  if (multi) return { kind: 'unsupported', reason: UNSUPPORTED_REASON };
  return { kind: 'blob' };
}
```

`detectCapabilities`、`WriterCapabilities`、`Writer`、`manifestHasDirectory` 保持不变。

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @peerlink/web test -- writer.spec`
Expected: PASS（detectCapabilities / decideWriter / manifestHasDirectory 全绿）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/core/storage/writer.ts apps/web/src/core/storage/writer.spec.ts
git commit -m "refactor(web): replace chooseWriterKind with three-state decideWriter"
```

---

## Task 2: 删除 ZipWriter 路径与依赖

**Files:**

- Delete: `apps/web/src/core/storage/zip-writer.ts`
- Modify: `apps/web/src/lib/transfer-session.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: 重写 `transfer-session.ts` 的 `makeWriter` 并清理 import**

在 `apps/web/src/lib/transfer-session.ts`：

删除 zip 相关 import（当前第 20 行）：

```ts
import { FolderZipWriter } from '@/core/storage/zip-writer';
```

将 writer 模块 import（当前 14-19 行）改为：

```ts
import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
  type Writer,
} from '@/core/storage/writer';
```

将整个 `makeWriter` 函数（当前 110-135 行）替换为：

```ts
async function makeWriter(files: FileEntry[]): Promise<Writer> {
  const decision = decideWriter(detectCapabilities(), {
    fileCount: files.length,
    hasDirectory: manifestHasDirectory(files),
  });
  // UI 已在 manifest 阶段门控 unsupported，此处仅作防御。
  if (decision.kind === 'unsupported') throw new Error(decision.reason);
  if (decision.kind === 'fs-access') {
    const root = await window.showDirectoryPicker!();
    return new FsAccessWriter({ files }, root);
  }
  return new BlobWriter(
    { files },
    { onFile: (name, blob) => triggerDownload(name, blob) }
  );
}
```

- [ ] **Step 2: 删除 zip-writer 源文件**

Run: `git rm apps/web/src/core/storage/zip-writer.ts`
Expected: 文件被移除（无对应 spec 文件，无需额外处理）。

- [ ] **Step 3: 移除 `@zip.js/zip.js` 依赖声明**

在 `apps/web/package.json` 删除该行（当前第 18 行）：

```json
    "@zip.js/zip.js": "catalog:",
```

在 `pnpm-workspace.yaml` 的 `catalog:` 下删除该行（当前第 27 行）：

```yaml
'@zip.js/zip.js': '^2.7.52'
```

- [ ] **Step 4: 刷新 lockfile**

Run: `pnpm install`
Expected: 成功，lockfile 更新（移除 @zip.js/zip.js）。

- [ ] **Step 5: 类型检查与构建，确认无残留引用**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web build`
Expected: 均通过；无任何对 `FolderZipWriter` / `chooseWriterKind` / `@zip.js/zip.js` 的未解析引用。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/lib/transfer-session.ts apps/web/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "refactor(web): drop ZipWriter path and @zip.js/zip.js dependency"
```

---

## Task 3: 接收面板门控不兼容并自动拒绝

**Files:**

- Modify: `apps/web/src/features/receive/ReceivePanel.tsx`

- [ ] **Step 1: 新增决策依赖的 import**

在 `apps/web/src/features/receive/ReceivePanel.tsx` 顶部，把第 1 行的 React import 改为带 `useMemo`，并新增 writer 决策 import。

将：

```tsx
import { useEffect, useRef } from 'react';
```

改为：

```tsx
import { useEffect, useMemo, useRef } from 'react';
```

在 `import { startReceiveSession } from '@/lib/transfer-session';` 之后新增：

```tsx
import {
  decideWriter,
  detectCapabilities,
  manifestHasDirectory,
} from '@/core/storage/writer';
```

- [ ] **Step 2: 在组件内计算决策并加自动拒绝 effect**

在 `const store = useTransferStore();` 与 `const sessionRef = ...` 之后、首个 `useEffect` 之前，插入：

```tsx
const decision = useMemo(
  () =>
    store.manifest
      ? decideWriter(detectCapabilities(), {
          fileCount: store.manifest.length,
          hasDirectory: manifestHasDirectory(store.manifest),
        })
      : null,
  [store.manifest]
);
const unsupported = decision?.kind === 'unsupported';
```

在已有的 `useEffect`（连接会话）之后，新增自动拒绝的 effect：

```tsx
useEffect(() => {
  if (store.phase === 'awaiting-accept' && unsupported) {
    sessionRef.current?.reject();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [store.phase, unsupported]);
```

- [ ] **Step 3: 不兼容时用提示替换接受/拒绝按钮区**

在 `awaiting-accept` 分支内，将底部按钮区（当前 86-101 行的 `<div className="flex gap-2"> … </div>`）替换为条件渲染：

```tsx
{
  unsupported ? (
    <div
      role="alert"
      data-testid="unsupported"
      className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-danger"
    >
      {decision?.kind === 'unsupported' && decision.reason}
    </div>
  ) : (
    <div className="flex gap-2">
      <Button
        className="flex-1"
        onClick={() => sessionRef.current?.accept()}
        data-testid="accept"
      >
        <Check className="size-4" /> 接受并接收
      </Button>
      <Button
        variant="danger"
        onClick={() => sessionRef.current?.reject()}
        data-testid="reject"
      >
        <X className="size-4" /> 拒绝
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: 类型检查与 lint**

Run: `pnpm --filter @peerlink/web typecheck && pnpm --filter @peerlink/web lint`
Expected: 均通过。

> 注：`danger` 色 token 已被 `Button variant="danger"` 使用，`text-danger`/`border-danger`/`bg-danger` 可用。若 lint/构建报该 token 不存在，改用既有 `text-fg` + `border-line` 中性提示样式（不引入新 token）。

- [ ] **Step 5: 手动验证（用户在真实浏览器，容器内 curl 不可用）**

请求用户用两类浏览器各验证一次（信令 :3001 + web :5173 已 `pnpm dev`）：

1. **Chromium（Chrome/Edge，支持 FS Access）**：
   - 发单文件 → 接收端可「接受」，触发选目录，盘到盘流式落盘。
   - 发文件夹/多文件 → 接收端可「接受」，选目录后按 relativePath 落盘。
2. **Firefox（不支持 FS Access）**：
   - 发单文件 → 接收端可「接受」，走 BlobWriter 触发下载。
   - 发文件夹/多文件 → 接收端**看不到「接受」**，显示不兼容提示（`data-testid="unsupported"`），且发送端立即收到「对方已拒绝」。

Expected: 四种组合行为与决策矩阵一致。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/features/receive/ReceivePanel.tsx
git commit -m "feat(web): gate incompatible receivers and auto-reject multi-file without FS Access"
```

---

## Self-Review Notes

- **Spec 覆盖**：决策矩阵四象限 → Task 1 测试全覆盖；单文件走 FS Access（去掉旧 `fileCount > 1` 限制）→ `decideWriter` 中 `caps.fileSystemAccess` 优先返回；多文件/文件夹不支持→拒绝→ Task 3 effect 自动 `reject()`（方案 b）；ZipWriter 删除 → Task 2。
- **类型一致**：`decideWriter`/`WriterDecision`/`unsupported.reason` 在 writer.ts、transfer-session.ts、ReceivePanel.tsx 三处签名一致。
- **无占位符**：所有步骤含完整代码与命令。
- **依赖清理**：`@zip.js/zip.js` 两处声明 + lockfile + 源文件全部移除，Task 2 Step 5 build 兜底校验无残留引用。
