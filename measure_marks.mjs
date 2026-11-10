import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation } from './src/utils/omrEngine.ts';

async function measureMarks() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/assets/aistudio/IBSample_719b8592.pdf'));
  const doc = await getDocument({ data }).promise;

  // Let's load Page 3 (Foster Holmes)
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

  // Otsu threshold (same as ChilliMark find_responses line 734)
  const gray = new cv.Mat();
  cv.cvtColor(rotated, gray, cv.COLOR_RGB2GRAY);
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray.delete();

  // Let's find question 20
  // From screenshot image_b4a4c179.png, Question 20 has "20 [A] [B] [C(X)] [D]"
  // Let's search for "20" or search for the box with the X
  // In the image, candidate boxes around Q20
  // Let's find all contours
  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  // Collect all boxes between 45 and 75px
  const boxes = [];
  for (let i = 0; i < cnts.size(); i++) {
    const c = cnts.get(i);
    const b = cv.boundingRect(c);
    if (b.width >= 45 && b.width <= 75 && b.height >= 45 && b.height <= 75) {
      boxes.push(b);
    }
    c.delete();
  }
  cnts.delete();
  hier.delete();

  console.log(`Found ${boxes.length} candidate boxes on Foster Holmes`);

  // Let's measure for each box:
  // 1. Total black pixels inside the inner 70% of the box (safely inside printed border)
  // Let's print the distribution of counts
  const allCounts = [];
  for (const b of boxes) {
    const cx = Math.floor(b.x + b.width / 2);
    const cy = Math.floor(b.y + b.height / 2);
    const halfW = Math.floor(b.width * 0.35); // 70% width
    const halfH = Math.floor(b.height * 0.35); // 70% height
    const roi = thresh.roi(new cv.Rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2));
    const cnt = cv.countNonZero(roi);
    roi.delete();
    allCounts.push({ box: b, count: cnt, innerArea: (halfW * 2) * (halfH * 2) });
  }

  allCounts.sort((a, b) => a.count - b.count);
  console.log('Lowest 10 counts (empty boxes):', allCounts.slice(0, 10).map(x => x.count));
  console.log('Median count:', allCounts[Math.floor(allCounts.length / 2)].count);
  console.log('Highest 20 counts (marked boxes):', allCounts.slice(-20).map(x => x.count));

  thresh.delete();
  rotated.delete();
}

measureMarks().catch(console.error);
