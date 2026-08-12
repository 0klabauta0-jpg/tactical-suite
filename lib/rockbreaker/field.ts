import fieldData from "@/lib/rockbreaker/field.v1.json";

export const ROCKBREAKER_SCENE_VERSION = 1 as const;

export type AsteroidRecord = {
  id: string;
  meshIndex: number;
  position: readonly [number, number, number];
  scale: readonly [number, number, number];
};

export class InvalidRockbreakerFieldError extends Error {
  constructor() { super("Invalid Rockbreaker asteroid field."); }
}

export function loadRockbreakerField(): AsteroidRecord[] {
  if (!Array.isArray(fieldData) || fieldData.length !== 944) throw new InvalidRockbreakerFieldError();
  const ids = new Set<string>();
  const parsed = fieldData.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null
      || candidate.id !== `rb-v1-${String(index + 1).padStart(4, "0")}`
      || ids.has(candidate.id) || !Number.isInteger(candidate.meshIndex)
      || !Array.isArray(candidate.position) || candidate.position.length !== 3 || !candidate.position.every(Number.isFinite)
      || !Array.isArray(candidate.scale) || candidate.scale.length !== 3
      || !candidate.scale.every((value) => Number.isFinite(value) && value > 0)) {
      throw new InvalidRockbreakerFieldError();
    }
    ids.add(candidate.id);
    return {
      id: candidate.id,
      meshIndex: candidate.meshIndex,
      position: candidate.position as [number, number, number],
      scale: candidate.scale as [number, number, number],
    };
  });
  return parsed;
}
