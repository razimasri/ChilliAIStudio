import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import cvModule from '@techstark/opencv-js';

const cv = cvModule.default || cvModule;

async function run() {
  console.log('Loading PDF...');
  const doc = await getDocument('public/samples/IGSample.pdf').promise;
  console.log('PDF pages:', doc.numPages);
  const page1 = await doc.getPage(1);
  const ops1 = await page1.getOperatorList();
  const imgName1 = ops1.argsArray[5][0];

  const imgData1 = await new Promise((resolve) => page1.objs.get(imgName1, resolve));
  console.log('Page 1 image:', imgData1.width, 'x', imgData1.height);

  // Create cv.Mat from RGB buffer
  const mat1 = new cv.Mat(imgData1.height, imgData1.width, cv.CV_8UC3);
  mat1.data.set(imgData1.data);

  // Resize to 4800x6840 canonical template size matching ChilliMark.py lines 385
  const template = new cv.Mat();
  cv.resize(mat1, template, new cv.Size(4800, 6840));
  mat1.delete();

  console.log('Template canonical size:', template.cols, 'x', template.rows);

  // Import functions from omrEngine
  const { rotation, largest_cnt, scale, find_boxes, sort_into_columns, sort_into_rows, missing, find_questions, find_responses, set_box } = await import('./src/utils/omrEngine.ts');

  const { rotated: templateRot, rect: calRect } = rotation(cv, template);
  console.log('Calibration rect:', calRect);

  // In IGSample, where is the question area and sample box?
  // Let's test find_boxes across the full page or realistic question area
  // In Cambridge IGCSE, questions start around y=1000..1200 down to y=6400, x=300..4500
  // Let's find all external contours on the page that could be boxes
  const thresh = new cv.Mat();
  const gray = new cv.Mat();
  cv.cvtColor(templateRot, gray, cv.COLOR_RGB2GRAY);
  cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 27, 5);
  gray.delete();

  const cnts = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, cnts, hier, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
  console.log('Total contours on template:', cnts.size());

  // Count box-like contours around width 100-200, height 20-60
  const candidateBoxes = [];
  for (let i = 0; i < cnts.size(); i++) {
    const b = cv.boundingRect(cnts.get(i));
    if (b.width >= 50 && b.width <= 250 && b.height >= 15 && b.height <= 80 && b.width > b.height * 1.5) {
      candidateBoxes.push(b);
    }
    cnts.get(i).delete();
  }
  cnts.delete();
  hier.delete();
  thresh.delete();

  console.log('Candidate box contours found on template:', candidateBoxes.length);
  if (candidateBoxes.length > 0) {
    const sample = candidateBoxes[Math.floor(candidateBoxes.length / 2)];
    console.log('Median sample box dimension: w =', sample.width, 'h =', sample.height, 'at x =', sample.x, 'y =', sample.y);

    // Test set_box
    const boxParams = set_box(cv, templateRot, sample.x - 5, sample.y - 5, sample.x + sample.width + 5, sample.y + sample.height + 5);
    console.log('set_box result: w =', boxParams.w, 'h =', boxParams.h, 'fill_limit =', boxParams.fill_limit);
    console.log('innerPts count =', boxParams.inner.length);
  }
}

run().catch(console.error);
