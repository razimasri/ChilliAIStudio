import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation, get_thresh } from './src/utils/omrEngine.ts';

async function checkDimensions() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/samples/IBSample.pdf'));
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

  const thresh = get_thresh(cv, rotated, true);
  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  console.log('Total contours on deskewed page 1:', cnts.size());
  const boxCounts = {};
  const sampleCandidate = [];
  for (let i = 0; i < cnts.size(); i++) {
    const c = cnts.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 6000 && b.x > 300 && b.x < 4500) {
      if (b.width >= 30 && b.width <= 150 && b.height >= 30 && b.height <= 150) {
        const key = `${Math.round(b.width / 5) * 5}x${Math.round(b.height / 5) * 5}`;
        boxCounts[key] = (boxCounts[key] || 0) + 1;
        if (b.width >= 40 && b.width <= 100 && b.height >= 40 && b.height <= 100) {
          sampleCandidate.push(b);
        }
      }
    }
    c.delete();
  }
  cnts.delete();
  hier.delete();
  thresh.delete();
  rotated.delete();

  console.log('Contour dimensions histogram (rounded to 5px):', boxCounts);
  console.log(`Found ${sampleCandidate.length} candidate boxes between 40 and 100px.`);
  if (sampleCandidate.length > 0) {
    console.log('First 5 candidate boxes:', sampleCandidate.slice(0, 5));
  }
}

checkDimensions().catch(console.error);
