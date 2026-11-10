import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const scratch = await mkdtemp(join(tmpdir(), 'chillimark-calibration-'));
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const name of ['synthetic', 'IBSample', 'IGSample']) {
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    const actual = await page.evaluate(async name => {
      const engine = await import('/src/utils/omrEngine.ts');
      const { getCV } = await import('/src/utils/cvLoader.ts');
      const cv = await getCV();
      const canvas = document.createElement('canvas');
      let image, selection, centers;
      if (name === 'synthetic') {
        canvas.width = 560; canvas.height = 640;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 560, 640);
        centers = [];
        for (let r = 0; r < 5; r++) {
          const row = [];
          for (let c = 0; c < 4; c++) {
            const x = 60 + c * 120, y = 60 + r * 110;
            ctx.strokeStyle = 'black'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.roundRect(x, y, 70, 50, 8); ctx.stroke();
            row.push([x + 35, y + 25]);
            if ((r === 1 && c === 0) || (r === 3 && (c === 0 || c === 2)) || (r === 4 && c === 3)) {
              ctx.strokeStyle = r === 4 ? 'rgb(170,170,170)' : 'black';
              ctx.lineWidth = r === 4 ? 2 : 5;
              ctx.beginPath(); ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + 60, y + 40);
              ctx.moveTo(x + 60, y + 10); ctx.lineTo(x + 10, y + 40); ctx.stroke();
            }
            if (r === 2 && c === 1) { ctx.fillStyle = 'black'; ctx.fillRect(x + 5, y + 5, 60, 40); }
            if (r === 4 && c === 1) { ctx.fillStyle = 'rgb(235,235,235)'; ctx.fillRect(x + 8, y + 8, 54, 34); }
          }
          centers.push(row);
        }
        selection = [57, 57, 134, 114];
        image = cv.imread(canvas);
      } else {
        // Prepare only page 1, following the production 600-DPI/template path.
        const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
        const pdf = await pdfjs.getDocument({ data: await (await fetch(`/samples/${name}.pdf`)).arrayBuffer() }).promise;
        const pdfPage = await pdf.getPage(1);
        const viewport = pdfPage.getViewport({ scale: 600 / 72 });
        canvas.width = Math.ceil(viewport.width - 1e-7); canvas.height = Math.ceil(viewport.height - 1e-7);
        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        await pdf.destroy();
        const template = await engine.renderToCanonicalMat(cv, canvas.toDataURL('image/png'));
        image = engine.rotation(cv, template).rotated; template.delete();
        const threshold = engine.get_thresh(cv, image);
        const contours = new cv.MatVector(), hierarchy = new cv.Mat();
        cv.findContours(threshold, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
        const candidates = [];
        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i), b = cv.boundingRect(contour);
          const valid = name === 'IBSample'
            ? b.y > 3000 && b.y < 5850 && b.x > 700 && b.x < 4000 && b.width >= 170 && b.width <= 220 && b.height >= 140 && b.height <= 200
            : b.y > 2800 && b.y < 6400 && b.x > 1800 && b.x < 4350 && b.width >= 70 && b.width <= 110 && b.height >= 18 && b.height <= 35;
          if (hierarchy.data32S[i * 4 + 3] === -1 && valid) candidates.push(b);
          contour.delete();
        }
        threshold.delete(); contours.delete(); hierarchy.delete();
        candidates.sort((a,b) => a.y-b.y || a.x-b.x);
        let params;
        const ordered = name === 'IBSample' ? [candidates[1], ...candidates] : candidates;
        for (const b of ordered) {
          for (const padding of [0, 1, 2, 3, 4]) {
            const trial = [b.x-padding,b.y-padding,b.x+b.width+padding,b.y+b.height+padding];
            try {
              const measured = engine.set_box(cv, image, ...trial);
              if (measured.w >= b.width*0.8 && measured.h >= b.height*0.8) {
                params = { ...measured, key: {} }; selection = trial; break;
              }
            } catch { /* Original validation asks the user to select another box. */ }
          }
          if (params) break;
        }
        if (!params) throw new Error(`${name}: no valid calibration selection`);
        const x1 = Math.max(0, Math.min(...candidates.map(b=>b.x))-50);
        const y1 = Math.max(0, Math.min(...candidates.map(b=>b.y))-50);
        const x2 = Math.min(image.cols, Math.max(...candidates.map(b=>b.x+b.width))+50);
        const y2 = Math.min(image.rows, Math.max(...candidates.map(b=>b.y+b.height))+50);
        const roi = image.roi(new cv.Rect(x1,y1,x2-x1,y2-y1));
        const rawBoxes = engine.find_boxes(cv, roi, params);
        roi.delete();
        const { columns, filtered_boxes } = engine.sort_into_columns(rawBoxes, params);
        engine.sort_into_rows(filtered_boxes, params);
        engine.missing(columns, params);
        centers = engine.find_questions(columns, params).slice(0,40).map(q => q.boxes.map(b => [b.xy[0]+x1,b.xy[1]+y1]));
        // Row reconstruction is deliberately shared input to both fill engines.
      }
      const params = engine.set_box(cv, image, ...selection);
      const questions = centers.map((row, number) => ({ number, response: 'Blank', response_box: null,
        boxes: row.map((xy, i) => ({ xy, letter: String.fromCharCode(65+i), bool: false, colour: null })) }));
      const student = { questions, incomplete: [] };
      engine.find_responses(cv, student, image, params);
      cv.imshow(canvas, image);
      const dataUrl = canvas.toDataURL('image/png');
      image.delete();
      const blank = new cv.Mat(200, 200, cv.CV_8UC4, new cv.Scalar(255,255,255,255));
      let rejectsBlank = false;
      try { engine.set_box(cv, blank, 20,20,100,100); } catch { rejectsBlank = true; }
      blank.delete();
      return { dataUrl, selection, centers, w: params.w, h: params.h, outer: params.outer.map(p=>[p.x,p.y]),
        inner: params.inner.map(p=>[p.x,p.y]), fill_limit: params.fill_limit,
        responses: questions.map(q=>q.response), filled: questions.map(q=>q.boxes.map(b=>b.bool)), rejectsBlank };
    }, name);
    const image = join(scratch, `${name}.png`), spec = join(scratch, `${name}.json`);
    await writeFile(image, Buffer.from(actual.dataUrl.split(',')[1], 'base64'));
    await writeFile(spec, JSON.stringify({ image, selection: actual.selection, centers: actual.centers }));
    const oracle = spawnSync(process.env.PYTHON || 'python3', ['tests/calibration_reference.py', spec], { encoding: 'utf8' });
    assert.equal(oracle.status, 0, oracle.stderr);
    const expected = JSON.parse(oracle.stdout);
    for (const field of ['w','h','outer','inner','responses','filled']) assert.deepEqual(actual[field], expected[field], `${name}: ${field}`);
    assert.ok(Math.abs(actual.fill_limit - expected.fill_limit) < 1e-9, `${name}: threshold`);
    assert.equal(actual.rejectsBlank, true);
    if (name === 'synthetic') {
      assert.deepEqual(actual.responses.slice(0,4), ['Blank','A','B',false]);
      assert.ok(actual.inner.length > 4, 'Measured rounded inner contour must not become a fixed rectangle');
    } else assert.equal(actual.responses.length, 40);
    console.log(`${name}: contours, threshold, ${actual.filled.flat().length} box decisions and ${actual.responses.length} responses match original Python`);
    await page.close();
  }
} finally {
  await browser.close(); await server.close(); await rm(scratch, { recursive: true, force: true });
}
