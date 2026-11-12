import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import {
  rotation,
  find_boxes,
  sort_into_columns,
  sort_into_rows,
  missing,
  find_questions,
  find_responses,
  set_box,
  get_thresh
} from './src/utils/omrEngine.ts';

async function diagnose() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/samples/IBSample.pdf'));
  const doc = await getDocument({ data }).promise;

  async function getPageMat(pageNum) {
    const page = await doc.getPage(pageNum);
    const ops = await page.getOperatorList();
    // find fn 85 (paintImageXObject)
    let imgName = null;
    let w = 0, h = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === 85) {
        imgName = ops.argsArray[i][0];
        w = ops.argsArray[i][1];
        h = ops.argsArray[i][2];
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

  // Calibrate on page 1
  console.log('Loading page 1...');
  const res1 = await getPageMat(1);
  const { rotated: calRot, rect: calRect } = rotation(cv, res1);
  res1.delete();

  // Find sample box around (250, 1150) to (4350, 5950)
  // Let's find question 1 box A
  const thresh1 = get_thresh(cv, calRot, false);
  const cnts1 = new cv.MatVector();
  const hier1 = new cv.Mat();
  cv.findContours(thresh1, cnts1, hier1, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const boxes = [];
  for (let i = 0; i < cnts1.size(); i++) {
    const c = cnts1.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 5800 && b.x > 200 && b.x < 4600 && b.width >= 40 && b.width <= 110 && b.height >= 40 && b.height <= 110) {
      const ratio = b.width / b.height;
      if (ratio > 0.8 && ratio < 1.25) {
        boxes.push(b);
      }
    }
    c.delete();
  }
  cnts1.delete();
  hier1.delete();
  thresh1.delete();

  console.log(`Found ${boxes.length} square boxes on page 1`);
  // Sort by Y then X to pick the very first question box (e.g. Q1 option A)
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);
  const sampleBox = boxes[0];
  console.log('Sample box (Q1 opt A approx):', sampleBox);

  // Call set_box
  const boxRes = set_box(cv, calRot, sampleBox.x, sampleBox.y, sampleBox.x + sampleBox.width, sampleBox.y + sampleBox.height);
  console.log('set_box result:', {
    w: boxRes.w,
    h: boxRes.h,
    fill_limit: boxRes.fill_limit,
    innerArea: (boxRes.w - 20) * (boxRes.h - 16)
  });

  // Check extent of boxes
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y < minY) minY = b.y;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  console.log(`Grid extent: x=[${minX}, ${maxX}], y=[${minY}, ${maxY}]`);

  const params = {
    x1: Math.max(0, minX - 60),
    y1: Math.max(0, minY - 60),
    x2: Math.min(4800, maxX + 60),
    y2: Math.min(6840, maxY + 60),
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
  console.log('Params Q-Area:', { x1: params.x1, y1: params.y1, x2: params.x2, y2: params.y2 });

  calRot.delete();

  // Test Page 3 (Foster Holmes)
  console.log('\n--- Testing Page 3 (Foster Holmes) ---');
  const res3 = await getPageMat(3);
  const { rotated: rot3 } = rotation(cv, res3);
  res3.delete();

  const qRoi3 = rot3.roi(new cv.Rect(params.x1, params.y1, params.x2 - params.x1, params.y2 - params.y1));
  const pageParams3 = { ...params };
  const rawBoxes3 = find_boxes(cv, qRoi3, pageParams3);
  const { columns: cols3, filtered_boxes: fb3 } = sort_into_columns(rawBoxes3, pageParams3);
  sort_into_rows(fb3, pageParams3);
  missing(cols3, pageParams3);
  const qList3 = find_questions(cols3, pageParams3);
  console.log(`Page 3: detected ${qList3.length} questions, ${cols3.length} columns`);

  const student3 = { questions: qList3, incomplete: [] };
  find_responses(cv, student3, qRoi3, pageParams3);

  console.log(`Page 3: Incomplete (ambiguous) questions count: ${student3.incomplete.length}`);

  // Inspect Question 20 on Page 3
  const q20 = qList3.find(q => q.number === 19);
  if (q20) {
    console.log('Q20 details:');
    const gray = new cv.Mat();
    cv.cvtColor(qRoi3, gray, cv.COLOR_RGB2GRAY);
    const th = new cv.Mat();
    cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    gray.delete();

    for (const b of q20.boxes) {
      const shifted = pageParams3.inner.map(pt => ({
        x: Math.round(pt.x + b.xy[0]),
        y: Math.round(pt.y + b.xy[1])
      }));
      const m = new cv.Mat(shifted.length, 1, cv.CV_32SC2);
      for (let i = 0; i < shifted.length; i++) {
        m.data32S[i * 2] = shifted[i].x;
        m.data32S[i * 2 + 1] = shifted[i].y;
      }
      const bnd = cv.boundingRect(m);
      m.delete();

      const rx = Math.max(0, Math.min(th.cols - 1, bnd.x));
      const ry = Math.max(0, Math.min(th.rows - 1, bnd.y));
      const rw = Math.max(0, Math.min(th.cols - rx, bnd.width));
      const rh = Math.max(0, Math.min(th.rows - ry, bnd.height));
      const roiBox = th.roi(new cv.Rect(rx, ry, rw, rh));
      const cnt = cv.countNonZero(roiBox);
      roiBox.delete();
      console.log(`  Box ${b.letter}: center=(${b.xy[0]}, ${b.xy[1]}), rect=(${rx},${ry},${rw},${rh}), count=${cnt}, fill_limit=${pageParams3.fill_limit}, isFilled=${b.bool}`);
    }
    th.delete();
  }

  // Print all ambiguous questions on Page 3
  for (const q of student3.incomplete) {
    console.log(`  Ambiguous Q#${q.number + 1}: ${q.boxes.map(b => `${b.letter}:${b.bool ? 'FILLED' : 'empty'}`).join(', ')}`);
  }

  qRoi3.delete();
  rot3.delete();
}

diagnose().catch(console.error);
