import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation } from './src/utils/omrEngine.ts';

async function dumpBox() {
  const cv = await getCV();
  const data = new Uint8Array(fs.readFileSync('public/assets/aistudio/IBSample_719b8592.pdf'));
  const doc = await getDocument({ data }).promise;

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

  // Let's inspect Question 20 from screenshot image_b4a4c179.png!
  // In image_b4a4c179.png:
  // "Scanned Question #20 Snippet: 20 [A] [B] [C(X)] [D]"
  // Where is question 20 located?
  // Let's find "20" on rotated page using template matching or searching for the text "20"
  // Let's search in page3 text content!
  const textContent = await page3.getTextContent();
  console.log('Text content items count:', textContent.items.length);
  for (const item of textContent.items) {
    if (item.str === '20' || item.str === '19' || item.str.includes('20')) {
      console.log(`Found text "${item.str}" at:`, item.transform);
    }
  }

  rotated.delete();
}

dumpBox().catch(console.error);
