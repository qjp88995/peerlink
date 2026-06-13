import { z } from 'zod';

/** manifest 中的单个文件条目。 */
export const fileEntrySchema = z.object({
  fileId: z.number().int().nonnegative(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  /** 相对路径（含目录），单文件时等于文件名。 */
  relativePath: z.string(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

const chat = z.object({
  type: z.literal('chat'),
  msgId: z.string(),
  text: z.string().max(8192),
  ts: z.number().int(),
});

const manifest = z.object({
  type: z.literal('manifest'),
  transferId: z.string(),
  files: z.array(fileEntrySchema),
  totalSize: z.number().int().nonnegative(),
});
const accept = z.object({ type: z.literal('accept'), transferId: z.string() });
const reject = z.object({ type: z.literal('reject'), transferId: z.string() });
const fileComplete = z.object({
  type: z.literal('file-complete'),
  fileId: z.number().int().nonnegative(),
  crc32: z.number().int().nonnegative(),
});
const transferComplete = z.object({
  type: z.literal('transfer-complete'),
  transferId: z.string(),
});
const cancel = z.object({
  type: z.literal('cancel'),
  transferId: z.string(),
  reason: z.string().optional(),
});
const voiceStart = z.object({
  type: z.literal('voice-start'),
  msgId: z.string(),
  streamId: z.number().int().nonnegative(),
  mimeType: z.string(),
  durationMs: z.number().int().nonnegative(),
  totalSize: z.number().int().nonnegative(),
  ts: z.number().int(),
});
const voiceComplete = z.object({
  type: z.literal('voice-complete'),
  msgId: z.string(),
  crc32: z.number().int().nonnegative(),
});

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

const screenStart = z.object({
  type: z.literal('screen-start'),
  callId: z.number().int().nonnegative(),
});
const screenStop = z.object({
  type: z.literal('screen-stop'),
  callId: z.number().int().nonnegative(),
});

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
export type ControlMessage = z.infer<typeof controlMessageSchema>;
