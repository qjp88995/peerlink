import { z } from 'zod';

/** 信令服务可返回的错误码。 */
export const signalErrorCode = z.enum([
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_EXPIRED',
  'BAD_MESSAGE',
  'RATE_LIMITED',
]);
export type SignalErrorCode = z.infer<typeof signalErrorCode>;

/** WebRTC 信令载荷：服务不解析内容，原样透传。 */
export const signalPayloadSchema = z.union([
  z.object({ sdp: z.string() }),
  z.object({ candidate: z.unknown() }),
]);

// ─── 客户端 → 服务 ───
const createRoom = z.object({ type: z.literal('create-room') });
const joinRoom = z.object({ type: z.literal('join-room'), roomId: z.string() });
const lanInvite = z.object({
  type: z.literal('lan-invite'),
  targetPeerId: z.string(),
});
const clientSignal = z.object({
  type: z.literal('signal'),
  to: z.string(),
  payload: signalPayloadSchema,
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  createRoom,
  joinRoom,
  lanInvite,
  clientSignal,
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ─── 服务 → 客户端 ───
const roomCreated = z.object({
  type: z.literal('room-created'),
  roomId: z.string(),
});
const peerJoined = z.object({
  type: z.literal('peer-joined'),
  peerId: z.string(),
});
const peerLeft = z.object({ type: z.literal('peer-left'), peerId: z.string() });
const lanPeer = z.object({ peerId: z.string(), name: z.string() });
const lanPeers = z.object({
  type: z.literal('lan-peers'),
  peers: z.array(lanPeer),
});
const serverSignal = z.object({
  type: z.literal('signal'),
  from: z.string(),
  payload: signalPayloadSchema,
});
const errorMsg = z.object({
  type: z.literal('error'),
  code: signalErrorCode,
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  roomCreated,
  peerJoined,
  peerLeft,
  lanPeers,
  serverSignal,
  errorMsg,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type LanPeer = z.infer<typeof lanPeer>;
