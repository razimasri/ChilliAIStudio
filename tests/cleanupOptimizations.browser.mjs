import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/worker.html');
  const report = await page.evaluate(async () => {
    const e = await import('/src/utils/omrEngine.ts');
    const old = await import('/tests/helpers/legacyCleanup.ts');
    const { getCV } = await import('/src/utils/cvLoader.ts');
    const cv = await getCV();
    const check = (condition, message) => { if (!condition) throw Error(message); };
    let seed = 42, cases = 0, thresholdCases = 0, unsafeChanges = 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };
    for (const channels of [1, 3, 4]) for (const mono of [true, false]) {
      const image = new cv.Mat(100, 110, channels === 1 ? cv.CV_8UC1 : channels === 3 ? cv.CV_8UC3 : cv.CV_8UC4);
      for (let i = 0; i < image.data.length; i += channels) {
        const v = random();
        for (let c = 0; c < channels; c++) image.data[i + c] = (channels === 4 && c === 3) ? random() : (mono || c === 0 ? v : random());
      }
      const unchanged = image.data.slice();
      const roi = image.roi(new cv.Rect(3, 2, 96, 96));
      for (const input of [image, roi]) for (const blur of [true, false]) {
        const medianChannels = [];
        const proxy = new Proxy(cv, { get(target, key) { return key === 'medianBlur' ? (...args) => { medianChannels.push(args[0].channels()); return target.medianBlur(...args); } : target[key]; } });
        const a = e.get_thresh(proxy, input, blur), b = old.legacy_get_thresh(cv, input, blur);
        check(a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]), `threshold ${channels}/${mono}/${blur}`);
        if (blur) check(medianChannels[0] === (channels === 1 || mono ? 1 : 3), 'wrong blur channel count');
        a.delete(); b.delete(); thresholdCases++;
      }
      if (channels === 3 && !mono) {
        const gray = new cv.Mat(), blurred = new cv.Mat(), unsafe = new cv.Mat();
        cv.cvtColor(image, gray, cv.COLOR_RGB2GRAY); cv.medianBlur(gray, blurred, 5);
        cv.adaptiveThreshold(blurred, unsafe, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 27, 5);
        const reference = old.legacy_get_thresh(cv, image);
        unsafeChanges = unsafe.data.reduce((n, v, i) => n + (v !== reference.data[i] ? 1 : 0), 0);
        reference.delete(); gray.delete(); blurred.delete(); unsafe.delete();
      }
      check(image.data.every((v, i) => v === unchanged[i]), "input pixels mutated");
      roi.delete(); image.delete();
    }
    check(unsafeChanges > 0, 'missing coloured-input counterexample');
    for (const [rows, cols] of [[240, 320], [20, 25]]) {
      const shapes = [[0,0,cols,rows], [0,0,110,90], [cols-110,0,110,90], [0,rows-90,110,90], [cols-110,rows-90,110,90], [-10,-10,80,70]];
      for (let i = 0; i < 80; i++) shapes.push([random() % cols, random() % rows, 20 + random(), 20 + random()]);
      for (const [x,y,w,h] of shapes) {
        // Rectangles and concave joined shapes exercise borders, splitting and erosion.
        for (const concave of [false, true]) {
          const points = concave ? [x,y,x+w,y,x+w,y+h,x+w/2|0,y+h,x+w/2|0,y+h/2|0,x,y+h/2|0] : [x,y,x+w,y,x+w,y+h,x,y+h];
          const contour = cv.matFromArray(points.length / 2, 1, cv.CV_32SC2, points);
          const bounds = cv.boundingRect(contour), params = { w: 60, h: 45 }, area = { rows, cols };
          for (const operation of ['erode_messy', 'slice_messy']) {
            const a = [], b = [], extra = operation === 'slice_messy' ? [bounds.x,bounds.y,bounds.width,bounds.height] : [];
            if (extra.length) { e[operation](cv,area,contour,params,...extra,a); old['legacy_'+operation](cv,area,contour,params,...extra,b); }
            else { e[operation](cv,contour,area,params,a); old['legacy_'+operation](cv,contour,area,params,b); }
            check(JSON.stringify(a) === JSON.stringify(b), `${operation}: ${JSON.stringify({rows,cols,x,y,w,h,concave,a,b})}`);
            cases++;
          }
          contour.delete();
        }
      }
    }
    return { cases, thresholdCases, unsafeChanges };
  });
  assert.equal(report.thresholdCases, 24);
  console.log(report);
} finally { await browser.close(); await server.close(); }
