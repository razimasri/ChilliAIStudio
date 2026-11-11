export interface Point { x: number; y: number }
/** Clockwise TL, TR, BR, BL, in image-relative coordinates. */
export type Corners = [Point, Point, Point, Point];
export function orderedCorners(points: Point[]): Corners {
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const start = sorted.reduce((best, p, i) => p.x + p.y < sorted[best].x + sorted[best].y ? i : best, 0);
  return [...sorted.slice(start), ...sorted.slice(0, start)] as Corners;
}
export function quadArea(corners: Corners): number {
  return Math.abs(corners.reduce((sum, p, i) => { const next = corners[(i + 1) % 4]; return sum + p.x * next.y - p.y * next.x; }, 0)) / 2;
}
export function validateCorners(corners: Corners): void {
  if (corners.length !== 4 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1))
    throw new Error('Keep all four page corners inside the photograph.');
  const crosses = corners.map((p, i) => {
    const b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  if (!crosses.every(v => v > 0.001) || quadArea(corners) < 0.12)
    throw new Error('Select the four outer page corners in order, without crossing the edges. The page should fill most of the photograph.');
}
export function pageSize(corners: Corners, width: number, height: number) {
  const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  return { width: Math.min(distance(corners[0], corners[1]), distance(corners[3], corners[2])),
    height: Math.min(distance(corners[0], corners[3]), distance(corners[1], corners[2])) };
}
