import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer, build, preview } from 'vite';
let server;
if (process.env.CALIBRATION_TEST_BUILD) {
  const outDir = 'work/calibration-test-dist';
  await build({
    build: {
      outDir,
      rollupOptions: { input: 'tests/fixtures/calibrationPreview.html' },
    },
  });
  server = await preview({
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0 },
  });
} else {
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript(() => {
    window.holdCalibrationReady = true;
    window.pendingCalibration = [];
    window.holdMeasurementReady = true;
    window.pendingMeasurements = [];
    window.liveCalibrationWorkers = new Set();
    window.workerPreviewSnapshots = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.calibration = String(url).includes('calibration.worker');
        if (this.calibration) {
          window.liveCalibrationWorkers.add(this);
          const canvas = document.querySelector(
            'canvas[aria-label="Question area selection"]',
          );
          window.workerPreviewSnapshots.push({
            width: canvas?.width,
            height: canvas?.height,
            painted:
              canvas?.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 255,
          });
        }
      }
      set onmessage(handler) {
        super.onmessage =
          handler &&
          ((event) => {
            if (
              this.calibration &&
              event.data.type === 'ready' &&
              event.data.image
            ) {
              window.lastCalibrationOutput = event.data;
              if (window.holdCalibrationReady) {
                window.pendingCalibration.push(() => handler(event));
                return;
              }
            }
            if (
              this.calibration &&
              event.data.type === 'ready' &&
              event.data.box
            ) {
              window.lastMeasuredCalibration = event.data;
              if (window.holdMeasurementReady) {
                window.pendingMeasurements.push(() => handler(event));
                return;
              }
            }
            handler(event);
          });
      }
      get onmessage() {
        return super.onmessage;
      }
      terminate() {
        window.liveCalibrationWorkers.delete(this);
        super.terminate();
      }
    };
  });
  await page.goto(
    server.resolvedUrls.local[0] + 'tests/fixtures/calibrationPreview.html',
  );
  await page.waitForFunction(() => window.mountCalibration);
  await page.evaluate(() => window.mountCalibration());
  const canvas = page.getByLabel('Question area selection', { exact: true });
  await canvas.waitFor({ timeout: 120000 });
  const next = page.getByRole('button', {
    name: 'Next: Select Box',
    exact: true,
  });
  await page.waitForFunction(
    () => window.pendingCalibration.length === 1,
    null,
    { timeout: 120000 },
  );
  assert.equal(await next.isDisabled(), true);
  const frame = await canvas.boundingBox();
  await page.mouse.move(
    frame.x + frame.width * 0.2,
    frame.y + frame.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    frame.x + frame.width * 0.8,
    frame.y + frame.height * 0.85,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.equal(
    await next.isEnabled(),
    true,
    'Next must not wait for full-resolution preparation',
  );
  await next.click();
  const boxCanvas = page.getByLabel('Empty box selection', { exact: true });
  await boxCanvas.waitFor();
  const low = await boxCanvas.evaluate((canvas) => ({
    width: canvas.width,
    logical: Number(canvas.dataset.coordinateWidth),
  }));
  assert.ok(
    low.width < low.logical,
    'Sample box must open immediately using the preview',
  );
  const selected = await page.evaluate(async () => {
    const {
      engine: e,
      getCV,
      measureSelectedBox,
      alignQuestionArea,
    } = window.calibrationFixture;
    const cv = await getCV(),
      url = URL.createObjectURL(window.lastCalibrationOutput.image);
    const mat = await e.renderScanMat(cv, url);
    URL.revokeObjectURL(url);
    const threshold = e.get_thresh(cv, mat),
      contours = new cv.MatVector(),
      hierarchy = new cv.Mat();
    let area;
    try {
      cv.findContours(
        threshold,
        contours,
        hierarchy,
        cv.RETR_CCOMP,
        cv.CHAIN_APPROX_SIMPLE,
      );
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i),
          b = cv.boundingRect(contour);
        contour.delete();
        if (
          b.x < 1800 ||
          b.x > 3450 ||
          b.y < 2900 ||
          b.y > 5500 ||
          b.width < 70 ||
          b.width > 110 ||
          b.height < 18 ||
          b.height > 35
        )
          continue;
        const candidate = {
          x1: b.x - 4,
          y1: b.y - 4,
          x2: b.x + b.width + 4,
          y2: b.y + b.height + 4,
        };
        try {
          const measured = measureSelectedBox(
            cv,
            mat,
            candidate.x1,
            candidate.y1,
            candidate.x2,
            candidate.y2,
          );
          if (measured.w >= b.width * 0.8 && measured.h >= b.height * 0.8) {
            area = candidate;
            break;
          }
        } catch {}
      }
    } finally {
      threshold.delete();
      contours.delete();
      hierarchy.delete();
      mat.delete();
    }
    if (!area) throw Error('No valid empty box found in sample');
    return {
      raw: alignQuestionArea(area, -window.lastCalibrationOutput.angle),
      q: window.calibrationParams,
    };
  });
  const workspace = page.getByRole('region', {
    name: 'Scan workspace',
    exact: true,
  });
  await workspace.evaluate((element, { raw, q }) => {
    element.scrollLeft = Math.max(0, raw.x1 - q.x1 - 80);
    element.scrollTop = Math.max(0, raw.y1 - q.y1 - 80);
  }, selected);
  const points = await boxCanvas.evaluate((canvas, { raw, q }) => {
    window.sampleCanvasNode = canvas;
    const r = canvas.getBoundingClientRect(),
      w = Number(canvas.dataset.coordinateWidth),
      h = Number(canvas.dataset.coordinateHeight);
    return {
      x1: r.x + ((raw.x1 - q.x1) / w) * r.width,
      y1: r.y + ((raw.y1 - q.y1) / h) * r.height,
      x2: r.x + ((raw.x2 - q.x1) / w) * r.width,
      y2: r.y + ((raw.y2 - q.y1) / h) * r.height,
    };
  }, selected);
  await page.mouse.move(points.x1, points.y1);
  await page.mouse.down();
  await page.mouse.move(points.x2, points.y2, { steps: 8 });
  await page.evaluate(() => {
    window.holdCalibrationReady = false;
    window.pendingCalibration.splice(0).forEach((release) => release());
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.calibrationParams.questionAreaFrame),
    'preview',
    'Do not change frame during a sample-box gesture',
  );
  await page.evaluate(() => {
    window.calibrationTicks = 0;
    window.calibrationTimer = setInterval(() => window.calibrationTicks++, 20);
  });
  await page.mouse.up();
  const busy = page.getByRole('status', {
    name: 'Calibrating selected box',
    exact: true,
  });
  await busy.waitFor();
  await page.waitForFunction(
    () => window.pendingMeasurements.length === 1,
    null,
    { timeout: 120000 },
  );
  assert.equal(
    await busy.isVisible(),
    true,
    'Selection and spinner must stay visible while measurement is pending',
  );
  assert.notEqual(
    await busy
      .locator('span')
      .first()
      .evaluate((span) => getComputedStyle(span).animationName),
    'none',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Mark Exams', exact: true })
      .isDisabled(),
    true,
  );
  const spinnerBounds = await busy.boundingBox(),
    workspaceBounds = await workspace.boundingBox();
  assert.ok(
    spinnerBounds.x >= workspaceBounds.x &&
      spinnerBounds.y >= workspaceBounds.y &&
      spinnerBounds.x + spinnerBounds.width <=
        workspaceBounds.x + workspaceBounds.width &&
      spinnerBounds.y + spinnerBounds.height <=
        workspaceBounds.y + workspaceBounds.height,
    'Spinner must be inside the visible selected box',
  );
  await page.screenshot({ path: '/workspace/work/progressive-spinner.png' });
  assert.ok(
    (await page.evaluate(() => window.calibrationTicks)) > 5,
    'UI animation/heartbeat stalled during calibration',
  );
  await page.evaluate(() => {
    clearInterval(window.calibrationTimer);
    window.holdMeasurementReady = false;
    window.pendingMeasurements.splice(0).forEach((release) => release());
  });
  await page
    .getByText('Empty box ready', { exact: true })
    .waitFor({ timeout: 120000 });
  assert.equal(
    await page
      .getByRole('button', { name: 'Mark Exams', exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector('canvas[aria-label="Empty box selection"]') ===
        window.sampleCanvasNode,
    ),
    true,
    'Image upgrade must not replace the selection window',
  );
  const measured = await page.evaluate(async (rawArea) => {
    const {
      engine: e,
      getCV,
      measureSelectedBox,
      alignQuestionArea,
    } = window.calibrationFixture;
    const cv = await getCV(),
      url = URL.createObjectURL(window.lastCalibrationOutput.image);
    const image = await e.renderScanMat(cv, url);
    URL.revokeObjectURL(url);
    const area = alignQuestionArea(rawArea, window.lastCalibrationOutput.angle);
    try {
      return {
        actual: window.calibrationParams,
        expected: measureSelectedBox(
          cv,
          image,
          area.x1,
          area.y1,
          area.x2,
          area.y2,
        ),
      };
    } finally {
      image.delete();
    }
  }, selected.raw);
  for (const field of ['w', 'h', 'inner', 'outer', 'fill_limit'])
    assert.deepEqual(
      measured.actual[field],
      measured.expected[field],
      `Worker measurement changed ${field}`,
    );
  const mapping = await page.evaluate(() => {
    const expected = window.calibrationFixture.alignQuestionArea(
      { x1: 960, y1: 2052, x2: 3840, y2: 5814 },
      window.lastCalibrationOutput.angle,
    );
    return {
      expected,
      actual: window.calibrationParams,
      snapshots: window.workerPreviewSnapshots,
      workers: window.liveCalibrationWorkers.size,
    };
  });
  for (const axis of ['x1', 'x2', 'y1', 'y2'])
    assert.ok(
      Math.abs(mapping.actual[axis] - mapping.expected[axis]) <= 2,
      `Preview mapping changed ${axis}`,
    );
  assert.equal(mapping.actual.questionAreaFrame, 'aligned');
  assert.equal(mapping.workers, 0);
  assert.ok(
    mapping.snapshots[0].width <= 1200 &&
      mapping.snapshots[0].height <= 1200 &&
      mapping.snapshots[0].painted,
    'Preview must paint before background worker starts',
  );
  const dimensions = await page
    .getByLabel('Empty box selection', { exact: true })
    .evaluate((c) => ({ width: c.width, height: c.height }));
  assert.equal(dimensions.width, mapping.actual.x2 - mapping.actual.x1);
  assert.equal(dimensions.height, mapping.actual.y2 - mapping.actual.y1);
  await page.evaluate(() => window.clearCalibration());
  const pixels = await page.evaluate(async () => {
    const {
      engine: e,
      getCV,
      getExamPage,
      prepareCalibration,
    } = window.calibrationFixture;
    const cv = await getCV();
    const raster = await getExamPage(window.calibrationFile);
    let count = 0;
    try {
      const raw = await e.renderToCanonicalMat(cv, raster.url),
        ref = e.rotation(cv, raw);
      raw.delete();
      const expected = document.createElement('canvas');
      cv.imshow(expected, ref.rotated);
      ref.rotated.delete();
      const prepared = window.lastCalibrationOutput;
      if (
        JSON.stringify(prepared.rect) !== JSON.stringify(ref.rect) ||
        prepared.angle !== ref.angle
      )
        throw Error('Worker alignment geometry differs');
      const image = await createImageBitmap(prepared.image),
        strip = new OffscreenCanvas(image.width, 128);
      for (let y = 0; y < image.height; y += 128) {
        const h = Math.min(128, image.height - y);
        strip.getContext('2d').clearRect(0, 0, strip.width, strip.height);
        strip
          .getContext('2d')
          .drawImage(image, 0, y, image.width, h, 0, 0, image.width, h);
        const a = strip
            .getContext('2d')
            .getImageData(0, 0, image.width, h).data,
          b = expected.getContext('2d').getImageData(0, y, image.width, h).data;
        if (!a.every((v, i) => v === b[i]))
          throw Error(`Calibration pixels differ at ${y}`);
        count += image.width * h;
      }
      image.close();
      strip.width = 0;
      expected.width = 0;
      // Worker cancellation must reject and terminate, without stale UI work.
      const controller = new AbortController();
      const blob = await (await fetch(raster.url)).blob();
      const task = prepareCalibration(blob, controller.signal, () =>
        controller.abort(),
      ).then(
        () => false,
        (e) => e.name === 'AbortError',
      );
      if (!(await task) || window.liveCalibrationWorkers.size)
        throw Error('Calibration cancellation leaked a worker');
    } finally {
      raster.release();
    }
    return count;
  });
  assert.equal(pixels, 4800 * 6840);
  console.log(
    JSON.stringify({ pixels, selection: mapping.expected, canvas: dimensions }),
  );
  console.log(
    'Preview sample-box navigation, pending selection/spinner, active-gesture mapping, worker measurement, native template pixels and cancellation passed.',
  );
} finally {
  await browser.close();
  await server.close();
}
