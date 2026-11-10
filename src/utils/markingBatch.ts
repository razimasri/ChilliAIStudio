import type { CalibrationParams, ExamFile, StudentResult } from "../types";
import { getExamPage } from "./pdfProcessor";
import { releaseResultImages } from "./imageStore";
import { MarkingClient } from "./markingClient";
export function markingWorkerCount(
  pageCount: number,
  hardware: { hardwareConcurrency?: number; deviceMemory?: number } = navigator,
): number {
  // Each 600-DPI scan and independent OpenCV heap is large. Unknown memory is conservative.
  return Math.min(
    Math.max(1, pageCount),
    (hardware.deviceMemory ?? 0) >= 8 && (hardware.hardwareConcurrency ?? 0) >= 4 ? 2 : 1,
  );
}
export interface MarkingProgress {
  index: number;
  completed: number;
  workers: number;
  active: number[];
  done: number[];
  message: string;
}
export async function markBatch(
  files: ExamFile[],
  names: string[],
  params: CalibrationParams,
  signal: AbortSignal,
  progress: (state: MarkingProgress) => void,
  workerCount = markingWorkerCount(files.length),
): Promise<StudentResult[]> {
  signal.throwIfAborted();
  const count = Math.min(files.length, Math.max(1, Math.min(2, Math.floor(workerCount) || 1)));
  const controller = new AbortController(),
    clients: MarkingClient[] = [],
    results: StudentResult[] = [];
  let next = 0,
    completed = 0,
    failure: unknown;
  const active = new Set<number>(),
    done = new Set<number>();
  const cancel = () => {
    controller.abort();
    clients.forEach((client) => client.dispose());
  };
  signal.addEventListener("abort", cancel, { once: true });
  const jobs: Promise<void>[] = [];
  try {
    for (let slot = 0; slot < count; slot++) clients.push(new MarkingClient());
    for (const client of clients)
      jobs.push(
        (async () => {
          while (next < files.length) {
            controller.signal.throwIfAborted();
            const index = next++,
              name =
                names[index] || `Student ${String(index + 1).padStart(2, "0")}`;
            active.add(index);
            const report = (message: string) =>
              progress({
                index,
                completed,
                workers: count,
                active: [...active],
                done: [...done],
                message: `Page ${index + 1} (${name}): ${message}`,
              });
            try {
              report("Preparing full-resolution page…");
              // Only each available worker's current input is prepared, never a whole batch.
              const raster = await getExamPage(
                files[index],
                undefined,
                controller.signal,
              );
              let input: Blob;
              try {
                const response = await fetch(raster.url, {
                  signal: controller.signal,
                });
                if (!response.ok)
                  throw new Error("Could not read page raster.");
                input = await response.blob();
              } finally {
                raster.release();
              }
              controller.signal.throwIfAborted();
              const result = await client.mark(
                input,
                name,
                index,
                params,
                report,
              );
              if (controller.signal.aborted) {
                releaseResultImages([result]);
                controller.signal.throwIfAborted();
              }
              result.originalDataUrl = files[index].dataUrl;
              results[index] = result;
              completed++;
              active.delete(index);
              done.add(index);
              report("Complete");
            } catch (error) {
              if (!controller.signal.aborted) {
                failure = new Error(
                  `Page ${index + 1} (${name}): ${error instanceof Error ? error.message : String(error)}`,
                );
                cancel();
              }
              throw error;
            }
          }
        })(),
      );
    const settled = await Promise.allSettled(jobs);
    signal.throwIfAborted();
    if (failure) throw failure;
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    return results;
  } catch (error) {
    cancel();
    await Promise.allSettled(jobs);
    releaseResultImages(results.filter(Boolean));
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    clients.forEach((client) => client.dispose());
  }
}
