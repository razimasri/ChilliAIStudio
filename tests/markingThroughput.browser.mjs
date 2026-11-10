// Twenty pages: bundled fourteen IGCSE scans plus six repeated pages.
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const reports = [];
try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.text().startsWith("bench20:")) console.log(m.text());
  });
  await page.goto(server.resolvedUrls.local[0] + "tests/fixtures/worker.html");
  await page.evaluate(async () => {
    window.bench = await (
      await import("/tests/helpers/sampleCalibration.ts")
    ).setup();
  });
  for (const setting of (process.env.COUNTS || "2,4,auto").split(",")) {
    const r = await page.evaluate(async (setting) => {
      const { markBatch } = await import("/src/utils/markingBatch.ts");
      const { workerPlan } = await import("/src/utils/workerPolicy.ts");
      const { releaseAllImages } = await import("/src/utils/imageStore.ts");
      const { pages, params } = window.bench;
      const files = Array.from({ length: 20 }, (_, i) => ({
        ...pages[i % pages.length],
        id: `bench-${i}`,
      }));
      let lastPhase = "";
      const phases = [];
      const start = performance.now();
      const results = await markBatch(
        files,
        [],
        params,
        new AbortController().signal,
        (p) => {
          if (p.autoPhase && lastPhase !== p.autoPhase) {
            lastPhase = p.autoPhase;
            phases.push({
              phase: p.autoPhase,
              workers: p.workers,
              ms: performance.now() - start,
            });
            console.log(
              `bench20: ${setting}: ${p.autoPhase} ${p.workers} workers`,
            );
          }
        },
        setting === "auto" ? undefined : Number(setting),
        (r) => console.log(`bench20: ${setting} finished ${r.index + 1}`),
      );
      const report = {
        setting,
        ms: performance.now() - start,
        hardware: {
          cores: navigator.hardwareConcurrency,
          memory: navigator.deviceMemory,
        },
        plan: workerPlan(files),
        phases,
        scores: results.map((r) => r.score),
        responses: results.map((r) => r.responses),
      };
      releaseAllImages();
      return report;
    }, setting);
    reports.push(r);
    console.log(JSON.stringify({ ...r, responses: undefined }));
    if (process.env.BENCHMARK_REPORT)
      await writeFile(
        process.env.BENCHMARK_REPORT,
        JSON.stringify(reports, null, 2),
      );
  }
} finally {
  await browser.close();
  await server.close();
}

for (const result of reports.slice(1)) {
  assert.deepEqual(result.responses, reports[0].responses);
  assert.deepEqual(result.scores, reports[0].scores);
}
console.log("All worker settings produced identical answers and scores.");
