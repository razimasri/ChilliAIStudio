import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation } from './src/utils/omrEngine.ts';

async function inspectQ20() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/assets/aistudio/IBSample_719b8592.pdf'));
  const doc = await getDocument({ data }).promise;

  // Page 3 is Foster Holmes
  const page3 = await doc.getPage(3);
  const ops3 = await page3.getOperatorList();
  let imgName = null;
  for (let i = 0; i < ops3.fnArray.length; i++) {
    if (ops3.fnArray[i] === 85) {
      imgName = ops3.argsArray[i][0];
      break;
    }
  }
  const imgObj = await new Promise((resolve) => page3.objs.get(imgName, resolve));
  const mat = new cv.Mat(imgObj.height, imgObj.width, cv.CV_8UC3);
  mat.data.set(imgObj.data);
  const resized = new cv.Mat();
  cv.resize(mat, resized, new cv.Size(4800, 6840));
  mat.delete();

  const { rotated } = rotation(cv, resized);
  resized.delete();

  // Let's threshold using Otsu as in find_responses (ChilliMark.py line 734)
  const gray = new cv.Mat();
  cv.cvtColor(rotated, gray, cv.COLOR_RGB2GRAY);
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray.delete();

  // Find all square boxes around ~50-70px in deskewed page
  const threshAdapt = new cv.Mat();
  cv.adaptiveThreshold(thresh, threshAdapt, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 27, 5);
  // or findContours on thresh
  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const qBoxes = [];
  for (let i = 0; i < cnts.size(); i++) {
    const c = cnts.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 6000 && b.x > 300 && b.x < 4500) {
      if (b.width >= 45 && b.width <= 75 && b.height >= 45 && b.height <= 75) {
        qBoxes.push(b);
      }
    }
    c.delete();
  }
  cnts.delete();
  hier.delete();

  console.log(`Found ${qBoxes.length} question boxes on Foster Holmes.`);

  // Find boxes around y ≈ 3500-4000 (around Q20)
  // Let's sort boxes into rows and columns
  qBoxes.sort((a, b) => a.y - b.y || a.x - b.x);

  // Let's test different sampling windows:
  // 1. Current inner box (w-20, h-16)
  // 2. Tighter inner box (w * 0.6, h * 0.6)
  // 3. ChilliMark inner contour
  // Let's print pixel counts of empty boxes vs marked boxes!

  // Let's find 20 random boxes across the page and measure their pixel counts in the center
  const sampleCounts = [];
  for (const b of qBoxes.slice(0, 30)) {
    const cx = Math.floor(b.x + b.width / 2);
    const cy = Math.floor(b.y + b.height / 2);

    // Current code: innerHalfW = (w-20)/2, innerHalfH = (h-16)/2
    const ihw = Math.floor((b.width - 20) / 2);
    const ihh = Math.floor((b.height - 16) / 2);
    const roi1 = thresh.roi(new cv.Rect(cx - ihw, cy - ihh, ihw * 2, ihh * 2));
    const cnt1 = cv.countNonZero(roi1);
    roi1.delete();

    // Inset by 25% on all sides
    const ihw2 = Math.floor(b.width * 0.3);
    const ihh2 = Math.floor(b.height * 0.3);
    const roi2 = thresh.roi(new cv.Rect(cx - ihw2, cy - ihh2, ihw2 * 2, ihh2 * 2));
    const cnt2 = cv.countNonZero(roi2);
    roi2.delete();

    sampleCounts.push({ box: `${b.x},${b.y} (${b.width}x${b.height})`, cntCurrent: cnt1, cntTight: cnt2 });
  }

  console.log('Sample boxes (first 25):');
  for (const s of sampleCounts.slice(0, 25)) {
    console.log(s);
  }

  thresh.delete();
  rotated.delete();
}

inspectQ20().catch(console.error);
