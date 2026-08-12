const VIEWPORT_PADDING = 8;
const FIRST_PANEL_Y = 70;
const COLLAPSED_HEADER_STEP = 38;

export function rightPanelStack(viewportWidth: number, notesWidth: number, logWidth: number) {
  return {
    notes: {
      x: Math.max(VIEWPORT_PADDING, viewportWidth - notesWidth - VIEWPORT_PADDING),
      y: FIRST_PANEL_Y,
    },
    logNotes: {
      x: Math.max(VIEWPORT_PADDING, viewportWidth - logWidth - VIEWPORT_PADDING),
      y: FIRST_PANEL_Y + COLLAPSED_HEADER_STEP,
    },
  };
}
