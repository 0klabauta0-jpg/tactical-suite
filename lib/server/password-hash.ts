import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export type RoomPasswordHash = {
  version: 1;
  passwordHash: string;
  salt: string;
  keyLength: 64;
  cost: number;
  blockSize: number;
  parallelization: number;
};

const CURRENT = { keyLength: 64 as const, cost: 16_384, blockSize: 8, parallelization: 1 };

function derive(password: string, salt: Buffer, value: RoomPasswordHash): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, value.keyLength, {
      N: value.cost,
      r: value.blockSize,
      p: value.parallelization,
      maxmem: 64 * 1024 * 1024,
    }, (error, result) => error ? reject(error) : resolve(result));
  });
}

function validParameters(value: RoomPasswordHash): boolean {
  return value.version === 1
    && value.keyLength === 64
    && Number.isInteger(value.cost) && value.cost >= 8_192 && value.cost <= 65_536 && (value.cost & (value.cost - 1)) === 0
    && Number.isInteger(value.blockSize) && value.blockSize >= 1 && value.blockSize <= 16
    && Number.isInteger(value.parallelization) && value.parallelization >= 1 && value.parallelization <= 4;
}

export async function hashRoomPassword(password: string): Promise<RoomPasswordHash> {
  if (!password.trim()) throw new Error("Room password cannot be empty.");
  const value: RoomPasswordHash = {
    version: 1,
    passwordHash: "",
    salt: randomBytes(16).toString("base64url"),
    ...CURRENT,
  };
  value.passwordHash = (await derive(password, Buffer.from(value.salt, "base64url"), value)).toString("base64url");
  return value;
}

export async function verifyRoomPassword(password: string, value: RoomPasswordHash): Promise<boolean> {
  try {
    if (!validParameters(value)) return false;
    const expected = Buffer.from(value.passwordHash, "base64url");
    const salt = Buffer.from(value.salt, "base64url");
    if (expected.length !== value.keyLength || salt.length < 16) return false;
    const actual = await derive(password, salt, value);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function needsPasswordRehash(value: RoomPasswordHash): boolean {
  return !validParameters(value)
    || value.cost !== CURRENT.cost
    || value.blockSize !== CURRENT.blockSize
    || value.parallelization !== CURRENT.parallelization;
}
