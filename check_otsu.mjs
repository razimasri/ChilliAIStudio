import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';
import { getCV } from './src/utils/cvLoader.ts';
import { rotation } from './src/utils/omrEngine.ts';

async function checkThresh() {
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

  const gray = new cv.Mat();
  cv.cvtColor(rotated, gray, cv.COLOR_RGB2GRAY);

  // Measure Otsu threshold value
  const th = new cv.Mat();
  const otsuVal = cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
  console.log('Otsu threshold value on Page 3:', otsuVal);

  // Let's check mean pixel intensity of empty boxes vs paper background
  // In image_b4a4c179.png, Question 20 is around center of page
  // Let's find where "20" is
  // Or let's inspect the histogram of grayscale values inside an empty box
  th.delete();
  gray.delete();
  rotated.delete();
}

checkThresh().catch(console.error);
