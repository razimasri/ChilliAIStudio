import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../src/utils/geometryConsensus.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { geometryConsensus } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const params = {
  w: 90,
  h: 70,
  columnLayout: {
    centres: [100, 220, 340, 460, 1000, 1120, 1240, 1360],
    choices: 4,
  },
};
const pages = [];
for (let index = 0; index < 8; index++) {
  const questions = [];
  for (let number = 0; number < 12; number++) {
    const boxes = [];
    for (let c = 0; c < 4; c++) {
      const block = Math.floor(number / 6),
        scale = 1 + index * 0.015;
      boxes.push({
        letter: String.fromCharCode(65 + c),
        xy: [
          Math.round((100 + block * 900 + c * 120) * scale + index * 9),
          Math.round(
            (200 + (number % 6) * 100) * (1 + index * 0.01) - index * 7,
          ),
        ],
      });
    }
    questions.push({ number, boxes });
  }
  pages.push({ index, questions });
}
assert.equal(
  geometryConsensus(pages, params).size,
  0,
  "Translation and scaling must not be anomalies",
);
const broken = structuredClone(pages);
broken[4].questions[2].boxes[1].xy[0] += 110;
broken[4].questions[8].boxes[3].xy[1] += 95;
for (const box of broken[6].questions[3].boxes) box.xy[1] += 100;
const repairs = geometryConsensus(broken, params);
assert.equal(repairs.size, 2);
assert.equal(repairs.get(4).length, 2);
assert.equal(repairs.get(6).length, 4);
for (const [index, adjustments] of repairs)
  for (const fix of adjustments) {
    const expected = pages[index].questions[fix.question].boxes.find(
      (b) => b.letter === fix.letter,
    ).xy;
    assert.ok(Math.abs(fix.to[0] - expected[0]) <= 2);
    assert.ok(Math.abs(fix.to[1] - expected[1]) <= 2);
  }
assert.equal(
  geometryConsensus(broken.slice(4, 7), params).size,
  0,
  "Three pages cannot provide three independent supporting votes",
);
assert.equal(
  geometryConsensus(broken, { ...params, columnLayout: undefined }).size,
  0,
);
assert.equal(
  pages[4].questions[2].boxes[1].xy[0] + 110,
  broken[4].questions[2].boxes[1].xy[0],
  "Model must not mutate observations",
);
const jitter = structuredClone(pages);
jitter.forEach((p, i) =>
  p.questions.forEach((q) =>
    q.boxes.forEach((b, c) => {
      b.xy[0] += ((i + c) % 3) - 1;
      b.xy[1] += ((i + c) % 5) - 2;
    }),
  ),
);
assert.equal(
  geometryConsensus(jitter, params).size,
  0,
  "Small scan jitter must be preserved",
);
console.log(
  "Relative geometry: translation/scale, box/row outliers, supported consensus, sparse batches and jitter passed.",
);

const divided = structuredClone(pages);
for (const page of divided.slice(0, 4)) page.questions[2].boxes[1].xy[0] += 110;
assert.equal(geometryConsensus(divided, params).size, 0, 'A divided class has no reliable majority to force');
const thin = { ...params, h: 12 };
const thinJitter = structuredClone(pages);
thinJitter[4].questions[2].boxes[1].xy[1] += 8;
assert.equal(geometryConsensus(thinJitter, thin).size, 0, 'Thin boxes need a spacing-based jitter floor');
thinJitter[4].questions[2].boxes[1].xy[1] += 12;
assert.equal(geometryConsensus(thinJitter, thin).get(4).length, 1, 'Larger thin-box displacement should still be corrected');
