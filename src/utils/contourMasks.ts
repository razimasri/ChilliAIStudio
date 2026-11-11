/** Restore global coordinates before computing moments, avoiding rounding drift. */
export function translateContour(cv: any, contour: any, dx: number, dy: number): any {
  const source = contour.data32S;
  const points = new Int32Array(source.length);
  for (let i = 0; i < source.length; i += 2) {
    points[i] = source[i] + dx;
    points[i + 1] = source[i + 1] + dy;
  }
  return cv.matFromArray(contour.rows, contour.cols, cv.CV_32SC2, points);
}

/** Keep the 15-pixel support of the 31×31 kernel and the real image borders. */
export function boundedContourMask(cv: any, contour: any, rows: number, cols: number) {
  const bounds = cv.boundingRect(contour);
  let x = Math.max(0, bounds.x - 15);
  let y = Math.max(0, bounds.y - 15);
  let right = Math.min(cols, bounds.x + bounds.width + 15);
  let bottom = Math.min(rows, bounds.y + bounds.height + 15);
  // Preserve the old all-zero mask for a contour wholly outside the image.
  if (right <= x || bottom <= y) {
    x = y = 0;
    right = cols;
    bottom = rows;
  }
  const mask = cv.Mat.zeros(bottom - y, right - x, cv.CV_8UC1);
  let local: any = null;
  let vector: any = null;
  try {
    local = translateContour(cv, contour, -x, -y);
    vector = new cv.MatVector();
    vector.push_back(local);
    cv.drawContours(mask, vector, -1, new cv.Scalar(255), -1);
    return { mask, x, y };
  } catch (error) {
    mask.delete();
    throw error;
  } finally {
    vector?.delete();
    local?.delete();
  }
}
