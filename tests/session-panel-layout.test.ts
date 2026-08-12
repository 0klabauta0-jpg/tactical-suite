import { describe, expect, it } from "vitest";
import { rightPanelStack } from "@/lib/ui/session-panel-layout";

describe("session panel layout", () => {
  it("stacks notes and log notes at the right edge", () => {
    expect(rightPanelStack(1440, 320, 320)).toEqual({
      notes: { x: 1112, y: 70 },
      logNotes: { x: 1112, y: 108 },
    });
  });

  it("keeps both headers reachable on a narrow viewport", () => {
    expect(rightPanelStack(300, 320, 360)).toEqual({
      notes: { x: 8, y: 70 },
      logNotes: { x: 8, y: 108 },
    });
  });
});
