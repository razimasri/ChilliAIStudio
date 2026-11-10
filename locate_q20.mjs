import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation, scale } from './src/utils/omrEngine.ts';

async function locateQ20() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/assets/aistudio/IBSample_719b8592.pdf'));
  const doc = await getDocument({ data }).promise;

  // Let's inspect page 3
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

  // In IBSample, how many questions are there and where are they located?
  // Let's find all text/box contours around the sheet.
  // IBDP sheet has 40 questions:
  // Usually 1-10 in col 1, 11-20 in col 2, 21-30 in col 3, 31-40 in col 4!
  // OR 1-20 in col 1, 21-40 in col 2!
  // Let's check which one!
  // In image_b4a4c179.png:
  // Foster Holmes Question #20: Choice C has [X].
  // In image_904c7f3e.png:
  // Bailey Alexander Question #8: Choice D has [X].
  // In image_5cc4472d.png:
  // Clara Oswald Question #4: Choice B has [X].

  // Let's threshold the whole page using Otsu
  const gray = new cv.Mat();
  cv.cvtColor(rotated, gray, cv.COLOR_RGB2GRAY);
  const thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  gray.delete();

  // Find all contours of type RETR_CCOMP
  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

  // Group square contours by X coordinate to see the columns!
  const boxList = [];
  for (let i = 0; i < cnts.size(); i++) {
    const c = cnts.get(i);
    const b = cv.boundingRect(c);
    if (b.y > 1000 && b.y < 6000 && b.width >= 40 && b.width <= 80 && b.height >= 40 && b.height <= 80) {
      const ratio = b.width / b.height;
      if (ratio > 0.75 && ratio < 1.35) {
        boxList.push(b);
      }
    }
    c.delete();
  }
  cnts.delete();
  hier.delete();

  console.log('Total square boxes found:', boxList.length);
  // Sort by X
  boxList.sort((a, b) => a.x - b.x);

  // Cluster X coordinates
  const xClusters = [];
  for (const b of boxList) {
    let added = false;
    for (const cl of xClusters) {
      if (Math.abs(cl.avgX - b.x) < 40) {
        cl.boxes.push(b);
        cl.avgX = Math.round(cl.boxes.reduce((sum, item) => sum + item.x, 0) / cl.boxes.length);
        added = true;
        break;
      }
    }
    if (!added) {
      xClusters.push({ avgX: b.x, boxes: [b] });
    }
  }

  console.log(`Found ${xClusters.length} X-clusters:`);
  for (const cl of xClusters) {
    if (cl.boxes.length > 5) {
      console.log(`  X ≈ ${cl.avgX}: ${cl.boxes.length} boxes (y from ${Math.min(...cl.boxes.map(b => b.y))} to ${Math.max(...cl.boxes.map(b => b.y))})`);
    }
  }

  thresh.delete();
  rotated.delete();
}

locateQ20().catch(console.error);
