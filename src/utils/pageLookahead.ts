import type { ExamFile } from "../types";
import type { WorkerHardware } from "./workerPolicy";
import {
  getMarkingPage,
  prepareMarkingPage,
  type PageImage,
} from "./pdfProcessor";

export function canPrepareAhead(
  file: ExamFile,
  hardware: WorkerHardware = navigator,
): boolean {
  const memory = hardware.deviceMemory || 0;
  const pixels = file.width * file.height;
  return (
    memory >= 4 &&
    Number.isFinite(pixels) &&
    pixels > 0 &&
    pixels * 4 <= 192 * 1024 ** 2
  );
}

/** One unclaimed native raster, plus inputs already owned by active marking jobs. */
export class PageLookahead {
  private slot?: {
    index: number;
    controller: AbortController;
    promise: Promise<PageImage>;
  };
  private closed = false;
  private readonly cancel = () => this.dispose();
  constructor(
    private files: ExamFile[],
    private signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    signal.addEventListener("abort", this.cancel, { once: true });
  }
  prepare(index: number): void {
    if (this.closed || index >= this.files.length || this.slot?.index === index)
      return;
    if (!canPrepareAhead(this.files[index])) {
      this.clear();
      return;
    }
    this.clear();
    const controller = new AbortController();
    const promise = prepareMarkingPage(this.files[index], controller.signal);
    this.slot = { index, controller, promise };
    void promise.catch(() => {}); // The consumer observes preparation failures.
  }
  take(index: number): Promise<PageImage> {
    this.signal.throwIfAborted();
    const slot = this.slot;
    if (!slot || slot.index !== index)
      return getMarkingPage(this.files[index], this.signal);
    this.slot = undefined;
    // Ownership transfers to the marking job, including cancellation while pending.
    const abort = () => slot.controller.abort();
    this.signal.addEventListener("abort", abort, { once: true });
    return slot.promise
      .then((page) => {
        if (this.signal.aborted) {
          page.release();
          this.signal.throwIfAborted();
        }
        return page;
      })
      .catch((error) => {
        this.signal.throwIfAborted();
        throw error;
      })
      .finally(() => this.signal.removeEventListener("abort", abort));
  }
  private clear(): void {
    const old = this.slot;
    this.slot = undefined;
    if (old) {
      old.controller.abort();
      void old.promise.then(
        (page) => page.release(),
        () => {},
      );
    }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.cancel);
    this.clear();
  }
}
