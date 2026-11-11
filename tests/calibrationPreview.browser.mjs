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
            if (this.calibration && event.data.type === 'ready') {
              window.lastCalibrationOutput = event.data;
              if (window.holdCalibrationReady) {
                window.pendingCalibration.push(() => handler(event));
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
  await page.evaluate(() => {
    window.holdCalibrationReady = false;
    window.pendingCalibration.splice(0).forEach((release) => release());
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await canvas.getAttribute('data-frame'),
    'preview',
    'Do not change coordinate frame during a drag',
  );
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector('canvas[aria-label="Question area selection"]')
        ?.dataset.frame === 'aligned',
    null,
    { timeout: 120000 },
  );
  assert.equal(await next.isEnabled(), true);
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
  await next.click();
  await page.getByLabel('Empty box selection', { exact: true }).waitFor();
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
    'Preview paints first; active selection transfers after release; native calibration pixels/geometry match; sample-box crop stays full-resolution; cancellation passed.',
  );
} finally {
  await browser.close();
  await server.close();
}
