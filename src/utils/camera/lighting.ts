/** Camera paper is white. Remove local illumination/colour casts without thresholding ink.
 * Estimate the paper on a small image, closing away text before dividing by it.
 * Apply in strips so a phone never needs a second full-resolution RGBA page.
 * Mutates only the caller's perspective-corrected image, never the original photo.
 */
export function whitenPaper(cv: any, image: any): void {
  const small = new cv.Mat(), paper = new cv.Mat(), strip = new cv.Mat();
  const scale = Math.min(1, 512 / Math.max(image.cols, image.rows));
  const width = Math.max(1, Math.round(image.cols * scale));
  const height = Math.max(1, Math.round(image.rows * scale));
  const diameter = Math.max(3, Math.round(width * .06) | 1);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(diameter, diameter));
  const sx = image.cols / width, sy = image.rows / height;
  const matrix = cv.matFromArray(2, 3, cv.CV_64F, [sx, 0, (sx - 1) / 2, 0, sy, (sy - 1) / 2]);
  try {
    cv.resize(image, small, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
    cv.morphologyEx(small, paper, cv.MORPH_CLOSE, kernel);
    // Bound amplification in essentially black/clipped regions; no lost detail can be recovered there.
    for (let i = 0; i < paper.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) paper.data[i + channel] = Math.max(32, paper.data[i + channel]);
      paper.data[i + 3] = 255;
    }
    for (let y = 0; y < image.rows; y += 128) {
      const rows = Math.min(128, image.rows - y);
      matrix.data64F[5] = (sy - 1) / 2 - y;
      cv.warpAffine(paper, strip, matrix, new cv.Size(image.cols, rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      const roi = image.roi(new cv.Rect(0, y, image.cols, rows));
      try { cv.divide(roi, strip, roi, 255); }
      finally { roi.delete(); }
    }
  } finally { small.delete(); paper.delete(); strip.delete(); kernel.delete(); matrix.delete(); }
}
