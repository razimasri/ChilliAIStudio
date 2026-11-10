import type { ExamFile } from "../types";
export interface WorkerHardware {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}
/** Browser hints are ceilings, not a prediction of throughput or free RAM. */
export function workerPlan(
  files: Pick<ExamFile, "width" | "height">[],
  hardware: WorkerHardware = navigator,
) {
  const cores = hardware.hardwareConcurrency || 1,
    memory = hardware.deviceMemory || 0;
  const pixels = Math.max(
    4800 * 6840,
    ...files.map((file) => file.width * file.height),
  );
  // Approximate five RGBA buffers plus a WASM allowance; leave most device RAM for
  // calibration, the browser, retained output images and other applications.
  const estimatedWorkerBytes = pixels * 4 * 5 + 128 * 1024 ** 2;
  const memorySlots = memory
    ? Math.floor(
        (memory * 1024 ** 3 * (memory >= 8 ? 0.4 : 0.25)) /
          estimatedWorkerBytes,
      )
    : 1;
  const cpuSlots = cores >= 4 ? cores - 1 : cores;
  const ceiling = Math.max(
    1,
    Math.min(4, files.length || 1, cpuSlots, memorySlots),
  );
  const initial = Math.min(2, ceiling);
  // Two warm-up pages, four baseline pages, one page per trial worker, and a
  // useful tail. Small exams don't pay for a concurrency experiment.
  const canTrial =
    ceiling > initial &&
    files.length >= initial + initial * 2 + ceiling + initial;
  return { initial, ceiling, canTrial, estimatedWorkerBytes };
}
export function trialIsFaster(
  baselinePagesPerMs: number,
  trialPagesPerMs: number,
) {
  return trialPagesPerMs >= baselinePagesPerMs * 1.1;
}
