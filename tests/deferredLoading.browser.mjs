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
    const { queuePage } = await import("/src/utils/pageQueue.ts");
    const { releaseAllImages } = await import("/src/utils/imageStore.ts");
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const allocated = new Set();
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      allocated.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      allocated.delete(url);
      revoke(url);
    };
    let encoded = 0;
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      encoded++;
      return toBlob.apply(this, args);
    };
    const source = new File(
      [await (await fetch("/samples/IGSample.pdf")).blob()],
      "IGSample.pdf",
      { type: "application/pdf" },
    );
    const start = performance.now();
    const pages = await p.loadExamFile(source);
    const metadataMs = performance.now() - start;
    check(
      pages.length === 14 && encoded === 0,
      "Upload must read metadata without rasterizing",
    );
    check(
      !performance
        .getEntriesByType("resource")
        .some((e) => /opencv/i.test(e.name)),
      "OpenCV must stay lazy during upload",
    );
    const preview = await p.getExamPage(pages[0], 360);
    const decode = async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    };
    const small = await decode(preview.url);
    check(
      Math.max(small.width, small.height) <= 360,
      "Preview must stay small",
    );
    preview.release();
    const count = encoded;
    const again = await p.getExamPage(pages[0], 360);
    again.release();
    check(encoded === count, "Repeated preview should use the bounded cache");
    const fullStart = performance.now();
    const full = await p.getExamPage(pages[0]);
    const firstFullMs = performance.now() - fullStart;
    const native = await decode(full.url);
    check(
      native.width === 4909 && native.height === 6967,
      "Full render must keep native 600-DPI dimensions",
    );
    const fullCount = encoded;
    const repeat = await p.getExamPage(pages[0]);
    repeat.release();
    check(
      encoded === fullCount,
      "Calibration/marking should reuse the last full page",
    );

    // Independent reference: original eager renderer's viewport, rounding and draw settings.
    const pdfjs = await import("/node_modules/pdfjs-dist/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc =
      "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ data: await source.arrayBuffer() })
      .promise;
    let comparedPixels = 0;
    const compare = async (actualUrl, index, rotation = 0) => {
      const pdfPage = await pdf.getPage(index + 1),
        viewport = pdfPage.getViewport({ scale: 600 / 72 });
      const expected = document.createElement("canvas");
      expected.width = Math.ceil(viewport.width - 1e-7);
      expected.height = Math.ceil(viewport.height - 1e-7);
      await pdfPage.render({
        canvasContext: expected.getContext("2d"),
        viewport,
      }).promise;
      let reference = expected;
      if (rotation) {
        reference = document.createElement("canvas");
        reference.width = expected.height;
        reference.height = expected.width;
        const ctx = reference.getContext("2d");
        ctx.translate(reference.width / 2, reference.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(expected, -expected.width / 2, -expected.height / 2);
      }
      const image = await decode(actualUrl),
        actual = document.createElement("canvas");
      actual.width = image.width;
      actual.height = image.height;
      actual.getContext("2d").drawImage(image, 0, 0);
      check(
        actual.width === reference.width && actual.height === reference.height,
        "Reference dimensions differ",
      );
      // Read strips to avoid holding two more entire RGBA pages in JavaScript.
      for (let y = 0; y < actual.height; y += 128) {
        const h = Math.min(128, actual.height - y),
          a = actual.getContext("2d").getImageData(0, y, actual.width, h).data,
          b = reference
            .getContext("2d")
            .getImageData(0, y, actual.width, h).data;
        check(
          a.every((v, i) => v === b[i]),
          `Changed page pixels at strip ${y}`,
        );
        comparedPixels += actual.width * h;
      }
      expected.width = actual.width = 0;
      if (reference !== expected) reference.width = 0;
      pdfPage.cleanup();
    };
    await compare(full.url, 0);
    full.release();
    const rotated = await p.getExamPage({
      ...pages[1],
      rotation: 90,
      width: pages[1].height,
      height: pages[1].width,
    });
    await compare(rotated.url, 1, 90);
    rotated.release();
    await pdf.destroy();

    const order = [];
    let release;
    const running = queuePage(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const background = queuePage(async () => {
      order.push("preview");
    }, true);
    const urgent = queuePage(async () => {
      order.push("mark");
    });
    const controller = new AbortController();
    const cancelled = queuePage(
      async () => {
        throw new Error("Cancelled task ran");
      },
      true,
      controller.signal,
    ).then(
      () => false,
      (e) => e.name === "AbortError",
    );
    controller.abort();
    release();
    await Promise.all([running, background, urgent]);
    check(await cancelled, "Queued preview cancellation failed");
    check(
      order.join(",") === "mark,preview",
      "Full pages must take queue priority",
    );

    p.releaseUnusedSources(pages, []);
    releaseAllImages();
    check(allocated.size === 0, "Image URLs leaked");
    const { exportArchive } = await import("/src/utils/exportArchive.ts");
    const abort = new AbortController();
    const stopped = exportArchive(
      [{ name: "x.txt", data: new Blob(["test"]) }],
      () => {},
      abort.signal,
    ).then(
      () => false,
      (e) => e.name === "AbortError",
    );
    abort.abort();
    check(await stopped, "ZIP cancellation failed");
    return {
      pages: pages.length,
      metadataMs,
      firstFullMs,
      comparedPixels,
      encoded,
      liveImageUrls: allocated.size,
    };
  });
  assert.equal(report.pages, 14);
  assert.equal(report.liveImageUrls, 0);
  console.log(JSON.stringify(report));
  console.log(
    "Metadata-only upload, small cached previews, 600-DPI pixel equivalence including rotation, priority/cancellation, URL cleanup and ZIP cancellation passed",
  );
  await page.reload();
  await page.evaluate(() => {
    window.encodedSizes = [];
    window.livePreviews = new Set();
    const encode = HTMLCanvasElement.prototype.toBlob,
      create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.encodedSizes.push([this.width, this.height]);
      return encode.apply(this, args);
    };
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob.type === "image/png") window.livePreviews.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.livePreviews.delete(url);
      revoke(url);
    };
  });
  await page
    .getByRole("button", { name: "Load Cambridge IGCSE Sample" })
    .click();
  await page.getByTitle("Rotate 90°").first().waitFor();
  assert.equal(await page.getByTitle("Rotate 90°").count(), 14);
  await page.locator('img[alt="Page 1"][src^="blob:"]').waitFor();
  await page.getByTitle("Rotate 90°").first().click();
  await page.getByTitle("Remove", { exact: true }).last().click();
  assert.equal(await page.getByTitle("Rotate 90°").count(), 13);
  assert.equal(
    await page.evaluate(() =>
      window.encodedSizes.every(([w, h]) => Math.max(w, h) <= 360),
    ),
    true,
    "Upload/rotate must not rasterize full pages",
  );
  await page.getByRole("button", { name: "Clear All" }).click();
  await page.waitForFunction(() => window.livePreviews.size === 0);
  assert.equal(await page.getByTitle("Rotate 90°").count(), 0);
  console.log(
    "Actual upload UI: sample, small previews, deferred rotate, remove and clear release all preview URLs",
  );
} finally {
  await browser.close();
  await server.close();
}
