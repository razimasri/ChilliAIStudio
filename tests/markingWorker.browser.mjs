import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer, build, preview } from 'vite';
let server, origin;
if (process.env.WORKER_TEST_BUILD) {
  const outDir = 'work/worker-test-dist';
  await build({
    build: { outDir, rollupOptions: { input: 'tests/fixtures/worker.html' } },
  });
  server = await preview({
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0 },
  });
  origin = server.resolvedUrls.local[0];
} else {
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.text().startsWith('workers:')) console.log(message.text());
  });
  page.on('pageerror', (error) => console.error(error));
  await page.goto(origin + 'tests/fixtures/worker.html');
  await page.waitForFunction(() => window.workerFixture);
  const report = await page.evaluate(async () => {
    const {
      engine: e,
      getCV,
      MarkingClient,
      markBatch,
      markingWorkerCount,
      releaseAllImages,
      resolveStudentResponse,
    } = window.workerFixture;
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    check(
      markingWorkerCount(10, { hardwareConcurrency: 8, deviceMemory: 8 }) === 2,
      'Desktop should use two workers',
    );
    check(
      markingWorkerCount(10, { hardwareConcurrency: 8, deviceMemory: 4 }) === 1,
      'Low-memory devices should use one worker',
    );
    check(
      markingWorkerCount(10, { hardwareConcurrency: 8 }) === 1,
      'Unknown memory should be conservative',
    );
    check(
      markingWorkerCount(1, { hardwareConcurrency: 8, deviceMemory: 8 }) === 1,
      'One page should use one worker',
    );
    let peakWorkers = 0;
    const livingWorkers = new Set(),
      liveUrls = new Set();
    const NativeWorker = Worker,
      create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        livingWorkers.add(this);
        peakWorkers = Math.max(peakWorkers, livingWorkers.size);
      }
      terminate() {
        livingWorkers.delete(this);
        super.terminate();
      }
    };
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob.type === 'image/png') liveUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      liveUrls.delete(url);
      revoke(url);
    };
    const cv = await getCV();
    const canvas = document.createElement('canvas');
    canvas.width = 4800;
    canvas.height = 6840;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, 4800, 6840);
    context.strokeStyle = 'black';
    context.lineWidth = 4;
    context.strokeRect(300, 900, 4200, 5300);
    for (let block = 0; block < 2; block++)
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 6; r++)
          context.strokeRect(
            700 + block * 2000 + c * 300,
            1300 + r * 600,
            120,
            100,
          );
    const blank = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    const blankUrl = URL.createObjectURL(blank);
    const mat = await e.renderToCanonicalMat(cv, blankUrl);
    const { rotated, rect } = e.rotation(cv, mat);
    mat.delete();
    const box = e.set_box(cv, rotated, 697, 1297, 823, 1403);
    rotated.delete();
    const params = {
      ...box,
      rect,
      x1: 500,
      y1: 1100,
      x2: 4300,
      y2: 6000,
      key: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, 'A'])),
      names: [],
    };
    // Fill one option and double-mark another to exercise both output paths.
    context.fillStyle = 'black';
    context.fillRect(725, 1325, 65, 50);
    context.fillRect(725, 1925, 65, 50);
    context.fillRect(1025, 1925, 65, 50);
    const ambiguous = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    canvas.width = 0;
    const inputUrl = URL.createObjectURL(ambiguous);
    const comparable = ({
      annotatedDataUrl,
      rawDeskewedDataUrl,
      originalDataUrl,
      ambiguityCrops,
      ...rest
    }) => rest;
    const equalPixels = async (a, b) => {
      const first = await createImageBitmap(await (await fetch(a)).blob()),
        second = await createImageBitmap(await (await fetch(b)).blob());
      check(
        first.width === second.width && first.height === second.height,
        'Image dimensions differ',
      );
      const x = new OffscreenCanvas(first.width, 128),
        y = new OffscreenCanvas(first.width, 128);
      for (let row = 0; row < first.height; row += 128) {
        const h = Math.min(128, first.height - row);
        x.getContext('2d').drawImage(
          first,
          0,
          row,
          first.width,
          h,
          0,
          0,
          first.width,
          h,
        );
        y.getContext('2d').drawImage(
          second,
          0,
          row,
          first.width,
          h,
          0,
          0,
          first.width,
          h,
        );
        const a = x.getContext('2d').getImageData(0, 0, first.width, h).data,
          b = y.getContext('2d').getImageData(0, 0, first.width, h).data;
        check(
          a.every((v, i) => v === b[i]),
          `Worker pixels differ at row ${row}`,
        );
      }
      first.close();
      second.close();
      x.width = y.width = 0;
    };
    const client = new MarkingClient();
    try {
      for (const [input, url, label] of [
        [blank, blankUrl, 'blank'],
        [ambiguous, inputUrl, 'ambiguous'],
      ]) {
        const reference = await e.processStudentScan(cv, url, label, 0, params);
        const transferred =
          label === 'ambiguous' ? await createImageBitmap(input) : input;
        const actual = await client.mark(
          transferred,
          label,
          0,
          params,
          () => {},
        );
        if (transferred instanceof ImageBitmap)
          check(
            transferred.width === 0,
            'Worker input bitmap was not transferred',
          );
        check(
          JSON.stringify(comparable(reference)) ===
            JSON.stringify(comparable(actual)),
          `Worker recognition differs for ${label}`,
        );
        check(
          actual.hasAmbiguity === (label === 'ambiguous'),
          'Fixture did not exercise expected ambiguity path',
        );
        await equalPixels(reference.annotatedDataUrl, actual.annotatedDataUrl);
        if (actual.rawDeskewedDataUrl) {
          await equalPixels(
            reference.rawDeskewedDataUrl,
            actual.rawDeskewedDataUrl,
          );
          for (const number of Object.keys(reference.ambiguityCrops))
            await equalPixels(
              reference.ambiguityCrops[number],
              actual.ambiguityCrops[number],
            );
          let corrected = actual;
          for (const question of actual.incomplete)
            corrected = resolveStudentResponse(
              corrected,
              question.number,
              'A',
              params.key,
            );
          const finalReference = await e.renderStudentFinalAnnotation(
            cv,
            corrected,
            params,
          );
          const finalWorker = await client.annotate(corrected, params);
          await equalPixels(finalReference, finalWorker);
        }
        console.log(
          `workers: ${label} recognition and output pixels match main-thread engine`,
        );
      }
    } finally {
      client.dispose();
    }
    releaseAllImages();
    const files = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      name: `Page ${index}`,
      size: blank.size,
      dataUrl: blankUrl,
      rotation: 0,
      pageIndex: index,
      totalPages: 4,
      width: 4800,
      height: 6840,
    }));
    const active = new Set(),
      done = new Set();
    let maxActive = 0,
      ticks = 0,
      ticksDuringProcessing = 0;
    const timer = setInterval(() => {
      ticks++;
      if (active.size) ticksDuringProcessing++;
    }, 20);
    const start = performance.now();
    const streamed = [];
    let returned = false;
    const results = await markBatch(
      files,
      ['One', 'Two', 'Three', 'Four'],
      params,
      new AbortController().signal,
      ({ index, message }) => {
        if (message.endsWith('Complete')) {
          active.delete(index);
          done.add(index);
        } else if (message.includes('Cropping question area'))
          active.add(index);
        maxActive = Math.max(maxActive, active.size);
      },
      4,
      (result) => {
        check(!returned, 'Page callback arrived after batch returned');
        streamed.push(result.index);
      },
    );
    returned = true;
    check(
      streamed.length === 4 && new Set(streamed).size === 4,
      'Each completed page must stream exactly once',
    );
    clearInterval(timer);
    check(
      livingWorkers.size === 0,
      'Finished batch left marking workers alive',
    );
    check(
      maxActive >= 2 && peakWorkers === 4,
      'Four-worker pool did not run overlapping marking jobs',
    );
    check(
      ticksDuringProcessing > 10,
      'Interface heartbeat stopped during marking',
    );
    check(
      JSON.stringify(results.map((r) => r.name)) ===
        JSON.stringify(['One', 'Two', 'Three', 'Four']),
      'Parallel completion changed student order',
    );
    check(
      results.every(
        (r, index) => r.index === index && r.questions.length === 12,
      ),
      'Parallel pages lost their identities',
    );
    const elapsedMs = performance.now() - start;
    // Cancellation must interrupt native work and reject, without a partial result.
    const beforeCancel = liveUrls.size;
    const abort = new AbortController();
    let abortAt;
    const cancelled = markBatch(
      files,
      [],
      params,
      abort.signal,
      ({ message }) => {
        if (
          !abort.signal.aborted &&
          message.includes('Cropping question area')
        ) {
          abortAt = performance.now();
          abort.abort();
        }
      },
      2,
    ).then(
      () => false,
      (error) => error.name === 'AbortError',
    );
    check(await cancelled, 'Cancelled batch returned results');
    check(
      livingWorkers.size === 0 && liveUrls.size === beforeCancel,
      'Cancelled batch leaked workers or image URLs',
    );
    const cancelMs = performance.now() - abortAt;
    check(
      cancelMs < 3000,
      'Terminating workers did not promptly cancel native work',
    );
    const badCanvas = document.createElement('canvas');
    badCanvas.width = 4800;
    badCanvas.height = 6840;
    badCanvas.getContext('2d').fillStyle = 'white';
    badCanvas.getContext('2d').fillRect(0, 0, 4800, 6840);
    const invalid = badCanvas.toDataURL('image/png');
    badCanvas.width = 0;
    let failed = false;
    try {
      await markBatch(
        [{ ...files[0], dataUrl: invalid }, files[1]],
        [],
        params,
        new AbortController().signal,
        () => {},
        2,
      );
    } catch (error) {
      failed = /Page 1/.test(error.message);
    }
    check(
      failed,
      'Invalid page should halt rather than fabricate a zero score',
    );
    check(
      livingWorkers.size === 0 && liveUrls.size === beforeCancel,
      'Failed batch leaked workers or partial result images',
    );
    releaseAllImages();
    URL.revokeObjectURL(blankUrl);
    URL.revokeObjectURL(inputUrl);
    check(liveUrls.size === 0, 'Result image cleanup leaked URLs');
    return {
      maxActive,
      peakWorkers,
      ticks,
      ticksDuringProcessing,
      elapsedMs,
      cancelMs,
      orderedNames: results.map((r) => r.name),
      liveWorkers: livingWorkers.size,
      liveImageUrls: liveUrls.size,
    };
  });
  assert.ok(report.maxActive >= 2);
  await page.evaluate(() => window.showWorkerProgress());
  await page
    .getByRole('listitem', { name: 'Page 1: processing', exact: true })
    .waitFor();
  await page
    .getByRole('listitem', { name: 'Page 2: complete', exact: true })
    .waitFor();
  await page
    .getByRole('listitem', { name: 'Page 3: processing', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Cancel marking' }).click();
  assert.equal(await page.evaluate(() => window.progressCancelled), true);
  console.log(JSON.stringify(report));
  console.log(
    'Worker pixel/recognition parity, four-worker pool, bitmap transfer, interface heartbeat, stable order, cancellation and failure handling passed',
  );
} finally {
  await browser.close();
  if (server.close) await server.close();
  else await new Promise((resolve) => server.httpServer.close(resolve));
}
