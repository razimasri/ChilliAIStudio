import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
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
    if (m.text().startsWith("columns:")) console.log(m.text());
  });
  await page.goto(server.resolvedUrls.local[0] + "tests/fixtures/worker.html");
  const report = await page.evaluate(async () => {
    const e = await import("/src/utils/omrEngine.ts");
    const { geometryConsensus } =
      await import("/src/utils/geometryConsensus.ts");
    const { setup } = await import("/tests/helpers/sampleCalibration.ts");
    const { getCV } = await import("/src/utils/cvLoader.ts");
    const { getMarkingPage } = await import("/src/utils/pdfProcessor.ts");
    const { MarkingClient } = await import("/src/utils/markingClient.ts");
    const { releaseAllImages } = await import("/src/utils/imageStore.ts");
    const cv = await getCV(),
      reports = [];
    const check = (condition, message) => {
      if (!condition) throw Error(message);
    };
    for (const name of ["IBSample", "IGSample"]) {
      const { pages, params } = await setup(name);
      const cohort = [];
      check(
        params.columnLayout?.centres.length === (name === "IBSample" ? 12 : 8),
        `${name}: complete calibration should identify all columns`,
      );
      check(params.columnLayout.choices === 4, `${name}: calibration choices`);
      for (let index = 0; index < pages.length; index++) {
        const lease = await getMarkingPage(pages[index]);
        const raw = await e.renderScanMat(cv, lease.bitmap);
        const { rotated, rect } = e.rotation(cv, raw);
        raw.delete();
        const scan = e.scale(cv, rotated, rect, params);
        rotated.delete();
        const roi = scan.roi(
          new cv.Rect(
            params.x1,
            params.y1,
            params.x2 - params.x1,
            params.y2 - params.y1,
          ),
        );
        try {
          const boxes = e.find_boxes(cv, roi, params);
          const reconstruct = (layout, input = boxes) => {
            const local = { ...params, columnLayout: layout };
            const { columns, filtered_boxes } = e.sort_into_columns(
              input,
              local,
            );
            const counts = columns.map((c) => c.length);
            e.sort_into_rows(filtered_boxes, local);
            e.missing(columns, local);
            const questions = e.find_questions(columns, local),
              student = { questions, incomplete: [] };
            e.find_responses(cv, student, roi, local);
            return { questions, counts };
          };
          const previous = reconstruct(undefined),
            current = reconstruct(params.columnLayout);
          check(
            current.questions.length === Object.keys(params.key).length,
            `${name} page ${index + 1}: lost questions`,
          );
          const changed = current.questions
            .filter((q, i) => q.response !== previous.questions[i]?.response)
            .map((q) => q.number + 1);
          if (previous.counts.length === params.columnLayout.centres.length) {
            check(
              JSON.stringify(current.questions) ===
                JSON.stringify(previous.questions),
              `${name} page ${index + 1}: complete grid behavior changed`,
            );
          }
          if (name === "IBSample" && index === 6) {
            check(
              previous.counts.length === 11,
              "Regression no longer reproduces missing A column",
            );
            check(
              current.counts.length === 12,
              "A column identity not restored",
            );
            check(
              current.counts[8] === 2,
              "Sparse A column should retain its two detections",
            );
            for (const number of [28, 29]) {
              const q = current.questions[number];
              check(
                q.boxes.map((b) => b.letter).join("") === "ABCD",
                `Question ${number + 1}: lost option`,
              );
              check(
                Math.abs(q.boxes[0].xy[0] - params.columnLayout.centres[8]) <
                  params.w / 4,
                `Question ${number + 1}: A moved to B`,
              );
              check(
                q.boxes[1].xy[0] - q.boxes[0].xy[0] > params.w * 0.8,
                `Question ${number + 1}: A/B overlap`,
              );
            }
            // A completely obscured column must preserve the same option slots.
            const noA = boxes.filter(
              (b) =>
                Math.abs(b[0] - params.columnLayout.centres[8]) > params.w / 2,
            );
            const obscured = reconstruct(params.columnLayout, noA);
            check(
              obscured.counts[8] === 0,
              "Fully obscured A was not kept as an empty column",
            );
            check(
              Math.abs(
                obscured.questions[28].boxes[0].xy[0] -
                  params.columnLayout.centres[8],
              ) < 1,
              "Missing A placeholder shifted",
            );
            const client = new MarkingClient();
            try {
              const input = await getMarkingPage(pages[index]);
              try {
                const result = await client.mark(
                  input.bitmap,
                  "Maya Lin",
                  index,
                  params,
                  () => {},
                );
                check(
                  JSON.stringify(
                    result.questions.map((q) => q.boxes.map((b) => b.xy)),
                  ) ===
                    JSON.stringify(
                      current.questions.map((q) => q.boxes.map((b) => b.xy)),
                    ),
                  "Native worker grid differs",
                );
                const final = await client.annotate(result, params);
                const image = await createImageBitmap(
                  await (await fetch(final)).blob(),
                );
                const canvas = document.createElement("canvas");
                canvas.width = 1000;
                canvas.height = 650;
                canvas
                  .getContext("2d")
                  .drawImage(
                    image,
                    params.x1 + params.columnLayout.centres[8] - 150,
                    params.y1,
                    1000,
                    650,
                    0,
                    0,
                    1000,
                    650,
                  );
                window.columnRegressionCrop = canvas.toDataURL("image/png");
                image.close();
              } finally {
                input.release();
              }
            } finally {
              client.dispose();
              releaseAllImages();
            }
          }
          cohort.push({ index, questions: current.questions });
          reports.push({
            sample: name,
            page: index + 1,
            previousColumns: previous.counts.length,
            columns: current.counts.length,
            changedAnswers: changed,
          });
          console.log(`columns: ${name} page ${index + 1} passed`);
        } finally {
          roi.delete();
          scan.delete();
          lease.release();
        }
      }
      const repairs = geometryConsensus(cohort, params);
      check(
        repairs.size === 0,
        `${name}: unexpected consensus repairs ${JSON.stringify([...repairs])}`,
      );
      console.log(
        `columns: ${name} relative consensus preserved all healthy positions`,
      );
    }
    return reports;
  });
  const crop = await page.evaluate(() => window.columnRegressionCrop);
  if (process.env.COLUMN_REGRESSION_CROP)
    await writeFile(
      process.env.COLUMN_REGRESSION_CROP,
      Buffer.from(crop.split(",")[1], "base64"),
    );
  assert.equal(report.length, 25);
  console.log(JSON.stringify(report));
  console.log(
    "All 25 sample pages, sparse/obscured columns, complete-grid parity and native worker/final annotation passed.",
  );
} finally {
  await browser.close();
  await server.close();
}
