const MIN_SCALE = 0.3;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.3;

export function zoomIn(scale: number): number {
  return Math.min(MAX_SCALE, scale * ZOOM_FACTOR);
}

export function zoomOut(scale: number): number {
  return Math.max(MIN_SCALE, scale / ZOOM_FACTOR);
}
