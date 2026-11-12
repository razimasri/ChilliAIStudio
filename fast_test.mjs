import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import {
  rotation,
  scale,
  sort_into_columns,
  sort_into_rows,
  missing,
  find_questions,
  set_box,
  get_thresh,
  contour_center
} from './src/utils/omrEngine.ts';

// Fast local erode_messy that doesn't allocate 40MB
function fast_find_boxes(cv, q_area, params) {
  const boxes = [];
  const thresh = get_thresh(cv, q_area, true);
  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const hierData = hier.data32S;
  const externalContours = [];
  for (let i = 0; i < cnts.size(); i++) {
    const parent = hierData[i * 4 + 3];
    if (parent === -1) {
      externalContours.push(cnts.get(i));
    } else {
      cnts.get(i).delete();
    }
  }
  cnts.delete();
  hier.delete();
  thresh.delete();

  externalContours.sort((a, b) => {
    const ra = cv.boundingRect(a);
    const rb = cv.boundingRect(b);
    return rb.width * rb.height - ra.width * ra.height;
  });

  const limit = Math.floor(0.9 * params.h * params.w);
  const min_w = Math.floor(params.w * 0.8);
  const min_h = Math.floor(params.h * 0.8);
  const max_w = Math.floor(params.w * 1.3);
  const max_h = Math.floor(params.h * 1.3);
  const isNarrow = params.w > params.h * 2;

  for (const c of externalContours) {
    const bound = cv.boundingRect(c);
    const w = bound.width;
    const h = bound.height;
    if (w * h < limit) {
      c.delete();
      continue;
    }
    if (min_w <= w && w <= max_w && min_h <= h && h <= max_h) {
      boxes.push(contour_center(cv, c));
      c.delete();
      continue;
    }
    // Clean, direct box matching
    c.delete();
  }

  return boxes;
}

async function runTest() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/samples/IBSample.pdf'));
  const doc = await getDocument({ data }).promise;

  async function getMat(pageNum) {
    const page = await doc.getPage(pageNum);
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
    return resized;
  }

  console.log('Loading page 1 calibration...');
  const p1 = await getMat(1);
  const { rotated: calRot, rect: calRect } = rotation(cv, p1);
  p1.delete();

  // Find sample box around Q1
  const thresh1 = get_thresh(cv, calRot, true);
  const cnts1 = new cv.MatVector();
  const hier1 = new cv.Mat();
  cv.findContours(thresh1, cnts1, hier1, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  let sampleBox = null;
  const allCandidateBoxes = [];
  for (let i = 0; i < cnts1.size(); i++) {
    const c = cnts1.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 5800 && b.x > 300 && b.x < 4500 && b.width >= 45 && b.width <= 75 && b.height >= 45 && b.height <= 75) {
      allCandidateBoxes.push(b);
      if (!sampleBox && b.y < 1500) sampleBox = b;
    }
    c.delete();
  }
  cnts1.delete();
  hier1.delete();
  thresh1.delete();

  console.log('Total candidate boxes on Page 1:', allCandidateBoxes.length);
  console.log('Sample box:', sampleBox);

  const boxRes = set_box(cv, calRot, sampleBox.x, sampleBox.y, sampleBox.x + sampleBox.width, sampleBox.y + sampleBox.height);
  console.log('boxRes:', { w: boxRes.w, h: boxRes.h, fill_limit: boxRes.fill_limit });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of allCandidateBoxes) {
    if (b.x < minX) minX = b.x;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y < minY) minY = b.y;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  console.log(`Q-Area: x=[${minX-50}, ${maxX+50}], y=[${minY-50}, ${maxY+50}]`);

  const params = {
    x1: Math.max(0, minX - 50),
    y1: Math.max(0, minY - 50),
    x2: Math.min(4800, maxX + 50),
    y2: Math.min(6840, maxY + 50),
    rect: calRect,
    w: boxRes.w,
    h: boxRes.h,
    choices: 4,
    fill_limit: boxRes.fill_limit,
    inner: boxRes.inner,
    outer: boxRes.outer,
    col_avg: [],
    row_avg: [],
    x_jump: 0,
    y_jump: 0,
    text_shift: [0, 0],
    font_size: 4,
    key: {}
  };

  calRot.delete();

  // Test Foster Holmes (Page 3)
  console.log('\n--- Testing Foster Holmes (Page 3) ---');
  const p3 = await getMat(3);
  const { rotated: rot3, rect: rect3 } = rotation(cv, p3);
  p3.delete();

  const scaled3 = scale(cv, rot3, rect3, params);
  rot3.delete();

  const qRoi3 = scaled3.roi(new cv.Rect(params.x1, params.y1, params.x2 - params.x1, params.y2 - params.y1));
  const pageParams = { ...params };
  const rawBoxes = fast_find_boxes(cv, qRoi3, pageParams);
  console.log(`Page 3 raw boxes: ${rawBoxes.length}`);

  const { columns, filtered_boxes } = sort_into_columns(rawBoxes, pageParams);
  console.log(`Columns count: ${columns.length}, choices: ${pageParams.choices}`);
  console.log('Column counts:', columns.map(c => c.length));

  sort_into_rows(filtered_boxes, pageParams);
  console.log(`Rows count: ${pageParams.row_avg.length}, y_jump: ${pageParams.y_jump}`);

  missing(columns, pageParams);
  console.log('Column counts after missing:', columns.map(c => c.length));

  const questions = find_questions(columns, pageParams);
  console.log(`Total questions on Page 3: ${questions.length}`);

  // Otsu threshold for find_responses
  const gray3 = new cv.Mat();
  cv.cvtColor(qRoi3, gray3, cv.COLOR_RGB2GRAY);
  const thresh3 = new cv.Mat();
  cv.threshold(gray3, thresh3, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray3.delete();

  // Inspect each question
  let ambigCount = 0;
  for (let qIdx = 0; qIdx < questions.length; qIdx++) {
    const q = questions[qIdx];
    const boxCounts = [];
    for (const b of q.boxes) {
      const shiftedPts = pageParams.inner.map((pt) => ({
        x: Math.round(pt.x + b.xy[0]),
        y: Math.round(pt.y + b.xy[1]),
      }));
      const contourMat = new cv.Mat(shiftedPts.length, 1, cv.CV_32SC2);
      for (let i = 0; i < shiftedPts.length; i++) {
        contourMat.data32S[i * 2] = shiftedPts[i].x;
        contourMat.data32S[i * 2 + 1] = shiftedPts[i].y;
      }
      const bnd = cv.boundingRect(contourMat);
      contourMat.delete();

      const rx = Math.max(0, Math.min(thresh3.cols - 1, bnd.x));
      const ry = Math.max(0, Math.min(thresh3.rows - 1, bnd.y));
      const rw = Math.max(0, Math.min(thresh3.cols - rx, bnd.width));
      const rh = Math.max(0, Math.min(thresh3.rows - ry, bnd.height));

      let count = 0;
      if (rw > 0 && rh > 0) {
        const temp = thresh3.roi(new cv.Rect(rx, ry, rw, rh));
        count = cv.countNonZero(temp);
        temp.delete();
      }
      boxCounts.push({ letter: b.letter, count });
    }

    const filledBoxes = boxCounts.filter(d => d.count > pageParams.fill_limit);
    if (filledBoxes.length > 1) {
      ambigCount++;
      console.log(`  Q#${qIdx + 1} AMBIGUOUS (limit=${pageParams.fill_limit.toFixed(1)}):`, boxCounts.map(d => `${d.letter}:${d.count}`).join('  '));
    } else if (qIdx === 19) {
      console.log(`  Q#20 (Foster Holmes Q20 screenshot): limit=${pageParams.fill_limit.toFixed(1)}:`, boxCounts.map(d => `${d.letter}:${d.count}`).join('  '));
    }
  }

  console.log(`\nPAGE 3 TOTAL AMBIGUOUS QUESTIONS: ${ambigCount} / ${questions.length}`);

  thresh3.delete();
  qRoi3.delete();
  scaled3.delete();
}

runTest().catch(console.error);
