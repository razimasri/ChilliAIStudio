import { TEMPLATE_WIDTH, TEMPLATE_HEIGHT } from './pageGeometry';
export const CALIBRATION_PREVIEW_EDGE = 1200;
export const CALIBRATION_PREVIEW_WIDTH = Math.round(
  (CALIBRATION_PREVIEW_EDGE * TEMPLATE_WIDTH) / TEMPLATE_HEIGHT,
);
/** OpenCV getRotationMatrix2D's forward mapping; cover all four selected corners. */
export function alignQuestionArea(
  area: { x1: number; y1: number; x2: number; y2: number },
  angle: number,
) {
  if (area.x2 <= area.x1 || area.y2 <= area.y1) return area;
  const radians = (angle * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  const cx = Math.floor(TEMPLATE_WIDTH / 2),
    cy = Math.floor(TEMPLATE_HEIGHT / 2);
  const points = [
    [area.x1, area.y1],
    [area.x2, area.y1],
    [area.x2, area.y2],
    [area.x1, area.y2],
  ].map(([x, y]) => ({
    x: c * (x - cx) + s * (y - cy) + cx,
    y: -s * (x - cx) + c * (y - cy) + cy,
  }));
  return {
    x1: Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)))),
    y1: Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)))),
    x2: Math.min(
      TEMPLATE_WIDTH,
      Math.ceil(Math.max(...points.map((p) => p.x))),
    ),
    y2: Math.min(
      TEMPLATE_HEIGHT,
      Math.ceil(Math.max(...points.map((p) => p.y))),
    ),
  };
}
