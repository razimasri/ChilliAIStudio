import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Run with CHROMIUM_PATH=/usr/bin/chromium npm run test:geometry,
// or install Playwright's Chromium with npx playwright install chromium.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  // Independently calculated from the sample PDF page boxes at 600/72;
  // these intentionally differ within a batch (as in PyMuPDF dpi=600).
  for (const [name, expectedSizes] of [
    ['IBSample', [[4817,6842],[4817,6825],[4825,6842],[4817,6834],[4825,6817],[4817,6842],[4825,6842],[4817,6842],[4817,6842],[4825,6842],[4817,6842]]],
    ['IGSample', [[4909,6967],[4917,6975],[4917,6992],[4917,6975],[4917,6967],[4917,6967],[4917,6975],[4917,6992],[4917,6975],[4917,6967],[4917,6967],[4917,6975],[4917,6967],[4917,6975]]],
  ]) {
    const page = await browser.newPage();
    page.on('pageerror', error => console.error(error));
    page.on('console', msg => { if (msg.text().startsWith('geometry:')) console.log(msg.text()); });
    await page.goto(origin);
    const report = await page.evaluate(async ({ name }) => {
      const { loadExamFile, getExamPage, releaseUnusedSources } = await import('/src/utils/pdfProcessor.ts');
      const engine = await import('/src/utils/omrEngine.ts');
      const { getCV } = await import('/src/utils/cvLoader.ts');
      const { MarkingClient } = await import('/src/utils/markingClient.ts');
      const cv = await getCV();
      console.log(`geometry: ${name}: OpenCV ready`);
      const response = await fetch(`/samples/${name}.pdf`);
      const file = new File([await response.blob()], `${name}.pdf`, { type: 'application/pdf' });
      const loaded = await loadExamFile(file, p => { if (p.stage === 'rendering') console.log(`geometry: ${name}: ${p.message}`); });
      const sizes = loaded.map(p => [p.width, p.height]);
      const allDeferred = loaded.every(p => p.sourceFile === file && p.dataUrl.startsWith('data:image/svg+xml,'));
      const sourcePages = [...loaded];
      // Keep two pages so we test batch pages independently of the template.
      const pages = loaded.splice(0, 2);
      loaded.length = 0;
      const firstRaster = await getExamPage(pages[0]);
      const native = await engine.renderScanMat(cv, firstRaster.url);
      const nativeSize = [native.cols, native.rows];
      native.delete();
      const template = await engine.renderToCanonicalMat(cv, firstRaster.url);
      const templateSize = [template.cols, template.rows];
      const { rotated, rect } = engine.rotation(cv, template);
      template.delete();
      firstRaster.release();

      // Find a tight empty-box selection and grid bounds on the actual sample.
      const threshold = engine.get_thresh(cv, rotated);
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(threshold, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
      const candidates = [];
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const b = cv.boundingRect(c);
        const inGrid = name === 'IBSample'
          ? b.y > 3000 && b.y < 5850 && b.x > 700 && b.x < 4000
          : b.y > 2800 && b.y < 6400 && b.x > 1800 && b.x < 4350;
        const boxSize = name === 'IBSample'
          ? b.width >= 170 && b.width <= 220 && b.height >= 140 && b.height <= 200
          : b.width >= 70 && b.width <= 110 && b.height >= 18 && b.height <= 35;
        if (hierarchy.data32S[i * 4 + 3] === -1 && inGrid && boxSize) candidates.push(b);
        c.delete();
      }
      threshold.delete(); contours.delete(); hierarchy.delete();
      if (!candidates.length) throw new Error(`${name}: no calibration box candidates`);
      candidates.sort((a, b) => a.y - b.y || a.x - b.x);
      let box;
      const ordered = name === 'IBSample' ? [candidates[1], ...candidates] : candidates;
      for (const sample of ordered) {
        for (const padding of [0, 1, 2, 3, 4]) {
          try {
            const measured = engine.set_box(cv, rotated, sample.x-padding, sample.y-padding,
              sample.x+sample.width+padding, sample.y+sample.height+padding);
            if (measured.w >= sample.width*0.8 && measured.h >= sample.height*0.8) { box = measured; break; }
          } catch { /* Select another empty box when original validation rejects it. */ }
        }
        if (box) break;
      }
      if (!box) throw new Error(`${name}: no valid calibration selection`);
      const params = {
        rect, ...box,
        x1: Math.max(0, Math.min(...candidates.map(b => b.x)) - 50),
        y1: Math.max(0, Math.min(...candidates.map(b => b.y)) - 50),
        x2: Math.min(4800, Math.max(...candidates.map(b => b.x + b.width)) + 50),
        y2: Math.min(6840, Math.max(...candidates.map(b => b.y + b.height)) + 50),
        key: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, 'A'])),
        names: [],
      };
      rotated.delete();
      console.log(`geometry: ${name}: box ${box.w}×${box.h}, question area [${params.x1}, ${params.y1}, ${params.x2}, ${params.y2}]`);
      const results = [];
      for (let i = 0; i < pages.length; i++) {
        const raster = await getExamPage(pages[i]);
        const result = await engine.processStudentScan(cv, raster.url, `Sample ${i + 1}`, i, params, msg => console.log(`geometry: ${name} page ${i + 1}: ${msg}`));
        if (i === 0) {
          const worker = new MarkingClient();
          try {
            const actual = await worker.mark(await (await fetch(raster.url)).blob(), `Sample ${i + 1}`, i, params, () => {});
            const normalize = ({annotatedDataUrl, originalDataUrl, rawDeskewedDataUrl, ambiguityCrops, ...state}) => state;
            if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(result))) throw new Error(`${name}: worker recognition differs from main-thread engine`);
            console.log(`geometry: ${name}: worker responses, questions, coordinates and scores match main-thread engine`);
          } finally { worker.dispose(); }
        }
        raster.release();
        const aligned = await engine.renderScanMat(cv, result.rawDeskewedDataUrl || result.annotatedDataUrl);
        const alignedSize = [aligned.cols, aligned.rows];
        aligned.delete();
        const cropSizes = [];
        for (const crop of Object.values(result.ambiguityCrops)) {
          const img = await engine.loadImageElement(crop);
          cropSizes.push([img.naturalWidth, img.naturalHeight]);
        }
        // Exercise final annotation from the stored aligned raster, then ensure the
        // final renderer retains the exact question coordinate frame.
        const coordsBefore = JSON.stringify(result.questions.map(q => q.boxes.map(b => b.xy)));
        const corrected = result.rawDeskewedDataUrl ? await engine.renderStudentFinalAnnotation(cv, result, params) : result.annotatedDataUrl;
        const correctedMat = await engine.renderScanMat(cv, corrected);
        const correctedSize = [correctedMat.cols, correctedMat.rows];
        correctedMat.delete();
        results.push({
          alignedSize, correctedSize, questions: result.questions.length,
          coordsUnchanged: coordsBefore === JSON.stringify(result.questions.map(q => q.boxes.map(b => b.xy))),
          lossless: (await (await fetch(corrected)).blob()).type === 'image/png',
          cropSizes,
        });
      }
      // Below the original landmark cutoff we must fail instead of fabricating a frame.
      const blank = new cv.Mat(6840, 4800, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
      let rejectsBlank = false;
      try { engine.largest_cnt(cv, blank).delete(); } catch { rejectsBlank = true; }
      blank.delete();
      releaseUnusedSources(sourcePages, []);
      const { releaseAllImages } = await import('/src/utils/imageStore.ts'); releaseAllImages();
      return { sizes, nativeSize, templateSize, allDeferred, results, rejectsBlank, rect };
    }, { name });
    assert.deepEqual(report.sizes, expectedSizes);
    assert.deepEqual(report.nativeSize, expectedSizes[0]);
    assert.deepEqual(report.templateSize, [4800, 6840]);
    assert.equal(report.allDeferred, true);
    assert.equal(report.rejectsBlank, true);
    for (const result of report.results) {
      assert.deepEqual(result.alignedSize, [4800, 6840]);
      assert.deepEqual(result.correctedSize, [4800, 6840]);
      assert.equal(result.questions, 40);
      assert.equal(result.coordsUnchanged, true);
      assert.equal(result.lossless, true);
      for (const [w, h] of result.cropSizes) {
        assert.ok(w > 0 && w <= 1050);
        assert.ok(h > 0 && h <= 230);
      }
    }
    console.log(`${name}: ${expectedSizes.length} pages retained their 600-DPI sizes; two pages detected 40 questions and preserved 4800×6840 correction coordinates`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
