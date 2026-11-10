import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../src/utils/workerPolicy.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { workerPlan, trialIsFaster } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const pages = Array.from({ length: 20 }, () => ({ width: 4800, height: 6840 }));
assert.equal(workerPlan(pages, { hardwareConcurrency: 8 }).ceiling, 1);
assert.equal(
  workerPlan(pages, { hardwareConcurrency: 8, deviceMemory: 4 }).ceiling,
  1,
);
const desktop = workerPlan(pages, { hardwareConcurrency: 8, deviceMemory: 8 });
assert.deepEqual(
  [desktop.initial, desktop.ceiling, desktop.canTrial],
  [2, 4, true],
);
assert.equal(
  workerPlan(pages.slice(0, 4), { hardwareConcurrency: 8, deviceMemory: 8 })
    .canTrial,
  false,
);
assert.equal(
  workerPlan(pages, { hardwareConcurrency: 2, deviceMemory: 8 }).ceiling,
  2,
);
assert.equal(
  workerPlan(pages, { hardwareConcurrency: 4, deviceMemory: 8 }).ceiling,
  3,
);
assert.equal(
  workerPlan([{ width: 8000, height: 8000 }, ...pages], {
    hardwareConcurrency: 8,
    deviceMemory: 8,
  }).ceiling,
  2,
);
assert.equal(
  workerPlan(pages.slice(0, 1), { hardwareConcurrency: 8, deviceMemory: 8 })
    .ceiling,
  1,
);
assert.equal(trialIsFaster(1, 1.09), false);
assert.equal(trialIsFaster(1, 1.11), true);
console.log(
  "Worker policy: CPU/memory/page-size limits, short batches and throughput threshold passed.",
);
