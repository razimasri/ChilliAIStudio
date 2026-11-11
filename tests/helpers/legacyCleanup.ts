// Full-grid RGB masks from PR16 and the pre-optimization RGBA blur.
// Keep these independent of production filtering to verify exact pixel/geometry parity.
import type { CalibrationParams } from '../../src/types';
import { contour_center, area } from '../../src/utils/omrEngine';
export function legacy_slice_messy(
  cv: any,
  q_area: any,
  e_cnt: any,
  params: any,
  x: number,
  y: number,
  w: number,
  h: number,
  boxes: [number, number][],
): void {
  const slice_mask = new cv.Mat.zeros(q_area.rows, q_area.cols, cv.CV_8UC3);
  const drawVec = new cv.MatVector();
  drawVec.push_back(e_cnt);
  cv.drawContours(
    slice_mask,
    drawVec,
    -1,
    new cv.Scalar(255, 255, 255, 255),
    -1,
  );
  drawVec.delete();

  const x_scale = Math.floor(w / params.w) + 1;
  const y_scale = Math.floor(h / params.h);

  for (let j = 1; j < x_scale; j++) {
    const lx = Math.floor(x + (j * w) / x_scale);
    cv.line(
      slice_mask,
      new cv.Point(lx, y - 10),
      new cv.Point(lx, y + h + 10),
      new cv.Scalar(0, 0, 0, 0),
      15,
    );
  }

  for (let k = 1; k < y_scale; k++) {
    const ly = Math.floor(y + (k * h) / y_scale);
    cv.line(
      slice_mask,
      new cv.Point(x - 10, ly),
      new cv.Point(x + w + 10, ly),
      new cv.Scalar(0, 0, 0, 0),
      15,
    );
  }

  const grayMask = new cv.Mat();
  cv.cvtColor(slice_mask, grayMask, cv.COLOR_RGB2GRAY);

  const slice_cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(
    grayMask,
    slice_cnts,
    hier,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE,
  );

  for (let i = 0; i < slice_cnts.size(); i++) {
    const s_cnt = slice_cnts.get(i);
    const b = cv.boundingRect(s_cnt);
    if (
      params.w * 0.5 <= b.width &&
      b.width <= params.w * 1.5 &&
      params.h * 0.5 <= b.height &&
      b.height <= params.h * 1.5
    ) {
      boxes.push(contour_center(cv, s_cnt));
    }
    s_cnt.delete();
  }

  slice_mask.delete();
  grayMask.delete();
  slice_cnts.delete();
  hier.delete();
}

export function legacy_erode_messy(
  cv: any,
  c: any,
  q_area: any,
  params: any,
  boxes: [number, number][],
): void {
  const erode_mask = new cv.Mat.zeros(q_area.rows, q_area.cols, cv.CV_8UC3);
  const drawVec = new cv.MatVector();
  drawVec.push_back(c);
  cv.drawContours(
    erode_mask,
    drawVec,
    -1,
    new cv.Scalar(255, 255, 255, 255),
    -1,
  );
  drawVec.delete();

  const kernel = cv.Mat.ones(31, 31, cv.CV_8U);
  const eroded = new cv.Mat();
  cv.erode(erode_mask, eroded, kernel, new cv.Point(-1, -1), 1);

  const gray = new cv.Mat();
  cv.cvtColor(eroded, gray, cv.COLOR_RGB2GRAY);

  const erode_cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(
    gray,
    erode_cnts,
    hier,
    cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE,
  );

  for (let i = 0; i < erode_cnts.size(); i++) {
    const e_cnt = erode_cnts.get(i);
    const b = cv.boundingRect(e_cnt);
    if (
      params.w * 0.5 <= b.width &&
      b.width <= params.w * 1.5 &&
      params.h * 0.5 <= b.height &&
      b.height <= params.h * 1.5
    ) {
      boxes.push(contour_center(cv, e_cnt));
    } else {
      legacy_slice_messy(
        cv,
        q_area,
        e_cnt,
        params,
        b.x,
        b.y,
        b.width,
        b.height,
        boxes,
      );
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

export function legacy_find_boxes(
  cv: any,
  q_area: any,
  params: CalibrationParams,
): [number, number][] {
  const boxes: [number, number][] = [];
  const thresh = legacy_get_thresh(cv, q_area, true);

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
      legacy_erode_messy(cv, c, q_area, params, boxes);
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

export function legacy_get_thresh(cv: any, image: any, blur = true): any {
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
