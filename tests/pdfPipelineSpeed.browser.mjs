import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
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
  page.on("console", (m) => {
    if (m.text().startsWith("pipeline:")) console.log(m.text());
  });
  await page.goto(server.resolvedUrls.local[0] + "tests/fixtures/worker.html");
  const report = await page.evaluate(
    async (count) => {
      const { setup } = await import("/tests/helpers/sampleCalibration.ts");
      const { markBatch } = await import("/src/utils/markingBatch.ts");
      const { PageLookahead } = await import("/src/utils/pageLookahead.ts");
      const { releaseAllImages } = await import("/src/utils/imageStore.ts");
      const { pages, params } = await setup("IGSample"),
        prepare = PageLookahead.prototype.prepare;
      const files = Array.from({ length: count }, (_, i) => ({
        ...pages[i % pages.length],
        id: "bench-" + i,
      }));
      const reports = [];
      let expected;
      try {
        for (const mode of ["on", "off"]) {
          PageLookahead.prototype.prepare =
            mode === "on" ? prepare : function () {};
          const start = performance.now();
          const results = await markBatch(
            files,
            [],
            params,
            new AbortController().signal,
            () => {},
            2,
          );
          const ms = performance.now() - start;
          const state = JSON.stringify(
            results.map((s) => ({
              responses: s.responses,
              score: s.score,
              questions: s.questions.map((q) => ({
                number: q.number,
                response: q.response,
                reason: q.reviewReason,
                boxes: q.boxes.map((b) => b.xy),
              })),
            })),
          );
          if (expected && state !== expected)
            throw Error("Lookahead changed marking results");
          expected = state;
          reports.push({ mode, pages: count, workers: 2, ms });
          console.log("pipeline: " + JSON.stringify(reports.at(-1)));
          releaseAllImages();
        }
      } finally {
        PageLookahead.prototype.prepare = prepare;
      }
      return {
        hardware: {
          cores: navigator.hardwareConcurrency,
          memory: navigator.deviceMemory,
        },
        reports,
      };
    },
    Number(process.env.PAGE_COUNT || 20),
  );
  assert.equal(report.reports.length, 2);
  if (process.env.PIPELINE_REPORT)
    await writeFile(
      process.env.PIPELINE_REPORT,
      JSON.stringify(report, null, 2),
    );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await server.close();
}
