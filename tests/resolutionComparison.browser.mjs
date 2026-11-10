// Diagnostic only: no reduced-resolution path is enabled in the application.
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
    const { setup } = await import("/tests/helpers/sampleCalibration.ts");
    const { getMarkingPage } = await import("/src/utils/pdfProcessor.ts");
    const { MarkingClient } = await import("/src/utils/markingClient.ts");
    const { releaseResultImages } = await import("/src/utils/imageStore.ts");
    const { pages, params } = await setup();
    const client = new MarkingClient(),
      report = [];
    try {
      for (let i = 0; i < 4; i++) {
        const input = await getMarkingPage(pages[i]);
        const original = input.bitmap;
        const small = new OffscreenCanvas(
          Math.round(original.width / 4),
          Math.round(original.height / 4),
        );
        small
          .getContext("2d")
          .drawImage(original, 0, 0, small.width, small.height);
        const restored = new OffscreenCanvas(original.width, original.height);
        restored
          .getContext("2d")
          .drawImage(small, 0, 0, restored.width, restored.height);
        const reduced = await createImageBitmap(restored);
        small.width = small.height = restored.width = restored.height = 0;
        let full, quarter;
        try {
          full = await client.mark(original, "Comparison", i, params, () => {});
          quarter = await client.mark(
            reduced,
            "Comparison",
            i,
            params,
            () => {},
          );
          report.push({
            page: i + 1,
            originalQuestions: full.responses.length,
            reducedQuestions: quarter.responses.length,
            originalScore: full.score,
            reducedScore: quarter.score,
            changedAnswers: Array.from(
              {
                length: Math.max(
                  full.responses.length,
                  quarter.responses.length,
                ),
              },
              (_, q) => q,
            )
              .filter((q) => full.responses[q] !== quarter.responses[q])
              .map((q) => q + 1),
          });
        } catch (error) {
          report.push({
            page: i + 1,
            originalQuestions: full?.responses.length,
            originalScore: full?.score,
            error: String(error),
          });
        } finally {
          input.release();
          reduced.close();
          releaseResultImages([full, quarter].filter(Boolean));
        }
      }
    } finally {
      client.dispose();
    }
    return report;
  });
  assert.equal(report.length, 4);
  assert.ok(
    report.every((page) => page.originalQuestions === 27),
    "Full-resolution baseline must mark all 27 questions",
  );
  console.log(
    JSON.stringify(
      {
        experiment:
          "quarter width/height (one sixteenth pixels), then upscale to original dimensions",
        report,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
