import { describe, expect, it } from "vitest";

import { buildRoomTemplateCopy } from "@/lib/rooms/template";

describe("buildRoomTemplateCopy", () => {
  it("copies validated system-aware maps, POIs, groups and columns", () => {
    expect(buildRoomTemplateCopy({
      groups: [{ id: "alpha", label: "Alpha", systemId: "stanton" }],
      columns: { alpha: ["ada", 42] },
      systems: [{ id: "stanton", label: "Stanton", x: 10, y: 20 }],
      mapsBySystem: {
        stanton: [{ id: "main", label: "Stanton", image: "/stanton.png" }],
      },
      poisBySystem: {
        stanton: [{ id: "seraphim", label: "Seraphim", image: "/seraphim.png", parentMapId: "main" }],
      },
      tokensBySystem: { stanton: [{ groupId: "alpha", x: 1, y: 2 }] },
    })).toEqual({
      groups: [{ id: "alpha", label: "Alpha", systemId: "stanton" }],
      columns: { alpha: ["ada"] },
      systems: [{ id: "stanton", label: "Stanton", x: 10, y: 20 }],
      mapsBySystem: {
        stanton: [{ id: "main", label: "Stanton", image: "/stanton.png" }],
      },
      poisBySystem: {
        stanton: [{ id: "seraphim", label: "Seraphim", image: "/seraphim.png", parentMapId: "main" }],
      },
    });
  });

  it("keeps legacy maps and POIs compatible while dropping invalid fields", () => {
    expect(buildRoomTemplateCopy({
      maps: [{ id: "main", label: "Pyro", image: "/pyro.png" }, { id: "broken" }],
      pois: [{ id: "station", label: "Ruin", image: "", parentMapId: "main" }],
      systems: [{ id: "broken", label: "Broken", x: "far", y: 2 }],
    })).toEqual({
      maps: [{ id: "main", label: "Pyro", image: "/pyro.png" }],
      pois: [{ id: "station", label: "Ruin", image: "", parentMapId: "main" }],
    });
  });
});
