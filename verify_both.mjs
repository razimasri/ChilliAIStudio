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

async function verifyBoth() {
  const cv = await getCV();

  // 1. VERIFY CAMBRIDGE IGSample.pdf
  console.log('=== VERIFYING CAMBRIDGE (IGSample.pdf) ===');
  const camData = new Uint8Array(fs.readFileSync('public/assets/aistudio/IGSample_bab86a83.pdf'));
  const camDoc = await getDocument({ data: camData }).promise;
  console.log(`Loaded IGSample with ${camDoc.numPages} pages.`);

  async function getCamPageMat(pNum) {
    const page = await camDoc.getPage(pNum);
    const ops = await page.getOperatorList();
    let imgName = null;
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === 85) {
        imgName = ops.argsArray[i][0];
        break;
      }
    }
    const imgObj = await new Promise((res) => page.objs.get(imgName, res));
    const mat = new cv.Mat(imgObj.height, imgObj.width, cv.CV_8UC3);
    mat.data.set(imgObj.data);
    const resized = new cv.Mat();
    cv.resize(mat, resized, new cv.Size(4800, 6840));
    mat.delete();
    return resized;
  }

  // Cambridge Page 1
  const cam1 = await getCamPageMat(1);
  const { rotated: camRot1, rect: camRect1 } = rotation(cv, cam1);
  cam1.delete();

  // Find sample box on Cambridge
  const camThresh1 = get_thresh(cv, camRot1, true);
  const camCnts1 = new cv.MatVector();
  const camHier1 = new cv.Mat();
  cv.findContours(camThresh1, camCnts1, camHier1, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  let camSampleBox = null;
  const camBoxes = [];
  for (let i = 0; i < camCnts1.size(); i++) {
    const c = camCnts1.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 5800 && b.width >= 70 && b.width <= 110 && b.height >= 18 && b.height <= 35) {
      camBoxes.push(b);
      if (!camSampleBox && b.y < 2000) camSampleBox = b;
    }
    c.delete();
  }
  camCnts1.delete();
  camHier1.delete();
  camThresh1.delete();

  console.log(`Cambridge candidate boxes: ${camBoxes.length}, sampleBox:`, camSampleBox);

  let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity;
  for (const b of camBoxes) {
    if (b.x < cMinX) cMinX = b.x;
    if (b.x + b.width > cMaxX) cMaxX = b.x + b.width;
    if (b.y < cMinY) cMinY = b.y;
    if (b.y + b.height > cMaxY) cMaxY = b.y + b.height;
  }

  const camBoxRes = set_box(cv, camRot1, camSampleBox.x, camSampleBox.y, camSampleBox.x + camSampleBox.width, camSampleBox.y + camSampleBox.height);
  console.log('Cambridge set_box:', { w: camBoxRes.w, h: camBoxRes.h, fill_limit: camBoxRes.fill_limit });

  const camParams = {
    x1: Math.max(0, cMinX - 50),
    y1: Math.max(0, cMinY - 50),
    x2: Math.min(4800, cMaxX + 50),
    y2: Math.min(6840, cMaxY + 50),
    rect: camRect1,
    w: camBoxRes.w,
    h: camBoxRes.h,
    choices: 4,
    fill_limit: camBoxRes.fill_limit,
    inner: camBoxRes.inner,
    outer: camBoxRes.outer,
    col_avg: [],
    row_avg: [],
    x_jump: 0,
    y_jump: 0,
    text_shift: [0, 0],
    font_size: 4,
    key: {}
  };
  camRot1.delete();

  // Test Cambridge Pages 2 and 3 (which had 0 ambiguities)
  for (let p = 2; p <= 3; p++) {
    const mat = await getCamPageMat(p);
    const { rotated, rect } = rotation(cv, mat);
    mat.delete();

    const scaled = scale(cv, rotated, rect, camParams);
    rotated.delete();

    const qRoi = scaled.roi(new cv.Rect(camParams.x1, camParams.y1, camParams.x2 - camParams.x1, camParams.y2 - camParams.y1));
    const pageParams = { ...camParams };

    const th = get_thresh(cv, qRoi, true);
    const cnts = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(th, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

    const bList = [];
    for (let i = 0; i < cnts.size(); i++) {
      const c = cnts.get(i);
      const b = cv.boundingRect(c);
      if (b.width >= pageParams.w * 0.75 && b.width <= pageParams.w * 1.3 && b.height >= pageParams.h * 0.75 && b.height <= pageParams.h * 1.3) {
        bList.push(contour_center(cv, c));
      }
      c.delete();
    }
    cnts.delete();
    hier.delete();
    th.delete();

    const { columns, filtered_boxes } = sort_into_columns(bList, pageParams);
    sort_into_rows(filtered_boxes, pageParams);
    missing(columns, pageParams);
    const questions = find_questions(columns, pageParams);

    const gray = new cv.Mat();
    cv.cvtColor(qRoi, gray, cv.COLOR_RGB2GRAY);
    const thOtsu = new cv.Mat();
    cv.threshold(gray, thOtsu, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    gray.delete();

    let ambig = 0;
    for (const q of questions) {
      let filled = 0;
      for (const b of q.boxes) {
        const shiftedPts = pageParams.inner.map((pt) => ({
          x: Math.round(pt.x + b.xy[0]),
          y: Math.round(pt.y + b.xy[1]),
        }));
        const m = new cv.Mat(shiftedPts.length, 1, cv.CV_32SC2);
        for (let i = 0; i < shiftedPts.length; i++) {
          m.data32S[i * 2] = shiftedPts[i].x;
          m.data32S[i * 2 + 1] = shiftedPts[i].y;
        }
        const bnd = cv.boundingRect(m);
        m.delete();

        const rx = Math.max(0, Math.min(thOtsu.cols - 1, bnd.x));
        const ry = Math.max(0, Math.min(thOtsu.rows - 1, bnd.y));
        const rw = Math.max(0, Math.min(thOtsu.cols - rx, bnd.width));
        const rh = Math.max(0, Math.min(thOtsu.rows - ry, bnd.height));
        if (rw > 0 && rh > 0) {
          const temp = thOtsu.roi(new cv.Rect(rx, ry, rw, rh));
          const count = cv.countNonZero(temp);
          temp.delete();
          if (count > pageParams.fill_limit) filled++;
        }
      }
      if (filled > 1) ambig++;
    }
    console.log(`Cambridge Page ${p} (40 Qs) Ambiguities: ${ambig}`);

    thOtsu.delete();
    qRoi.delete();
    scaled.delete();
  }
}

verifyBoth().catch(console.error);
