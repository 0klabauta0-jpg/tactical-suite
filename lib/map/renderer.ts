import type { MapRendererKind } from "@/lib/board/collections";
import type { RoomFeatures } from "@/lib/rooms/config";

export function resolveMapRenderer(map: { renderer?: MapRendererKind } | undefined, features: Pick<RoomFeatures, "rockbreaker3d">) {
  if (map?.renderer === "rockbreaker3d") return features.rockbreaker3d ? "rockbreaker3d" as const : "disabled" as const;
  return "image2d" as const;
}
