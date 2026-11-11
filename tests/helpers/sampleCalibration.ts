// Test-only calibration of the bundled real samples, using existing engine rules.
import * as engine from "../../src/utils/omrEngine.ts";
import { getCV } from "../../src/utils/cvLoader.ts";
import { loadExamFile, getExamPage } from "../../src/utils/pdfProcessor.ts";
export async function setup(name = "IGSample") {
  const cv = await getCV();
  const source = new File(
    [await (await fetch(`/samples/${name}.pdf`)).blob()],
    `${name}.pdf`,
    { type: "application/pdf" },
  );
  const pages = await loadExamFile(source);
  const first = await getExamPage(pages[0]);
  const template = await engine.renderToCanonicalMat(cv, first.url);
  const { rotated, rect } = engine.rotation(cv, template);
  template.delete();
  first.release();
  // Find a tight empty-box selection and grid bounds on the actual sample.
  const threshold = engine.get_thresh(cv, rotated);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(
    threshold,
    contours,
    hierarchy,
    cv.RETR_CCOMP,
    cv.CHAIN_APPROX_SIMPLE,
  );
  const candidates = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const b = cv.boundingRect(c);
    const inGrid =
      name === "IBSample"
        ? b.y > 3000 && b.y < 5850 && b.x > 700 && b.x < 4000
        : b.y > 2800 && b.y < 6400 && b.x > 1800 && b.x < 4350;
    const boxSize =
      name === "IBSample"
        ? b.width >= 170 && b.width <= 220 && b.height >= 140 && b.height <= 200
        : b.width >= 70 && b.width <= 110 && b.height >= 18 && b.height <= 35;
    if (hierarchy.data32S[i * 4 + 3] === -1 && inGrid && boxSize)
      candidates.push(b);
    c.delete();
  }
  threshold.delete();
  contours.delete();
  hierarchy.delete();
  if (!candidates.length)
    throw new Error(`${name}: no calibration box candidates`);
  candidates.sort((a, b) => a.y - b.y || a.x - b.x);
  let box;
  const ordered =
    name === "IBSample" ? [candidates[1], ...candidates] : candidates;
  for (const sample of ordered) {
    for (const padding of [0, 1, 2, 3, 4]) {
      try {
        const measured = engine.set_box(
          cv,
          rotated,
          sample.x - padding,
          sample.y - padding,
          sample.x + sample.width + padding,
          sample.y + sample.height + padding,
        );
        if (
          measured.w >= sample.width * 0.8 &&
          measured.h >= sample.height * 0.8
        ) {
          box = measured;
          break;
        }
      } catch {
        /* Select another empty box when original validation rejects it. */
      }
    }
    if (box) break;
  }
  if (!box) throw new Error(`${name}: no valid calibration selection`);
  const params = {
    rect,
    ...box,
    x1: Math.max(0, Math.min(...candidates.map((b) => b.x)) - 50),
    y1: Math.max(0, Math.min(...candidates.map((b) => b.y)) - 50),
    x2: Math.min(4800, Math.max(...candidates.map((b) => b.x + b.width)) + 50),
    y2: Math.min(6840, Math.max(...candidates.map((b) => b.y + b.height)) + 50),
    key: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, "A"])),
    names: [],
  };
  params.columnLayout = engine.calibrateColumnLayout(cv, rotated, params);
  rotated.delete();
  params.key = Object.fromEntries(
    Array.from({ length: name === "IGSample" ? 27 : 30 }, (_, i) => [i, "A"]),
  );
  return { pages, params };
}
