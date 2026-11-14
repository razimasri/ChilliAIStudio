// Pre-filtering production algorithm, retained as a parity reference.
import type { CalibrationParams } from '../../src/types';
import { get_thresh, area, contour_center, erode_messy } from '../../src/utils/omrEngine';
export function cutoffBoxes(cv: any, q_area: any, params: CalibrationParams): [number, number][] {
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
  for (const item of externalContours) item.contour.delete();
  cnts.delete();

  return boxes;
}

