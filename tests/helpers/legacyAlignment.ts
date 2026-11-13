// Frozen pre-optimization registration used only as the parity oracle.
import { largest_cnt, normaliseDeskewAngle, scale } from '../../src/utils/omrEngine';
export function legacyRotation(cv: any, page: any) {
  const big = largest_cnt(cv, page);
  const angle = normaliseDeskewAngle(cv.minAreaRect(big).angle);
  big.delete();
  const matrix = cv.getRotationMatrix2D(new cv.Point(Math.floor(page.cols / 2), Math.floor(page.rows / 2)), angle, 1);
  const rotated = new cv.Mat();
  try {
    cv.warpAffine(page, rotated, matrix, new cv.Size(page.cols, page.rows));
    const rotatedBig = largest_cnt(cv, rotated);
    let bounds;
    try { bounds = cv.boundingRect(rotatedBig); } finally { rotatedBig.delete(); }
    return { rotated, angle, rect: [bounds.x, bounds.y, bounds.width, bounds.height] as [number,number,number,number] };
  } catch(error) { rotated.delete(); throw error; }
  finally { matrix.delete(); }
}
export function legacyRegistration(cv: any, page: any, params: { rect: [number,number,number,number] }) {
  const { rotated, rect } = legacyRotation(cv,page);
  try { return scale(cv,rotated,rect,params); }
  finally { rotated.delete(); }
}
