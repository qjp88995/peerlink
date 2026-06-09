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

const manifest = z.object({
  type: z.literal('manifest'),
  files: z.array(fileEntrySchema),
  totalSize: z.number().int().nonnegative(),
});
const accept = z.object({ type: z.literal('accept') });
const reject = z.object({ type: z.literal('reject') });
const fileComplete = z.object({
  type: z.literal('file-complete'),
  fileId: z.number().int().nonnegative(),
  crc32: z.number().int().nonnegative(),
});
const transferComplete = z.object({ type: z.literal('transfer-complete') });
const cancel = z.object({
  type: z.literal('cancel'),
  reason: z.string().optional(),
});

export const controlMessageSchema = z.discriminatedUnion('type', [
  manifest,
  accept,
  reject,
  fileComplete,
  transferComplete,
  cancel,
]);
export type ControlMessage = z.infer<typeof controlMessageSchema>;
