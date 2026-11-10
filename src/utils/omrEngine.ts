import {
  CalibrationParams,
  ContourPoint,
  DetectedQuestion,
  QuestionBox,
  StudentResult,
  QuestionStat,
} from '../types';
import { getCV } from './cvLoader';
import { TEMPLATE_HEIGHT, TEMPLATE_WIDTH } from './pageGeometry';

/**
 * Loads an image from dataURL into an HTMLImageElement
 */
export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}

/**
 * Decode a scan without changing its dimensions or orientation.
 */
export async function renderScanMat(cv: any, dataUrl: string): Promise<any> {
  const img = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const mat = cv.matFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  canvas.width = 0;
  canvas.height = 0;
  return mat;
}

/** Resize only the first-page calibration template, as in Python load_inputs. */
export async function renderToCanonicalMat(cv: any, dataUrl: string): Promise<any> {
  const source = await renderScanMat(cv, dataUrl);
  const template = new cv.Mat();
  try {
    cv.resize(source, template, new cv.Size(TEMPLATE_WIDTH, TEMPLATE_HEIGHT), 0, 0, cv.INTER_LINEAR);
    return template;
  } catch (error) {
    template.delete();
    throw error;
  } finally {
    source.delete();
  }
}

/**
 * Python Source:
 * def area(n):
 *   _,_,w,h = cv2.boundingRect(n)
 *   return h*w
 */
export function area(cv: any, n: any): number {
  const rect = cv.boundingRect(n);
  return rect.width * rect.height;
}

/**
 * Python Source:
 * def contour_center(contour):
 *   M = cv2.moments(contour)
 *   cx = int(M['m10']/M['m00'])
 *   cy = int(M['m01']/M['m00'])
 *   return [cx,cy]
 */
export function contour_center(cv: any, contour: any): [number, number] {
  const M = cv.moments(contour);
  if (M.m00 === 0) {
    const r = cv.boundingRect(contour);
    return [Math.floor(r.x + r.width / 2), Math.floor(r.y + r.height / 2)];
  }
  const cx = Math.floor(M.m10 / M.m00);
  const cy = Math.floor(M.m01 / M.m00);
  return [cx, cy];
}

/**
 * Python Source:
 * def get_thresh(image, blur=True):
 *   if blur:
 *     image = cv2.medianBlur(image, 5)
 *   image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
 *   return cv2.adaptiveThreshold(image, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 27, 5)
 */
export function get_thresh(cv: any, image: any, blur = true): any {
  let processed = image;
  let tempBlur: any = null;
  if (blur) {
    tempBlur = new cv.Mat();
    cv.medianBlur(image, tempBlur, 5);
    processed = tempBlur;
  }

  const gray = new cv.Mat();
  if (processed.channels() === 4) {
    cv.cvtColor(processed, gray, cv.COLOR_RGBA2GRAY);
  } else if (processed.channels() === 3) {
    cv.cvtColor(processed, gray, cv.COLOR_RGB2GRAY);
  } else {
    processed.copyTo(gray);
  }

  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    gray,
    thresh,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    27,
    5
  );

  if (tempBlur) tempBlur.delete();
  gray.delete();
  return thresh;
}

/**
 * Python Source:
 * def largest_cnt(image: cv2.typing.MatLike) -> cv2.typing.MatLike:
 *   gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
 *   thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
 *   thresh = cv2.rectangle(thresh, (0, 0), (thresh.shape[1], thresh.shape[0]), 0, 200)
 *   cnts, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
 *   filtered = filter(lambda cnt: area(cnt) > 4000000, cnts)
 *   sorted_cnts = sorted(filtered, key=area, reverse=True)
 *   largest = sorted_cnts[0]
 *   largest = cv2.approxPolyDP(largest, 0.01 * cv2.arcLength(largest, True), True)
 *   return largest
 */
export function largest_cnt(cv: any, image: any): any {
  // The 200px border and 4,000,000px bounding-area cutoff are defined at
  // the original scan/template resolution. Downsampling changes the contour
  // used for rotation and registration, especially around thin printed lines.
  const gray = new cv.Mat();
  if (image.channels() === 4) {
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
  } else if (image.channels() === 3) {
    cv.cvtColor(image, gray, cv.COLOR_RGB2GRAY);
  } else {
    image.copyTo(gray);
  }

  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray.delete();
  cv.rectangle(thresh, new cv.Point(0, 0), new cv.Point(thresh.cols, thresh.rows), new cv.Scalar(0), 200);

  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  let largest: any = null;
  try {
    cv.findContours(thresh, cnts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let maxArea = 4000000;
    for (let i = 0; i < cnts.size(); i++) {
      const contour = cnts.get(i);
      const boundingArea = area(cv, contour);
      if (boundingArea > maxArea) {
        if (largest) largest.delete();
        largest = contour;
        maxArea = boundingArea;
      } else {
        contour.delete();
      }
    }
    if (!largest) {
      throw new Error('No alignment rectangle larger than 4,000,000 pixels found. Check scan resolution and orientation.');
    }
    const approx = new cv.Mat();
    cv.approxPolyDP(largest, approx, 0.01 * cv.arcLength(largest, true), true);
    return approx;
  } finally {
    largest?.delete();
    cnts.delete();
    hier.delete();
    thresh.delete();
  }
}

export function normaliseDeskewAngle(rawAngle: number): number {
  // minAreaRect angle conventions differ between OpenCV builds.
  //
  // We only want the equivalent SMALL rotation nearest 0°.
  //
  // Examples:
  //   89°  -> -1°
  //  -89°  -> +1°
  //    3°  ->  3°
  //   -4°  -> -4°

  let angle = rawAngle;

  while (angle > 45) {
    angle -= 90;
  }

  while (angle <= -45) {
    angle += 90;
  }

  return angle;
}

export function rotation(
  cv: any,
  inputPage: any
): { rotated: any; image: any; rect: [number, number, number, number] } {
  // Match Python rotation(): retain the native page dimensions through deskew.
  // Orientation changes are explicit in the upload UI, before calibration.
  const page = inputPage;
  let big: any = null;
  let rotatedBig: any = null;
  let matrix: any = null;
  const rotated = new cv.Mat();
  try {
    big = largest_cnt(cv, page);
    const angle = normaliseDeskewAngle(cv.minAreaRect(big).angle);
    matrix = cv.getRotationMatrix2D(
      new cv.Point(Math.floor(page.cols / 2), Math.floor(page.rows / 2)), angle, 1
    );
    cv.warpAffine(page, rotated, matrix, new cv.Size(page.cols, page.rows));
    rotatedBig = largest_cnt(cv, rotated);
    const bounding = cv.boundingRect(rotatedBig);
    return {
      image: rotated,
      rotated,
      rect: [bounding.x, bounding.y, bounding.width, bounding.height],
    };
  } catch (error) {
    rotated.delete();
    throw error;
  } finally {
    big?.delete();
    rotatedBig?.delete();
    matrix?.delete();
  }
}

/**
 * Python Source:
 * def scale(image: cv2.typing.MatLike, rect: list, params: Parameters) -> cv2.typing.MatLike:
 *   rx, ry, rw, rh = params.rect
/**
 * Decodes an OpenCV exception pointer or error into a human-readable message.
 * Emscripten OpenCV.js throws C++ pointers (numbers) which can be retrieved with cv.exceptionFromPtr.
 */
export function decodeCVError(cv: any, err: any): string {
  if (typeof err === 'number' && cv && typeof cv.exceptionFromPtr === 'function') {
    try {
      const exp = cv.exceptionFromPtr(err);
      return exp?.msg || `OpenCV Exception ${err}`;
    } catch (_) {
      return `OpenCV Exception Pointer: ${err}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Python Source:
 * def scale(image, rect, params):
 *   rx, ry, rw, rh = params.rect
 *   x, y, w, h = rect
 *   scale_x = rw / w
 *   scale_y = rh / h
 *
 *   height, width, _ = image.shape
 *   sx, sy, sw, sh = round(x * scale_x), round(y * scale_y), round(w * scale_x), round(h * scale_y)
 *   image = cv2.resize(image, (round(width * scale_x), round(height * scale_y)))
 *
 *   if sx < rx:
 *     image = cv2.copyMakeBorder(image, 0, 0, rx - sx, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))
 *   else:
 *     image = image[0:image.shape[0], sx - rx:image.shape[1]]
 *
 *   if sy < ry:
 *     image = cv2.copyMakeBorder(image, ry - sy, 0, 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))
 *   else:
 *     image = image[sy - ry:height, 0:image.shape[1]]
 *
 *   if image.shape[1] < 4800:
 *     image = cv2.copyMakeBorder(image, 0, 0, 0, 4800 - image.shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255))
 *   else:
 *     image = image[0:image.shape[0], 0:4800]
 *
 *   if image.shape[0] < 6840:
 *     image = cv2.copyMakeBorder(image, 0, 6840 - image.shape[0], 0, 0, cv2.BORDER_CONSTANT, value=(255, 255, 255))
 *   else:
 *     image = image[0:6840, 0:4800]
 *
 *   return image
 */
export function scale(
  cv: any,
  image: any,
  rect: [number, number, number, number],
  params: { rect: [number, number, number, number] }
): any {
  const [rx, ry, rw, rh] = params.rect;
  const [x, y, w, h] = rect;
  const scale_x = rw / Math.max(1, w);
  const scale_y = rh / Math.max(1, h);

  const width = image.cols;
  const height = image.rows;
  const sx = Math.round(x * scale_x);
  const sy = Math.round(y * scale_y);

  const targetW = TEMPLATE_WIDTH;
  const targetH = TEMPLATE_HEIGHT;

  const resized = new cv.Mat();
  cv.resize(
    image,
    resized,
    new cv.Size(Math.max(1, Math.round(width * scale_x)), Math.max(1, Math.round(height * scale_y))),
    0,
    0,
    cv.INTER_LINEAR
  );

  // Exact Python ChilliMark alignment:
  // Maps scaled contour top-left (sx, sy) to calibration rectangle top-left (rx, ry)
  const srcX = Math.max(0, sx - rx);
  const srcY = Math.max(0, sy - ry);

  const dstX = Math.max(0, rx - sx);
  const dstY = Math.max(0, ry - sy);

  const copyW = Math.max(0, Math.min(resized.cols - srcX, targetW - dstX));
  const copyH = Math.max(0, Math.min(resized.rows - srcY, targetH - dstY));

  // Canonical 4800x6840 canvas filled with white (255)
  const result = new cv.Mat(
    targetH,
    targetW,
    resized.type(),
    new cv.Scalar(255, 255, 255, 255)
  );

  if (copyW > 0 && copyH > 0) {
    const srcRoi = resized.roi(new cv.Rect(srcX, srcY, copyW, copyH));
    const dstRoi = result.roi(new cv.Rect(dstX, dstY, copyW, copyH));
    srcRoi.copyTo(dstRoi);
    srcRoi.delete();
    dstRoi.delete();
  }

  resized.delete();
  return result;
}

/**
 * Extracts point coordinates from an OpenCV contour Mat
 */
function extractPoints(contourMat: any): ContourPoint[] {
  const points: ContourPoint[] = [];
  const data = contourMat.data32S;
  for (let i = 0; i < data.length; i += 2) {
    points.push({ x: data[i], y: data[i + 1] });
  }
  return points;
}

/**
 * Creates an OpenCV contour Mat from point array
 */
function createContourMat(cv: any, points: ContourPoint[]): any {
  const mat = new cv.Mat(points.length, 1, cv.CV_32SC2);
  const data = mat.data32S;
  for (let i = 0; i < points.length; i++) {
    data[i * 2] = points[i].x;
    data[i * 2 + 1] = points[i].y;
  }
  return mat;
}

/**
 * Python Source: Parameters.set_box (lines 101-147):
 * def set_box(self, image):
 *   clip = get_thresh(image[int(self.box_y1):int(self.box_y2), int(self.box_x1):int(self.box_x2)], blur=False)
 *   outer, _ = cv2.findContours(clip, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
 *   outer = outer[0]
 *   extra = 0
 *   check_area = 0
 *   outer_area = cv2.contourArea(outer)
 *   while abs(check_area - outer_area) > 10:
 *     outer_area = 0 + check_area
 *     check_img = get_thresh(image[int(self.box_y1 - extra):int(self.box_y2 + extra * 2), int(self.box_x1 - extra):int(self.box_x2 + extra * 2)], blur=True)
 *     check_outer, _ = cv2.findContours(check_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
 *     check_outer = check_outer[0]
 *     check_area = cv2.contourArea(check_outer)
 *     outer = check_outer
 *     extra += 1
 *   outer = cv2.approxPolyDP(check_outer, 0.05 * cv2.arcLength(outer, True), True)
 *   percentage = abs(area(outer) - ((self.box_y2 - self.box_y1) * (self.box_x2 - self.box_x1))) / area(outer)
 *   x, y, w, h = cv2.boundingRect(outer)
 *   clip = cv2.bitwise_not(check_img)
 *   clip = cv2.drawContours(clip, [outer], -1, 0, w // 6)
 *   clip = clip[y:y+h, x:x+w]
 *   inner, _ = cv2.findContours(clip, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
 *   inner = inner[0]
 *   self.h = h
 *   self.w = w
 *   self.outer = outer - contour_center(outer)
 *   self.inner = inner - contour_center(inner)
 *   self.fill_limit = 5.5 * (cv2.contourArea(self.inner)) ** 0.5
 */
export function set_box(
  cv: any,
  image: any,
  box_x1: number,
  box_y1: number,
  box_x2: number,
  box_y2: number
): {
  w: number;
  h: number;
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  outer: ContourPoint[];
  inner: ContourPoint[];
  fill_limit: number;
  text_shift: [number, number];
  font_size: number;
} {
  const minX = Math.max(0, Math.floor(Math.min(box_x1, box_x2)));
  const minY = Math.max(0, Math.floor(Math.min(box_y1, box_y2)));
  const maxX = Math.min(image.cols, Math.floor(Math.max(box_x1, box_x2)));
  const maxY = Math.min(image.rows, Math.floor(Math.max(box_y1, box_y2)));
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw <= 0 || bh <= 0) throw new Error('Select one empty answer box within the page.');

  // Keep OpenCV's contour order, matching Python's contours[0]. Do not
  // substitute a rectangle or a different contour when extraction fails.
  const firstContour = (threshold: any): any => {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    try {
      cv.findContours(threshold, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      if (!contours.size()) throw new Error('No usable box contour found. Select one empty box tightly.');
      return contours.get(0);
    } finally {
      contours.delete();
      hierarchy.delete();
    }
  };
  const thresholdRegion = (x1: number, y1: number, x2: number, y2: number, blur: boolean): any => {
    const roi = image.roi(new cv.Rect(x1, y1, x2 - x1, y2 - y1));
    try { return get_thresh(cv, roi, blur); } finally { roi.delete(); }
  };

  let threshold: any = null;
  let measured: any = null;
  let outer: any = null;
  let inverted: any = null;
  let inner: any = null;
  let originX = minX;
  let originY = minY;
  try {
    threshold = thresholdRegion(minX, minY, maxX, maxY, false);
    measured = firstContour(threshold);
    let previousArea = cv.contourArea(measured);
    let checkArea = 0;
    if (previousArea <= 10) throw new Error('The selection does not contain a usable empty box.');

    let extra = 0;
    while (Math.abs(checkArea - previousArea) > 10) {
      // Python grows the crop until the contour area stabilizes. A bounded
      // failure protects the browser; reaching it never accepts guessed geometry.
      if (extra >= 128) throw new Error('Box contour did not stabilize. Select one empty box more tightly.');
      previousArea = checkArea;
      originX = Math.max(0, minX - extra);
      originY = Math.max(0, minY - extra);
      threshold.delete();
      threshold = null;
      threshold = thresholdRegion(originX, originY,
        Math.min(image.cols, maxX + extra * 2), Math.min(image.rows, maxY + extra * 2), true);
      measured.delete();
      measured = null;
      measured = firstContour(threshold);
      checkArea = cv.contourArea(measured);
      extra++;
    }

    outer = new cv.Mat();
    cv.approxPolyDP(measured, outer, 0.05 * cv.arcLength(measured, true), true);
    const bound = cv.boundingRect(outer);
    const boundingArea = bound.width * bound.height;
    if (!boundingArea || Math.abs(boundingArea - bw * bh) / boundingArea > 1) {
      throw new Error('The area of the box contour does not match the selection.');
    }
    const outerCenter = contour_center(cv, outer);
    if (cv.contourArea(outer) <= 0) throw new Error('The outer box contour is degenerate.');

    inverted = new cv.Mat();
    cv.bitwise_not(threshold, inverted);
    const vector = new cv.MatVector();
    try {
      vector.push_back(outer);
      cv.drawContours(inverted, vector, -1, new cv.Scalar(0), Math.floor(bound.width / 6));
    } finally { vector.delete(); }
    const cavity = inverted.roi(new cv.Rect(bound.x, bound.y, bound.width, bound.height));
    try { inner = firstContour(cavity); } finally { cavity.delete(); }
    const innerArea = cv.contourArea(inner);
    if (innerArea <= 0) throw new Error('The selected box has no usable inner contour.');
    const innerCenter = contour_center(cv, inner);
    const centered = (contour: any, center: [number, number]): ContourPoint[] =>
      extractPoints(contour).map(pt => ({ x: pt.x - center[0], y: pt.y - center[1] }));

    // Annotation placement is independent of mark detection.
    const font_size = 100 > bound.height * 1.2 ? 3 : 4;
    const text_shift: [number, number] = font_size === 3
      ? [-30, -bound.height] : [-40, 50];
    return {
      w: bound.width,
      h: bound.height,
      x: originX + bound.x,
      y: originY + bound.y,
      cx: originX + outerCenter[0],
      cy: originY + outerCenter[1],
      outer: centered(outer, outerCenter),
      inner: centered(inner, innerCenter),
      fill_limit: 5.5 * Math.sqrt(innerArea),
      text_shift,
      font_size,
    };
  } finally {
    threshold?.delete();
    measured?.delete();
    outer?.delete();
    inverted?.delete();
    inner?.delete();
  }
}

/**
 * Python Source:
 * def slice_messy(q_area, e_cnt, params, x, y, w, h, boxes):
 *   slice_mask = numpy.zeros(q_area.shape, dtype="uint8")
 *   slice_mask = cv2.drawContours(slice_mask, [e_cnt], -1, (255, 255, 255), -1)
 *   x_scale = w // params.w + 1
 *   y_scale = h // params.h
 *   j = 1
 *   while j < x_scale:
 *     cv2.line(slice_mask, (x + j * w // x_scale, y - 10), (x + j * w // x_scale, y + h + 10), (0, 0, 0), 15)
 *     j += 1
 *   k = 1
 *   while k < y_scale:
 *     cv2.line(slice_mask, (x - 10, y + k * h // y_scale), (x + w + 10, y + k * h // y_scale), (0, 0, 0), 15)
 *     k += 1
 *   slice_mask = cv2.cvtColor(slice_mask, cv2.COLOR_RGB2GRAY)
 *   slice_cnts, _ = cv2.findContours(slice_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
 *   for s_cnt in slice_cnts:
 *     _, _, sw, sh = cv2.boundingRect(s_cnt)
 *     if params.w * 0.5 <= sw <= params.w * 1.5 and params.h * 0.5 <= sh <= params.h * 1.5:
 *       boxes.append(contour_center(s_cnt))
 */
export function slice_messy(cv: any, q_area: any, e_cnt: any, params: any, x: number, y: number, w: number, h: number, boxes: [number, number][]): void {
  const slice_mask = new cv.Mat.zeros(q_area.rows, q_area.cols, cv.CV_8UC3);
  const drawVec = new cv.MatVector();
  drawVec.push_back(e_cnt);
  cv.drawContours(slice_mask, drawVec, -1, new cv.Scalar(255, 255, 255, 255), -1);
  drawVec.delete();

  const x_scale = Math.floor(w / params.w) + 1;
  const y_scale = Math.floor(h / params.h);

  for (let j = 1; j < x_scale; j++) {
    const lx = Math.floor(x + (j * w) / x_scale);
    cv.line(slice_mask, new cv.Point(lx, y - 10), new cv.Point(lx, y + h + 10), new cv.Scalar(0, 0, 0, 0), 15);
  }

  for (let k = 1; k < y_scale; k++) {
    const ly = Math.floor(y + (k * h) / y_scale);
    cv.line(slice_mask, new cv.Point(x - 10, ly), new cv.Point(x + w + 10, ly), new cv.Scalar(0, 0, 0, 0), 15);
  }

  const grayMask = new cv.Mat();
  cv.cvtColor(slice_mask, grayMask, cv.COLOR_RGB2GRAY);

  const slice_cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(grayMask, slice_cnts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  for (let i = 0; i < slice_cnts.size(); i++) {
    const s_cnt = slice_cnts.get(i);
    const b = cv.boundingRect(s_cnt);
    if (params.w * 0.5 <= b.width && b.width <= params.w * 1.5 && params.h * 0.5 <= b.height && b.height <= params.h * 1.5) {
      boxes.push(contour_center(cv, s_cnt));
    }
    s_cnt.delete();
  }

  slice_mask.delete();
  grayMask.delete();
  slice_cnts.delete();
  hier.delete();
}

/**
 * Python Source:
 * def erode_messy(c, q_area, params, boxes):
 *   erode_mask = numpy.zeros(q_area.shape, dtype="uint8")
 *   erode_mask = cv2.drawContours(erode_mask, [c], -1, (255, 255, 255), -1)
 *   kernel = numpy.ones((31, 31), numpy.uint8)
 *   erode_mask = cv2.erode(erode_mask, kernel=kernel, iterations=1)
 *   erode_mask = cv2.cvtColor(erode_mask, cv2.COLOR_BGR2GRAY)
 *   erode_cnts, _ = cv2.findContours(erode_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
 *   for e_cnt in erode_cnts:
 *     x, y, w, h = cv2.boundingRect(e_cnt)
 *     if params.w * 0.5 <= w <= params.w * 1.5 and params.h * 0.5 <= h <= params.h * 1.5:
 *       boxes.append(contour_center(e_cnt))
 *       continue
 *     slice_messy(q_area, e_cnt, params, x, y, w, h, boxes)
 */
export function erode_messy(cv: any, c: any, q_area: any, params: any, boxes: [number, number][]): void {
  const erode_mask = new cv.Mat.zeros(q_area.rows, q_area.cols, cv.CV_8UC3);
  const drawVec = new cv.MatVector();
  drawVec.push_back(c);
  cv.drawContours(erode_mask, drawVec, -1, new cv.Scalar(255, 255, 255, 255), -1);
  drawVec.delete();

  const kernel = cv.Mat.ones(31, 31, cv.CV_8U);
  const eroded = new cv.Mat();
  cv.erode(erode_mask, eroded, kernel, new cv.Point(-1, -1), 1);

  const gray = new cv.Mat();
  cv.cvtColor(eroded, gray, cv.COLOR_RGB2GRAY);

  const erode_cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(gray, erode_cnts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  for (let i = 0; i < erode_cnts.size(); i++) {
    const e_cnt = erode_cnts.get(i);
    const b = cv.boundingRect(e_cnt);
    if (params.w * 0.5 <= b.width && b.width <= params.w * 1.5 && params.h * 0.5 <= b.height && b.height <= params.h * 1.5) {
      boxes.push(contour_center(cv, e_cnt));
    } else {
      slice_messy(cv, q_area, e_cnt, params, b.x, b.y, b.width, b.height, boxes);
    }
    e_cnt.delete();
  }

  erode_mask.delete();
  kernel.delete();
  eroded.delete();
  gray.delete();
  erode_cnts.delete();
  hier.delete();
}

/**
 * Python Source:
 * def find_boxes(q_area, params):
 *   boxes = []
 *   thresh = get_thresh(q_area)
 *   cnts, hier = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
 *   sorted_cnts = [c for i, c in enumerate(cnts) if hier[0][i][3] == -1]
 *   sorted_cnts = sorted(sorted_cnts, key=area, reverse=True)
 *   limit = int(0.9 * params.h * params.w)
 *   min_w = int(params.w * 0.8)
 *   min_h = int(params.h * 0.8)
 *   max_w = int(params.w * 1.3)
 *   max_h = int(params.h * 1.3)
 *   version = None
 *   if params.w > params.h * 2:
 *     version = "narrow"
 *   for c in sorted_cnts:
 *     _, _, w, h = cv2.boundingRect(c)
 *     if w * h < limit:
 *       break
 *     if min_w <= w <= max_w and min_h <= h <= max_h:
 *       boxes.append(contour_center(c))
 *       continue
 *     if version == "narrow":
 *       continue
 *     if h < params.h * 4.5:
 *       erode_messy(c, q_area, params, boxes)
 *   return boxes
 */
export function find_boxes(cv: any, q_area: any, params: CalibrationParams): [number, number][] {
  const boxes: [number, number][] = [];
  const thresh = get_thresh(cv, q_area, true);

  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const hierData = hier.data32S; // array of [next, prev, first_child, parent]
  const externalContours: any[] = [];

  for (let i = 0; i < cnts.size(); i++) {
    const parent = hierData[i * 4 + 3];
    if (parent === -1) {
      const c = cnts.get(i);
      externalContours.push({ contour: c, area: area(cv, c) });
    }
  }

  externalContours.sort((a, b) => b.area - a.area);

  const limit = Math.floor(0.9 * params.h * params.w);
  const min_w = Math.floor(params.w * 0.8);
  const min_h = Math.floor(params.h * 0.8);
  const max_w = Math.floor(params.w * 1.3);
  const max_h = Math.floor(params.h * 1.3);
  const version = params.w > params.h * 2 ? 'narrow' : null;

  for (const item of externalContours) {
    const c = item.contour;
    const b = cv.boundingRect(c);
    const w = b.width;
    const h = b.height;

    if (w * h < limit) {
      break;
    }

    if (min_w <= w && w <= max_w && min_h <= h && h <= max_h) {
      boxes.push(contour_center(cv, c));
      continue;
    }

    if (version === 'narrow') {
      continue;
    }

    if (h < params.h * 4.5) {
      erode_messy(cv, c, q_area, params, boxes);
    }
  }

  // Cleanup
  thresh.delete();
  hier.delete();
  for (let i = 0; i < cnts.size(); i++) {
    cnts.get(i).delete();
  }
  cnts.delete();

  return boxes;
}

/**
 * Python Source:
 * def sort_into_columns(boxes, params: Parameters):
 *   columns = [[]]
 *   boxes = sorted(boxes, key=operator.itemgetter(0))
 *   prev_x = 0
 *   col_index = 0
 *   for i, box in enumerate(boxes):
 *     x, _ = box
 *     if abs(x - prev_x) > params.w // 2 and i > 0:
 *       col_index += 1
 *       columns.append([])
 *     columns[col_index].append(box)
 *     prev_x = x
 *   columns = [c for c in columns if len(c) > 2]
 *   col_avg = []
 *   for c, column in enumerate(columns):
 *     columns[c] = sorted(column, key=operator.itemgetter(1))
 *     x_pos = []
 *     for r in columns[c]:
 *       x_pos.append(r[0])
 *     if len(x_pos):
 *       avg = sum(x_pos) / len(x_pos)
 *       col_avg.append(int(avg))
 *   params.col_avg = col_avg
 *   params.x_jump = int((col_avg[-1] - col_avg[0]) / len(col_avg))
 *   prev = col_avg[0]
 *   for i, x_pos in enumerate(col_avg):
 *     if x_pos - prev > params.x_jump * 1.2:
 *       params.choices = i
 *       break
 *     prev = x_pos
 *     params.choices = i + 1
 *   filtered_boxes = [box for column in columns for box in column]
 *   return columns, filtered_boxes
 */
export function sort_into_columns(
  boxes: [number, number][],
  params: CalibrationParams
): { columns: [number, number][][]; filtered_boxes: [number, number][] } {
  if (boxes.length === 0) {
    return { columns: [], filtered_boxes: [] };
  }

  let columns: [number, number][][] = [[]];
  const sortedBoxes = [...boxes].sort((a, b) => a[0] - b[0]);

  let prev_x = 0;
  let col_index = 0;
  for (let i = 0; i < sortedBoxes.length; i++) {
    const box = sortedBoxes[i];
    const x = box[0];
    if (Math.abs(x - prev_x) > Math.floor(params.w / 2) && i > 0) {
      col_index += 1;
      columns.push([]);
    }
    columns[col_index].push(box);
    prev_x = x;
  }

  columns = columns.filter((c) => c.length > 2);

  const col_avg: number[] = [];
  for (let c = 0; c < columns.length; c++) {
    columns[c].sort((a, b) => a[1] - b[1]);
    const x_pos = columns[c].map((r) => r[0]);
    if (x_pos.length > 0) {
      const avg = x_pos.reduce((sum, v) => sum + v, 0) / x_pos.length;
      col_avg.push(Math.floor(avg));
    }
  }

  params.col_avg = col_avg;
  if (col_avg.length > 0) {
    params.x_jump = Math.floor((col_avg[col_avg.length - 1] - col_avg[0]) / col_avg.length);

    let prev = col_avg[0];
    for (let i = 0; i < col_avg.length; i++) {
      const x_pos = col_avg[i];
      if (x_pos - prev > params.x_jump * 1.2) {
        params.choices = i;
        break;
      }
      prev = x_pos;
      params.choices = i + 1;
    }
  } else {
    params.x_jump = 0;
    params.choices = 4;
  }

  const filtered_boxes = columns.flat();
  return { columns, filtered_boxes };
}

/**
 * Python Source:
 * def sort_into_rows(boxes, params):
 *   rows = [[]]
 *   boxes = sorted(boxes, key=operator.itemgetter(1))
 *   prev_y = 0
 *   row_index = 0
 *   for i, box in enumerate(boxes):
 *     _, y = box
 *     if abs(y - prev_y) > 0.95 * params.h and i > 0:
 *       row_index += 1
 *       rows.append([])
 *     rows[row_index].append(box)
 *     prev_y = y
 *   rows = [r for r in rows if len(r) > 2]
 *   row_avg = []
 *   for r, row in enumerate(rows):
 *     rows[r] = sorted(row, key=operator.itemgetter(0))
 *     y_pos = []
 *     for c in rows[r]:
 *       _, y = c
 *       y_pos.append(y)
 *     avg = sum(y_pos) / len(y_pos)
 *     row_avg.append(int(avg))
 *   params.row_avg = row_avg
 *   if len(row_avg) > 1:
 *     gaps = [row_avg[i + 1] - row_avg[i] for i in range(len(row_avg) - 1)]
 *     gaps.sort()
 *     n = len(gaps)
 *     params.y_jump = (
 *       0 if n == 0 else
 *       gaps[n // 2] if n % 2 else
 *       int((gaps[n // 2 - 1] + gaps[n // 2]) / 2)
 *     )
 *   else:
 *     params.y_jump = 0
 */
export function sort_into_rows(boxes: [number, number][], params: CalibrationParams): void {
  if (boxes.length === 0) {
    params.row_avg = [];
    params.y_jump = 0;
    return;
  }

  let rows: [number, number][][] = [[]];
  const sortedBoxes = [...boxes].sort((a, b) => a[1] - b[1]);

  let prev_y = 0;
  let row_index = 0;
  for (let i = 0; i < sortedBoxes.length; i++) {
    const box = sortedBoxes[i];
    const y = box[1];
    if (Math.abs(y - prev_y) > 0.95 * params.h && i > 0) {
      row_index += 1;
      rows.push([]);
    }
    rows[row_index].push(box);
    prev_y = y;
  }

  rows = rows.filter((r) => r.length > 2);

  const row_avg: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    rows[r].sort((a, b) => a[0] - b[0]);
    const y_pos = rows[r].map((c) => c[1]);
    const avg = y_pos.reduce((sum, v) => sum + v, 0) / y_pos.length;
    row_avg.push(Math.floor(avg));
  }

  // Calculate gaps to find median y_jump
  if (row_avg.length > 1) {
    const gaps: number[] = [];
    for (let i = 0; i < row_avg.length - 1; i++) {
      gaps.push(row_avg[i + 1] - row_avg[i]);
    }
    gaps.sort((a, b) => a - b);
    const n = gaps.length;
    params.y_jump =
      n === 0
        ? 0
        : n % 2 === 1
        ? gaps[Math.floor(n / 2)]
        : Math.floor((gaps[Math.floor(n / 2) - 1] + gaps[Math.floor(n / 2)]) / 2);
  } else {
    params.y_jump = params.y_jump || 0;
  }

  // If there are gaps in row_avg greater than 1.6 * y_jump, interpolate missing rows
  if (params.y_jump > 0 && row_avg.length > 1) {
    const filled_row_avg: number[] = [row_avg[0]];
    for (let i = 1; i < row_avg.length; i++) {
      const prevY = filled_row_avg[filled_row_avg.length - 1];
      const currY = row_avg[i];
      const gap = currY - prevY;
      const numSteps = Math.round(gap / params.y_jump);
      if (numSteps > 1 && numSteps <= 5) {
        const stepSize = gap / numSteps;
        for (let s = 1; s < numSteps; s++) {
          filled_row_avg.push(Math.floor(prevY + s * stepSize));
        }
      }
      filled_row_avg.push(currY);
    }
    params.row_avg = filled_row_avg;
  } else {
    params.row_avg = row_avg;
  }
}

/**
 * Python Source:
 * def missing(columns, params, img):
 *   Aligns detected boxes in each column 1-to-1 against expected row positions.
 *   Inserts placeholders for missing/filled boxes and drops stray noise so all
 *   columns have identical row count and accurate question-to-row mapping.
 */
export function missing(
  columns: [number, number][][],
  params: CalibrationParams
): [number, number][][] {
  if (!params.row_avg || params.row_avg.length === 0 || !params.col_avg) {
    return columns;
  }

  const choices = params.choices || 4;
  const numBlocks = Math.max(1, Math.floor(columns.length / choices));
  const yJump = params.y_jump || (params.h ? params.h * 2.5 : 100);
  const tol = Math.min(yJump * 0.45, Math.max(params.h * 0.85, 45));

  for (let b = 0; b < numBlocks; b++) {
    const startCol = b * choices;
    const endCol = Math.min(columns.length, startCol + choices);
    const blockColumns = columns.slice(startCol, endCol);

    // Find Y-bounds of detected boxes in this block
    const allBlockBoxes = blockColumns.flat();
    if (allBlockBoxes.length === 0) continue;

    let bMinY = Infinity;
    let bMaxY = -Infinity;
    for (const pt of allBlockBoxes) {
      if (pt[1] < bMinY) bMinY = pt[1];
      if (pt[1] > bMaxY) bMaxY = pt[1];
    }

    // Determine the rows in params.row_avg that fall within this block's Y-extent
    const blockRows = params.row_avg.filter(
      (y) => y >= bMinY - tol && y <= bMaxY + tol
    );

    const rowsToUse = blockRows.length >= 5 ? blockRows : params.row_avg;

    // Per-block Y adjustment: compute median offset of detected boxes in this block from blockRows
    const offsets: number[] = [];
    for (const col of blockColumns) {
      for (const box of col) {
        for (const rY of rowsToUse) {
          if (Math.abs(box[1] - rY) <= tol) {
            offsets.push(box[1] - rY);
            break;
          }
        }
      }
    }
    offsets.sort((a, b) => a - b);
    const medianOffset = offsets.length > 0 ? offsets[Math.floor(offsets.length / 2)] : 0;

    for (let c = startCol; c < endCol; c++) {
      const colBoxes = columns[c] || [];
      const colX = params.col_avg[c] !== undefined ? params.col_avg[c] : (colBoxes[0]?.[0] ?? 0);
      const alignedColumn: [number, number][] = [];
      const usedBoxIndices = new Set<number>();

      for (let r = 0; r < rowsToUse.length; r++) {
        const targetY = rowsToUse[r] + medianOffset;

        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < colBoxes.length; i++) {
          if (usedBoxIndices.has(i)) continue;
          const dist = Math.abs(colBoxes[i][1] - targetY);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }

        if (bestIdx !== -1 && bestDist <= tol) {
          usedBoxIndices.add(bestIdx);
          // Preserve authentic detected contour center coordinates
          alignedColumn.push([colBoxes[bestIdx][0], colBoxes[bestIdx][1]]);
        } else {
          // Interpolate placeholder for missing/filled box
          alignedColumn.push([colX, targetY]);
        }
      }

      columns[c] = alignedColumn;
    }
  }

  return columns;
}

/**
 * Python Source:
 * def find_questions(columns, params):
 *   stack = [[]] * params.choices
 *   for c, column in enumerate(columns):
 *     index = c % params.choices
 *     stack[index] = stack[index] + column
 *   questions = []
 *   for r, row in enumerate(stack[0]):
 *     question = Question(r)
 *     for c, column in enumerate(stack):
 *       try:
 *         box = Question.Box(column[r], c)
 *         question.boxes.append(box)
 *       except:
 *         print("column", r, c)
 *     questions.append(question)
 *   if params.key:
 *     questions = questions[:len(params.key)]
 *   return questions
 */
export function find_questions(
  columns: [number, number][][],
  params: CalibrationParams
): DetectedQuestion[] {
  const choices = params.choices || 4;
  const stack: [number, number][][] = Array.from({ length: choices }, () => []);

  for (let c = 0; c < columns.length; c++) {
    const index = c % choices;
    stack[index] = stack[index].concat(columns[c]);
  }

  const questions: DetectedQuestion[] = [];
  if (stack.length === 0 || stack[0].length === 0) return questions;

  for (let r = 0; r < stack[0].length; r++) {
    const question: DetectedQuestion = {
      number: r,
      response: 'Blank',
      response_box: null,
      boxes: [],
    };

    for (let c = 0; c < stack.length; c++) {
      if (stack[c][r]) {
        const box: QuestionBox = {
          xy: stack[c][r],
          letter: String.fromCharCode(c + 65),
          colour: null,
          bool: false,
        };
        question.boxes.push(box);
      }
    }
    questions.push(question);
  }

  if (params.key && Object.keys(params.key).length > 0) {
    const keyLen = Object.keys(params.key).length;
    return questions.slice(0, keyLen);
  }

  return questions;
}

/**
 * Python Source: Box.fill (lines 30-39) & find_responses (lines 730-747)
 * def fill(self, params, thresh):
 *   contour = params.inner + self.xy
 *   x, y, w, h = cv2.boundingRect(contour)
 *   temp = thresh[y:y+h, x:x+w]
 *   mask = numpy.zeros(temp.shape, dtype="uint8")
 *   mask = cv2.bitwise_and(temp, temp, mask)
 *   if cv2.countNonZero(mask) > params.fill_limit:
 *     self.bool = True
 *     self.colour = "yellow"
 *
 * def find_responses(student: Student, image, params: Parameters):
 *   thresh = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
 *   thresh = cv2.threshold(thresh, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
 *   for question in student.questions:
 *     filled = 0
 *     for box in question.boxes:
 *       box.fill(params, thresh)
 *       if box.bool:
 *         filled += 1
 *     if filled > 1:
 *       question.response = False
 *       student.incomplete.append(question)
 *     else:
 *       question.get_response()
 */
export function find_responses(
  cv: any,
  student: { questions: DetectedQuestion[]; incomplete: DetectedQuestion[] },
  image: any,
  params: CalibrationParams
): void {
  const gray = new cv.Mat();
  if (image.channels() === 4) {
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY);
  } else if (image.channels() === 3) {
    cv.cvtColor(image, gray, cv.COLOR_RGB2GRAY);
  } else {
    image.copyTo(gray);
  }

  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray.delete();

  for (const question of student.questions) {
    let filled = 0;

    for (const box of question.boxes) {
      if (!box.xy || isNaN(box.xy[0]) || isNaN(box.xy[1])) {
        continue;
      }

      // Exact Python Box.fill (lines 31-36):
      // contour = params.inner + self.xy
      // x, y, w, h = cv2.boundingRect(contour)
      // temp = thresh[y:y+h, x:x+w]
      // if cv2.countNonZero(mask) > params.fill_limit:
      const shiftedPts = params.inner.map((pt) => ({
        x: Math.round(pt.x + box.xy[0]),
        y: Math.round(pt.y + box.xy[1]),
      }));
      const contourMat = createContourMat(cv, shiftedPts);
      const b = cv.boundingRect(contourMat);
      contourMat.delete();

      const rx = Math.max(0, Math.min(thresh.cols - 1, b.x));
      const ry = Math.max(0, Math.min(thresh.rows - 1, b.y));
      const rw = Math.max(0, Math.min(thresh.cols - rx, b.width));
      const rh = Math.max(0, Math.min(thresh.rows - ry, b.height));

      if (rw > 0 && rh > 0) {
        const temp = thresh.roi(new cv.Rect(rx, ry, rw, rh));
        const count = cv.countNonZero(temp);
        temp.delete();

        if (count > params.fill_limit) {
          box.bool = true;
          box.colour = 'yellow';
          filled += 1;
        }
      }
    }

    if (filled > 1) {
      question.response = false;
      student.incomplete.push(question);
    } else {
      // question.get_response()
      let answered = false;
      for (const box of question.boxes) {
        if (box.bool) {
          question.response = box.letter;
          question.response_box = box;
          box.colour = 'red';
          answered = true;
          break;
        }
      }
      if (!answered) {
        question.response = 'Blank';
        question.response_box = null;
      }
    }
  }

  thresh.delete();
}

/**
 * Python Source: Student.annotate (lines 291-298)
 * def annotate(self, params, image):
 *   for question in self.questions:
 *     if question.response == "Blank" or not question.response:
 *       continue
 *     for box in question.boxes:
 *       if box.bool:
 *         cv2.drawContours(image, [box.xy + params.outer], -1, Student.colours.get(box.colour), 5, cv2.LINE_AA)
 *   return image
 */
export function annotate(
  cv: any,
  student: { questions: DetectedQuestion[] },
  params: CalibrationParams,
  image: any
): void {
  const colours: Record<string, [number, number, number, number]> = {
    red: [200, 0, 0, 255],
    yellow: [250, 170, 0, 255],
    green: [0, 170, 0, 255],
  };

  for (const question of student.questions) {
    if (question.response === 'Blank' || !question.response) {
      continue;
    }
    for (const box of question.boxes) {
      if (box.bool && box.colour) {
        const shiftedPts = params.outer.map((pt) => ({
          x: pt.x + box.xy[0],
          y: pt.y + box.xy[1],
        }));
        const cMat = createContourMat(cv, shiftedPts);
        const vec = new cv.MatVector();
        vec.push_back(cMat);
        const col = colours[box.colour] || [200, 0, 0, 255];
        cv.drawContours(image, vec, -1, new cv.Scalar(col[0], col[1], col[2], col[3]), 5, cv.LINE_AA);
        cMat.delete();
        vec.delete();
      }
    }
  }
}

/**
 * Python Source: Student.add_markup (lines 300-316)
 * def add_markup(self, image, params):
 *   for question in self.questions:
 *     if question.number > len(params.key) - 1:
 *       break
 *     if params.key[question.number] == question.response:
 *       question.response_box.colour = "green"
 *       self.score += 1
 *     x, y = question.boxes[ord(params.key[question.number]) - 65].xy
 *     text_y = y + params.text_shift[1]
 *     text_x = x + params.text_shift[0]
 *     cv2.putText(image, params.key[question.number], (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, params.font_size, (255, 255, 255), 20, lineType=cv2.LINE_AA)
 *     cv2.putText(image, params.key[question.number], (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, params.font_size, Student.colours.get("green"), 7, lineType=cv2.LINE_AA)
 */
export function add_markup(
  cv: any,
  student: { questions: DetectedQuestion[]; responses: (string | false)[]; score: number; scan: any },
  image: any,
  params: CalibrationParams
): void {
  const keyLength = Object.keys(params.key).length;

  for (const question of student.questions) {
    if (question.number > keyLength - 1) {
      break;
    }
    const correctAns = params.key[question.number];
    if (!correctAns) continue;

    if (correctAns === question.response) {
      if (question.response_box) {
        question.response_box.colour = 'green';
      }
      student.score += 1;
    }

    const boxIdx = correctAns.charCodeAt(0) - 65;
    if (question.boxes[boxIdx]) {
      const [x, y] = question.boxes[boxIdx].xy;
      const text_y = y + params.text_shift[1];
      const text_x = x + params.text_shift[0];

      cv.putText(
        image,
        correctAns,
        new cv.Point(text_x, text_y),
        cv.FONT_HERSHEY_SIMPLEX,
        params.font_size,
        new cv.Scalar(255, 255, 255, 255),
        20,
        cv.LINE_AA
      );
      cv.putText(
        image,
        correctAns,
        new cv.Point(text_x, text_y),
        cv.FONT_HERSHEY_SIMPLEX,
        params.font_size,
        new cv.Scalar(0, 170, 0, 255),
        7,
        cv.LINE_AA
      );
    }
  }

  // Score text on the top right
  const allAnswered = student.responses.every((r) => r !== false && r !== undefined);
  if (allAnswered && student.scan) {
    const scoreStr = `Score = ${student.score} / ${keyLength}`;
    cv.putText(
      student.scan,
      scoreStr,
      new cv.Point(3600, 700),
      cv.FONT_HERSHEY_SIMPLEX,
      5,
      new cv.Scalar(255, 255, 255, 255),
      15,
      cv.LINE_AA
    );
    cv.putText(
      student.scan,
      scoreStr,
      new cv.Point(3600, 700),
      cv.FONT_HERSHEY_SIMPLEX,
      5,
      new cv.Scalar(0, 0, 0, 255),
      7,
      cv.LINE_AA
    );
  }
}

/**
 * Python Source: corrections cropping (lines 332-339)
 * centres = [box.xy for box in question.boxes]
 * qx, qy = (centres[0][0] + centres[-1][0]) // 2, (centres[0][1] + centres[-1][1]) // 2
 * x1 = qx - 500 + params.x1
 * y1 = qy - 110 + params.y1
 * x2 = qx + 500 + params.x1
 * y2 = qy + 110 + params.y1
 * unclear = student.pil_output.crop([x1, y1, x2, y2])
 */
export function get_correction_crop(
  cv: any,
  scanMat: any,
  question: DetectedQuestion,
  params: CalibrationParams
): string {
  if (question.boxes.length === 0) return '';
  const centres = question.boxes.map((b) => b.xy);
  const qx = Math.floor((centres[0][0] + centres[centres.length - 1][0]) / 2);
  const allY = centres.map((b) => b[1]);
  const qy = Math.floor(allY.reduce((sum, v) => sum + v, 0) / allY.length);

  // Per-page, per-question crop window based on question.boxes:
  // - Left pad 550px captures the full question number (e.g. "19", "20") without clipping on 600 DPI scans.
  // - Right pad 500px covers all choices.
  // - Vertical: -120px to +110px frames the question number, choices, and boxes squarely at the center.
  const x1 = Math.max(0, qx - 550 + params.x1);
  const y1 = Math.max(0, qy - 120 + params.y1);
  const x2 = Math.min(scanMat.cols, qx + 500 + params.x1);
  const y2 = Math.min(scanMat.rows, qy + 110 + params.y1);

  const cropRoi = scanMat.roi(new cv.Rect(x1, y1, x2 - x1, y2 - y1));
  const canvas = document.createElement('canvas');
  cv.imshow(canvas, cropRoi);
  cropRoi.delete();
  return canvas.toDataURL('image/png');
}

/**
 * Full per-page marking pipeline (executed independently per page):
 * 1. Load scan at its native raster dimensions (PDF pages are rendered at 600 DPI)
 * 2. rotation(page) -> deskew
 * 3. scale(page, cur_rect, cal_rect) -> match calibration rectangle size and pad/crop to (4800, 6840)
 * 4. Crop q_area = scan[y1:y2, x1:x2]
 * 5. boxes = find_boxes(q_area, params)
 * 6. columns, boxes = sort_into_columns(boxes, params)
 * 7. sort_into_rows(boxes, params)
 * 8. missing(columns, params, q_area)
 * 9. questions = find_questions(columns, params)
 * 10. find_responses(student, q_area, params)
 * 11. if params.key: add_markup(q_area, params)
 * 12. q_area = annotate(params, q_area)
 * 13. scan[y1:y2, x1:x2] = q_area
 * 14. Add student name overlay
 */
export async function processStudentScan(
  cv: any,
  scanDataUrl: string,
  studentName: string,
  studentIndex: number,
  params: CalibrationParams,
  onProgress?: (step: string) => void
): Promise<StudentResult> {
  onProgress?.('Loading scan at original resolution...');
  const pageMat = await renderScanMat(cv, scanDataUrl);

  onProgress?.('Detecting largest contour and deskewing page...');
  let rotated: any;
  let rect: [number, number, number, number];
  try {
    ({ rotated, rect } = rotation(cv, pageMat));
  } finally {
    pageMat.delete();
  }

  onProgress?.('Scaling and registering page...');
  let scaledScan: any;
  try {
    scaledScan = scale(cv, rotated, rect, params);
  } finally {
    rotated.delete();
  }

  onProgress?.('Cropping question area and finding boxes...');
  const qx1 = Math.max(0, Math.min(scaledScan.cols - 50, params.x1));
  const qy1 = Math.max(0, Math.min(scaledScan.rows - 50, params.y1));
  const qx2 = Math.max(qx1 + 50, Math.min(scaledScan.cols, params.x2));
  const qy2 = Math.max(qy1 + 50, Math.min(scaledScan.rows, params.y2));

  const qRoi = scaledScan.roi(
    new cv.Rect(qx1, qy1, qx2 - qx1, qy2 - qy1)
  );
  const q_area = qRoi.clone();
  qRoi.delete();

  // Create isolated per-page parameters copy so grid math doesn't contaminate other pages
  const pageParams: CalibrationParams = { ...params };

  const rawBoxes = find_boxes(cv, q_area, pageParams);

  onProgress?.('Sorting columns and rows...');
  const { columns, filtered_boxes } = sort_into_columns(rawBoxes, pageParams);
  sort_into_rows(filtered_boxes, pageParams);
  missing(columns, pageParams);

  onProgress?.('Constructing questions and detecting responses...');
  const questions = find_questions(columns, pageParams);

  const studentState: {
    name: string;
    index: number;
    questions: DetectedQuestion[];
    incomplete: DetectedQuestion[];
    responses: (string | false)[];
    score: number;
    scan: any;
  } = {
    name: studentName,
    index: studentIndex,
    questions,
    incomplete: [],
    responses: [],
    score: 0,
    scan: scaledScan,
  };

  find_responses(cv, studentState, q_area, pageParams);
  studentState.responses = studentState.questions.map((q) => q.response);

  // Capture clean deskewed scan for ambiguity crops before any annotations are baked
  const cleanCanvas = document.createElement('canvas');
  cv.imshow(cleanCanvas, scaledScan);
  const rawDeskewedDataUrl = cleanCanvas.toDataURL('image/png');

  const hasAmbiguity = studentState.incomplete.length > 0;

  let annotatedDataUrl = rawDeskewedDataUrl;

  // Only run add_markup and annotate if there are NO ambiguous marks on this student,
  // matching ChilliMark.py line 327-370 where correction_update finishes annotation only after resolution.
  if (!hasAmbiguity) {
    onProgress?.('Annotating scan...');
    if (pageParams.key && Object.keys(pageParams.key).length > 0) {
      add_markup(cv, studentState, q_area, pageParams);
    }
    annotate(cv, studentState, pageParams, q_area);

    // Write q_area back into scaledScan: scan[y1:y2, x1:x2] = q_area
    const destX = Math.max(0, Math.min(scaledScan.cols - 1, pageParams.x1));
    const destY = Math.max(0, Math.min(scaledScan.rows - 1, pageParams.y1));
    const destW = Math.min(scaledScan.cols - destX, q_area.cols);
    const destH = Math.min(scaledScan.rows - destY, q_area.rows);

    if (destW > 0 && destH > 0) {
      const srcSub = q_area.roi(new cv.Rect(0, 0, destW, destH));
      const destRoi = scaledScan.roi(new cv.Rect(destX, destY, destW, destH));
      srcSub.copyTo(destRoi);
      srcSub.delete();
      destRoi.delete();
    }

    // Add student name on top:
    cv.putText(
      scaledScan,
      studentName,
      new cv.Point(512, 512),
      cv.FONT_HERSHEY_DUPLEX,
      6,
      new cv.Scalar(255, 255, 255, 255),
      25,
      cv.LINE_AA
    );
    cv.putText(
      scaledScan,
      studentName,
      new cv.Point(512, 512),
      cv.FONT_HERSHEY_DUPLEX,
      6,
      new cv.Scalar(0, 0, 0, 255),
      10,
      cv.LINE_AA
    );

    const markedCanvas = document.createElement('canvas');
    cv.imshow(markedCanvas, scaledScan);
    annotatedDataUrl = markedCanvas.toDataURL('image/png');
  }

  const ambiguityCrops: Record<number, string> = {};
  for (const q of studentState.incomplete) {
    ambiguityCrops[q.number] = get_correction_crop(cv, scaledScan, q, pageParams);
  }

  q_area.delete();
  scaledScan.delete();

  const total = Object.keys(params.key).length || questions.length;
  const percentage = total > 0 ? Math.round((studentState.score / total) * 100) : 0;

  return {
    id: `student-${studentIndex}`,
    index: studentIndex,
    name: studentName,
    score: studentState.score,
    total,
    percentage,
    questions: studentState.questions,
    responses: studentState.responses,
    annotatedDataUrl,
    originalDataUrl: scanDataUrl,
    rawDeskewedDataUrl,
    hasAmbiguity,
    incomplete: studentState.incomplete,
    ambiguityCrops,
  };
}

/**
 * Completes annotation for students once all ambiguities have been confirmed and resolved.
 * Exact port of ChilliMark.py correction_update() (lines 359-374):
 * def correction_update(student: Student, gui: Gui, params: Parameters):
 *   q_area = student.scan[params.y1:params.y2, params.x1:params.x2]
 *   for question in student.incomplete:
 *     question.annotate(params, q_area)
 *   if params.key:
 *     student.add_markup(q_area, params)
 *     (draw score)
 *   student.scan[params.y1:params.y2, params.x1:params.x2] = q_area
 */
export async function renderStudentFinalAnnotation(
  cv: any,
  student: StudentResult,
  params: CalibrationParams
): Promise<string> {
  const baseDataUrl = student.rawDeskewedDataUrl || student.annotatedDataUrl || student.originalDataUrl;
  // This image is already registered to the template. Decode it verbatim;
  // resizing here would move the stored question centers and sampling contours.
  const scanMat = await renderScanMat(cv, baseDataUrl);
  if (scanMat.cols !== TEMPLATE_WIDTH || scanMat.rows !== TEMPLATE_HEIGHT) {
    scanMat.delete();
    throw new Error('Final annotation requires a registered 4800 × 6840 scan.');
  }

  const qx1 = Math.max(0, Math.min(scanMat.cols - 50, params.x1));
  const qy1 = Math.max(0, Math.min(scanMat.rows - 50, params.y1));
  const qx2 = Math.max(qx1 + 50, Math.min(scanMat.cols, params.x2));
  const qy2 = Math.max(qy1 + 50, Math.min(scanMat.rows, params.y2));

  const qRoi = scanMat.roi(new cv.Rect(qx1, qy1, qx2 - qx1, qy2 - qy1));
  const q_area = qRoi.clone();
  qRoi.delete();

  const studentState = {
    questions: student.questions,
    responses: student.responses,
    score: student.score,
    scan: scanMat,
  };

  // Add key markups and contours for all answered questions
  if (params.key && Object.keys(params.key).length > 0) {
    add_markup(cv, studentState, q_area, params);
  }
  annotate(cv, studentState, params, q_area);

  // Write q_area back into scanMat
  const destX = Math.max(0, Math.min(scanMat.cols - 1, params.x1));
  const destY = Math.max(0, Math.min(scanMat.rows - 1, params.y1));
  const destW = Math.min(scanMat.cols - destX, q_area.cols);
  const destH = Math.min(scanMat.rows - destY, q_area.rows);

  if (destW > 0 && destH > 0) {
    const srcSub = q_area.roi(new cv.Rect(0, 0, destW, destH));
    const destRoi = scanMat.roi(new cv.Rect(destX, destY, destW, destH));
    srcSub.copyTo(destRoi);
    srcSub.delete();
    destRoi.delete();
  }
  q_area.delete();

  // Draw student name on top
  cv.putText(
    scanMat,
    student.name,
    new cv.Point(512, 512),
    cv.FONT_HERSHEY_DUPLEX,
    6,
    new cv.Scalar(255, 255, 255, 255),
    25,
    cv.LINE_AA
  );
  cv.putText(
    scanMat,
    student.name,
    new cv.Point(512, 512),
    cv.FONT_HERSHEY_DUPLEX,
    6,
    new cv.Scalar(0, 0, 0, 255),
    10,
    cv.LINE_AA
  );

  const canvas = document.createElement('canvas');
  cv.imshow(canvas, scanMat);
  const finalDataUrl = canvas.toDataURL('image/png');
  scanMat.delete();

  return finalDataUrl;
}

/**
 * Rotates an image by 90, 180, or 270 degrees on a 2D canvas
 */
export async function rotateScanImage(dataUrl: string, angleDegrees: number): Promise<string> {
  const normalizedAngle = ((angleDegrees % 360) + 360) % 360;
  if (normalizedAngle === 0) return dataUrl;

  const img = await loadImageElement(dataUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  if (normalizedAngle === 90 || normalizedAngle === 270) {
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
  } else {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((normalizedAngle * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  return canvas.toDataURL('image/png');
}

/**
 * Calculates per-question item analysis statistics matching Python make_csv
 */
export function calculateQuestionStats(
  students: StudentResult[],
  key: Record<number, string>,
  choicesCount: number = 4
): QuestionStat[] {
  const keyLength = Object.keys(key).length;
  const numQuestions = keyLength > 0 ? keyLength : (students[0]?.questions.length || 0);
  const stats: QuestionStat[] = [];

  for (let q = 0; q < numQuestions; q++) {
    const correctLetter = key[q] || '';
    const distribution: Record<string, number> = {};
    for (let c = 0; c < choicesCount; c++) {
      distribution[String.fromCharCode(65 + c)] = 0;
    }
    distribution['Blank'] = 0;
    distribution['Unclear'] = 0;

    let totalAnswered = 0;
    let correctCount = 0;

    for (const student of students) {
      const resp = student.responses[q];
      if (resp === false) {
        distribution['Unclear'] = (distribution['Unclear'] || 0) + 1;
      } else if (resp === 'Blank' || !resp) {
        distribution['Blank'] = (distribution['Blank'] || 0) + 1;
      } else {
        distribution[resp] = (distribution[resp] || 0) + 1;
        totalAnswered++;
        if (resp === correctLetter) {
          correctCount++;
        }
      }
    }

    const percentages: Record<string, number> = {};
    const totalStudents = Math.max(1, students.length);
    for (const [k, count] of Object.entries(distribution)) {
      percentages[k] = Math.round((count / totalStudents) * 100);
    }

    stats.push({
      questionNumber: q + 1,
      correctAnswer: correctLetter,
      totalAnswered,
      distribution,
      percentages,
      correctCount,
      correctPercent: Math.round((correctCount / totalStudents) * 100),
    });
  }

  return stats;
}

/**
 * Exports CSV matching ChilliMark.py make_csv (lines 792-828)
 */
export function exportStudentScoresCsv(
  students: StudentResult[],
  key: Record<number, string> = {}
): string {
  const keyLength = Object.keys(key).length || (students[0]?.questions.length || 0);
  const qNums = Array.from({ length: keyLength }, (_, i) => i + 1);

  const rows: string[][] = [];
  rows.push(['Student Name', `Out of ${keyLength}`, ...qNums.map(String)]);
  rows.push(['Answer Key', '', ...Array.from({ length: keyLength }, (_, i) => key[i] || '')]);

  for (const student of students) {
    const resps = student.responses.slice(0, keyLength).map((r) => (r === false ? 'Unclear' : r || 'Blank'));
    rows.push([student.name, String(student.score), ...resps]);
  }

  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * Exports question item analysis CSV
 */
export function exportQuestionStatsCsv(stats: QuestionStat[]): string {
  const rows: string[][] = [];
  rows.push(['Question', 'Correct Answer', 'Correct Count', 'Correct %', 'A', 'B', 'C', 'D', 'Blank', 'Unclear']);

  for (const s of stats) {
    rows.push([
      `Q${s.questionNumber}`,
      s.correctAnswer,
      String(s.correctCount),
      `${s.correctPercent}%`,
      String(s.distribution['A'] || 0),
      String(s.distribution['B'] || 0),
      String(s.distribution['C'] || 0),
      String(s.distribution['D'] || 0),
      String(s.distribution['Blank'] || 0),
      String(s.distribution['Unclear'] || 0),
    ]);
  }

  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
}

