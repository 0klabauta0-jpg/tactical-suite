import type { Role } from "@/lib/domain/roles";
import type { RoomMember } from "@/lib/server/room-login";

export type DecodedRoomToken = {
  uid: string;
  roomId?: unknown;
  playerId?: unknown;
  authVersion?: unknown;
};

export type RoomAuthDependencies = {
  verifyIdToken: (token: string) => Promise<DecodedRoomToken>;
  getMember: (roomId: string, uid: string) => Promise<RoomMember | null>;
  refreshMember: (member: RoomMember, roomId: string) => Promise<RoomMember>;
};

export class RoomAuthError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code);
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
    throw new RoomAuthError("UNAUTHENTICATED");
  }
  return authorization.slice(7);
}

export async function requireRoomMemberWith(
  dependencies: RoomAuthDependencies,
  request: Request,
  roomId: string,
  options: { roles?: Role[]; freshRole?: boolean } = {},
): Promise<RoomMember> {
  let decoded: DecodedRoomToken;
  try {
    decoded = await dependencies.verifyIdToken(bearerToken(request));
  } catch (error) {
    if (error instanceof RoomAuthError) throw error;
    throw new RoomAuthError("UNAUTHENTICATED");
  }
  if (decoded.authVersion !== 1 || decoded.roomId !== roomId || typeof decoded.playerId !== "string") {
    throw new RoomAuthError("FORBIDDEN");
  }
  let member = await dependencies.getMember(roomId, decoded.uid);
  if (!member || member.playerId !== decoded.playerId || member.authVersion !== 1) {
    throw new RoomAuthError("FORBIDDEN");
  }
  if (options.freshRole) member = await dependencies.refreshMember(member, roomId);
  if (options.roles && !options.roles.includes(member.role)) throw new RoomAuthError("FORBIDDEN");
  return member;
}
