import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = await readFile(
  new URL('../src/utils/calibrationClient.ts', import.meta.url),
  'utf8',
);
const js = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  })
  .outputText.replaceAll(
    'import.meta.url',
    "'https://example.test/src/utils/calibrationClient.js'",
  );
const workers = [];
globalThis.Worker = class {
  requests = [];
  terminated = false;
  constructor() {
    workers.push(this);
  }
  postMessage(request) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data) {
    this.onmessage?.({ data });
  }
};
const { CalibrationClient } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);
const client = new CalibrationClient(),
  signal = new AbortController().signal;
const input = new Blob(['native']),
  aligned = new Blob(['aligned']);
const prepare = client.prepare(input, signal, () => {});
assert.equal(workers.length, 1);
workers[0].reply({
  type: 'ready',
  image: aligned,
  thumbnail: new Blob(),
  angle: 0,
  rect: [0, 0, 4800, 6840],
});
await prepare;
assert.equal(
  workers[0].terminated,
  false,
  'Prepared runtime must remain alive',
);
const params = {},
  area = { x1: 10, y1: 10, x2: 100, y2: 100 },
  box = { w: 90, h: 90 };
const first = client.measure(params, area, signal);
assert.equal(
  workers[0].requests[1].input,
  undefined,
  'Normal measurement must reuse the Mat',
);
await assert.rejects(
  client.prepare(input, signal, () => {}),
  /already processing/,
);
workers[0].reply({ type: 'error', message: 'Not an empty box' });
await assert.rejects(first, /Not an empty box/);
const retry = client.measure(params, area, signal);
assert.equal(workers.length, 1);
assert.equal(workers[0].requests[2].input, undefined);
workers[0].reply({ type: 'ready', box });
assert.deepEqual((await retry).box, box);
const abort = new AbortController();
const cancelled = client.measure(params, area, abort.signal);
abort.abort();
await assert.rejects(cancelled, (error) => error.name === 'AbortError');
assert.equal(workers[0].terminated, true);
let completed = false;
const recovered = client.measure(params, area, signal).then((result) => {
  completed = true;
  return result;
});
assert.equal(workers.length, 2);
assert.equal(
  workers[1].requests[0].input,
  aligned,
  'After cancellation decode the saved aligned PNG once',
);
workers[0].reply({ type: 'ready', box: { w: 1, h: 1 } });
await Promise.resolve();
assert.equal(
  completed,
  false,
  'A late reply from the old worker must be ignored',
);
workers[1].reply({ type: 'ready', box });
assert.deepEqual((await recovered).box, box);
const warm = client.measure(params, area, signal);
assert.equal(workers[1].requests[1].input, undefined);
workers[1].reply({ type: 'ready', box });
await warm;
client.dispose();
assert.ok(workers.every((worker) => worker.terminated));
await assert.rejects(client.measure(params, area, signal));
console.log(
  'Calibration session: one worker/Mat across retries, cancellation recovery, stale-reply rejection and disposal passed.',
);
