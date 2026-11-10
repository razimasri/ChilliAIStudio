import { get_thresh, set_box } from './omrEngine';
/** Snap a roomy UI selection to a real box before the original measurement routine. */
export function measureSelectedBox(
  cv: any,
  image: any,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  try {
    return set_box(cv, image, x1, y1, x2, y2);
  } catch {
    /* Try a real contour from a roomier selection. */
  }
  const x = Math.max(0, Math.floor(Math.min(x1, x2))),
    y = Math.max(0, Math.floor(Math.min(y1, y2)));
  const width = Math.min(image.cols, Math.ceil(Math.max(x1, x2))) - x,
    height = Math.min(image.rows, Math.ceil(Math.max(y1, y2))) - y;
  if (width <= 0 || height <= 0)
    throw new Error('Draw around one empty answer box.');
  const roi = image.roi(new cv.Rect(x, y, width, height));
  let threshold: any;
  const contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  try {
    threshold = get_thresh(cv, roi, false);
    cv.findContours(
      threshold,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );
    const candidates: {
      x: number;
      y: number;
      width: number;
      height: number;
      area: number;
    }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        const b = cv.boundingRect(contour),
          area = cv.contourArea(contour);
        if (
          b.width >= 10 &&
          b.height >= 10 &&
          area > 10 &&
          area / (b.width * b.height) > 0.5 &&
          b.x > 0 &&
          b.y > 0 &&
          b.x + b.width < width &&
          b.y + b.height < height
        )
          candidates.push({ ...b, area });
      } finally {
        contour.delete();
      }
    }
    const largest = Math.max(0, ...candidates.map((c) => c.area));
    const boxes = candidates.filter((c) => c.area >= largest * 0.4);
    const centered = boxes.filter(
      (c) =>
        width / 2 >= c.x &&
        width / 2 <= c.x + c.width &&
        height / 2 >= c.y &&
        height / 2 <= c.y + c.height,
    );
    const box =
      boxes.length === 1
        ? boxes[0]
        : centered.length === 1
          ? centered[0]
          : undefined;
    if (box)
      return set_box(
        cv,
        image,
        Math.max(0, x + box.x - 3),
        Math.max(0, y + box.y - 3),
        Math.min(image.cols, x + box.x + box.width + 3),
        Math.min(image.rows, y + box.y + box.height + 3),
      );
    if (boxes.length > 1)
      throw new Error(
        'More than one box is inside the selection. Centre it on one empty box.',
      );
  } finally {
    threshold?.delete();
    roi.delete();
    contours.delete();
    hierarchy.delete();
  }
  // Preserve the original crop-expansion behavior for a tight/clipped selection.
  throw new Error(
    'No empty answer box was found. Draw around a visible unmarked box, with some space around it.',
  );
}
