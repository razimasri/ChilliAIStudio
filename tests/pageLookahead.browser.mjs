import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const report = await page.evaluate(async () => {
    const p = await import("/src/utils/pdfProcessor.ts");
    const { PageLookahead, canPrepareAhead } =
      await import("/src/utils/pageLookahead.ts");
    const { releaseAllImages } = await import("/src/utils/imageStore.ts");
    const check = (ok, message) => {
      if (!ok) throw Error(message);
    };
    let encoded = 0,
      created = 0,
      peak = 0;
    const live = new Set();
    const toBlob = HTMLCanvasElement.prototype.toBlob,
      make = createImageBitmap.bind(window);
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      encoded++;
      return toBlob.apply(this, args);
    };
    window.createImageBitmap = async (...args) => {
      const image = await make(...args),
        close = image.close.bind(image);
      created++;
      live.add(image);
      peak = Math.max(peak, live.size);
      image.close = () => {
        live.delete(image);
        close();
      };
      return image;
    };
    const source = new File(
      [await (await fetch("/samples/IGSample.pdf")).blob()],
      "scan.pdf",
      { type: "application/pdf" },
    );
    const files = await p.loadExamFile(source);
    check(files.length === 14 && encoded === 0, "Upload stays metadata-only");
    await p.warmExamPage(files[0]);
    check(encoded === 1, "Warm only the first native raster");
    const first = await p.getExamPage(files[0]);
    first.release();
    const warmed = await p.getMarkingPage(files[0]);
    check(
      encoded === 1,
      "Calibration and marking must reuse the warmed raster",
    );
    warmed.release();
    check(
      !canPrepareAhead(files[0], { deviceMemory: 2 }) &&
        !canPrepareAhead(files[0], {}),
      "No speculative native raster on low/unknown memory",
    );
    check(
      !canPrepareAhead(
        { ...files[0], width: 10000, height: 10000 },
        { deviceMemory: 8 },
      ),
      "Very large scans must not be speculated",
    );
    Object.defineProperty(navigator, "deviceMemory", {
      value: 8,
      configurable: true,
    });
    const controller = new AbortController(),
      lookahead = new PageLookahead(files, controller.signal);
    const wait = async (condition) => {
      const until = performance.now() + 30000;
      while (!condition()) {
        if (performance.now() > until) throw Error("Preparation timed out");
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    lookahead.prepare(1);
    await wait(() => live.size === 1);
    const prepared = [...live][0],
      before = created;
    lookahead.prepare(1);
    await new Promise((r) => setTimeout(r, 20));
    check(
      created === before,
      "Repeated preparation must share the pending/ready page",
    );
    const loan = await lookahead.take(1);
    check(
      loan.bitmap === prepared,
      "Consumer must receive the prepared bitmap",
    );
    const pixels = (image) => {
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
      c.width = c.height = 0;
      return bytes;
    };
    const expected = await p.getMarkingPage(files[1]);
    const a = pixels(loan.bitmap),
      b = pixels(expected.bitmap);
    expected.release();
    check(
      a.length === b.length && a.every((v, i) => v === b[i]),
      "Prefetch changed native pixels",
    );
    lookahead.prepare(2);
    await wait(() => live.size === 2);
    lookahead.prepare(3);
    await wait(() => created >= before + 3 && live.size === 2);
    lookahead.dispose();
    await wait(() => live.size === 1);
    check(
      loan.bitmap.width > 0,
      "Disposal must preserve the consumer-owned input",
    );
    loan.release();
    const aborter = new AbortController(),
      cancelled = new PageLookahead(files, aborter.signal);
    cancelled.prepare(4);
    const pending = cancelled.take(4).catch((e) => e);
    aborter.abort();
    const error = await pending;
    check(
      error.name === "AbortError",
      "Cancellation must stop pending preparation",
    );
    cancelled.dispose();
    const turn = await p.getMarkingPage({
      ...files[0],
      rotation: 90,
      width: files[0].height,
      height: files[0].width,
    });
    check(
      turn.bitmap.width === files[0].height &&
        turn.bitmap.height === files[0].width,
      "Rotation must invalidate cached raster",
    );
    turn.release();
    check(live.size === 0, "No prepared bitmap should survive disposal");
    p.releaseUnusedSources(files, []);
    releaseAllImages();
    return {
      pages: files.length,
      encodedDuringWarmup: 1,
      nativePixelsMatch: true,
      peakOwnedPlusPrepared: peak,
      liveBitmaps: live.size,
      cancelled: true,
    };
  });
  assert.equal(report.liveBitmaps, 0);
  console.log(report);
} finally {
  await browser.close();
  await server.close();
}
