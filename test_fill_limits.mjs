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
  get_thresh,
  contour_center
} from './src/utils/omrEngine.ts';

async function testFillLimits() {
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

  // Calibration on Page 1
  const p1 = await getMat(1);
  const { rotated: calRot, rect: calRect } = rotation(cv, p1);
  p1.delete();

  // Find all boxes on Page 1
  const thresh1 = get_thresh(cv, calRot, true);
  const cnts1 = new cv.MatVector();
  const hier1 = new cv.Mat();
  cv.findContours(thresh1, cnts1, hier1, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const boxes1 = [];
  for (let i = 0; i < cnts1.size(); i++) {
    const c = cnts1.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 5800 && b.x > 300 && b.x < 4500 && b.width >= 45 && b.width <= 75 && b.height >= 45 && b.height <= 75) {
      boxes1.push(b);
    }
    c.delete();
  }
  cnts1.delete();
  hier1.delete();
  thresh1.delete();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of boxes1) {
    if (b.x < minX) minX = b.x;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y < minY) minY = b.y;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }

  // Representative box
  const sampleBox = boxes1[0];
  const w = sampleBox.width;
  const h = sampleBox.height;

  // Inner cavity sampling area (safely inset 6px from borders)
  const innerHalfW = Math.floor((w - 12) / 2);
  const innerHalfH = Math.floor((h - 12) / 2);
  const innerPts = [
    { x: -innerHalfW, y: -innerHalfH },
    { x: innerHalfW, y: -innerHalfH },
    { x: innerHalfW, y: innerHalfH },
    { x: -innerHalfW, y: innerHalfH },
  ];
  const innerArea = (innerHalfW * 2) * (innerHalfH * 2);

  const params = {
    x1: Math.max(0, minX - 50),
    y1: Math.max(0, minY - 50),
    x2: Math.min(4800, maxX + 50),
    y2: Math.min(6840, maxY + 50),
    rect: calRect,
    w,
    h,
    choices: 4,
    fill_limit: 5.5 * Math.sqrt(innerArea),
    inner: innerPts,
    outer: [],
    col_avg: [],
    row_avg: [],
    x_jump: 0,
    y_jump: 0,
    text_shift: [0, 0],
    font_size: 4,
    key: {}
  };

  console.log(`Calibration: w=${w}, h=${h}, innerArea=${innerArea}, default fill_limit=${params.fill_limit.toFixed(1)}`);
  calRot.delete();

  // Test across pages 1 to 5 for various threshold values
  const testLimits = [180, 250, 300, 350, 400, 450];
  console.log('Testing limits:', testLimits);

  for (let pNum = 1; pNum <= 5; pNum++) {
    const pMat = await getMat(pNum);
    const { rotated, rect } = rotation(cv, pMat);
    pMat.delete();

    const scaled = scale(cv, rotated, rect, params);
    rotated.delete();

    const qRoi = scaled.roi(new cv.Rect(params.x1, params.y1, params.x2 - params.x1, params.y2 - params.y1));
    const pageParams = { ...params };

    // Find boxes in qRoi
    const thresh = get_thresh(cv, qRoi, true);
    const cnts = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    const qBoxes = [];
    for (let i = 0; i < cnts.size(); i++) {
      const c = cnts.get(i);
      const b = cv.boundingRect(c);
      if (b.width >= params.w * 0.75 && b.width <= params.w * 1.3 && b.height >= params.h * 0.75 && b.height <= params.h * 1.3) {
        qBoxes.push(contour_center(cv, c));
      }
      c.delete();
    }
    cnts.delete();
    hier.delete();
    thresh.delete();

    const { columns, filtered_boxes } = sort_into_columns(qBoxes, pageParams);
    sort_into_rows(filtered_boxes, pageParams);
    missing(columns, pageParams);
    const questions = find_questions(columns, pageParams);

    // Otsu threshold
    const gray = new cv.Mat();
    cv.cvtColor(qRoi, gray, cv.COLOR_RGB2GRAY);
    const thOtsu = new cv.Mat();
    cv.threshold(gray, thOtsu, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    gray.delete();

    // Measure counts for each question
    const qCounts = [];
    for (const q of questions) {
      const bCounts = [];
      for (const b of q.boxes) {
        const rx = Math.max(0, Math.min(thOtsu.cols - 1, b.xy[0] - innerHalfW));
        const ry = Math.max(0, Math.min(thOtsu.rows - 1, b.xy[1] - innerHalfH));
        const rw = Math.min(thOtsu.cols - rx, innerHalfW * 2);
        const rh = Math.min(thOtsu.rows - ry, innerHalfH * 2);
        const temp = thOtsu.roi(new cv.Rect(rx, ry, rw, rh));
        const cnt = cv.countNonZero(temp);
        temp.delete();
        bCounts.push(cnt);
      }
      qCounts.push(bCounts);
    }

    const ambigResults = testLimits.map(lim => {
      let ambig = 0;
      for (const bCounts of qCounts) {
        const filled = bCounts.filter(c => c > lim).length;
        if (filled > 1) ambig++;
      }
      return `${lim}:${ambig}`;
    });

    console.log(`Page ${pNum} (${questions.length} Qs) Ambiguities: ${ambigResults.join('  ')}`);

    thOtsu.delete();
    qRoi.delete();
    scaled.delete();
  }
}

testFillLimits().catch(console.error);
