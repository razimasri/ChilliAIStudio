import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation, scale } from './src/utils/omrEngine.ts';

async function measureAllBoxes() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/samples/IBSample.pdf'));
  const doc = await getDocument({ data }).promise;

  // Let's inspect page 3 (Foster Holmes) where user saw Q20 ambiguous
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

  const gray = new cv.Mat();
  cv.cvtColor(rotated, gray, cv.COLOR_RGB2GRAY);
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray.delete();

  // In screenshot image_b4a4c179.png:
  // "Scanned Question #20 Snippet:"
  // Let's find the exact coordinates of the snippet in image_b4a4c179.png!
  // We have /public/assets/aistudio/image_b4a4c179.png in workspace.
  // Let's find where that snippet appears in rotated!
  // In the snippet, we see "20", "[ A ]", "[ B ]", "[ C(X) ]", "[ D ]".
  // Let's search for the 'X' box!
  // What are the coordinates of the 'X' box in rotated?
  // Let's find contours with high fill in thresh:
  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  const boxes = [];
  for (let i = 0; i < cnts.size(); i++) {
    const c = cnts.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 6000 && b.x > 300 && b.x < 4500 && b.width >= 45 && b.width <= 75 && b.height >= 45 && b.height <= 75) {
      boxes.push(b);
    }
    c.delete();
  }
  cnts.delete();
  hier.delete();

  // Sort by Y then X
  boxes.sort((a, b) => a.y - b.y || a.x - b.x);

  // Group into rows (y within 30px)
  const rows = [];
  for (const b of boxes) {
    let added = false;
    for (const r of rows) {
      if (Math.abs(r.avgY - b.y) < 30) {
        r.boxes.push(b);
        r.avgY = Math.round(r.boxes.reduce((s, x) => s + x.y, 0) / r.boxes.length);
        added = true;
        break;
      }
    }
    if (!added) {
      rows.push({ avgY: b.y, boxes: [b] });
    }
  }

  // Filter rows that have at least 4 boxes (a question has 4 choices)
  const qRows = rows.filter(r => r.boxes.length >= 4);
  console.log(`Found ${qRows.length} question rows on Foster Holmes`);

  // Let's inspect each row: measure counts of each box in the row
  for (let rIdx = 0; rIdx < Math.min(25, qRows.length); rIdx++) {
    const r = qRows[rIdx];
    r.boxes.sort((a, b) => a.x - b.x);
    // Take first 4 boxes
    const rowBoxes = r.boxes.slice(0, 4);
    const counts = rowBoxes.map((b, i) => {
      const cx = Math.floor(b.x + b.width / 2);
      const cy = Math.floor(b.y + b.height / 2);
      const hw = Math.floor(b.width * 0.35);
      const hh = Math.floor(b.height * 0.35);
      const roi = thresh.roi(new cv.Rect(cx - hw, cy - hh, hw * 2, hh * 2));
      const cnt = cv.countNonZero(roi);
      roi.delete();
      return `${String.fromCharCode(65 + i)}:${cnt}`;
    });
    console.log(`Row at Y=${r.avgY}: ${counts.join('  ')}`);
  }

  thresh.delete();
  rotated.delete();
}

measureAllBoxes().catch(console.error);
