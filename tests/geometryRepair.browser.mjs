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
  await page.goto(server.resolvedUrls.local[0] + "tests/fixtures/worker.html");
  const report = await page.evaluate(async () => {
    const e = await import("/src/utils/omrEngine.ts");
    const { getCV } = await import("/src/utils/cvLoader.ts");
    const { markBatch } = await import("/src/utils/markingBatch.ts");
    const { MarkingClient } = await import("/src/utils/markingClient.ts");
    const { resolveStudentResponse, preserveManualResponses } =
      await import("/src/utils/grading.ts");
    const { releaseAllImages } = await import("/src/utils/imageStore.ts");
    const check = (condition, message) => {
      if (!condition) throw Error(message);
    };
    const liveWorkers = new Set(),
      liveUrls = new Set();
    const NativeWorker = Worker,
      createUrl = URL.createObjectURL.bind(URL),
      revokeUrl = URL.revokeObjectURL.bind(URL);
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        liveWorkers.add(this);
      }
      terminate() {
        liveWorkers.delete(this);
        super.terminate();
      }
    };
    URL.createObjectURL = (blob) => {
      const url = createUrl(blob);
      if (blob.type === "image/png") liveUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      liveUrls.delete(url);
      revokeUrl(url);
    };
    const cv = await getCV(),
      canvas = document.createElement("canvas");
    canvas.width = 4800;
    canvas.height = 6840;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 4800, 6840);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 4;
    ctx.strokeRect(300, 900, 4200, 5300);
    for (let block = 0; block < 2; block++)
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 6; r++)
          ctx.strokeRect(
            700 + block * 2000 + c * 300,
            1300 + r * 600,
            120,
            100,
          );
    ctx.fillStyle = "black";
    ctx.fillRect(725, 1325, 65, 50);
    const source = canvas.toDataURL("image/png");
    canvas.width = 0;
    const mat = await e.renderToCanonicalMat(cv, source),
      { rotated, rect } = e.rotation(cv, mat);
    mat.delete();
    const box = e.set_box(cv, rotated, 997, 1297, 1123, 1403);
    const params = {
      ...box,
      rect,
      x1: 500,
      y1: 1100,
      x2: 4300,
      y2: 6000,
      key: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, "A"])),
      names: [],
    };
    params.columnLayout = e.calibrateColumnLayout(cv, rotated, params);
    rotated.delete();
    const files = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      name: "Native fixture",
      dataUrl: source,
      width: 4800,
      height: 6840,
      rotation: 0,
      pageIndex: 0,
      totalPages: 1,
      size: 0,
    }));
    let latest,
      initial = 0,
      replacements = 0,
      consistencyProgress = 0;
    const results = await markBatch(
      files,
      [],
      params,
      new AbortController().signal,
      (p) => {
        if (p.message.includes("relative box")) consistencyProgress++;
      },
      2,
      (result, previous) => {
        if (previous) {
          replacements++;
          check(
            result.responses[0] === "A",
            "Corrected position was not re-read from actual pixels",
          );
          latest = preserveManualResponses(result, latest, params.key);
          return latest;
        }
        initial++;
        if (result.index === 0) {
          // Inject the metadata produced by an incorrect detector assignment. The PDF pixels stay unchanged.
          result.questions[0].boxes[0].xy[0] += 300;
          result.questions[0].response = "B";
          result.responses[0] = "B";
          result.score = 0;
          latest = resolveStudentResponse(result, 1, "D", params.key);
          return latest;
        }
      },
    );
    check(
      initial === 4 && replacements === 1,
      "Only the anomalous page should be reprocessed",
    );
    check(consistencyProgress > 0, "Repair progress not reported");
    check(
      results[0].responses[0] === "A" && results[0].responses[1] === "D",
      "Reread/manual response conflict",
    );
    check(
      results[0].score === 1 && results[0].manualResponses[1] === "D",
      "Grade/manual choice not preserved",
    );
    check(
      results[0].geometryCheck.adjustments.length === 1,
      "Expected exactly one geometric repair",
    );
    check(
      results.every((r) => r.geometryCheck.pagesCompared === 4),
      "All pages should participate",
    );
    const client = new MarkingClient();
    try {
      await client.annotate(results[0], params);
      check(results[0].score === 1, "Final annotation changed grade");
    } finally {
      client.dispose();
      releaseAllImages();
    }
    check(
      liveWorkers.size === 0 && liveUrls.size === 0,
      "Completed repair leaked workers or images",
    );
    const controller = new AbortController();
    let cancelled = false;
    try {
      await markBatch(
        files,
        [],
        params,
        controller.signal,
        (progress) => {
          if (progress.message.includes("relative box positions"))
            controller.abort();
        },
        2,
        (result) => {
          if (result.index === 0) result.questions[0].boxes[0].xy[0] += 300;
        },
      );
    } catch (error) {
      cancelled = error.name === "AbortError";
    }
    check(
      cancelled,
      "Cancellation during geometry repair returned partial results",
    );
    check(
      liveWorkers.size === 0 && liveUrls.size === 0,
      "Cancelled geometry repair leaked workers or images",
    );
    return {
      cancelled,
      liveWorkers: liveWorkers.size,
      liveUrls: liveUrls.size,
      initial,
      replacements,
      consistencyProgress,
      score: results[0].score,
      manual: results[0].responses[1],
      adjustment: results[0].geometryCheck.adjustments[0],
    };
  });
  assert.equal(report.replacements, 1);
  console.log(JSON.stringify(report));
  console.log(
    "Native geometry reread, score update, selective reprocessing and manual preservation passed.",
  );
} finally {
  await browser.close();
  await server.close();
}
