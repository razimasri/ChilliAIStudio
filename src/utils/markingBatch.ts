import { preserveManualResponses } from "./grading";
import { geometryConsensus } from "./geometryConsensus";
import type { CalibrationParams, ExamFile, StudentResult } from "../types";
import { getMarkingPage } from "./pdfProcessor";
import { PageLookahead } from "./pageLookahead";
import { releaseResultImages } from "./imageStore";
import { MarkingClient } from "./markingClient";
import { workerPlan, trialIsFaster } from "./workerPolicy";
export function markingWorkerCount(
  pageCount: number,
  hardware: { hardwareConcurrency?: number; deviceMemory?: number } = navigator,
): number {
  return workerPlan(
    Array.from({ length: Math.max(1, pageCount) }, () => ({
      width: 4800,
      height: 6840,
    })),
    hardware,
  ).initial;
}
export interface MarkingProgress {
  index: number;
  completed: number;
  workers: number;
  active: number[];
  done: number[];
  message: string;
  autoPhase?: "warmup" | "baseline" | "trial" | "selected";
  autoCeiling?: number;
}
export async function markBatch(
  files: ExamFile[],
  names: string[],
  params: CalibrationParams,
  signal: AbortSignal,
  progress: (state: MarkingProgress) => void,
  workerCount?: number,
  onResult?: (
    result: StudentResult,
    previous?: StudentResult,
  ) => StudentResult | void,
): Promise<StudentResult[]> {
  signal.throwIfAborted();
  if (!files.length) return [];
  params = { ...params }; // Batch-local reference learned from the first marked page.
  const needsReference = !params.columnLayout && files.length > 1;
  const automatic = workerCount === undefined;
  const plan = workerPlan(files);
  let count = Math.min(
    files.length,
    automatic
      ? plan.initial
      : Math.max(1, Math.min(4, Math.floor(workerCount) || 1)),
  );
  let phase: MarkingProgress["autoPhase"] = automatic ? "warmup" : undefined;
  const labels = {
    warmup: "warming up",
    baseline: "measuring",
    trial: "testing",
    selected: "selected",
  };
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
  const lookahead = new PageLookahead(files, controller.signal);
  const jobs: Promise<void>[] = [];
  const grow = (target: number) => {
    while (clients.length < target) clients.push(new MarkingClient());
  };
  const shrink = (target: number) => {
    while (clients.length > target) clients.pop()!.dispose();
  };
  try {
    const run = async (end: number) => {
      jobs.length = 0;
      for (const client of clients)
        jobs.push(
          (async () => {
            while (next < end) {
              controller.signal.throwIfAborted();
              const index = next++,
                name =
                  names[index] ||
                  `Student ${String(index + 1).padStart(2, "0")}`;
              active.add(index);
              const report = (message: string) =>
                progress({
                  index,
                  completed,
                  workers: count,
                  active: [...active],
                  done: [...done],
                  autoPhase: phase,
                  autoCeiling: automatic ? plan.ceiling : undefined,
                  message: `${automatic ? `Auto: ${labels[phase!]} ${count} workers · ` : ""}Page ${index + 1} (${name}): ${message}`,
                });
              try {
                report("Preparing full-resolution page…");
                // Prepare one native input per available worker, without PNG round trips.
                const prepared = lookahead.take(index);
                lookahead.prepare(next);
                const raster = await prepared;
                let result: StudentResult;
                try {
                  controller.signal.throwIfAborted();
                  if (!raster.bitmap)
                    throw new Error("Could not prepare native page pixels.");
                  result = await client.mark(
                    raster.bitmap,
                    name,
                    index,
                    params,
                    report,
                    index === 0 && !params.columnLayout
                      ? { learnColumnLayout: true }
                      : undefined,
                  );
                } finally {
                  raster.release();
                }
                if (controller.signal.aborted) {
                  releaseResultImages([result]);
                  controller.signal.throwIfAborted();
                }
                if (index === 0 && result.learnedColumnLayout)
                  params.columnLayout = result.learnedColumnLayout;
                result.originalDataUrl = files[index].dataUrl;
                const published = onResult?.(result);
                results[index] =
                  published && typeof published === "object"
                    ? published
                    : result;
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
    };
    grow(count);
    // Detect page 1 once; its complete column identities protect all later pages.
    // Empty-box calibration no longer scans the grid or duplicates this work.
    if (needsReference) await run(1);
    if (automatic && plan.canTrial && workerPlan(files.slice(next)).canTrial) {
      await run(Math.min(files.length, next + count)); // Warm the existing runtimes first.
      phase = "baseline";
      let started = performance.now(),
        before = completed;
      await run(Math.min(files.length, next + count * 2));
      const baselineRate = (completed - before) / (performance.now() - started),
        baseCount = count;
      phase = "trial";
      count = plan.ceiling;
      grow(count);
      started = performance.now();
      before = completed;
      await run(Math.min(files.length, next + count));
      const trialRate = (completed - before) / (performance.now() - started);
      if (!trialIsFaster(baselineRate, trialRate)) {
        count = baseCount;
        shrink(count);
      }
      phase = "selected";
    } else if (automatic) phase = "selected";
    await run(files.length);
    signal.throwIfAborted();
    lookahead.dispose();
    const repairs = geometryConsensus(results, params);
    for (const result of results)
      if (params.columnLayout && results.length >= 4)
        result.geometryCheck = {
          pagesCompared: results.length,
          boxesTracked: result.questions.reduce(
            (sum, q) => sum + q.boxes.length,
            0,
          ),
          adjustments: repairs.get(result.index) || [],
        };
    // The ordinary pass already supplied all coordinates. Only anomalous pages
    // are rasterized/read again; the native scans are never retained as a batch.
    let repairNext = 0;
    const affected = [...repairs.entries()];
    jobs.length = 0;
    for (const client of clients)
      jobs.push(
        (async () => {
          while (repairNext < affected.length) {
            controller.signal.throwIfAborted();
            const [index, adjustments] = affected[repairNext++],
              previous = results[index];
            active.add(index);
            done.delete(index);
            const report = (message: string) =>
              progress({
                index,
                completed,
                workers: count,
                active: [...active],
                done: [...done],
                message: `Checking relative box positions · Page ${index + 1}: ${message}`,
              });
            report(`Re-reading ${adjustments.length} anomalous box positions…`);
            const raster = await getMarkingPage(
              files[index],
              controller.signal,
            );
            let result: StudentResult;
            try {
              controller.signal.throwIfAborted();
              if (!raster.bitmap)
                throw new Error("Could not prepare native page pixels.");
              result = await client.mark(
                raster.bitmap,
                previous.name,
                index,
                params,
                report,
                {
                  adjustments,
                  reviewQuestions: [
                    ...new Set([
                      ...previous.incomplete.map((q) => q.number),
                      ...Object.keys(previous.manualResponses || {}).map(
                        Number,
                      ),
                    ]),
                  ],
                },
              );
            } finally {
              raster.release();
            }
            if (controller.signal.aborted) {
              releaseResultImages([result]);
              controller.signal.throwIfAborted();
            }
            result.originalDataUrl = files[index].dataUrl;
            result.geometryCheck = previous.geometryCheck;
            // The callback merges any manual answers entered during background work.
            results[index] = result;
            try {
              result = preserveManualResponses(result, previous, params.key);
              results[index] = result;
              const published = onResult?.(result, previous);
              results[index] =
                published && typeof published === "object" ? published : result;
            } finally {
              releaseResultImages([previous]);
            }
            active.delete(index);
            done.add(index);
            report("Alignment checked");
          }
        })().catch((error) => {
          if (!controller.signal.aborted) {
            failure = error;
            cancel();
          }
          throw error;
        }),
      );
    const repaired = await Promise.allSettled(jobs);
    signal.throwIfAborted();
    if (failure) throw failure;
    const rejectedRepair = repaired.find(
      (result) => result.status === "rejected",
    );
    if (rejectedRepair?.status === "rejected") throw rejectedRepair.reason;
    return results;
  } catch (error) {
    cancel();
    await Promise.allSettled(jobs);
    releaseResultImages(results.filter(Boolean));
    throw error;
  } finally {
    lookahead.dispose();
    signal.removeEventListener("abort", cancel);
    clients.forEach((client) => client.dispose());
  }
}
