import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import {
  rotation,
  scale,
  find_boxes,
  sort_into_columns,
  sort_into_rows,
  missing,
  find_questions,
  set_box,
  get_thresh
} from './src/utils/omrEngine.ts';

async function testPipeline() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/assets/aistudio/IBSample_719b8592.pdf'));
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

  // Page 1 calibration
  const p1 = await getMat(1);
  const { rotated: calRot, rect: calRect } = rotation(cv, p1);
  p1.delete();

  // In IBDP, what are defaultParams or user drag?
  // In sampleData.ts:
  // x1: 250, y1: 1150, x2: 4350, y2: 5950
  // Let's test with default params or finding a sample box on calRot:
  // Let's find question 1 box A on page 1
  const thresh1 = get_thresh(cv, calRot, true);
  const cnts1 = new cv.MatVector();
  const hier1 = new cv.Mat();
  cv.findContours(thresh1, cnts1, hier1, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  let sampleBox = null;
  for (let i = 0; i < cnts1.size(); i++) {
    const c = cnts1.get(i);
    const b = cv.boundingRect(c);
    // Find Q1 box A around x=1000, y=1000-1500
    if (b.y > 1000 && b.y < 1500 && b.x > 800 && b.x < 1500 && b.width >= 45 && b.width <= 75 && b.height >= 45 && b.height <= 75) {
      sampleBox = b;
      c.delete();
      break;
    }
    c.delete();
  }
  cnts1.delete();
  hier1.delete();
  thresh1.delete();

  console.log('Sample box for calibration:', sampleBox);

  const boxRes = set_box(cv, calRot, sampleBox.x, sampleBox.y, sampleBox.x + sampleBox.width, sampleBox.y + sampleBox.height);
  console.log('boxRes:', { w: boxRes.w, h: boxRes.h, fill_limit: boxRes.fill_limit });

  // Now let's set calibration params
  // Let's find full bounds of question boxes on Page 1
  const threshAll = get_thresh(cv, calRot, true);
  const cntsAll = new cv.MatVector();
  const hierAll = new cv.Mat();
  cv.findContours(threshAll, cntsAll, hierAll, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < cntsAll.size(); i++) {
    const c = cntsAll.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 900 && b.y < 6000 && b.x > 300 && b.x < 4500 && b.width >= 40 && b.width <= 80 && b.height >= 40 && b.height <= 80) {
      if (b.x < minX) minX = b.x;
      if (b.x + b.width > maxX) maxX = b.x + b.width;
      if (b.y < minY) minY = b.y;
      if (b.y + b.height > maxY) maxY = b.y + b.height;
    }
    c.delete();
  }
  cntsAll.delete();
  hierAll.delete();
  threshAll.delete();

  console.log(`Grid bounding box: x=[${minX}, ${maxX}], y=[${minY}, ${maxY}]`);

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

  // Now test Page 3 (Foster Holmes)
  const p3 = await getMat(3);
  const { rotated: rot3, rect: rect3 } = rotation(cv, p3);
  p3.delete();

  const scaled3 = scale(cv, rot3, rect3, params);
  rot3.delete();

  const qRoi3 = scaled3.roi(new cv.Rect(params.x1, params.y1, params.x2 - params.x1, params.y2 - params.y1));
  const pageParams = { ...params };
  const rawBoxes = find_boxes(cv, qRoi3, pageParams);
  console.log(`Page 3: rawBoxes found: ${rawBoxes.length}`);

  const { columns, filtered_boxes } = sort_into_columns(rawBoxes, pageParams);
  console.log(`Page 3: columns count: ${columns.length}, choices: ${pageParams.choices}`);
  console.log('Column lengths:', columns.map(c => c.length));

  sort_into_rows(filtered_boxes, pageParams);
  console.log(`Page 3: row_avg count: ${pageParams.row_avg.length}, y_jump: ${pageParams.y_jump}`);

  missing(columns, pageParams);
  console.log('Column lengths after missing:', columns.map(c => c.length));

  const questions = find_questions(columns, pageParams);
  console.log(`Total questions detected on Page 3: ${questions.length}`);

  // Now run find_responses
  const gray3 = new cv.Mat();
  cv.cvtColor(qRoi3, gray3, cv.COLOR_RGB2GRAY);
  const thresh3 = new cv.Mat();
  cv.threshold(gray3, thresh3, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray3.delete();

  let ambigCount = 0;
  for (let qIdx = 0; qIdx < questions.length; qIdx++) {
    const q = questions[qIdx];
    let filled = 0;
    const boxDetails = [];
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
      const isF = count > pageParams.fill_limit;
      if (isF) filled++;
      boxDetails.push({ letter: b.letter, count, isF });
    }

    if (filled > 1) {
      ambigCount++;
      console.log(`  Question ${qIdx + 1} AMBIGUOUS:`, boxDetails.map(d => `${d.letter}:${d.count}(${d.isF ? 'FILLED' : 'empty'})`).join('  '));
    } else {
      const chosen = boxDetails.find(d => d.isF);
      if (qIdx === 19 || qIdx === 7 || qIdx === 3) {
        console.log(`  Question ${qIdx + 1} [Chosen=${chosen ? chosen.letter : 'Blank'}]:`, boxDetails.map(d => `${d.letter}:${d.count}`).join('  '));
      }
    }
  }

  console.log(`\nPAGE 3 TOTAL AMBIGUOUS QUESTIONS: ${ambigCount} / ${questions.length}`);

  thresh3.delete();
  qRoi3.delete();
  scaled3.delete();
}

testPipeline().catch(console.error);
