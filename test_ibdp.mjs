import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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

async function testIBDP() {
  const cv = await getCV();
  const doc = await getDocument('public/samples/IBSample.pdf').promise;
  console.log(`Loaded IBSample.pdf with ${doc.numPages} pages.`);

  // Calibrate on page 1
  const page1 = await doc.getPage(1);
  const ops1 = await page1.getOperatorList();
  const imgData1 = await new Promise((resolve) => page1.objs.get(ops1.argsArray[5][0], resolve));
  const mat1 = new cv.Mat(imgData1.height, imgData1.width, cv.CV_8UC3);
  mat1.data.set(imgData1.data);
  const resized1 = new cv.Mat();
  cv.resize(mat1, resized1, new cv.Size(4800, 6840));
  mat1.delete();

  const { rotated: calRot, rect: calRect } = rotation(cv, resized1);
  resized1.delete();

  // Find all square boxes of size ~50-80 on page 1
  const thresh1 = get_thresh(cv, calRot, false);
  const cnts1 = new cv.MatVector();
  const hier1 = new cv.Mat();
  cv.findContours(thresh1, cnts1, hier1, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  let sampleBox = null;
  for (let i = 0; i < cnts1.size(); i++) {
    const c = cnts1.get(i);
    const b = cv.boundingRect(c);
    // IBDP boxes: square, ~40-100 px
    if (b.y > 1500 && b.width >= 40 && b.width <= 100 && b.height >= 40 && b.height <= 100) {
      const ratio = b.width / b.height;
      if (ratio > 0.8 && ratio < 1.25) {
        sampleBox = b;
        c.delete();
        break;
      }
    }
    c.delete();
  }
  cnts1.delete();
  hier1.delete();
  thresh1.delete();

  console.log('Found IBDP sampleBox:', sampleBox);

  // set_box on sampleBox
  const boxRes = set_box(cv, calRot, sampleBox.x, sampleBox.y, sampleBox.x + sampleBox.width, sampleBox.y + sampleBox.height);
  console.log('set_box result:');
  console.log('w:', boxRes.w, 'h:', boxRes.h, 'fill_limit:', boxRes.fill_limit);

  // Where are the IBDP question boxes? Let's check coordinates on calRot
  // Let's find all boxes in the question area
  // Usually IBDP questions are 40 questions (often 4 columns of 10, or 2 columns of 20, or similar)
  // Let's check bounding rect of all candidate boxes
  const threshAll = get_thresh(cv, calRot, false);
  const cntsAll = new cv.MatVector();
  const hierAll = new cv.Mat();
  cv.findContours(threshAll, cntsAll, hierAll, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const allCandidateBoxes = [];
  for (let i = 0; i < cntsAll.size(); i++) {
    const c = cntsAll.get(i);
    const b = cv.boundingRect(c);
    if (b.width >= boxRes.w * 0.75 && b.width <= boxRes.w * 1.3 &&
        b.height >= boxRes.h * 0.75 && b.height <= boxRes.h * 1.3) {
      allCandidateBoxes.push(b);
    }
    c.delete();
  }
  cntsAll.delete();
  hierAll.delete();
  threshAll.delete();

  console.log('Total candidate boxes matching dimensions:', allCandidateBoxes.length);

  let minBx = Infinity, maxBx = -Infinity, minBy = Infinity, maxBy = -Infinity;
  for (const b of allCandidateBoxes) {
    if (b.x < minBx) minBx = b.x;
    if (b.x + b.width > maxBx) maxBx = b.x + b.width;
    if (b.y < minBy) minBy = b.y;
    if (b.y + b.height > maxBy) maxBy = b.y + b.height;
  }
  console.log(`Candidate boxes extent: x=[${minBx}, ${maxBx}], y=[${minBy}, ${maxBy}]`);

  // Let's test marking with these bounds
  const params = {
    x1: Math.max(0, minBx - 50),
    y1: Math.max(0, minBy - 50),
    x2: Math.min(4800, maxBx + 50),
    y2: Math.min(6840, maxBy + 50),
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
  console.log('Params Question Area:', { x1: params.x1, y1: params.y1, x2: params.x2, y2: params.y2 });

  calRot.delete();

  // Test across pages of IBSample.pdf
  let totalAmbiguities = 0;
  for (let pNum = 1; pNum <= doc.numPages; pNum++) {
    const page = await doc.getPage(pNum);
    const ops = await page.getOperatorList();
    const imgData = await new Promise((resolve) => page.objs.get(ops.argsArray[5][0], resolve));
    const mat = new cv.Mat(imgData.height, imgData.width, cv.CV_8UC3);
    mat.data.set(imgData.data);
    const resized = new cv.Mat();
    cv.resize(mat, resized, new cv.Size(4800, 6840));
    mat.delete();

    const { rotated, rect } = rotation(cv, resized);
    resized.delete();

    const qRoi = rotated.roi(new cv.Rect(params.x1, params.y1, params.x2 - params.x1, params.y2 - params.y1));
    const pageParams = { ...params };
    const rawBoxes = find_boxes(cv, qRoi, pageParams);
    const { columns, filtered_boxes } = sort_into_columns(rawBoxes, pageParams);
    sort_into_rows(filtered_boxes, pageParams);
    missing(columns, pageParams);
    const questions = find_questions(columns, pageParams);

    const student = { questions, incomplete: [], responses: [] };
    find_responses(cv, student, qRoi, pageParams);

    console.log(`Page ${pNum}: Ambiguities = ${student.incomplete.length} (questions=${questions.length})`);
    totalAmbiguities += student.incomplete.length;

    qRoi.delete();
    rotated.delete();
  }

  console.log(`\nTOTAL IBDP AMBIGUITIES = ${totalAmbiguities}`);
}

testIBDP().catch(console.error);
