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
    const { PreparedDownloads } =
      await import("/src/utils/preparedDownloads.ts");
    const { calculateQuestionStats } = await import("/src/utils/omrEngine.ts");
    const check = (value, message) => {
      if (!value) throw Error(message);
    };
    const Native = Worker;
    let live = 0,
      peak = 0,
      created = 0;
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        this.tag = String(args[0]).includes("/src/utils/");
        if (this.tag) {
          created++;
          live++;
          peak = Math.max(peak, live);
        }
      }
      terminate() {
        if (this.tag && !this.closed) {
          this.closed = true;
          live--;
        }
        super.terminate();
      }
    };
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 12;
    canvas.getContext("2d").fillRect(0, 0, 8, 12);
    const url = canvas.toDataURL();
    const students = [
        {
          name: "Test",
          score: 1,
          total: 1,
          percentage: 100,
          responses: ["A"],
          annotatedDataUrl: url,
        },
      ],
      key = { 0: "A" },
      stats = calculateQuestionStats(students, key);
    const job = new PreparedDownloads(students, stats, key),
      phases = [];
    job.onProgress = (stage) => {
      if (phases.at(-1) !== stage) phases.push(stage);
    };
    const pdf = job.pdf(),
      all = job.all();
    check(
      pdf === job.pdf() && all === job.all(),
      "Clicks must share pending preparation promises",
    );
    const [pdfBlob, zipBlob] = await Promise.all([pdf, all]);
    check(
      (await job.pdf()) === pdfBlob && (await job.all()) === zipBlob,
      "Completed files must stay cached",
    );
    check(
      peak === 1 && live === 0 && created === 2,
      "Only one PDF worker then one ZIP worker should run",
    );
    check(phases.join() === "pdf,zip", "Preparation order changed");
    job.dispose();
    const cancelled = new PreparedDownloads(students, stats, key),
      pending = cancelled.all().catch((e) => e);
    cancelled.dispose();
    const error = await pending;
    check(
      error.name === "AbortError" && live === 0,
      "Unmount/reset must terminate preparation",
    );
    const broken = [
      { ...students[0], annotatedDataUrl: "data:image/png;base64,broken" },
    ];
    const retry = new PreparedDownloads(broken, stats, key);
    const failed = await retry.all().catch((e) => e);
    check(failed instanceof Error, "Invalid image must fail explicitly");
    broken[0].annotatedDataUrl = url;
    await retry.all();
    check(live === 0, "Retry must finish without retained workers");
    retry.dispose();
    return {
      sharedJobs: true,
      cachedFiles: true,
      peakWorkers: peak,
      cancelled: true,
      retried: true,
    };
  });
  assert.equal(report.peakWorkers, 1);
  console.log(report);
} finally {
  await browser.close();
  await server.close();
}
