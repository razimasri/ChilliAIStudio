import { TEMPLATE_WIDTH, TEMPLATE_HEIGHT } from './pageGeometry';
export type AlignmentRect = [number, number, number, number];
const SIZE_TOLERANCE = .10;
const CENTRE_TOLERANCE = .10;

/** Compare in page-relative coordinates: camera pixels/native PDF DPI may differ.
 * Width/height must each agree within 10% of the reference dimensions;
 * centres must agree within 10% of the page width/height independently.
 */
export function matchesAlignmentReference(
  rect: AlignmentRect, reference: AlignmentRect, pageWidth: number, pageHeight: number,
): boolean {
  const [x, y, width, height] = rect;
  const [rx, ry, rw, rh] = reference;
  if (![...rect, ...reference, pageWidth, pageHeight].every(Number.isFinite) ||
      width <= 0 || height <= 0 || rw <= 0 || rh <= 0 || pageWidth <= 0 || pageHeight <= 0) return false;
  const w = width / pageWidth, h = height / pageHeight;
  const expectedW = rw / TEMPLATE_WIDTH, expectedH = rh / TEMPLATE_HEIGHT;
  // Tiny epsilon keeps inclusive boundary checks stable across DPI normalisation.
  const epsilon = 1e-9;
  return Math.abs(w / expectedW - 1) <= SIZE_TOLERANCE + epsilon &&
    Math.abs(h / expectedH - 1) <= SIZE_TOLERANCE + epsilon &&
    Math.abs((x + width / 2) / pageWidth - (rx + rw / 2) / TEMPLATE_WIDTH) <= CENTRE_TOLERANCE + epsilon &&
    Math.abs((y + height / 2) / pageHeight - (ry + rh / 2) / TEMPLATE_HEIGHT) <= CENTRE_TOLERANCE + epsilon;
}
