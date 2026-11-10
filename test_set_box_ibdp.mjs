import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation, get_thresh } from './src/utils/omrEngine.ts';

async function testSetBox() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/assets/aistudio/IBSample_719b8592.pdf'));
  const doc = await getDocument({ data }).promise;

  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  let imgName = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] === 85) {
      imgName = ops.argsArray[i][0];
      break;
    }
  }
  const imgObj = await new Promise((resolve) => page.objs.get(imgName, resolve));
  const mat = new cv.Mat(imgObj.height, imgObj.width, cv.CV_8UC3);
  mat.data.set(imgObj.data);
  const resized = new cv.Mat();
  cv.resize(mat, resized, new cv.Size(4800, 6840));
  mat.delete();

  const { rotated } = rotation(cv, resized);
  resized.delete();

  // Find an empty box on page 1 (e.g. Q1 option A)
  // From our earlier histogram, candidate boxes are around x=852, y=1025 or x=1940, y=5707
  // Let's find one by contour
  const thresh = get_thresh(cv, rotated, true);
  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  let targetBox = null;
  for (let i = 0; i < cnts.size(); i++) {
    const c = cnts.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 3000 && b.width >= 48 && b.width <= 70 && b.height >= 48 && b.height <= 70) {
      targetBox = b;
      c.delete();
      break;
    }
    c.delete();
  }
  cnts.delete();
  hier.delete();
  thresh.delete();

  console.log('Selected target box for calibration test:', targetBox);

  // Now implement exact ChilliMark.py set_box logic:
  const box_x1 = targetBox.x;
  const box_y1 = targetBox.y;
  const box_x2 = targetBox.x + targetBox.width;
  const box_y2 = targetBox.y + targetBox.height;

  const clip = get_thresh(cv, rotated.roi(new cv.Rect(box_x1, box_y1, box_x2 - box_x1, box_y2 - box_y1)), false);
  const outerCnts = new cv.MatVector();
  const outerHier = new cv.Mat();
  cv.findContours(clip, outerCnts, outerHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let outer = outerCnts.get(0).clone();
  clip.delete();
  outerCnts.delete();
  outerHier.delete();

  let extra = 0;
  let check_area = 0;
  let outer_area = cv.contourArea(outer);
  let check_img = null;
  let check_outer = null;

  while (Math.abs(check_area - outer_area) > 10 && extra < 25) {
    outer_area = check_area;
    const y1_e = Math.max(0, Math.floor(box_y1 - extra));
    const y2_e = Math.min(rotated.rows, Math.floor(box_y2 + extra * 2));
    const x1_e = Math.max(0, Math.floor(box_x1 - extra));
    const x2_e = Math.min(rotated.cols, Math.floor(box_x2 + extra * 2));

    const check_roi = rotated.roi(new cv.Rect(x1_e, y1_e, x2_e - x1_e, y2_e - y1_e));
    if (check_img) check_img.delete();
    check_img = get_thresh(cv, check_roi, true);
    check_roi.delete();

    const cCnts = new cv.MatVector();
    const cHier = new cv.Mat();
    cv.findContours(check_img, cCnts, cHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (cCnts.size() > 0) {
      if (check_outer) check_outer.delete();
      check_outer = cCnts.get(0).clone();
      check_area = cv.contourArea(check_outer);
      outer.delete();
      outer = check_outer.clone();
    }
    for (let i = 0; i < cCnts.size(); i++) cCnts.get(i).delete();
    cCnts.delete();
    cHier.delete();
    extra++;
  }

  const bound = cv.boundingRect(outer);
  console.log('Detected outer box bound:', bound);

  const clipNot = new cv.Mat();
  cv.bitwise_not(check_img, clipNot);

  const drawVec = new cv.MatVector();
  drawVec.push_back(outer);
  cv.drawContours(clipNot, drawVec, -1, new cv.Scalar(0, 0, 0, 0), Math.floor(bound.width / 6));
  drawVec.delete();

  const croppedClip = clipNot.roi(bound);
  const innerCnts = new cv.MatVector();
  const innerHier = new cv.Mat();
  cv.findContours(croppedClip, innerCnts, innerHier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  console.log('Inner contours found:', innerCnts.size());
  for (let i = 0; i < innerCnts.size(); i++) {
    const ic = innerCnts.get(i);
    const ia = cv.contourArea(ic);
    const ib = cv.boundingRect(ic);
    console.log(`  Inner contour ${i}: area=${ia}, bound=(${ib.x},${ib.y},${ib.width},${ib.height}), fill_limit(5.5*sqrt)=${5.5 * Math.sqrt(ia)}`);
    ic.delete();
  }

  innerCnts.delete();
  innerHier.delete();
  croppedClip.delete();
  clipNot.delete();
  if (check_img) check_img.delete();
  if (check_outer) check_outer.delete();
  outer.delete();
  rotated.delete();
}

testSetBox().catch(console.error);
